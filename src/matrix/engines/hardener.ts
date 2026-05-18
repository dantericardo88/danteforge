// Matrix Kernel — Hardening checks (Phase C).
//
// Five deterministic checks that an LLM agent cannot game. Each accepts a
// MatrixDimension + cwd and produces a HardenCheckResult. The aggregator
// runHardenGate runs all applicable checks and returns a HardenVerdict.
//
// MVP ships orphan-audit + claim-auditor (the two highest-value checks per
// DanteFinance + DanteDojo feedback). The remaining three (hardcoded-fallback,
// import-resolves, functional-diff) ship in the next slice with their own
// fixtures.

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
  type HardenOverride,
  type HardenVerdict,
  type RunHardenGateOptions,
  applyHardenCap,
  computeHardenScoreCap,
} from '../types/harden-check.js';

const execFileAsync = promisify(execFile);
const HARDEN_RECEIPT_DIR = path.join('.danteforge', 'harden-receipts');

// ── Helpers ──────────────────────────────────────────────────────────────────

interface CheckIO {
  readFile: (p: string) => Promise<string>;
  exists: (p: string) => Promise<boolean>;
  listFiles: (dir: string, glob?: RegExp) => Promise<string[]>;
}

function defaultIO(): CheckIO {
  return {
    readFile: (p) => fs.readFile(p, 'utf8'),
    exists: async (p) => {
      try { await fs.access(p); return true; } catch { return false; }
    },
    listFiles: async (dir, glob) => {
      const out: string[] = [];
      const walk = async (d: string): Promise<void> => {
        let entries: string[];
        try { entries = await fs.readdir(d); } catch { return; }
        for (const e of entries) {
          if (e === 'node_modules' || e === 'dist' || e === '.git') continue;
          const full = path.join(d, e);
          try {
            const st = await fs.stat(full);
            if (st.isDirectory()) await walk(full);
            else if (!glob || glob.test(e)) out.push(full);
          } catch { /* skip */ }
        }
      };
      await walk(dir);
      return out;
    },
  };
}

function shouldSkipCheck(dim: MatrixDimension, check: HardenCheckId): { skip: boolean; reason?: string } {
  const overrides = (dim as unknown as Record<string, unknown>)['harden_overrides'] as HardenOverride[] | undefined;
  if (overrides?.some(o => o.check === check && !o.fileGlob)) {
    const match = overrides.find(o => o.check === check)!;
    return { skip: true, reason: `override approved by ${match.approvedBy}: ${match.reason}` };
  }
  return { skip: false };
}

// ── Check 1: orphan-audit ────────────────────────────────────────────────────

/**
 * Is the dim's capability_callsite actually imported by production code?
 *
 * For each declared callsite (capability_callsite.file), grep the source tree
 * for `from <module>` or `import <module>` outside tests/. Zero matches means
 * the module exists but nothing reaches it — it's an orphan.
 *
 * Skip semantics: when no capability_callsite is declared, the check is
 * SKIPPED (not failed) because the dim's author hasn't promised a specific
 * production path yet. This is the migration-friendly default. Once the
 * `danteforge harden migrate` walkthrough runs, every dim will have one.
 */
