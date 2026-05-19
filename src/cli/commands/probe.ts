// probe.ts — Cold-build runtime probe for the Capability Ladder (Phase A).
// Runs the project build from REPO ROOT with no per-package filter and no cache,
// then writes per-package pass/fail to .danteforge/runtime-evidence/<sha>-<tier>.json.
//
// This is the T1 "compiles cold" probe. It exists so any score above 4.0 has
// to be backed by a real build, not an agent self-report.
//
// Detects pnpm+turbo, pnpm workspaces, lerna, or plain npm.

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';

const execFileAsync = promisify(execFile);
const EVIDENCE_DIR = path.join('.danteforge', 'runtime-evidence');

// ── Types ─────────────────────────────────────────────────────────────────────

export type ProbeTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6';
export type MonorepoRunner = 'turbo' | 'pnpm-r' | 'lerna' | 'npm' | 'none';

export interface ProbeResult {
  tier: ProbeTier;
  passed: boolean;
  exitCode: number;
  gitSha: string | null;
  worktreeFingerprint: string | null;
  durationMs: number;
  runner: MonorepoRunner;
  command: string;
  failedPackages: string[];
  stdoutTail: string;
  stderrTail: string;
  evidencePath: string;
  ranAt: string;
  cachedHit: boolean;
}

export interface ProbeOptions {
  cwd?: string;
  tier?: ProbeTier;
  forceCold?: boolean;
  timeoutMs?: number;
  json?: boolean;
  // Injection seams (hermetic testing)
  _detectRunner?: (cwd: string) => Promise<MonorepoRunner>;
  _spawn?: (cmd: string, args: string[], opts: SpawnOpts) => SpawnResult;
  _readGitSha?: (cwd: string) => Promise<{ gitSha: string | null; worktreeFingerprint: string | null }>;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, data: string) => Promise<void>;
  _mkdir?: (p: string) => Promise<void>;
  _exists?: (p: string) => Promise<boolean>;
  _stdout?: (line: string) => void;
  /**
   * Time Machine integration seam. Tri-state:
   *   undefined → lazy-import the real createTimeMachineCommit (production)
   *   null      → disable Time Machine for this run (test/no-write paths)
   *   function  → injected mock (tests can count calls / assert label format)
   * Best-effort: TM failures never block probe completion.
   */
  _createTimeMachineCommit?: ((opts: import('../../core/time-machine.js').CreateTimeMachineCommitOptions) => Promise<unknown>) | null;
  /** Skip ALL durable writes (evidence file + Time Machine commit). Used by `--dry-run` style flows. */
  _noWrite?: boolean;
}

interface SpawnOpts {
  shell: boolean;
  cwd: string;
  timeout: number;
  encoding: 'utf8';
}

interface SpawnResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

// ── Monorepo detection ────────────────────────────────────────────────────────

export async function detectMonorepoRunner(cwd: string): Promise<MonorepoRunner> {
  const exists = async (p: string): Promise<boolean> => {
    try { await fs.access(path.join(cwd, p)); return true; } catch { return false; }
  };
  const hasTurbo = await exists('turbo.json');
  const hasPnpmWs = await exists('pnpm-workspace.yaml');
  const hasLerna = await exists('lerna.json');
  const hasPkg = await exists('package.json');

  if (hasTurbo && hasPnpmWs) return 'turbo';
  if (hasPnpmWs) return 'pnpm-r';
  if (hasLerna) return 'lerna';
  if (hasPkg) return 'npm';
  return 'none';
}

// ── Command construction ──────────────────────────────────────────────────────

function buildCommandForRunner(runner: MonorepoRunner, tier: ProbeTier, forceCold: boolean): string {
  if (tier === 'T1') {
    // Compile cold. Coalesce build across all packages, never per-package filter.
    if (runner === 'turbo') {
      return forceCold
        ? 'npx turbo run build --force --no-cache --continue --output-logs=errors-only'
        : 'npx turbo run build --continue --output-logs=errors-only';
    }
    if (runner === 'pnpm-r') return 'pnpm -r --no-bail run build';
    if (runner === 'lerna') return 'npx lerna run build --concurrency=4 --no-bail';
    return 'npm run build';
  }
  if (tier === 'T2') {
    if (runner === 'turbo') return 'npx turbo run test --continue --output-logs=errors-only';
    if (runner === 'pnpm-r') return 'pnpm -r --no-bail run test';
    if (runner === 'lerna') return 'npx lerna run test --concurrency=4 --no-bail';
    return 'npm test';
  }
  if (tier === 'T0') return 'node -e "process.exit(0)"';
  // T3-T6 tier probes deferred to Phase B — fall through to the no-op command
  return 'node -e "process.exit(0)"';
}

