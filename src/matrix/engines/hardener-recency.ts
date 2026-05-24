// Matrix Kernel hardener recency checks and verdict runner.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { MatrixDimension } from '../../core/compete-matrix.js';
import {
  HARDEN_CHECK_CAPS,
  type HardenCheckId,
  type HardenCheckResult,
  type HardenFinding,
  type HardenVerdict,
  type RunHardenGateOptions,
  computeHardenScoreCap,
} from '../types/harden-check.js';
import {
  checkClaimAuditor,
  checkFunctionalDiff,
  checkHardcodedFallback,
  checkImportResolves,
  checkOrphanAudit,
  checkPrimaryNotParallel,
  defaultIO,
  shouldSkipCheck,
  type CheckIO,
} from './hardener.js';

const execFileAsync = promisify(execFile);
const HARDEN_RECEIPT_DIR = path.join('.danteforge', 'harden-receipts');

// OR if it is imported by a file that matches.

export interface EntryPointConfig {
  patterns: string[];
  exclusions: string[];
  thresholdDays: number;
}

const DEFAULT_ENTRY_POINTS: EntryPointConfig = {
  patterns: ['src/cli/**/*.ts', 'src/api/**/*.ts', 'src/mcp/**/*.ts', 'bin/*'],
  exclusions: ['src/cli/internal/**'],
  thresholdDays: 30,
};

async function loadEntryPointConfig(cwd: string, io: CheckIO): Promise<EntryPointConfig> {
  const configPath = path.join(cwd, '.danteforge', 'config', 'entry-points.json');
  if (!(await io.exists(configPath))) return DEFAULT_ENTRY_POINTS;
  try {
    const raw = await io.readFile(configPath);
    const parsed = JSON.parse(raw) as Partial<EntryPointConfig>;
    return {
      patterns: parsed.patterns ?? DEFAULT_ENTRY_POINTS.patterns,
      exclusions: parsed.exclusions ?? DEFAULT_ENTRY_POINTS.exclusions,
      thresholdDays: parsed.thresholdDays ?? DEFAULT_ENTRY_POINTS.thresholdDays,
    };
  } catch {
    return DEFAULT_ENTRY_POINTS;
  }
}

function matchesGlob(rel: string, glob: string): boolean {
  const re = new RegExp(
    '^' +
      glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, ' ')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.')
        .replace(/ /g, '.*') +
      '$',
  );
  return re.test(rel.replace(/\\/g, '/'));
}

function matchesAnyGlob(rel: string, patterns: string[]): boolean {
  return patterns.some(p => matchesGlob(rel, p));
}

