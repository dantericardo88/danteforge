// score-audit.ts — `danteforge score-audit` — Completion integrity audit.
// Implements the 14-point integrity protocol: treats all prior scores as
// untrusted, independently verifies each dimension against strict evidence
// requirements, applies score caps, and writes audited values back.
//
// "The gap is the value. Inflating scores hides what to build next."

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { loadMatrix, saveMatrix } from '../../core/compete-matrix.js';
import {
  scanForStubs,
  isInCriticalPath,
  runCapabilityTest,
  computeScoreCap,
  buildAuditRecord,
  auditScoringScript,
} from '../../core/integrity-audit.js';
import type { IntegrityAuditRecord, IntegrityAuditSummary } from '../../matrix/types/integrity.js';

const execFileAsync = promisify(execFile);
const AUDIT_DIR = '.danteforge/integrity-audit';

// ── Options ───────────────────────────────────────────────────────────────────

export interface ScoreAuditOptions {
  cwd?: string;
  /** Only audit this dimension id */
  dimension?: string;
  /** Apply score caps and write back to matrix.json */
  apply?: boolean;
  /** Emit JSON summary instead of human-readable output */
  json?: boolean;
  /** Skip running capability tests (faster, less reliable) */
  skipCapTests?: boolean;
  /** Injection seams for tests */
  _loadMatrix?: typeof loadMatrix;
  _saveMatrix?: typeof saveMatrix;
  _scanStubs?: typeof scanForStubs;
  _runCapTest?: typeof runCapabilityTest;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getGitSha(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

async function runDeclaredOutcomes(
  outcomes: Array<{ id: string; command?: string }>,
  cwd: string,
): Promise<{ total: number; passing: number }> {
  if (!outcomes || outcomes.length === 0) return { total: 0, passing: 0 };
  let passing = 0;
  for (const outcome of outcomes) {
    if (!outcome.command) continue;
    try {
      const shell = process.platform === 'win32' ? 'cmd' : 'sh';
      const args = process.platform === 'win32' ? ['/c', outcome.command] : ['-c', outcome.command];
      await execFileAsync(shell, args, { cwd, timeout: 30_000 });
      passing++;
    } catch {
      // outcome failed — counts against the score
    }
  }
  return { total: outcomes.length, passing };
}

async function hasSrcImplementation(dimId: string, cwd: string): Promise<boolean> {
  const srcDir = path.join(cwd, 'src');
  const words = dimId.split('_');
  for (const word of words) {
    if (word.length < 4) continue;
    try {
      const { stdout } = await execFileAsync(
        'grep',
        ['-rl', '--include=*.ts', word, srcDir],
        { cwd, timeout: 5000 },
      ).catch(() => ({ stdout: '' }));
      if (stdout.trim()) return true;
    } catch {
      // grep failed — assume exists to avoid false floors
      return true;
    }
  }
  return false;
}

async function saveAuditRecord(record: IntegrityAuditRecord, cwd: string): Promise<void> {
  const dir = path.join(cwd, AUDIT_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${record.dimension}.json`),
    JSON.stringify(record, null, 2),
    'utf8',
  );
}

async function saveSummary(summary: IntegrityAuditSummary, cwd: string): Promise<void> {
  const dir = path.join(cwd, AUDIT_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8',
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function runScoreAudit(options: ScoreAuditOptions = {}): Promise<IntegrityAuditSummary> {
  const cwd = options.cwd ?? process.cwd();
  const apply = options.apply ?? false;
  const skipCapTests = options.skipCapTests ?? false;

  const _loadMatrix = options._loadMatrix ?? loadMatrix;
  const _saveMatrix = options._saveMatrix ?? saveMatrix;
  const _scanStubs = options._scanStubs ?? scanForStubs;
  const _runCapTest = options._runCapTest ?? runCapabilityTest;

  logger.info('[score-audit] ════════════════════════════════════════════════════');
  logger.info('[score-audit] Completion Integrity Audit — all prior scores untrusted');
  logger.info('[score-audit] Protocol: evidence-based scoring, 10-tier cap rubric');
  if (apply) {
    logger.info('[score-audit] --apply: score caps WILL be written to matrix.json');
  } else {
    logger.info('[score-audit] Dry-run mode. Use --apply to write capped scores.');
  }
  logger.info('[score-audit] ════════════════════════════════════════════════════\n');

  // Load raw matrix.json — do NOT use loadMatrix() here because it calls
  // applyOutcomeDerivedScores() which overrides scores.self with derived values.
  // The audit must start from the raw stored scores (which agents wrote), then
  // independently verify them. Using loadMatrix would pre-contaminate our audit
  // with the very derived values we're trying to validate.
  const matrixPath = path.join(cwd, '.danteforge', 'compete', 'matrix.json');
  let matrix: Awaited<ReturnType<typeof _loadMatrix>>;
  try {
    const raw = await fs.readFile(matrixPath, 'utf8');
    matrix = JSON.parse(raw) as NonNullable<typeof matrix>;
  } catch {
    logger.error('[score-audit] No competitive matrix found. Run `danteforge compete` first.');
    throw new Error('Matrix not found');
  }
  if (!matrix) {
    logger.error('[score-audit] Matrix is null.');
    throw new Error('Matrix not found');
  }

  const gitSha = await getGitSha(cwd);
  logger.info(`[score-audit] Git SHA: ${gitSha}`);

  // Step 1: Audit the scoring script itself
  logger.info('\n[score-audit] ── Auditing scoring script (evidence-rescore.mjs) ──');
  const scriptAudit = await auditScoringScript(cwd);
  if (scriptAudit.valid) {
    logger.info('[score-audit] ✓ Scoring script reads real evidence — not hardcoded');
  } else {
    logger.warn(`[score-audit] ⚠ Scoring script issues: ${scriptAudit.issues.join('; ')}`);
    if (scriptAudit.hardcodedScoreLines.length > 0) {
      for (const l of scriptAudit.hardcodedScoreLines) {
        logger.warn(`  Line ${l.line}: ${l.content}`);
      }
    }
  }

  // Step 2: Scan all stubs in src/ once (reused per dimension)
  logger.info('\n[score-audit] ── Scanning src/ for stubs, mocks, TODOs ──');
  const allStubs = await _scanStubs(cwd);
  logger.info(`[score-audit] Found ${allStubs.length} stub/mock/TODO finding(s) in src/`);

  // Step 3: Audit each dimension
  const excl = new Set(matrix.excludedDimensions ?? []);
  const dims = matrix.dimensions.filter(d => {
    if (excl.has(d.id)) return false;
    if (d.status === 'closed') return false;
    if (options.dimension && d.id !== options.dimension) return false;
    return true;
  });

  logger.info(`\n[score-audit] ── Auditing ${dims.length} dimension(s) ──\n`);

  const records: IntegrityAuditRecord[] = [];
  let scoresCapped = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  for (const dim of dims) {
    const priorScore = dim.scores['self'] ?? 0;
    logger.info(`[score-audit] ${dim.id} (prior: ${priorScore})`);

    // a) Capability test
    const capTestResult = skipCapTests ? null : await _runCapTest(dim, cwd);
    if (capTestResult) {
      logger.info(`  capability_test: ${capTestResult.passed ? '✓ PASS' : '✗ FAIL'} (exit ${capTestResult.exitCode}, ${capTestResult.durationMs}ms)`);
    } else {
      logger.info(`  capability_test: ${skipCapTests ? 'skipped' : 'none declared'}`);
    }

    // b) Run declared outcome commands directly — do not trust stored evidence
    const rawOutcomes = (dim as unknown as Record<string, unknown>)['outcomes'] as Array<{ id: string; command?: string }> | undefined;
    const { total: outcomeCount, passing: passingOutcomes } = await runDeclaredOutcomes(rawOutcomes ?? [], cwd);
    logger.info(`  outcomes: ${passingOutcomes}/${outcomeCount} passing`);

    // c) Stubs in critical path
    const dimStubs = allStubs
      .filter(s => isInCriticalPath(s.file, dim))
      .map(s => ({ ...s, inCriticalPath: true }));

    const nonCriticalStubs = allStubs
      .filter(s => !isInCriticalPath(s.file, dim))
      .slice(0, 3)
      .map(s => ({ ...s, inCriticalPath: false }));

    const stubFindings = [...dimStubs, ...nonCriticalStubs];

    if (dimStubs.length > 0) {
      logger.warn(`  stubs in critical path: ${dimStubs.length} (${dimStubs.map(s => `${s.file}:${s.line}`).join(', ')})`);
    }

    // d) Implementation existence check
    const hasImpl = await hasSrcImplementation(dim.id, cwd);

    // e) Score cap
    const capResult = computeScoreCap({
      capabilityTestResult: capTestResult,
      outcomeCount,
      passingOutcomes,
      criticalPathStubCount: dimStubs.length,
      anyStubInPath: dimStubs.length > 0,
      hasSrcImplementation: hasImpl,
    });

    const adjScore = Math.min(priorScore, capResult.cap);
    const capped = adjScore < priorScore;

    if (capped) {
      scoresCapped++;
      logger.warn(`  → CAPPED: ${priorScore} → ${adjScore}  (${capResult.reason})`);
    } else {
      logger.info(`  → CONFIRMED: ${adjScore}  (${capResult.reason})`);
    }

    // f) Build record
    const record = buildAuditRecord({
      dim, capTestResult, capResult, stubFindings, outcomeCount, passingOutcomes, hasSrcImplementation: hasImpl,
    });
    records.push(record);
    await saveAuditRecord(record, cwd);

    // g) Apply cap to matrix (if --apply)
    if (apply && capped) {
      dim.scores['self'] = adjScore;
      dim.gap_to_leader = Math.max(0, record.leaderScore - adjScore);
    }

    totalBefore += priorScore;
    totalAfter += adjScore;
  }

  // Step 4: Write back if --apply
  if (apply && scoresCapped > 0) {
    await _saveMatrix(matrix, cwd);
    logger.info(`\n[score-audit] Wrote ${scoresCapped} capped score(s) to matrix.json`);
  }

  const summary: IntegrityAuditSummary = {
    auditedAt: new Date().toISOString(),
    gitSha,
    totalDimensions: dims.length,
    verified: records.filter(r => r.status === 'verified').length,
    partiallyVerified: records.filter(r => r.status === 'partially-verified').length,
    structural: records.filter(r => r.status === 'structural').length,
    claimed: records.filter(r => r.status === 'claimed').length,
    missing: records.filter(r => r.status === 'missing').length,
    scoresCapped,
    avgScoreBefore: dims.length > 0 ? parseFloat((totalBefore / dims.length).toFixed(2)) : 0,
    avgScoreAfter: dims.length > 0 ? parseFloat((totalAfter / dims.length).toFixed(2)) : 0,
    scoringScriptAudit: scriptAudit,
    records,
  };

  await saveSummary(summary, cwd);

  // Step 5: Print report
  logger.info('\n[score-audit] ════════════════════════════════════════════════════');
  logger.info('[score-audit] INTEGRITY AUDIT COMPLETE');
  logger.info(`[score-audit] Dimensions audited: ${dims.length}`);
  logger.info(`[score-audit] Verified (E2E):     ${summary.verified}`);
  logger.info(`[score-audit] Partial evidence:   ${summary.partiallyVerified}`);
  logger.info(`[score-audit] Structural only:    ${summary.structural}`);
  logger.info(`[score-audit] Claimed only:       ${summary.claimed}`);
  logger.info(`[score-audit] Missing:            ${summary.missing}`);
  logger.info(`[score-audit] Scores capped:      ${scoresCapped}`);
  logger.info(`[score-audit] Avg before:         ${summary.avgScoreBefore}`);
  logger.info(`[score-audit] Avg after:          ${summary.avgScoreAfter}`);
  logger.info(`[score-audit] Report:             ${AUDIT_DIR}/summary.json`);
  logger.info('[score-audit] ════════════════════════════════════════════════════');

  if (summary.structural > 0 || summary.claimed > 0 || summary.missing > 0) {
    logger.warn('\n[score-audit] NEXT ACTIONS (highest priority first):');
    const actionable = records
      .filter(r => r.status !== 'verified')
      .sort((a, b) => b.leaderScore - b.ourScore - (a.leaderScore - a.ourScore));
    for (const r of actionable.slice(0, 5)) {
      logger.warn(`  ${r.dimension}: ${r.highestImpactNextAction}`);
    }
  }

  return summary;
}