// ── Git fingerprint ───────────────────────────────────────────────────────────

async function readGitSha(cwd: string): Promise<{ gitSha: string | null; worktreeFingerprint: string | null }> {
  try {
    const { stdout: head } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 5000 });
    const gitSha = head.trim() || null;
    if (!gitSha) return { gitSha: null, worktreeFingerprint: null };
    const { stdout: status } = await execFileAsync(
      'git', ['status', '--porcelain=v1', '--untracked-files=all'],
      { cwd, timeout: 5000 },
    );
    // Cheap fingerprint: dirty status hash is enough for cache invalidation
    const dirty = status.replace(/\r\n/g, '\n').trim();
    const worktreeFingerprint = dirty.length === 0 ? gitSha : `${gitSha}-dirty-${dirty.length}`;
    return { gitSha, worktreeFingerprint };
  } catch {
    return { gitSha: null, worktreeFingerprint: null };
  }
}

// ── Per-package failure parsing ───────────────────────────────────────────────

// Turbo (real format):
//   Summary line:  "Failed:    @scope/pkg#build, @scope/pkg2#build"
//   Stderr ERROR:  " ERROR  @scope/pkg#build: command ... exited (1)"
//   Legacy ERROR:  "@scope/pkg:task: ERROR ..."
const TURBO_SUMMARY_RE = /^Failed:\s+(.+)$/gm;
const TURBO_ERROR_RE = /\bERROR\b\s+([@\w/-]+)#[\w:-]+/g;
const TURBO_LEGACY_RE = /^([@\w/-]+):[a-z][\w-]*: ERROR/gm;

// pnpm -r: " ELIFECYCLE  Command failed" or "@pkg dev ERR_pnpm_*"
const PNPM_FAIL_RE = /^([@\w/-]+) \S+ ERR_/gm;
// lerna: "lerna ERR! npm: @scope/pkg: exit code 1"
const LERNA_FAIL_RE = /^lerna ERR! [^:]+: ([@\w/-]+)/gm;
// Generic tsc Errors|Files table footer
const TSC_PROJECT_FAIL_RE = /Errors\s+Files[\s\S]+?(\d+)\s+([^\s]+)/g;

function harvestRegex(re: RegExp, text: string, groupIdx: number, found: Set<string>): void {
  re.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const cap = match[groupIdx];
    if (cap) found.add(cap);
  }
  re.lastIndex = 0;
}

export function parseFailedPackages(runner: MonorepoRunner, stdout: string, stderr: string): string[] {
  const combined = `${stdout}\n${stderr}`;
  const found = new Set<string>();

  if (runner === 'turbo') {
    // Pattern A: summary line — most authoritative
    TURBO_SUMMARY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TURBO_SUMMARY_RE.exec(combined)) !== null) {
      const list = m[1] ?? '';
      for (const entry of list.split(/[,\s]+/)) {
        const pkg = entry.split('#')[0]?.trim();
        if (pkg && /^@?[\w/-]+$/.test(pkg)) found.add(pkg);
      }
    }
    TURBO_SUMMARY_RE.lastIndex = 0;
    // Pattern B: stderr ERROR lines
    harvestRegex(TURBO_ERROR_RE, combined, 1, found);
    // Pattern C: legacy per-line ERROR
    harvestRegex(TURBO_LEGACY_RE, combined, 1, found);
  } else if (runner === 'pnpm-r') {
    harvestRegex(PNPM_FAIL_RE, combined, 1, found);
  } else if (runner === 'lerna') {
    harvestRegex(LERNA_FAIL_RE, combined, 1, found);
  }

  // Always also try the generic TS project pattern
  TSC_PROJECT_FAIL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TSC_PROJECT_FAIL_RE.exec(combined)) !== null) {
    const [, errs, p] = match;
    if (errs && p && parseInt(errs, 10) > 0) found.add(p);
  }
  TSC_PROJECT_FAIL_RE.lastIndex = 0;
  return Array.from(found).sort();
}

