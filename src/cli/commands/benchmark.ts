// benchmark — real 18-dimension scorecard with optional competitor comparison,
// plus external benchmark suites (SWE-bench, Exercism) for T8 evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { computeHarshScore, type HarshScoreResult, type ScoringDimension } from '../../core/harsh-scorer.js';
import { loadMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

const execFileAsync = promisify(execFile);
const BENCHMARKS_DIR = '.danteforge/benchmarks';

export type ExternalSuite = 'swe-bench' | 'exercism';

export interface BenchmarkOptions {
  dimension?: string;
  compare?: boolean;
  format?: 'table' | 'json';
  cwd?: string;
  // External benchmark suite options
  suite?: ExternalSuite;
  instances?: number;         // max tasks (default: 10)
  assertMinPassRate?: number; // exit 1 if pass rate < threshold
  timeoutPerTask?: number;    // ms per task (default: 300_000)
  // Injection seams for testing
  _harshScore?: typeof computeHarshScore;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
}

// ── External benchmark types ──────────────────────────────────────────────────

interface TaskResult {
  instanceId: string;
  repo?: string;
  passed: boolean;
  durationMs: number;
  errorSummary?: string;
}

interface ExternalBenchmarkReport {
  suite: ExternalSuite;
  ranAt: string;
  totalTasks: number;
  passedTasks: number;
  passRate1: number;
  avgDurationMs: number;
  results: TaskResult[];
}

// Published pass rates for competitor comparison (update as new papers land).
const EXTERNAL_BASELINES: Record<string, { sweBench?: number; exercism?: number; source: string }> = {
  'aider':     { sweBench: 0.185, exercism: 0.62, source: 'https://aider.chat/docs/leaderboards/' },
  'openhands': { sweBench: 0.776, source: 'https://arxiv.org/abs/2407.16741' },
  'swe-agent': { sweBench: 0.128, source: 'https://swe-agent.com' },
  'devin':     { sweBench: 0.138, source: 'https://cognition.ai/blog/devin' },
  'codex':     { sweBench: 0.177, source: 'https://openai.com/blog/openai-codex' },
};

// ── SWE-bench runner ──────────────────────────────────────────────────────────

async function loadSweBenchInstances(cwd: string, count: number) {
  const dir = path.join(cwd, BENCHMARKS_DIR);
  let files: string[];
  try { files = await fs.readdir(dir); }
  catch { return []; }

  const benchFile = files
    .filter(f => f.startsWith('swe-bench-') && f.endsWith('.json'))
    .sort((a, b) => {
      const na = parseInt(a.replace('swe-bench-', '').replace('.json', ''), 10);
      const nb = parseInt(b.replace('swe-bench-', '').replace('.json', ''), 10);
      return nb - na;
    })[0];

  if (!benchFile) return [];
  const raw = await fs.readFile(path.join(dir, benchFile), 'utf-8');
  const data = JSON.parse(raw) as {
    instances: Array<{ instance_id: string; repo: string; problem_statement: string; test_patch: string }>;
  };
  return (data.instances ?? []).slice(0, count);
}

// Path to the dedicated swe-bench-runner package (lives in the DanteCode monorepo, a sibling of this repo).
// Portable: env override, else resolve DanteCode as a sibling of the current project (never a hardcoded drive).
const SWE_BENCH_RUNNER = process.env['DANTEFORGE_SWE_BENCH_RUNNER']
  ?? path.resolve(process.cwd(), '..', 'DanteCode', 'packages', 'swe-bench-runner', 'dist', 'index.js');

async function resolveSweBenchRunner(): Promise<string | null> {
  try {
    await fs.access(SWE_BENCH_RUNNER);
    return SWE_BENCH_RUNNER;
  } catch {
    return null;
  }
}

async function runSweBenchTask(
  inst: { instance_id: string; repo: string; problem_statement: string },
  runnerPath: string,
  timeoutMs: number,
): Promise<TaskResult> {
  const t0 = Date.now();
  try {
    const env = {
      ...process.env,
      SWEBENCH_INSTANCE_ID: inst.instance_id,
      SWEBENCH_REPO: inst.repo,
      SWEBENCH_PROBLEM: inst.problem_statement.slice(0, 2000),
    };
    // Delegate to the dedicated swe-bench-runner — NOT a self-call into benchmark.
    // The runner handles: repo clone at base_commit, patch application, test execution.
    await execFileAsync(process.execPath, [runnerPath, '--instance', inst.instance_id], {
      timeout: timeoutMs, env,
    });
    return { instanceId: inst.instance_id, repo: inst.repo, passed: true, durationMs: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { instanceId: inst.instance_id, repo: inst.repo, passed: false, durationMs: Date.now() - t0, errorSummary: msg.slice(0, 200) };
  }
}

async function runSweBench(cwd: string, instances: number, timeoutPerTask: number): Promise<ExternalBenchmarkReport> {
  // Pre-flight: verify the dedicated runner is built before loading any tasks.
  const runnerPath = await resolveSweBenchRunner();
  if (!runnerPath) {
    logger.warn('[benchmark] swe-bench-runner not built.');
    logger.warn('[benchmark] To enable SWE-bench: build the swe-bench-runner in the sibling DanteCode repo');
    logger.warn('[benchmark]   (../DanteCode/packages/swe-bench-runner: npm ci && npm run build), or set');
    logger.warn('[benchmark]   DANTEFORGE_SWE_BENCH_RUNNER to its built dist/index.js path.');
    logger.warn('[benchmark] Then re-run: danteforge benchmark --suite swe-bench');
    return buildExternalReport('swe-bench', []);
  }

  const insts = await loadSweBenchInstances(cwd, instances);
  if (insts.length === 0) {
    logger.warn('[benchmark] No SWE-bench data found. Run `node scripts/download-swe-bench.mjs` first.');
    return buildExternalReport('swe-bench', []);
  }
  logger.info(`[benchmark] Running ${insts.length} SWE-bench tasks via swe-bench-runner...`);
  const results: TaskResult[] = [];
  for (const inst of insts) {
    logger.info(`[benchmark]   ${results.length + 1}/${insts.length}: ${inst.instance_id}`);
    const r = await runSweBenchTask(inst, runnerPath, timeoutPerTask);
    results.push(r);
    logger.info(`[benchmark]   ${r.passed ? 'PASS' : 'FAIL'} (${r.durationMs}ms)`);
  }
  return buildExternalReport('swe-bench', results);
}

// ── Exercism runner ───────────────────────────────────────────────────────────

async function runExercism(cwd: string, instances: number, timeoutPerTask: number): Promise<ExternalBenchmarkReport> {
  logger.info('[benchmark] Checking exercism CLI...');
  let available = false;
  try { await execFileAsync('exercism', ['version'], { timeout: 5000 }); available = true; }
  catch { logger.warn('[benchmark] exercism CLI not found — install from https://exercism.org/cli-walkthrough'); }

  if (!available) return buildExternalReport('exercism', []);

  const exercises = ['hello-world', 'two-fer', 'leap', 'grains', 'hamming', 'raindrops', 'bob', 'pangram', 'anagram', 'isogram'].slice(0, instances);
  const results: TaskResult[] = [];

  for (const slug of exercises) {
    const t0 = Date.now();
    try {
      const tmpDir = path.join(cwd, BENCHMARKS_DIR, 'exercism-tmp', slug);
      await fs.mkdir(tmpDir, { recursive: true });
      await execFileAsync('exercism', ['download', '--exercise', slug, '--track', 'typescript', '--force'], { cwd: tmpDir, timeout: 30_000 });
      await execFileAsync('npm', ['install', '--prefer-offline'], { cwd: tmpDir, timeout: 60_000 });
      await execFileAsync('npm', ['test'], { cwd: tmpDir, timeout: timeoutPerTask });
      results.push({ instanceId: slug, passed: true, durationMs: Date.now() - t0 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ instanceId: slug, passed: false, durationMs: Date.now() - t0, errorSummary: msg.slice(0, 200) });
    }
    logger.info(`[benchmark]   ${slug}: ${results.at(-1)!.passed ? 'PASS' : 'FAIL'}`);
  }
  return buildExternalReport('exercism', results);
}

function buildExternalReport(suite: ExternalSuite, results: TaskResult[]): ExternalBenchmarkReport {
  const passed = results.filter(r => r.passed).length;
  const avg = results.length > 0 ? results.reduce((s, r) => s + r.durationMs, 0) / results.length : 0;
  return { suite, ranAt: new Date().toISOString(), totalTasks: results.length, passedTasks: passed, passRate1: results.length > 0 ? passed / results.length : 0, avgDurationMs: Math.round(avg), results };
}

function renderExternalReport(report: ExternalBenchmarkReport, compareWith?: string): void {
  logger.info('');
  logger.info(`── External Benchmark: ${report.suite} ───────────────────────────────`);
  logger.info(`   Tasks:      ${report.totalTasks}  |  Passed: ${report.passedTasks}  |  Pass@1: ${(report.passRate1 * 100).toFixed(1)}%`);
  logger.info(`   Avg time:   ${(report.avgDurationMs / 1000).toFixed(1)}s per task`);
  if (compareWith) {
    const b = EXTERNAL_BASELINES[compareWith.toLowerCase()];
    const their = b ? (report.suite === 'exercism' ? b.exercism : b.sweBench) : undefined;
    if (their !== undefined) {
      const d = report.passRate1 - their;
      logger.info(`   vs ${compareWith}: ${(their * 100).toFixed(1)}% baseline (DanteForge ${d >= 0 ? '+' : ''}${(d * 100).toFixed(1)}%)`);
    }
  }
  logger.info('')
}

async function saveExternalReport(cwd: string, report: ExternalBenchmarkReport): Promise<void> {
  const dir = path.join(cwd, BENCHMARKS_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `report-${report.suite}-${Date.now()}.json`),
    JSON.stringify(report, null, 2),
    'utf-8',
  );
}

export async function benchmark(options: BenchmarkOptions = {}): Promise<void> {
  return withErrorBoundary('benchmark', async () => {
    const cwd = options.cwd ?? process.cwd();

    // ── External benchmark suites (SWE-bench / Exercism) ───────────────────
    if (options.suite) {
      const instances = options.instances ?? 10;
      const timeoutPerTask = options.timeoutPerTask ?? 300_000;
      const report = options.suite === 'exercism'
        ? await runExercism(cwd, instances, timeoutPerTask)
        : await runSweBench(cwd, instances, timeoutPerTask);

      renderExternalReport(report, typeof options.compare === 'string' ? options.compare : undefined);
      await saveExternalReport(cwd, report);

      if (options.assertMinPassRate !== undefined && report.passRate1 < options.assertMinPassRate) {
        logger.warn(`[benchmark] FAIL — pass rate ${(report.passRate1 * 100).toFixed(1)}% < required ${(options.assertMinPassRate * 100).toFixed(1)}%`);
        process.exitCode = 1;
      }
      return;
    }
    const harshScoreFn = options._harshScore ?? computeHarshScore;

    const result: HarshScoreResult = await harshScoreFn({ cwd });

    // ── Single-dimension output ──────────────────────────────────────────────
    if (options.dimension) {
      const dim = options.dimension as ScoringDimension;
      const score = result.displayDimensions[dim];
      if (score === undefined) {
        logger.warn(`Unknown dimension: ${options.dimension}`);
        logger.info(`Valid dimensions: ${Object.keys(result.displayDimensions).join(', ')}`);
        return;
      }
      if (options.format === 'json') {
        process.stdout.write(JSON.stringify({ dimension: dim, score }, null, 2) + '\n');
      } else {
        logger.info(`${dim}: ${score.toFixed(1)}/10`);
      }
      return;
    }

    // ── JSON output ──────────────────────────────────────────────────────────
    if (options.format === 'json') {
      process.stdout.write(JSON.stringify(result.displayDimensions, null, 2) + '\n');
      return;
    }

    // ── Full table output ────────────────────────────────────────────────────
    const rows = (Object.entries(result.displayDimensions) as [ScoringDimension, number][])
      .sort(([, a], [, b]) => b - a);

    logger.info(`\n## DanteForge Benchmark — ${result.timestamp.slice(0, 10)}`);
    logger.info(`Overall: ${result.displayScore.toFixed(1)}/10  Verdict: ${result.verdict}`);
    if (result.stubsDetected.length > 0) {
      logger.warn(`Stubs detected: ${result.stubsDetected.length} file(s) — penalty applied`);
    }
    logger.info('');
    logger.info('| Dimension | Score | Bar |');
    logger.info('|---|---|---|');
    for (const [dim, score] of rows) {
      const bar = '█'.repeat(Math.round(score)) + '░'.repeat(10 - Math.round(score));
      logger.info(`| ${dim} | ${score.toFixed(1)}/10 | ${bar} |`);
    }

    // ── Competitor comparison ────────────────────────────────────────────────
    if (options.compare) {
      const matrixFn = options._loadMatrix ?? loadMatrix;
      let matrix: CompeteMatrix | null = null;
      try {
        matrix = await matrixFn(cwd);
      } catch {
        logger.warn('Could not load CHL matrix for comparison. Run `danteforge compete --init` first.');
        return;
      }
      if (!matrix) {
        logger.warn('No CHL matrix found. Run `danteforge compete --init` to create one.');
        return;
      }

      logger.info('');
      logger.info('### vs CHL Matrix (self-score vs leader gap)');
      logger.info('| Dimension | Self | Leader Gap |');
      logger.info('|---|---|---|');
      for (const dim of matrix.dimensions) {
        const selfDisplay = (dim.scores['self'] ?? 0).toFixed(1);
        const gapDisplay = dim.gap_to_leader > 0 ? `-${dim.gap_to_leader.toFixed(1)}` : '✓ leads';
        logger.info(`| ${dim.label} | ${selfDisplay}/10 | ${gapDisplay} |`);
      }
      logger.info('');
      logger.info(`Overall matrix score: ${matrix.overallSelfScore?.toFixed(1) ?? '?'}/10`);
      logger.info(`Run \`danteforge compete --sprint\` to close the next gap.`);
    }
  });
}