export async function checkOrphanAudit(
  dim: MatrixDimension,
  cwd: string,
  io: CheckIO = defaultIO(),
): Promise<HardenCheckResult> {
  const start = Date.now();
  const skip = shouldSkipCheck(dim, 'orphan-audit');
  if (skip.skip) {
    return {
      check: 'orphan-audit', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['orphan-audit'], skipped: true, skipReason: skip.reason,
    };
  }
  const callsite = (dim as unknown as Record<string, unknown>)['capability_callsite'] as
    | { file: string; symbol: string; lineHint?: number } | undefined;
  if (!callsite) {
    return {
      check: 'orphan-audit', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['orphan-audit'],
      skipped: true, skipReason: 'no capability_callsite declared (run `danteforge harden migrate`)',
    };
  }

  const findings: HardenFinding[] = [];
  const moduleSpec = callsite.file
    .replace(/\.tsx?$/, '')
    .replace(/^src\//, '')
    .replace(/^\.\//, '');

  // grep the source tree for any production import of this module/symbol.
  // We accept either `from '...<moduleSpec>...'` or `import('...<moduleSpec>...')`.
  const cwdSrc = path.join(cwd, 'src');
  const allFiles = await io.listFiles(cwdSrc, /\.tsx?$/);
  // Cross-platform tests/ filter: accept both forward and backslash separators.
  const productionFiles = allFiles.filter(f => !/[/\\]tests[/\\]/.test(f));

  const moduleNeedle = moduleSpec.replace(/[/\\]/g, '[/\\\\]');
  const importRe = new RegExp(`(?:from|import)\\s*\\(?\\s*['\"][^'\"]*${moduleNeedle}[^'\"]*['\"]`, 'g');
  const symbolRe = callsite.symbol
    ? new RegExp(`\\b${callsite.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    : null;

  let importHits = 0;
  let symbolHits = 0;
  for (const f of productionFiles) {
    // Skip the callsite file itself (a module always "imports" its own exports).
    if (path.resolve(f) === path.resolve(path.join(cwd, callsite.file))) continue;
    try {
      const content = await io.readFile(f);
      if (importRe.test(content)) importHits++;
      importRe.lastIndex = 0;
      if (symbolRe && symbolRe.test(content)) symbolHits++;
    } catch { /* unreadable */ }
  }

  if (importHits === 0 && symbolHits === 0) {
    findings.push({
      file: callsite.file,
      line: callsite.lineHint ?? 1,
      snippet: `${callsite.file}::${callsite.symbol}`,
      reason: `Orphan module: 0 production files import this callsite. Tests pass but nothing reaches the code.`,
    });
  }

  return {
    check: 'orphan-audit',
    passed: findings.length === 0,
    durationMs: Date.now() - start,
    findings,
    scoreCap: HARDEN_CHECK_CAPS['orphan-audit'],
  };
}

// ── Check 2: claim-auditor ───────────────────────────────────────────────────

const CLAIM_PATTERNS: Array<{ re: RegExp; thingNoun: string }> = [
  { re: /(\d+)\+?\s+(?:tools?|MCP tools?)\b/gi, thingNoun: 'tools' },
  { re: /(\d+)\+?\s+(?:markets?|countries|jurisdictions)\b/gi, thingNoun: 'markets' },
  { re: /(\d+)\+?\s+(?:tests?|test cases?|assertions?)\b/gi, thingNoun: 'tests' },
  { re: /(\d+)\+?\s+(?:integrations?|connectors?|providers?)\b/gi, thingNoun: 'integrations' },
  { re: /(\d+)\+?\s+(?:commands?|CLI commands?)\b/gi, thingNoun: 'commands' },
  { re: /(\d+)\+?\s+(?:skills?)\b/gi, thingNoun: 'skills' },
];

/**
 * Do numeric claims in the dim's capability_callsite docstring match reality?
 *
 * Extracts patterns like "131 tools", "49 countries", "100+ markets" from the
 * file's leading docstring (and from any JSDoc on the declared symbol). For
 * each claim, count the actual artifacts in the source file using heuristic
 * regex (e.g. `\._reg\(`, dict entries, exported `function`).
 *
 * Catches the DanteFinance dim_059 case: docstring says "131 wired MCP tools"
 * but `grep -c "self\._reg("` returns 74.
 */
export async function checkClaimAuditor(
  dim: MatrixDimension,
  cwd: string,
  io: CheckIO = defaultIO(),
): Promise<HardenCheckResult> {
  const start = Date.now();
  const skip = shouldSkipCheck(dim, 'claim-auditor');
  if (skip.skip) {
    return {
      check: 'claim-auditor', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['claim-auditor'], skipped: true, skipReason: skip.reason,
    };
  }
  const callsite = (dim as unknown as Record<string, unknown>)['capability_callsite'] as
    | { file: string; symbol: string; lineHint?: number } | undefined;
  if (!callsite) {
    return {
      check: 'claim-auditor', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['claim-auditor'],
      skipped: true, skipReason: 'no capability_callsite declared',
    };
  }

  const filePath = path.join(cwd, callsite.file);
  if (!(await io.exists(filePath))) {
    return {
      check: 'claim-auditor', passed: false, durationMs: Date.now() - start,
      findings: [{
        file: callsite.file, line: 1,
        snippet: callsite.file,
        reason: `capability_callsite.file does not exist on disk`,
      }],
      scoreCap: HARDEN_CHECK_CAPS['claim-auditor'],
    };
  }

  const content = await io.readFile(filePath);

  // Extract all docstring/JSDoc text blocks; flatten to a single haystack.
  const docBlocks = content.match(/\/\*\*[\s\S]*?\*\//g) ?? [];
  // Also include the first leading line-comment block.
  const leading = content.match(/^(?:\/\/[^\n]*\n)+/);
  const haystack = docBlocks.join('\n') + (leading ? '\n' + leading[0] : '');

  // Count code "things" by category.
  const counts: Record<string, number> = {
    tools: (content.match(/\b(?:server|app|this|self)\.tool\s*\(/g) ?? []).length
        + (content.match(/_reg\s*\(/g) ?? []).length,
    markets: (content.match(/^\s*['\"][A-Z]{2,4}['\"]\s*[,:]/gm) ?? []).length,
    tests: (content.match(/\b(?:it|test|describe)\s*\(\s*['\"`]/g) ?? []).length,
    integrations: (content.match(/^\s*(?:export\s+)?(?:const|class|function)\s+\w+(?:Provider|Adapter|Connector|Integration)\b/gm) ?? []).length,
    commands: (content.match(/\.command\s*\(/g) ?? []).length,
    skills: (content.match(/skill_name|skillName|SKILL_/g) ?? []).length,
  };

  const findings: HardenFinding[] = [];
  for (const { re, thingNoun } of CLAIM_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(haystack)) !== null) {
      const claimedRaw = match[1];
      if (!claimedRaw) continue;
      const claimed = parseInt(claimedRaw, 10);
      if (Number.isNaN(claimed)) continue;
      const actual = counts[thingNoun] ?? 0;
      // Allow ±15% slack to absorb naming heuristics. Genuine inflation is
      // typically 2-3× (e.g. claimed 131 vs actual 74 in DanteFinance).
      const upper = Math.ceil(claimed * 1.15);
      const lower = Math.floor(claimed * 0.85);
      if (actual < lower || actual > upper) {
        findings.push({
          file: callsite.file,
          line: 1,
          snippet: match[0],
          reason: `Claim "${match[0]}" but code-side count of ${thingNoun} is ${actual} (expected ${lower}-${upper}).`,
        });
      }
    }
    re.lastIndex = 0;
  }

  return {
    check: 'claim-auditor',
    passed: findings.length === 0,
    durationMs: Date.now() - start,
    findings,
    scoreCap: HARDEN_CHECK_CAPS['claim-auditor'],
  };
}