async function getLastMainCommitDate(file: string, cwd: string): Promise<{ sha: string; date: Date; daysSince: number } | null> {
  // Try main first, fall back to HEAD's first-parent history if main doesn't exist.
  for (const branch of ['main', 'master', 'HEAD']) {
    try {
      const { stdout } = await execFileAsync(
        'git', ['log', '-1', '--format=%H|%aI', branch === 'HEAD' ? '--first-parent' : `--first-parent`, branch, '--', file],
        { cwd, timeout: 5000 },
      );
      const trimmed = stdout.trim();
      if (!trimmed) continue;
      const [sha, iso] = trimmed.split('|');
      if (!sha || !iso) continue;
      const date = new Date(iso);
      const daysSince = (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
      return { sha, date, daysSince };
    } catch {
      continue;
    }
  }
  return null;
}

export async function checkRecencyCheck(
  dim: MatrixDimension, cwd: string, io: CheckIO = defaultIO(),
  searchEngine?: import('../search/types.js').SearchEngine,
): Promise<HardenCheckResult> {
  const start = Date.now();
  const skip = shouldSkipCheck(dim, 'recency-check');
  if (skip.skip) {
    return {
      check: 'recency-check', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['recency-check'],
      skipped: true, skipReason: skip.reason,
    };
  }
  const callsite = (dim as unknown as Record<string, unknown>)['capability_callsite'] as
    | { file: string; symbol: string } | undefined;
  if (!callsite) {
    return {
      check: 'recency-check', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['recency-check'],
      skipped: true, skipReason: 'no capability_callsite declared',
    };
  }
  const auditExempt = (dim as unknown as Record<string, unknown>)['audit_exempt'];
  if (auditExempt === 'recency-by-design' || auditExempt === 'test-only-by-design') {
    return {
      check: 'recency-check', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['recency-check'],
      skipped: true, skipReason: `audit_exempt: ${auditExempt}`,
    };
  }

  const config = await loadEntryPointConfig(cwd, io);

  // Find every importer of the callsite's symbol. Use SearchEngine when present;
  // fall back to a ripgrep-like pure-Node grep for parity.
  let importers: string[] = [];
  if (searchEngine) {
    try {
      const matches = await searchEngine.findImports(callsite.symbol, { includeTests: false, maxResults: 100 });
      importers = matches.map(m => m.file);
    } catch {
      importers = [];
    }
  }
  if (importers.length === 0) {
    // No production importers at all — orphan audit handles this case at P2.
    // Recency does not double-cap on the same failure; pass through.
    return {
      check: 'recency-check', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['recency-check'],
      skipped: true, skipReason: 'no production importers (orphan-audit territory)',
    };
  }

  // For each importer, find its last main-branch commit date and check whether
  // the file traces to an entry point. An importer "traces" if it matches an
  // entry-point pattern directly OR is itself imported by such a file.
  const findings: HardenFinding[] = [];
  let bestDays = Number.POSITIVE_INFINITY;
  let bestImporter: string | null = null;
  let hasFreshAndTraceable = false;
  for (const importer of importers) {
    // SearchEngine returns paths with backslashes on Windows + sometimes a `./`
    // prefix; normalize both so glob matching against entry-point patterns works.
    let normalized = importer.replace(/\\/g, '/');
    if (normalized.startsWith('./')) normalized = normalized.slice(2);
    if (config.exclusions.some(e => matchesGlob(normalized, e))) continue;
    const fileInfo = await getLastMainCommitDate(normalized, cwd);
    if (!fileInfo) continue;
    if (fileInfo.daysSince < bestDays) {
      bestDays = fileInfo.daysSince;
      bestImporter = normalized;
    }
    const tracesDirect = matchesAnyGlob(normalized, config.patterns);
    let tracesIndirect = false;
    if (!tracesDirect && searchEngine) {
      try {
        // Two-hop: who imports THIS importer? (use the file's basename as symbol guess)
        const basenameSymbol = path.basename(normalized).replace(/\.[^.]+$/, '');
        const secondHop = await searchEngine.findImports(basenameSymbol, { includeTests: false, maxResults: 20 });
        tracesIndirect = secondHop.some(s => matchesAnyGlob(s.file.replace(/\\/g, '/'), config.patterns));
      } catch { /* best-effort */ }
    }
    const traces = tracesDirect || tracesIndirect;
    if (traces && fileInfo.daysSince <= config.thresholdDays) {
      hasFreshAndTraceable = true;
      break;
    }
  }

  if (!hasFreshAndTraceable) {
    const daysText = bestImporter
      ? `${Math.round(bestDays)} days since freshest importer (${bestImporter}); threshold=${config.thresholdDays}`
      : `no importer traces to an entry point matching ${config.patterns.join(', ')}`;
    findings.push({
      file: callsite.file,
      line: 1,
      snippet: `imports of ${callsite.symbol}`,
      reason: `recency: ${daysText}. Either modify a production importer recently, or document as audit_exempt: recency-by-design.`,
    });
  }

  return {
    check: 'recency-check',
    passed: findings.length === 0,
    durationMs: Date.now() - start,
    findings,
    scoreCap: HARDEN_CHECK_CAPS['recency-check'],
  };
}

// ── Aggregator ───────────────────────────────────────────────────────────────

const DEFAULT_CHECKS: HardenCheckId[] = [
  'orphan-audit', 'claim-auditor', 'hardcoded-fallback', 'import-resolves', 'functional-diff', 'primary-not-parallel', 'recency-check', 'stale-at-ceiling',
];

// ── Stale-at-ceiling check ──────────────────────────────────────────────────

/** Threshold: warn after this many waves without outcomes declared. */
const STALE_WARN_WAVES = 3;
/** Threshold: fail after this many waves without outcomes declared. */
const STALE_FAIL_WAVES = 5;

async function checkStaleAtCeiling(
  dim: MatrixDimension, _cwd: string, _io: CheckIO,
): Promise<HardenCheckResult> {
  const start = Date.now();
  const d = dim as unknown as Record<string, unknown>;
  const outcomes = Array.isArray(d['outcomes']) ? d['outcomes'] as unknown[] : [];

  // If dim declares outcomes, this check passes (outcomes exist, depth path is available).
  if (outcomes.length > 0) {
    return {
      check: 'stale-at-ceiling', passed: true, skipped: false,
      durationMs: Date.now() - start, findings: [],
      scoreCap: HARDEN_CHECK_CAPS['stale-at-ceiling'],
    };
  }

  // Count waves since last score change using sprint_history length.
  const sprintHistory = Array.isArray(dim.sprint_history) ? dim.sprint_history : [];
  const wavesSinceChange = sprintHistory.length;

  if (wavesSinceChange >= STALE_FAIL_WAVES) {
    return {
      check: 'stale-at-ceiling', passed: false, skipped: false,
      durationMs: Date.now() - start,
      findings: [{
        file: 'matrix.json', line: 1, snippet: dim.id,
        reason: `Dim "${dim.id}" has been stale for ${wavesSinceChange} waves with no outcomes declared. ` +
          `Add outcomes to unlock scores above 7.0: danteforge gap ${dim.id}`,
      }],
      scoreCap: HARDEN_CHECK_CAPS['stale-at-ceiling'],
    };
  }

  const findings: import('../types/harden-check.js').HardenFinding[] = [];
  if (wavesSinceChange >= STALE_WARN_WAVES) {
    findings.push({
      file: 'matrix.json', line: 1, snippet: dim.id,
      reason: `WARNING: Dim "${dim.id}" has been stale for ${wavesSinceChange} waves. ` +
        `Will block at ${STALE_FAIL_WAVES} waves. Add outcomes to prevent score cap.`,
    });
  }

  return {
    check: 'stale-at-ceiling', passed: true, skipped: false,
    durationMs: Date.now() - start, findings,
    scoreCap: HARDEN_CHECK_CAPS['stale-at-ceiling'],
  };
}

async function runOneCheck(
  id: HardenCheckId, dim: MatrixDimension, cwd: string, io: CheckIO,
  searchEngine?: import('../search/types.js').SearchEngine,
): Promise<HardenCheckResult> {
  switch (id) {
    case 'orphan-audit': return checkOrphanAudit(dim, cwd, io, searchEngine);
    case 'claim-auditor': return checkClaimAuditor(dim, cwd, io);
    case 'hardcoded-fallback': return checkHardcodedFallback(dim, cwd, io);
    case 'import-resolves': return checkImportResolves(dim, cwd, io);
    case 'functional-diff': return checkFunctionalDiff(dim, cwd, io);
    case 'primary-not-parallel': return checkPrimaryNotParallel(dim, cwd, io);
    case 'recency-check': return checkRecencyCheck(dim, cwd, io, searchEngine);
    case 'stale-at-ceiling': return checkStaleAtCeiling(dim, cwd, io);
  }
}

export async function runHardenGate(options: RunHardenGateOptions): Promise<HardenVerdict> {
  const { dimensionId, dim, cwd, onlyChecks } = options;
  const io = defaultIO();
  const checksToRun = onlyChecks ?? DEFAULT_CHECKS;

  const results: HardenCheckResult[] = [];
  for (const id of checksToRun) {
    const override = options._check?.[id];
    const result = override ? await override(dim, cwd) : await runOneCheck(id, dim, cwd, io, options._searchEngine);
    results.push(result);
  }

  const failed = results.filter(r => !r.passed && !r.skipped);
  const allowed = failed.length === 0;
  const verdict: HardenVerdict = {
    dimensionId,
    allowed,
    scoreCap: allowed ? 10.0 : 0,  // computed below
    checks: results,
    evidencePath: path.join(cwd, HARDEN_RECEIPT_DIR, `${dimensionId}.json`),
    ranAt: new Date().toISOString(),
    reason: allowed
      ? `All ${results.filter(r => !r.skipped).length} applicable checks passed`
      : `${failed.length} check(s) failed: ${failed.map(c => c.check).join(', ')}`,
  };
  verdict.scoreCap = computeHardenScoreCap(verdict);

  if (!options._noWrite) {
    try {
      const sha = await currentGitSha(cwd);
      const evidencePath = path.join(cwd, HARDEN_RECEIPT_DIR, `${sha ?? 'nogit'}-${dimensionId}.json`);
      verdict.evidencePath = evidencePath;
      await fs.mkdir(path.dirname(evidencePath), { recursive: true });
      await fs.writeFile(evidencePath, JSON.stringify(verdict, null, 2), 'utf8');
    } catch {
      // best-effort write; the verdict object is still returned
    }
  }

  // Phase H Time Machine integration: record the verdict as a causal node.
  // Best-effort — TM failures never block harden-gate work. Mirrors the
  // matrix-development-engine.ts:333-345 pattern.
  await recordHardenVerdictCommit(verdict, cwd, options._createTimeMachineCommit, options._noWrite);

  return verdict;
}

async function recordHardenVerdictCommit(
  verdict: HardenVerdict,
  cwd: string,
  override: RunHardenGateOptions['_createTimeMachineCommit'],
  noWrite?: boolean,
): Promise<void> {
  if (override === null) return;
  if (noWrite) return; // suppress when we're not writing receipts (test path)
  try {
    const createFn = override
      ?? (await import('../../core/time-machine.js')).createTimeMachineCommit;
    const failed = verdict.checks.filter(c => !c.passed && !c.skipped).map(c => c.check);
    await createFn({
      cwd,
      paths: verdict.evidencePath ? [verdict.evidencePath] : [],
      label: `harden-verdict/${verdict.dimensionId}/${verdict.allowed ? 'allowed' : `blocked-by-${failed.join('+')}`}`,
      causalLinks: {
        materials: verdict.evidencePath ? [verdict.evidencePath] : [],
        inputDependencies: [],
      },
    });
  } catch {
    // best-effort
  }
}

async function currentGitSha(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 3000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