// ── Cache ─────────────────────────────────────────────────────────────────────

function evidencePathFor(cwd: string, gitSha: string | null, tier: ProbeTier): string {
  const sha = gitSha ?? 'nogit';
  return path.join(cwd, EVIDENCE_DIR, `${sha}-${tier}.json`);
}

async function readCachedEvidence(
  p: string,
  readFn: (p: string) => Promise<string>,
  existsFn: (p: string) => Promise<boolean>,
): Promise<ProbeResult | null> {
  if (!(await existsFn(p))) return null;
  try {
    const raw = await readFn(p);
    const parsed = JSON.parse(raw) as ProbeResult;
    return { ...parsed, cachedHit: true };
  } catch {
    return null;
  }
}

// ── Default spawn ─────────────────────────────────────────────────────────────

function defaultSpawn(cmd: string, _args: string[], opts: SpawnOpts): SpawnResult {
  const r = spawnSync(cmd, [], opts);
  const toStr = (v: unknown): string => (typeof v === 'string' ? v : v ? String(v) : '');
  return { status: r.status, stdout: toStr(r.stdout), stderr: toStr(r.stderr) };
}

function tailLines(s: string, n: number): string {
  return s.split('\n').slice(-n).join('\n');
}

// ── Main probe ────────────────────────────────────────────────────────────────

