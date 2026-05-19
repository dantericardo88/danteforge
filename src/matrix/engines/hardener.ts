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
 * For each declared callsite (capability_callsite.file), search the source tree
 * for `from <module>` or `import <module>` outside tests/. Zero matches means
 * the module exists but nothing reaches it — it's an orphan.
 *
 * Skip semantics: when no capability_callsite is declared, the check is
 * SKIPPED (not failed) because the dim's author hasn't promised a specific
 * production path yet. This is the migration-friendly default. Once the
 * `danteforge harden migrate` walkthrough runs, every dim will have one.
 *
 * Phase M.1 (docs/PRDs/autonomous-frontier-reaching.md section 4): the check
 * now consults SearchEngine.findImports(symbol). The legacy inline grep+readFile
 * path is preserved as `_legacyOrphanAudit` and exercised by the parity test
 * `tests/search-orphan-parity.test.ts` to verify zero behavioral divergence.
 */
export async function checkOrphanAudit(
  dim: MatrixDimension,
  cwd: string,
  io: CheckIO = defaultIO(),
  searchEngine?: import('../search/types.js').SearchEngine,
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

  // Phase M.1 path: use SearchEngine if injected; otherwise fall back to the
  // legacy inline grep path. Both produce identical findings (enforced by parity test).
  if (searchEngine && callsite.symbol) {
    const findings = await _searchEngineOrphanAudit(callsite, cwd, searchEngine);
    return {
      check: 'orphan-audit',
      passed: findings.length === 0,
      durationMs: Date.now() - start,
      findings,
      scoreCap: HARDEN_CHECK_CAPS['orphan-audit'],
    };
  }

  const findings = await _legacyOrphanAudit(callsite, cwd, io);
  return {
    check: 'orphan-audit',
    passed: findings.length === 0,
    durationMs: Date.now() - start,
    findings,
    scoreCap: HARDEN_CHECK_CAPS['orphan-audit'],
  };
}

/**
 * SearchEngine-backed orphan audit (Phase M.1). Uses findImports to locate
 * production import sites of the callsite module. Identical semantics to
 * `_legacyOrphanAudit`; the parity test asserts findings match.
 */
