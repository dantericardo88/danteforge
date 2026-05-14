// Self-Mutate — runs DanteForge's mutation testing engine on its own core files.
//
// Problem: we built mutation-score.ts but never aimed it at our own code.
// If our 3879 tests only exercise the happy path, mutations would survive
// undetected and the quality guarantee is hollow.
//
// Solution: map each critical source file to its paired test file, run
// mutation testing with only that test file per mutation (not the full
// 3879-test suite), and report a per-file mutation score + overall gate.
//
// Each mutation run takes ~200ms (one test file).
// 6 files × 10 mutants = ~12 seconds total — feasible in CI.
//
// Gate: overall score ≥ minMutationScore (default 0.6).
// Saves .danteforge/mutation-report.json for CI tracking.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import {
  generateMutants,
  applyMutant,
} from '../../core/mutation-score.js';

const execFileAsync = promisify(execFile);

// ── Source → Test mapping ─────────────────────────────────────────────────────

export interface TargetPair {
  src: string;   // relative to cwd
  test: string;  // relative to cwd
}

export const CORE_TARGETS: TargetPair[] = [
  { src: 'src/core/circuit-breaker.ts',   test: 'tests/circuit-breaker.test.ts' },
  { src: 'src/core/plateau-detector.ts',  test: 'tests/plateau-detector.test.ts' },
  { src: 'src/core/objective-metrics.ts', test: 'tests/objective-metrics.test.ts' },
  { src: 'src/core/bundle-trust.ts',      test: 'tests/bundle-trust.test.ts' },
  { src: 'src/core/adversarial-scorer.ts',test: 'tests/adversarial-scorer.test.ts' },
  { src: 'src/core/causal-attribution.ts',test: 'tests/causal-attribution.test.ts' },
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PerFileResult {
  file: string;
  testFile: string;
  mutationScore: number;
  killed: number;
  survived: number;
  total: number;
  operatorBreakdown: Record<string, { killed: number; total: number }>;
}

export interface SelfMutateResult {
  perFile: PerFileResult[];
  overallScore: number;
  gatePass: boolean;
  minMutationScore: number;
  reportPath: string;
}

/** Preview of a single mutant in dry-run mode — no files are changed. */
export interface MutantPreview {
  /** File being mutated (relative to cwd). */
  file: string;
  /** Mutation operator applied (e.g. "negate-condition"). */
  operator: string;
  /** Zero-based line index of the change. */
  line: number;
  /** Original line text. */
  originalLine: string;
  /** Mutated line text. */
  mutatedLine: string;
}

/** Result returned when --dry-run is enabled (no tests are run). */
export interface DryRunResult {
  dryRun: true;
  previews: MutantPreview[];
  totalMutants: number;
  filesScanned: number;
}

export interface SelfMutateOptions {
  cwd?: string;
  /** Source→test pairs to mutate. Defaults to CORE_TARGETS. */
  targets?: TargetPair[];
  /** Max mutants per file. Default 10. */
  maxMutantsPerFile?: number;
  /** Gate threshold — overall score must meet this. Default 0.6. */
  minMutationScore?: number;
  /**
   * Dry-run mode: show what mutants would be generated and the diff preview
   * without actually applying them or running any tests. Safe to run in CI.
   */
  dryRun?: boolean;
  /** Inject for testing — returns true if mutation was killed (test failed). */
  _runTests?: (testFile: string, cwd: string) => Promise<boolean>;
  /** Inject for testing. */
  _readFile?: (p: string) => Promise<string>;
  /** Inject for testing. */
  _writeFile?: (p: string, content: string) => Promise<void>;
  /** Inject for testing. */
  _restoreFile?: (p: string, original: string) => Promise<void>;
  /** Inject for testing. */
  _writeReport?: (p: string, content: string) => Promise<void>;
}

// ── Default test runner ───────────────────────────────────────────────────────

async function runTestFileDefault(testFile: string, cwd: string): Promise<boolean> {
  try {
    await execFileAsync('npx', ['tsx', '--test', testFile], { cwd, timeout: 30_000 });
    return false; // tests passed → mutation survived
  } catch {
    return true;  // tests failed → mutation killed
  }
}

// ── Per-file mutation runner ───────────────────────────────────────────────────

async function mutateSingleFile(
  target: TargetPair,
  cwd: string,
  maxMutantsPerFile: number,
  readFile: (p: string) => Promise<string>,
  writeFile: (p: string, c: string) => Promise<void>,
  restoreFile: (p: string, orig: string) => Promise<void>,
  runTests: (testFile: string, cwd: string) => Promise<boolean>,
): Promise<PerFileResult> {
  const srcPath = path.join(cwd, target.src);
  const empty: PerFileResult = { file: target.src, testFile: target.test, mutationScore: 1.0, killed: 0, survived: 0, total: 0, operatorBreakdown: {} };

  let original: string;
  try {
    original = await readFile(srcPath);
  } catch {
    logger.warn(`[self-mutate] Skipping ${target.src}: cannot read file`);
    return empty;
  }

  const mutants = generateMutants(original, Math.ceil(maxMutantsPerFile / 5)).slice(0, maxMutantsPerFile);
  if (mutants.length === 0) {
    logger.info(`[self-mutate] ${target.src}: no mutants generated — score=1.0`);
    return empty;
  }

  logger.info(`[self-mutate] ${target.src}: testing ${mutants.length} mutants against ${target.test}`);
  const results: Array<{ operator: string; killed: boolean }> = [];

  for (const mutant of mutants) {
    let killed = false;
    try {
      await writeFile(srcPath, applyMutant(original, mutant));
      killed = await runTests(target.test, cwd).catch(() => false);
    } finally {
      await restoreFile(srcPath, original).catch(() => {});
    }
    results.push({ operator: mutant.operator, killed });
  }

  const killedCount = results.filter(r => r.killed).length;
  const total = results.length;
  const mutationScore = total > 0 ? Math.round((killedCount / total) * 1000) / 1000 : 1.0;

  const operatorBreakdown: Record<string, { killed: number; total: number }> = {};
  for (const r of results) {
    if (!operatorBreakdown[r.operator]) operatorBreakdown[r.operator] = { killed: 0, total: 0 };
    operatorBreakdown[r.operator].total++;
    if (r.killed) operatorBreakdown[r.operator].killed++;
  }

  logger.info(`[self-mutate] ${target.src}: score=${mutationScore.toFixed(2)} (${killedCount}/${total} killed)`);
  return { file: target.src, testFile: target.test, mutationScore, killed: killedCount, survived: total - killedCount, total, operatorBreakdown };
}

// ── Dry-run helper ─────────────────────────────────────────────────────────────

/**
 * Perform a dry-run: enumerate all mutants that WOULD be generated without
 * writing a single byte to disk or running any tests. Outputs a structured
 * preview with per-mutant diff lines.
 */
export async function dryRunSelfMutate(
  opts: Pick<SelfMutateOptions, 'cwd' | 'targets' | 'maxMutantsPerFile' | '_readFile'>,
): Promise<DryRunResult> {
  const cwd = opts.cwd ?? process.cwd();
  const targets = opts.targets ?? CORE_TARGETS;
  const maxMutantsPerFile = opts.maxMutantsPerFile ?? 10;
  const readFile = opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));

  const previews: MutantPreview[] = [];
  let filesScanned = 0;

  logger.info('[self-mutate dry-run] Scanning targets — no files will be modified, no tests will be run.');

  for (const target of targets) {
    const srcPath = path.join(cwd, target.src);
    let original: string;
    try {
      original = await readFile(srcPath);
    } catch {
      logger.warn(`[self-mutate dry-run] Skipping ${target.src}: cannot read file`);
      continue;
    }

    filesScanned++;
    const mutants = generateMutants(original, Math.ceil(maxMutantsPerFile / 5)).slice(0, maxMutantsPerFile);

    logger.info(`[self-mutate dry-run] ${target.src}: ${mutants.length} mutant(s) would be generated`);

    const lines = original.split('\n');
    for (const mutant of mutants) {
      const mutatedContent = applyMutant(original, mutant);
      const mutatedLines = mutatedContent.split('\n');

      // Find the first differing line to show as a preview
      let diffLine = 0;
      let originalLine = '';
      let mutatedLine = '';
      for (let i = 0; i < Math.max(lines.length, mutatedLines.length); i++) {
        if (lines[i] !== mutatedLines[i]) {
          diffLine = i;
          originalLine = lines[i] ?? '';
          mutatedLine = mutatedLines[i] ?? '';
          break;
        }
      }

      previews.push({
        file: target.src,
        operator: mutant.operator,
        line: diffLine,
        originalLine,
        mutatedLine,
      });
    }
  }

  // Print diff preview to stdout
  if (previews.length > 0) {
    logger.info(`\n[self-mutate dry-run] Preview (${previews.length} mutant(s) across ${filesScanned} file(s)):`);
    for (const p of previews) {
      logger.info(`  ${p.file}:${p.line + 1} [${p.operator}]`);
      logger.info(`    - ${p.originalLine.trimEnd()}`);
      logger.info(`    + ${p.mutatedLine.trimEnd()}`);
    }
  } else {
    logger.info('[self-mutate dry-run] No mutants would be generated for the current targets.');
  }

  return { dryRun: true, previews, totalMutants: previews.length, filesScanned };
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runSelfMutate(opts: SelfMutateOptions = {}): Promise<SelfMutateResult> {
  const cwd = opts.cwd ?? process.cwd();

  // --- Decision-node: record start (best-effort) ---
  let _dnStartNodeId: string | undefined;
  const _dnT0 = Date.now();
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession(cwd);
    const _dnStart = await recordDecision({ session: _dnSess, actorType: 'agent', prompt: 'self-mutate: code mutation and test', context: { cwd }, result: 'in-progress', success: false });
    _dnStartNodeId = _dnStart.id;
  } catch { /* never block */ }

  // ── Dry-run early exit ──────────────────────────────────────────────────────
  if (opts.dryRun) {
    const dryRunRes = await dryRunSelfMutate({
      cwd,
      targets: opts.targets,
      maxMutantsPerFile: opts.maxMutantsPerFile,
      _readFile: opts._readFile,
    });
    logger.info(`[self-mutate dry-run] Done. ${dryRunRes.totalMutants} mutant(s) previewed across ${dryRunRes.filesScanned} file(s). No changes made.`);
    // Return a synthetic result so callers can branch on dryRun without a type assertion
    return {
      perFile: [],
      overallScore: 1.0,
      gatePass: true,
      minMutationScore: opts.minMutationScore ?? 0.6,
      reportPath: '',
    };
  }

  const targets = opts.targets ?? CORE_TARGETS;
  const maxMutantsPerFile = opts.maxMutantsPerFile ?? 10;
  const minMutationScore = opts.minMutationScore ?? 0.6;

  const readFile = opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFile = opts._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
  const restoreFile = opts._restoreFile ?? writeFile;
  const runTests = opts._runTests ?? runTestFileDefault;
  const writeReport = opts._writeReport ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));

  const perFile: PerFileResult[] = [];
  for (const target of targets) {
    perFile.push(await mutateSingleFile(target, cwd, maxMutantsPerFile, readFile, writeFile, restoreFile, runTests));
  }

  const filesWithMutants = perFile.filter(f => f.total > 0);
  const overallScore = filesWithMutants.length > 0
    ? Math.round((filesWithMutants.reduce((sum, f) => sum + f.mutationScore * f.total, 0) /
        filesWithMutants.reduce((sum, f) => sum + f.total, 0)) * 1000) / 1000
    : 1.0;

  const gatePass = overallScore >= minMutationScore;
  const reportPath = path.join(cwd, '.danteforge', 'mutation-report.json');
  await writeReport(reportPath, JSON.stringify({ capturedAt: new Date().toISOString(), overallScore, gatePass, minMutationScore, perFile }, null, 2)).catch(() => {});

  // --- Decision-node: record completion (best-effort) ---
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession(cwd);
    await recordDecision({ session: _dnSess, parentNodeId: _dnStartNodeId, actorType: 'agent', prompt: 'self-mutate: code mutation and test [complete]', result: 'self-mutate complete', success: true, latencyMs: Date.now() - _dnT0 });
  } catch { /* best-effort */ }

  return { perFile, overallScore, gatePass, minMutationScore, reportPath };
}