export async function runProbe(options: ProbeOptions = {}): Promise<ProbeResult> {
  const cwd = options.cwd ?? process.cwd();
  const tier = options.tier ?? 'T1';
  const forceCold = options.forceCold ?? true;
  const detectFn = options._detectRunner ?? detectMonorepoRunner;
  const spawn = options._spawn ?? defaultSpawn;
  const gitFn = options._readGitSha ?? readGitSha;
  const readFn = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFn = options._writeFile ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, d, 'utf8');
  });
  const mkdirFn = options._mkdir ?? (async (p: string) => { await fs.mkdir(p, { recursive: true }); });
  const existsFn = options._exists ?? (async (p: string) => {
    try { await fs.access(p); return true; } catch { return false; }
  });

  const runner = await detectFn(cwd);
  const { gitSha, worktreeFingerprint } = await gitFn(cwd);
  const evidencePath = evidencePathFor(cwd, gitSha, tier);

  // Cache hit: same SHA + clean worktree
  if (!forceCold && gitSha && worktreeFingerprint === gitSha) {
    const cached = await readCachedEvidence(evidencePath, readFn, existsFn);
    if (cached) return cached;
  }

  const command = buildCommandForRunner(runner, tier, forceCold);
  const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000; // 15 min cap

  const start = Date.now();
  let spawnResult: SpawnResult;
  try {
    spawnResult = spawn(command, [], { shell: true, cwd, timeout: timeoutMs, encoding: 'utf8' });
  } catch (err) {
    spawnResult = {
      status: -1,
      stdout: '',
      stderr: `spawn error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const durationMs = Date.now() - start;

  const failedPackages = parseFailedPackages(runner, spawnResult.stdout, spawnResult.stderr);
  const exitCode = spawnResult.status ?? 1;
  const passed = exitCode === 0 && failedPackages.length === 0;

  const result: ProbeResult = {
    tier,
    passed,
    exitCode,
    gitSha,
    worktreeFingerprint,
    durationMs,
    runner,
    command,
    failedPackages,
    stdoutTail: tailLines(spawnResult.stdout, 100),
    stderrTail: tailLines(spawnResult.stderr, 100),
    evidencePath,
    ranAt: new Date().toISOString(),
    cachedHit: false,
  };

  if (!options._noWrite) {
    await mkdirFn(path.dirname(evidencePath));
    await writeFn(evidencePath, JSON.stringify(result, null, 2));
    await recordProbeEvidenceCommit(result, cwd, options._createTimeMachineCommit);
  }

  return result;
}

/**
 * Phase H Time Machine integration: record the cold-build probe evidence as a
 * causal commit. Mirrors src/matrix/engines/outcome-runner.ts:recordOutcomeEvidenceCommit.
 * Best-effort — TM failures never block probe completion.
 */
async function recordProbeEvidenceCommit(
  result: ProbeResult,
  cwd: string,
  override?: ProbeOptions['_createTimeMachineCommit'],
): Promise<void> {
  if (override === null) return;
  try {
    const createFn = override
      ?? (await import('../../core/time-machine.js')).createTimeMachineCommit;
    await createFn({
      cwd,
      paths: [result.evidencePath],
      label: `probe-evidence/${result.tier}/${result.runner}/${result.passed ? 'pass' : 'fail'}`,
      causalLinks: {
        materials: [result.evidencePath],
        inputDependencies: [],
      },
    });
  } catch {
    // best-effort — TM crash never blocks the probe
  }
}

// ── Quick import-resolves pre-check (M.7) ────────────────────────────────────
//
// Walks src/ for TS files, extracts relative imports, and verifies the target
// file resolves on disk. Catches the most common class of build failures
// (renamed/deleted modules) in milliseconds instead of waiting for tsc.
//
// HONEST SCOPE: This is module-level resolution only, not symbol-level. tsc
// still catches "imported X but X isn't exported" — that's a slower full-build
// concern. The quick-check covers the fast-fail surface: "the file isn't even
// there." Bare-module specifiers (e.g. `import 'react'`) are skipped — those
// would need a node_modules walk we don't gain much from.

export interface QuickImportCheckResult {
  scannedFiles: number;
  brokenImports: Array<{ file: string; line: number; specifier: string; reason: string }>;
  durationMs: number;
}

const IMPORT_RE = /^\s*(?:import|export)(?:\s+[\s\S]*?)?\s+from\s+['"]([^'"]+)['"]/gm;

/**
 * Strip JSDoc/block comments and line comments before regex-matching imports.
 * Without this we get false positives for docstring example imports (the most
 * common one: ` *   import { X } from './module.js';` in a JSDoc block).
 */
function stripCommentsForImportScan(src: string): string {
  // Block comments: replace with same length of spaces so line numbers stay stable.
  let out = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  // Single-line comments at start-of-line or after non-string content.
  // Heuristic: match `//` not inside a string literal. Naive but correct enough
  // for the import-scan use case — we just need to avoid matching `from './x'`
  // inside a `// foo` comment.
  out = out.replace(/(^|[^\\:"'])\/\/[^\n]*/g, (_, prefix) => prefix);
  return out;
}

async function walkTsFilesForCheck(root: string): Promise<string[]> {
  const out: string[] = [];
  const skip = new Set(['node_modules', 'dist', '.git', '.danteforge', 'coverage', 'build']);
  async function recurse(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (skip.has(ent.name)) continue;
        await recurse(full);
      } else if (ent.isFile() && /\.(?:m?ts|c?ts|tsx)$/.test(ent.name)) {
        out.push(full);
      }
    }
  }
  await recurse(root);
  return out;
}

async function resolveRelativeImport(fromFile: string, specifier: string): Promise<string | null> {
  // Map .js → .ts (project uses TS sources with .js extension in imports).
  const baseDir = path.dirname(fromFile);
  let target = path.resolve(baseDir, specifier);
  if (target.endsWith('.js')) target = target.slice(0, -3) + '.ts';
  else if (target.endsWith('.mjs')) target = target.slice(0, -4) + '.mts';

  // Direct file
  try { await fs.access(target); return target; } catch { /* keep trying */ }
  // .ts
  try { await fs.access(target + '.ts'); return target + '.ts'; } catch { /* keep trying */ }
  // .tsx
  try { await fs.access(target + '.tsx'); return target + '.tsx'; } catch { /* keep trying */ }
  // /index.ts
  try { await fs.access(path.join(target, 'index.ts')); return path.join(target, 'index.ts'); } catch { /* keep trying */ }
  return null;
}

export async function runQuickImportCheck(cwd: string = process.cwd()): Promise<QuickImportCheckResult> {
  const start = Date.now();
  const srcRoot = path.join(cwd, 'src');
  const files = await walkTsFilesForCheck(srcRoot);
  const broken: QuickImportCheckResult['brokenImports'] = [];

  for (const file of files) {
    let content: string;
    try { content = await fs.readFile(file, 'utf8'); }
    catch { continue; }
    const stripped = stripCommentsForImportScan(content);
    IMPORT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = IMPORT_RE.exec(stripped)) !== null) {
      const specifier = m[1]!;
      // Skip bare-module imports (node_modules) and node: scheme.
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
      const resolved = await resolveRelativeImport(file, specifier);
      if (resolved === null) {
        // Compute line number from the match index (stripped preserves line breaks).
        const line = stripped.slice(0, m.index).split('\n').length;
        broken.push({
          file: path.relative(cwd, file).replace(/\\/g, '/'),
          line,
          specifier,
          reason: 'module file not found on disk',
        });
      }
    }
  }

  return {
    scannedFiles: files.length,
    brokenImports: broken,
    durationMs: Date.now() - start,
  };
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

export async function runProbeCommand(opts: {
  tier?: string;
  json?: boolean;
  forceCold?: boolean;
  noCache?: boolean;
  cwd?: string;
  timeoutMs?: number;
  quickCheck?: boolean;
}): Promise<void> {
  // M.7: `--quick-check` runs the import-resolves pre-scan only. No build invoked.
  // Useful as a pre-commit/CI gate: fails in milliseconds when a relative import
  // points to a missing file. Operators who want full type-checking still run
  // tsc separately.
  if (opts.quickCheck) {
    const cwd = opts.cwd ?? process.cwd();
    const result = await runQuickImportCheck(cwd);
    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      const passed = result.brokenImports.length === 0;
      const icon = passed ? chalk.green('✓') : chalk.red('✗');
      const status = passed ? chalk.green('PASS') : chalk.red('FAIL');
      logger.info('');
      logger.info(chalk.bold('Quick Import Check (M.7)'));
      logger.info(chalk.dim('─'.repeat(50)));
      logger.info(`  ${icon} ${status}   ${chalk.dim('scanned:')} ${result.scannedFiles} files in ${result.durationMs}ms`);
      if (!passed) {
        logger.info('');
        logger.info(chalk.red(`  Broken imports (${result.brokenImports.length}):`));
        for (const b of result.brokenImports.slice(0, 25)) {
          logger.info(`    ${chalk.red('✗')} ${chalk.cyan(b.file)}:${b.line}  ${chalk.dim('→')} ${b.specifier}`);
        }
        if (result.brokenImports.length > 25) {
          logger.info(chalk.dim(`    … and ${result.brokenImports.length - 25} more`));
        }
      }
      logger.info('');
    }
    if (result.brokenImports.length > 0) process.exitCode = 1;
    return;
  }

  const tier = (opts.tier as ProbeTier) ?? 'T1';
  const result = await runProbe({
    cwd: opts.cwd,
    tier,
    forceCold: opts.forceCold ?? !opts.noCache,
    timeoutMs: opts.timeoutMs,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    const icon = result.passed ? chalk.green('✓') : chalk.red('✗');
    const status = result.passed ? chalk.green('PASS') : chalk.red('FAIL');
    logger.info('');
    logger.info(chalk.bold(`Runtime Probe — ${result.tier}`));
    logger.info(chalk.dim('─'.repeat(50)));
    logger.info(`  ${icon} ${status}   ${chalk.dim('runner:')} ${result.runner}   ${chalk.dim('exit:')} ${result.exitCode}`);
    logger.info(`  ${chalk.dim('command:')} ${result.command}`);
    logger.info(`  ${chalk.dim('duration:')} ${(result.durationMs / 1000).toFixed(1)}s`);
    if (result.gitSha) logger.info(`  ${chalk.dim('git SHA:')} ${result.gitSha.slice(0, 8)}${result.worktreeFingerprint !== result.gitSha ? chalk.yellow(' (dirty)') : ''}`);
    if (result.cachedHit) logger.info(`  ${chalk.yellow('cached:')} replayed from ${result.evidencePath}`);
    if (result.failedPackages.length > 0) {
      logger.info('');
      logger.info(chalk.red(`  Failed packages (${result.failedPackages.length}):`));
      for (const p of result.failedPackages.slice(0, 25)) logger.info(`    ${chalk.red('✗')} ${p}`);
      if (result.failedPackages.length > 25) logger.info(chalk.dim(`    … and ${result.failedPackages.length - 25} more`));
    }
    logger.info('');
    logger.info(`  ${chalk.dim('evidence:')} ${path.relative(process.cwd(), result.evidencePath)}`);
    logger.info('');
  }

  if (!result.passed) process.exitCode = 1;
}
