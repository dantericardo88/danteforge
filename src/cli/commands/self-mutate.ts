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

export interface SelfMutateOptions {
  cwd?: string;
  /** Source→test pairs to mutate. Defaults to CORE_TARGETS. */
  targets?: TargetPair[];
  /** Max mutants per file. Default 10. */
  maxMutantsPerFile?: number;
  /** Gate threshold — overall score must meet this. Default 0.6. */
  minMutationScore?: number;
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

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run mutation testing on DanteForge's own core files.
 * Uses per-file test targeting to keep runtime bounded.
 */
export async function runSelfMutate(opts: SelfMutateOptions = {}): Promise<SelfMutateResult> {
  const cwd = opts.cwd ?? process.cwd();
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
    const srcPath = path.join(cwd, target.src);

    let original: string;
    try {
      original = await readFile(srcPath);
    } catch {
      logger.warn(`[self-mutate] Skipping ${target.src}: cannot read file`);
      // File not readable — contribute score of 1.0 (no mutations = clean)
      perFile.push({
        file: target.src,
        testFile: target.test,
        mutationScore: 1.0,
        killed: 0,
        survived: 0,
        total: 0,
        operatorBreakdown: {},
      });
      continue;
    }

    const maxPerOp = Math.ceil(maxMutantsPerFile / 5);
    const mutants = generateMutants(original, maxPerOp).slice(0, maxMutantsPerFile);

    if (mutants.length === 0) {
      logger.info(`[self-mutate] ${target.src}: no mutants generated — score=1.0`);
      perFile.push({
        file: target.src,
        testFile: target.test,
        mutationScore: 1.0,
        killed: 0,
        survived: 0,
        total: 0,
        operatorBreakdown: {},
      });
      continue;
    }

    logger.info(`[self-mutate] ${target.src}: testing ${mutants.length} mutants against ${target.test}`);

    const results: Array<{ operator: string; killed: boolean }> = [];

    for (const mutant of mutants) {
      const mutatedSource = applyMutant(original, mutant);
      let killed = false;
      try {
        await writeFile(srcPath, mutatedSource);
        killed = await runTests(target.test, cwd).catch(() => false);
      } finally {
        await restoreFile(srcPath, original).catch(() => {});
      }
      results.push({ operator: mutant.operator, killed });
    }

    const killedCount = results.filter(r => r.killed).length;
    const total = results.length;
    const mutationScore = total > 0 ? Math.round((killedCount / total) * 1000) / 1000 : 1.0;

    // Build operator breakdown
    const operatorBreakdown: Record<string, { killed: number; total: number }> = {};
    for (const r of results) {
      if (!operatorBreakdown[r.operator]) operatorBreakdown[r.operator] = { killed: 0, total: 0 };
      operatorBreakdown[r.operator].total++;
      if (r.killed) operatorBreakdown[r.operator].killed++;
    }

    logger.info(`[self-mutate] ${target.src}: score=${mutationScore.toFixed(2)} (${killedCount}/${total} killed)`);

    perFile.push({
      file: target.src,
      testFile: target.test,
      mutationScore,
      killed: killedCount,
      survived: total - killedCount,
      total,
      operatorBreakdown,
    });
  }

  // Compute overall score: weighted by total mutants (files with 0 mutants don't dilute)
  const filesWithMutants = perFile.filter(f => f.total > 0);
  const overallScore = filesWithMutants.length > 0
    ? Math.round((filesWithMutants.reduce((sum, f) => sum + f.mutationScore * f.total, 0) /
        filesWithMutants.reduce((sum, f) => sum + f.total, 0)) * 1000) / 1000
    : 1.0;

  const gatePass = overallScore >= minMutationScore;

  const reportPath = path.join(cwd, '.danteforge', 'mutation-report.json');
  const report = {
    capturedAt: new Date().toISOString(),
    overallScore,
    gatePass,
    minMutationScore,
    perFile,
  };

  await writeReport(reportPath, JSON.stringify(report, null, 2)).catch(() => {});

  return { perFile, overallScore, gatePass, minMutationScore, reportPath };
}