// ── Stubs for checks 3-5 (next slice) ────────────────────────────────────────
// Wired into the gate so the aggregate runs end-to-end; they currently return
// "skipped" pending implementation. Tests assert these stubs exist with the
// correct shape so the API is stable when real implementations land.

export async function checkHardcodedFallback(dim: MatrixDimension, _cwd: string, _io: CheckIO = defaultIO()): Promise<HardenCheckResult> {
  return {
    check: 'hardcoded-fallback', passed: true, durationMs: 0, findings: [],
    scoreCap: HARDEN_CHECK_CAPS['hardcoded-fallback'],
    skipped: true, skipReason: 'check ships in next slice',
  };
}

export async function checkImportResolves(dim: MatrixDimension, _cwd: string, _io: CheckIO = defaultIO()): Promise<HardenCheckResult> {
  return {
    check: 'import-resolves', passed: true, durationMs: 0, findings: [],
    scoreCap: HARDEN_CHECK_CAPS['import-resolves'],
    skipped: true, skipReason: 'check ships in next slice',
  };
}

export async function checkFunctionalDiff(dim: MatrixDimension, _cwd: string, _io: CheckIO = defaultIO()): Promise<HardenCheckResult> {
  return {
    check: 'functional-diff', passed: true, durationMs: 0, findings: [],
    scoreCap: HARDEN_CHECK_CAPS['functional-diff'],
    skipped: true, skipReason: 'check ships in next slice',
  };
}

// ── Aggregator ───────────────────────────────────────────────────────────────

const DEFAULT_CHECKS: HardenCheckId[] = [
  'orphan-audit', 'claim-auditor', 'hardcoded-fallback', 'import-resolves', 'functional-diff',
];

async function runOneCheck(
  id: HardenCheckId, dim: MatrixDimension, cwd: string, io: CheckIO,
): Promise<HardenCheckResult> {
  switch (id) {
    case 'orphan-audit': return checkOrphanAudit(dim, cwd, io);
    case 'claim-auditor': return checkClaimAuditor(dim, cwd, io);
    case 'hardcoded-fallback': return checkHardcodedFallback(dim, cwd, io);
    case 'import-resolves': return checkImportResolves(dim, cwd, io);
    case 'functional-diff': return checkFunctionalDiff(dim, cwd, io);
  }
}

export async function runHardenGate(options: RunHardenGateOptions): Promise<HardenVerdict> {
  const { dimensionId, dim, cwd, onlyChecks } = options;
  const io = defaultIO();
  const checksToRun = onlyChecks ?? DEFAULT_CHECKS;

  const results: HardenCheckResult[] = [];
  for (const id of checksToRun) {
    const override = options._check?.[id];
    const result = override ? await override(dim, cwd) : await runOneCheck(id, dim, cwd, io);
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

  return verdict;
}

async function currentGitSha(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 3000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// Re-export the helpers callers need.
export { applyHardenCap, computeHardenScoreCap };