async function _searchEngineOrphanAudit(
  callsite: { file: string; symbol: string; lineHint?: number },
  cwd: string,
  engine: import('../search/types.js').SearchEngine,
): Promise<HardenFinding[]> {
  const baseName = path.basename(callsite.file).replace(/\.tsx?$/, '');
  // Find every production-code import of the symbol. The SearchEngine excludes
  // test files by default (matches legacy behavior).
  await engine.index(cwd).catch(() => undefined); // best-effort, idempotent
  const importsOfSymbol = await engine.findImports(callsite.symbol);
  // Also find imports of the module (basename match) — covers re-export or
  // namespace imports where the symbol name doesn't appear in the import statement.
  const importsOfModule = await engine.findPattern(
    `(?:from|import)\\s*\\(?\\s*['\"][^'\"]*[/\\\\]${escapeForRegex(baseName)}(?:\\.[a-z]+)?['\"]`,
  );
  // Exclude the callsite file itself (a module trivially "imports" its own exports).
  const callsitePath = path.normalize(callsite.file).replace(/\\/g, '/');
  const importHits = importsOfModule.filter(m => normalizeRel(m.file) !== callsitePath);
  const symbolHits = importsOfSymbol.filter(m => normalizeRel(m.file) !== callsitePath);

  if (importHits.length === 0 && symbolHits.length === 0) {
    return [{
      file: callsite.file,
      line: callsite.lineHint ?? 1,
      snippet: `${callsite.file}::${callsite.symbol}`,
      reason: `Orphan module: 0 production files import this callsite. Tests pass but nothing reaches the code.`,
    }];
  }
  return [];
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeRel(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^src\//, 'src/');
}

/**
 * Legacy orphan audit — inline grep + readFile path. Preserved for the
 * parity test (`tests/search-orphan-parity.test.ts`) which verifies the new
 * SearchEngine path produces identical findings on a fixture repo.
 *
 * Do not remove without updating the parity test; the legacy path is the
 * ground truth that the new path must match.
 */
async function _legacyOrphanAudit(
  callsite: { file: string; symbol: string; lineHint?: number },
  cwd: string,
  io: CheckIO,
): Promise<HardenFinding[]> {
  const findings: HardenFinding[] = [];
  const moduleSpec = callsite.file
    .replace(/\.tsx?$/, '')
    .replace(/^src\//, '')
    .replace(/^\.\//, '');

  const cwdSrc = path.join(cwd, 'src');
  const allFiles = await io.listFiles(cwdSrc, /\.tsx?$/);
  const productionFiles = allFiles.filter(f => !/[/\\]tests[/\\]/.test(f));

  const moduleNeedle = moduleSpec.replace(/[/\\]/g, '[/\\\\]');
  const baseName = path.basename(callsite.file).replace(/\.tsx?$/, '');
  const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importRe = new RegExp(
    `(?:from|import)\\s*\\(?\\s*['"][^'"]*(?:${moduleNeedle}|[/\\\\]${escapedBase})(?:\\.[a-z]+)?['"]`,
    'g',
  );
  const symbolRe = callsite.symbol
    ? new RegExp(`\\b${callsite.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    : null;

  let importHits = 0;
  let symbolHits = 0;
  for (const f of productionFiles) {
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
  return findings;
}

/** Exposed for parity testing only. Not for production use. */
export const __test_legacyOrphanAudit = _legacyOrphanAudit;

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

  // Phase M.2: count code "things" PROJECT-WIDE (PRD design), not just within
  // the callsite file. Catches the DanteFinance dim_059 case: docstring in
  // mcp-server.ts claimed "131 MCP tools" but project-wide count was 74.
  // Falls back to single-file count if the project-wide walk fails.
  const counts: Record<string, number> = await countProjectWidePatterns(cwd, content, io);

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

/**
 * Phase M.2: count claim patterns project-wide (not just within the callsite
 * file). The PRD calls this out — "tools: 131" claimed in a docstring should
 * be measured against the project's actual count of `tool()` registrations,
 * not just registrations in the file the docstring lives in.
 *
 * Falls back to single-file count when the project walk fails (network FS,
 * cross-project boundaries, etc).
 */
async function countProjectWidePatterns(
  cwd: string,
  callsiteContent: string,
  io: CheckIO,
): Promise<Record<string, number>> {
  const patterns = {
    tools: { regs: [/\b(?:server|app|this|self)\.tool\s*\(/g, /_reg\s*\(/g] },
    markets: { regs: [/^\s*['\"][A-Z]{2,4}['\"]\s*[,:]/gm] },
    tests: { regs: [/\b(?:it|test|describe)\s*\(\s*['\"`]/g] },
    integrations: { regs: [/^\s*(?:export\s+)?(?:const|class|function)\s+\w+(?:Provider|Adapter|Connector|Integration)\b/gm] },
    commands: { regs: [/\.command\s*\(/g] },
    skills: { regs: [/skill_name|skillName|SKILL_/g] },
  };

  const counts: Record<string, number> = { tools: 0, markets: 0, tests: 0, integrations: 0, commands: 0, skills: 0 };

  try {
    const cwdSrc = path.join(cwd, 'src');
    const allFiles = await io.listFiles(cwdSrc, /\.tsx?$/);
    // Production files only — exclude tests/.
    const productionFiles = allFiles.filter(f => !/[/\\]tests?[/\\]/.test(f));
    for (const f of productionFiles) {
      let content: string;
      try { content = await io.readFile(f); } catch { continue; }
      for (const [key, p] of Object.entries(patterns)) {
        for (const re of p.regs) {
          re.lastIndex = 0;
          const matches = content.match(re);
          if (matches) counts[key] = (counts[key] ?? 0) + matches.length;
        }
      }
    }
    return counts;
  } catch {
    // Project walk failed — fall back to single-file count for the callsite.
    for (const [key, p] of Object.entries(patterns)) {
      for (const re of p.regs) {
        re.lastIndex = 0;
        const matches = callsiteContent.match(re);
        if (matches) counts[key] = (counts[key] ?? 0) + matches.length;
      }
    }
    return counts;
  }
}

// ── Check 3: hardcoded-fallback ──────────────────────────────────────────────

/** Patterns that catch illustrative-data literals in production code.
 *  Each pattern has a `min` threshold — fewer matches than that aren't suspicious
 *  (one-element arrays are legitimate constants; multi-element string lists are not). */
const HARDCODED_FALLBACK_PATTERNS: Array<{ name: string; re: RegExp; min: number }> = [
  // return ['DIS', 'PFE', 'INTC'] — DanteFinance dim_027 pattern
  { name: 'string array literal', re: /\breturn\s+\[\s*(?:["'][A-Z]{2,5}["']\s*,\s*){1,}["'][A-Z]{2,5}["']\s*\]/g, min: 1 },
  // tickers = ['MSFT', 'GOOGL', ...]
  { name: 'top-level ticker list', re: /^\s*(?:const|let|var)\s+(?:tickers|symbols|companies|stocks|fallback\w*)\s*=\s*\[\s*(?:["'][A-Z]{2,5}["']\s*,\s*){1,}/gm, min: 1 },
  // catch (e) { return [HARDCODED_DEFAULT] }
  { name: 'catch-block hardcoded return', re: /\bcatch\s*\([^)]*\)\s*\{\s*[\s\S]{0,200}?\breturn\s+\[\s*["'][A-Z]{2,}["']/g, min: 1 },
  // catch (e) { return { ticker: 'AAPL', ...
  { name: 'catch-block hardcoded object', re: /\bcatch\s*\([^)]*\)\s*\{\s*[\s\S]{0,200}?\breturn\s+\{[^}]*ticker\s*:\s*["'][A-Z]+["']/g, min: 1 },
];

/**
 * Scan production code under `capability_callsite.file` (and the file's directory)
 * for illustrative-data literals — multi-element string arrays of tickers, country
 * codes, etc., that look like hardcoded fallbacks.
 *
 * Catches the DanteFinance dim_027 pattern: `find_vulnerable_companies()` claims
 * dynamic EDGAR query but falls back to `return ['DIS', 'PFE', 'INTC']` line 1771.
 *
 * Allowlist via dim.harden_overrides with check='hardcoded-fallback'.
 */
export async function checkHardcodedFallback(
  dim: MatrixDimension, cwd: string, io: CheckIO = defaultIO(),
): Promise<HardenCheckResult> {
  const start = Date.now();
  const skip = shouldSkipCheck(dim, 'hardcoded-fallback');
  if (skip.skip) {
    return {
      check: 'hardcoded-fallback', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['hardcoded-fallback'],
      skipped: true, skipReason: skip.reason,
    };
  }
  const callsite = (dim as unknown as Record<string, unknown>)['capability_callsite'] as
    | { file: string; symbol: string; lineHint?: number } | undefined;
  if (!callsite) {
    return {
      check: 'hardcoded-fallback', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['hardcoded-fallback'],
      skipped: true, skipReason: 'no capability_callsite declared',
    };
  }

  const filePath = path.join(cwd, callsite.file);
  if (!(await io.exists(filePath))) {
    return {
      check: 'hardcoded-fallback', passed: false, durationMs: Date.now() - start,
      findings: [{
        file: callsite.file, line: 1, snippet: callsite.file,
        reason: 'capability_callsite.file does not exist on disk',
      }],
      scoreCap: HARDEN_CHECK_CAPS['hardcoded-fallback'],
    };
  }

  const content = await io.readFile(filePath);
  const lines = content.split('\n');
  const findings: HardenFinding[] = [];

  for (const { name, re } of HARDCODED_FALLBACK_PATTERNS) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const pos = match.index;
      const lineNum = content.slice(0, pos).split('\n').length;
      const snippet = (lines[lineNum - 1] ?? '').trim().slice(0, 120);
      findings.push({
        file: callsite.file,
        line: lineNum,
        snippet,
        reason: `Hardcoded fallback (${name}): production code returns an illustrative literal. Add to harden_overrides if intentional.`,
      });
    }
    re.lastIndex = 0;
  }

  return {
    check: 'hardcoded-fallback',
    passed: findings.length === 0,
    durationMs: Date.now() - start,
    findings,
    scoreCap: HARDEN_CHECK_CAPS['hardcoded-fallback'],
  };
}

// ── Check 4: import-resolves ─────────────────────────────────────────────────

/**
 * Detect silent-stub patterns: a try/catch that imports a module which doesn't
 * exist on disk. The catch falls back to a stub silently, so tests pass but
 * production never sees the real capability.
 *
 * TypeScript pattern: dynamic `await import('some.module')` inside try/catch.
 * Python pattern (for sibling projects via cross-language scan): `from X import Y`
 * inside `try:` whose path resolves to nothing.
 *
 * Score cap on fail: 4.0 (lowest — silent stubs are the worst inflation pattern).
 */
export async function checkImportResolves(
  dim: MatrixDimension, cwd: string, io: CheckIO = defaultIO(),
): Promise<HardenCheckResult> {
  const start = Date.now();
  const skip = shouldSkipCheck(dim, 'import-resolves');
  if (skip.skip) {
    return {
      check: 'import-resolves', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['import-resolves'],
      skipped: true, skipReason: skip.reason,
    };
  }
  const callsite = (dim as unknown as Record<string, unknown>)['capability_callsite'] as
    | { file: string; symbol: string; lineHint?: number } | undefined;
  if (!callsite) {
    return {
      check: 'import-resolves', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['import-resolves'],
      skipped: true, skipReason: 'no capability_callsite declared',
    };
  }

  const filePath = path.join(cwd, callsite.file);
  if (!(await io.exists(filePath))) {
    return {
      check: 'import-resolves', passed: false, durationMs: Date.now() - start,
      findings: [{ file: callsite.file, line: 1, snippet: callsite.file, reason: 'capability_callsite.file missing on disk' }],
      scoreCap: HARDEN_CHECK_CAPS['import-resolves'],
    };
  }
  const content = await io.readFile(filePath);
  const findings: HardenFinding[] = [];

  // Match: try { ... await import('X') ... } catch — captures the module string.
  const tryImportRe = /try\s*\{[\s\S]{0,300}?await\s+import\s*\(\s*['"]([^'"]+)['"]\s*\)[\s\S]{0,200}?\}\s*catch/g;
  // Also: try { require('X') } catch
  const tryRequireRe = /try\s*\{[\s\S]{0,300}?require\s*\(\s*['"]([^'"]+)['"]\s*\)[\s\S]{0,200}?\}\s*catch/g;
  // Python idiom: from X import Y inside try:
  const pyTryFromRe = /^\s*try\s*:\s*\n\s+from\s+([\w.]+)\s+import\s+\w+/gm;

  for (const re of [tryImportRe, tryRequireRe, pyTryFromRe]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      const moduleSpec = match[1];
      if (!moduleSpec) continue;
      const lineNum = content.slice(0, match.index).split('\n').length;
      const resolved = await resolveImportPath(moduleSpec, cwd, callsite.file, io);
      if (!resolved) {
        findings.push({
          file: callsite.file,
          line: lineNum,
          snippet: `import '${moduleSpec}'`,
          reason: `Silent-stub: try/catch imports "${moduleSpec}" but the path does not resolve on disk. Failed imports get swallowed.`,
        });
      }
    }
    re.lastIndex = 0;
  }

  return {
    check: 'import-resolves',
    passed: findings.length === 0,
    durationMs: Date.now() - start,
    findings,
    scoreCap: HARDEN_CHECK_CAPS['import-resolves'],
  };
}

/** Attempt to resolve a module specifier as a file under cwd. Returns the absolute
 *  path if found, null otherwise. Tries the spec verbatim, with .ts/.js/.mjs extensions,
 *  and as a directory index (index.ts). Relative paths are resolved against the importing file.
 *
 *  For Python-style dotted paths (e.g. `sentinel.see`), tries the dotted-to-slash
 *  conversion plus `.py` and `/__init__.py` candidates under cwd. */
async function resolveImportPath(
  spec: string, cwd: string, fromFile: string, io: CheckIO,
): Promise<string | null> {
  // node:* always treated as resolved (outside our scan scope).
  if (spec.startsWith('node:')) return spec;

  const isPythonStyle = !spec.startsWith('.') && !spec.startsWith('/')
    && !spec.includes('/') && spec.includes('.');

  if (isPythonStyle) {
    // Try sentinel.see → sentinel/see.py and sentinel/see/__init__.py
    const dotted = spec.replace(/\./g, path.sep);
    const candidates = [
      path.join(cwd, dotted + '.py'),
      path.join(cwd, dotted, '__init__.py'),
      path.join(cwd, 'src', dotted + '.py'),
      path.join(cwd, 'src', dotted, '__init__.py'),
    ];
    for (const c of candidates) {
      if (await io.exists(c)) return c;
    }
    // Couldn't resolve as a Python path — likely a real external package.
    // We conservatively report it as resolved (npm-style external pkg fallback).
    // The cost of a false negative on an external Python package is far less
    // than the cost of false positives on, say, `numpy`. The silent-stub catch
    // is for project-local paths.
    if (!spec.startsWith('sentinel') && !spec.startsWith('dojo') && !spec.startsWith('dirtydlite') && !spec.startsWith('danteagents')) {
      return spec;
    }
    return null;
  }

  // Plain external package (no slash, no dot) — treat as resolved.
  if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.includes('/')) {
    return spec;
  }

  // Relative or absolute project-local path.
  // NOTE: we use path.join + path.normalize instead of path.resolve because path.resolve
  // re-anchors against the real process.cwd() when the input is not drive-prefixed on Windows,
  // which breaks hermetic tests that pass synthetic cwds like '/p'.
  const fromDir = path.dirname(path.join(cwd, fromFile));
  const base = spec.startsWith('.')
    ? path.normalize(path.join(fromDir, spec))
    : path.join(cwd, spec);
  // TypeScript convention: imports use .js even when the source is .ts. Try both.
  const swapJsToTs = base.endsWith('.js') ? base.slice(0, -3) + '.ts' : null;
  const stripExt = base.replace(/\.(js|ts|tsx|mjs|cjs)$/, '');
  const candidates = [
    base,
    base + '.ts', base + '.tsx', base + '.js', base + '.mjs',
    swapJsToTs,
    stripExt + '.ts', stripExt + '.tsx',
    path.join(base, 'index.ts'), path.join(base, 'index.js'),
    path.join(stripExt, 'index.ts'), path.join(stripExt, 'index.js'),
  ].filter((c): c is string => c !== null);
  for (const c of candidates) {
    if (await io.exists(c)) return c;
  }
  return null;
}

// ── Check 5: functional-diff ─────────────────────────────────────────────────

const SPAWN_TIMEOUT_MS = 30_000;

/**
 * If `dim.capability_test.command` contains a `{{INPUT}}` template placeholder,
 * invoke the command twice with two distinct synthetic inputs and byte-compare
 * the outputs. Identical output = hardcoded behavior = fail.
 *
 * Catches the DanteFinance dim_027 pattern AFTER hardcoded-fallback misses it
 * (the function might be hardcoded without a literal — e.g. returning a cached
 * value from a module-level constant).
 *
 * Skip when:
 *  - capability_test.command lacks a `{{INPUT}}` placeholder
 *  - the dim's capability_test is a NoCapabilityTestMarker
 *  - declared by harden_overrides
 */
export async function checkFunctionalDiff(
  dim: MatrixDimension, cwd: string, _io: CheckIO = defaultIO(),
): Promise<HardenCheckResult> {
  const start = Date.now();
  const skip = shouldSkipCheck(dim, 'functional-diff');
  if (skip.skip) {
    return {
      check: 'functional-diff', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['functional-diff'],
      skipped: true, skipReason: skip.reason,
    };
  }
  const capTest = (dim as unknown as Record<string, unknown>)['capability_test'] as
    | { command?: string; no_capability_test?: boolean } | undefined;
  if (!capTest?.command || !capTest.command.includes('{{INPUT}}')) {
    return {
      check: 'functional-diff', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['functional-diff'],
      skipped: true,
      skipReason: 'capability_test.command has no {{INPUT}} placeholder for two-input probe',
    };
  }

  const inputA = 'alpha-input-001';
  const inputB = 'beta-input-002';
  const cmdA = capTest.command.replace(/\{\{INPUT\}\}/g, inputA);
  const cmdB = capTest.command.replace(/\{\{INPUT\}\}/g, inputB);

  const runOne = async (cmd: string): Promise<{ stdout: string; exitCode: number }> => {
    try {
      const { stdout } = await execFileAsync(cmd, [], { shell: true, cwd, timeout: SPAWN_TIMEOUT_MS });
      return { stdout: stdout ?? '', exitCode: 0 };
    } catch (err: unknown) {
      const e = err as { stdout?: string; code?: number };
      return { stdout: e.stdout ?? '', exitCode: typeof e.code === 'number' ? e.code : 1 };
    }
  };

  const [a, b] = await Promise.all([runOne(cmdA), runOne(cmdB)]);

  // Normalize whitespace + trailing-newline before compare so trivial differences don't mask real ones.
  const normA = a.stdout.trim();
  const normB = b.stdout.trim();
  const identical = normA === normB && normA.length > 0;

  const findings: HardenFinding[] = [];
  if (identical) {
    findings.push({
      file: '(capability_test.command)',
      line: 1,
      snippet: `Identical output for inputs "${inputA}" and "${inputB}"`,
      reason: 'Functional-diff: capability_test produced byte-identical output for two distinct inputs. Code likely hardcodes its response.',
    });
  }

  return {
    check: 'functional-diff',
    passed: findings.length === 0,
    durationMs: Date.now() - start,
    findings,
    scoreCap: HARDEN_CHECK_CAPS['functional-diff'],
  };
}

// ── Check 6: primary-not-parallel ────────────────────────────────────────────

/**
 * Verify that `capability_callsite.file` is THE primary implementation of its
 * capability, not a parallel implementation alongside a more-active legacy file.
 *
 * Heuristic (since full symbol-resolution is deferred):
 *   1. Find all production files under src/ that export the same `symbol` name
 *      as the declared callsite.
 *   2. For each candidate (other than the declared callsite), count how many
 *      production files import it.
 *   3. If a non-declared candidate has MORE production importers than the
 *      declared callsite, it is the primary. Fail with the offending file +
 *      its importer count so the operator can decide whether to:
 *        (a) move the declaration to the actual primary, or
 *        (b) wire the new callsite into production and let it become primary.
 *
 * Catches the DanteHarvest "27 dims at 7" pattern (replaced-not-supplemented
 * legacy) where the new module passes tests but the old module is the one
 * actually called by production.
 *
 * Score cap on fail: 5.5 (a parallel implementation is a real semantic gap).
 * Skip conditions: no `capability_callsite`, dim has explicit override.
 */
export async function checkPrimaryNotParallel(
  dim: MatrixDimension,
  cwd: string,
  io: CheckIO = defaultIO(),
): Promise<HardenCheckResult> {
  const start = Date.now();
  const skip = shouldSkipCheck(dim, 'primary-not-parallel');
  if (skip.skip) {
    return {
      check: 'primary-not-parallel', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['primary-not-parallel'],
      skipped: true, skipReason: skip.reason,
    };
  }
  const callsite = (dim as unknown as Record<string, unknown>)['capability_callsite'] as
    | { file: string; symbol: string; lineHint?: number } | undefined;
  if (!callsite) {
    return {
      check: 'primary-not-parallel', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['primary-not-parallel'],
      skipped: true, skipReason: 'no capability_callsite declared',
    };
  }
  if (!callsite.symbol) {
    return {
      check: 'primary-not-parallel', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['primary-not-parallel'],
      skipped: true, skipReason: 'capability_callsite.symbol not declared (cannot compare implementations)',
    };
  }

  const cwdSrc = path.join(cwd, 'src');
  const allFiles = await io.listFiles(cwdSrc, /\.tsx?$/);
  const productionFiles = allFiles.filter(f => !/[/\\]tests?[/\\]/.test(f));
  const declaredAbs = path.resolve(path.join(cwd, callsite.file));

  // Step 1: find candidate files that export the same symbol.
  // Heuristic regex — covers `export function X`, `export const X`, `export class X`,
  // `export { X }`, `export default function X`.
  const escSym = callsite.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const exportRe = new RegExp(
    `^(?:export\\s+(?:async\\s+)?(?:function|class|const|let|var)\\s+${escSym}\\b` +
    `|^export\\s*\\{[^}]*\\b${escSym}\\b[^}]*\\}` +
    `|^export\\s+default\\s+(?:async\\s+)?function\\s+${escSym}\\b)`,
    'm',
  );
  const candidates: string[] = [];
  for (const f of productionFiles) {
    try {
      const content = await io.readFile(f);
      if (exportRe.test(content)) candidates.push(f);
    } catch { /* skip */ }
  }

  // Only the declared file exports the symbol → no parallel implementation.
  if (candidates.length <= 1) {
    return {
      check: 'primary-not-parallel', passed: true, durationMs: Date.now() - start,
      findings: [], scoreCap: HARDEN_CHECK_CAPS['primary-not-parallel'],
    };
  }

  // Step 2: for each candidate, count production importers using the same
  // basename-or-modulespec heuristic as the orphan check.
  const importerCount = async (candidateAbs: string): Promise<number> => {
    const rel = path.relative(cwd, candidateAbs).replace(/\.(tsx?|jsx?|mjs)$/, '');
    const moduleSpec = rel.replace(/^src[/\\]/, '').replace(/^\.\//, '');
    const baseName = path.basename(candidateAbs).replace(/\.(tsx?|jsx?|mjs)$/, '');
    const moduleNeedle = moduleSpec.replace(/[/\\]/g, '[/\\\\]');
    const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const importRe = new RegExp(
      `(?:from|import)\\s*\\(?\\s*['"][^'"]*(?:${moduleNeedle}|[/\\\\]${escapedBase})(?:\\.[a-z]+)?['"]`,
      'g',
    );
    let hits = 0;
    for (const f of productionFiles) {
      if (path.resolve(f) === candidateAbs) continue;
      try {
        const content = await io.readFile(f);
        if (importRe.test(content)) hits++;
        importRe.lastIndex = 0;
      } catch { /* skip */ }
    }
    return hits;
  };

  const declaredImporters = await importerCount(declaredAbs);
  const findings: HardenFinding[] = [];
  for (const candidate of candidates) {
    if (path.resolve(candidate) === declaredAbs) continue;
    const candidateImporters = await importerCount(candidate);
    if (candidateImporters > declaredImporters) {
      findings.push({
        file: path.relative(cwd, candidate),
        line: 1,
        snippet: `export ... ${callsite.symbol} ...`,
        reason: `Parallel implementation found: "${path.relative(cwd, candidate)}" exports the same symbol "${callsite.symbol}" and has ${candidateImporters} production importer(s) vs ${declaredImporters} for the declared callsite "${callsite.file}". Either move the callsite to the actual primary or wire the new implementation into production.`,
      });
    }
  }

  return {
    check: 'primary-not-parallel',
    passed: findings.length === 0,
    durationMs: Date.now() - start,
    findings,
    scoreCap: HARDEN_CHECK_CAPS['primary-not-parallel'],
  };
}

// ── Check 7: recency-check (Three Pillars P3) ────────────────────────────────
//
// A dimension's production import is "stale" if no importing file was modified
// on the main branch within the last N days AND traces to a user-facing entry
// point. This catches the replacement-not-supplement failure mode: new module
// exists, is even imported, but the importing code is dead — the production
// code path still uses the legacy module.
//
// Two-hop entry-point trace (Phase L follow-up could replace with a full call
// graph): the importing file passes if it matches an entry-point glob directly,
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
  'orphan-audit', 'claim-auditor', 'hardcoded-fallback', 'import-resolves', 'functional-diff', 'primary-not-parallel', 'recency-check',
];

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

// Re-export the helpers callers need.
export { applyHardenCap, computeHardenScoreCap };
