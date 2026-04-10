// benchmark — cross-project PDSE benchmarking
import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import {
  loadProjectsManifest,
  registerProject,
  formatBenchmarkTable,
  buildBenchmarkReport,
} from '../../core/project-registry.js';

export interface BenchmarkOptions {
  register?: boolean;
  compare?: boolean;
  report?: boolean;
  startup?: boolean;
  startupRuns?: number;
  harness?: boolean;
  suite?: string;
  task?: string;
  all?: boolean;
  cwd?: string;
  homeDir?: string;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, c: string) => Promise<void>;
  _mkdir?: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
  _exec?: (cmd: string) => Promise<number>;
}

export async function benchmark(options: BenchmarkOptions = {}): Promise<void> {
  return withErrorBoundary('benchmark', async () => {
    const cwd = options.cwd ?? process.cwd();
    const readFile = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
    const writeFile = options._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
    const mkdir = options._mkdir ?? ((p: string, o?: { recursive?: boolean }) => fs.mkdir(p, o).then(() => {}).catch(() => {}));
    const registryOpts = {
      _readFile: readFile,
      _writeFile: writeFile,
      _mkdir: mkdir,
      homeDir: options.homeDir,
    };

    if (options.register) {
      // Read latest-pdse.json and register the project
      const snapshotPath = path.join(cwd, '.danteforge', 'latest-pdse.json');
      let snapshot: { avgScore: number; scores: Record<string, { score: number }> };
      try {
        const raw = await readFile(snapshotPath);
        snapshot = JSON.parse(raw) as typeof snapshot;
      } catch {
        logger.error('No PDSE snapshot found. Run "danteforge autoforge --score-only" first.');
        return;
      }
      await registerProject(cwd, snapshot, registryOpts);
      logger.success(`Registered "${path.basename(cwd)}" in benchmark registry (score: ${snapshot.avgScore})`);
      logger.info('Run "danteforge benchmark --compare" to see all projects.');
      return;
    }

    if (options.compare) {
      const manifest = await loadProjectsManifest(registryOpts);
      logger.info('');
      logger.info('DanteForge Cross-Project Leaderboard');
      logger.info('');
      logger.info(formatBenchmarkTable(manifest.projects));
      logger.info('');
      return;
    }

    if (options.report) {
      const manifest = await loadProjectsManifest(registryOpts);
      const generatedAt = new Date().toISOString();
      const reportContent = buildBenchmarkReport(manifest.projects, generatedAt);
      const reportPath = path.join(cwd, 'BENCHMARK_REPORT.md');
      await mkdir(path.dirname(reportPath), { recursive: true });
      await writeFile(reportPath, reportContent);
      logger.success(`Benchmark report written to BENCHMARK_REPORT.md`);
      logger.info(`  ${manifest.projects.length} project(s) tracked`);
      return;
    }

    if (options.startup) {
      // Performance monitoring for startup
      const { PerformanceMonitor } = await import('../../core/performance-monitor.js');
      const monitor = new PerformanceMonitor(cwd);
      // CLI startup benchmark with regression detection
      const runs = options.startupRuns ?? 5;
      const execFn = options._exec ?? (async (cmd: string) => {
        const { execSync } = await import('child_process');
        const start = performance.now();
        execSync(cmd, { cwd, stdio: 'pipe', timeout: 10_000 });
        return performance.now() - start;
      });

      logger.info(`Benchmarking CLI startup time (${runs} runs)...`);
      const times: number[] = [];
      for (let i = 0; i < runs; i++) {
        const ms = await execFn('node dist/index.js --version');
        times.push(ms);
      }
      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)] ?? avg;
      const p95 = [...times].sort((a, b) => a - b)[Math.floor(times.length * 0.95)] ?? avg;

      const result = { avgMs: Math.round(avg), medianMs: Math.round(median), p95Ms: Math.round(p95), runs, timestamp: new Date().toISOString() };

      // Load baseline for regression detection
      const baselinePath = path.join(cwd, '.danteforge', 'startup-baseline.json');
      let regressionDetected = false;
      try {
        const raw = await readFile(baselinePath);
        const baseline = JSON.parse(raw) as { medianMs: number };
        const regressionThreshold = 1.3; // 30% slower = regression
        if (result.medianMs > baseline.medianMs * regressionThreshold) {
          regressionDetected = true;
          logger.warn(`REGRESSION: Median startup ${result.medianMs}ms vs baseline ${baseline.medianMs}ms (${Math.round((result.medianMs / baseline.medianMs - 1) * 100)}% slower)`);
        } else {
          logger.success(`No regression: ${result.medianMs}ms vs baseline ${baseline.medianMs}ms`);
        }
      } catch {
        logger.info('No baseline found. Saving current results as baseline.');
      }

      // Save results
      const resultsDir = path.join(cwd, '.danteforge');
      await mkdir(resultsDir, { recursive: true });
      await writeFile(path.join(resultsDir, 'startup-benchmark.json'), JSON.stringify(result, null, 2));
      if (!regressionDetected) {
        await writeFile(baselinePath, JSON.stringify(result, null, 2));
      }

      // Record performance metrics
      await monitor.recordStartupTime(result.medianMs);

      logger.info(`  Avg: ${result.avgMs}ms | Median: ${result.medianMs}ms | P95: ${result.p95Ms}ms`);

      const { regression } = await monitor.getCurrentMetrics();
      if (!regression) {
        logger.success('No performance regression detected');
      }

      return;
    }

    if (options.harness) {
      const { benchmarkHarness } = await import('../../core/benchmark-harness.js');
      const harness = new benchmarkHarness();

      if (options.suite && options.task) {
        logger.info(`Running benchmark: ${options.suite}:${options.task}`);
        const result = await harness.runBenchmark(options.suite, options.task, cwd);
        if (result) {
          logger.success(`Benchmark completed with score: ${result.overallScore.toFixed(2)}`);
          logger.info(`Verdict: ${result.verdict}`);
        } else {
          logger.error('Benchmark failed');
        }
      } else if (options.suite) {
        logger.info(`Running benchmark suite: ${options.suite}`);
        const results = await harness.runSuite(options.suite, cwd);
        logger.success(`Suite completed: ${results.length} tasks`);
        for (const result of results) {
          logger.info(`  ${result.taskId}: ${result.overallScore.toFixed(2)} (${result.verdict})`);
        }
      } else if (options.all) {
        logger.info('Running all benchmark suites');
        const suites = benchmarkHarness.getSuites();
        for (const suiteId of suites) {
          logger.info(`Running suite: ${suiteId}`);
          const results = await benchmarkHarness.runSuite(suiteId, cwd);
          logger.success(`Suite ${suiteId} completed: ${results.length} tasks`);
        }
      } else {
        logger.info('Available benchmark suites:');
        const suites = harness.getSuites();
        for (const suiteId of suites) {
          const tasks = harness.getSuiteTasks(suiteId);
          logger.info(`  ${suiteId}: ${tasks.length} tasks`);
          for (const task of tasks) {
            logger.info(`    - ${task.id}: ${task.name} (${task.difficulty})`);
          }
        }
      }
      return;
    }

    // Default: status
    const manifest = await loadProjectsManifest(registryOpts);
    logger.info(`Benchmark registry: ${manifest.projects.length} project(s) tracked`);
    logger.info('');
    logger.info('Options:');
    logger.info('  --register     Register this project (requires latest-pdse.json)');
    logger.info('  --compare      Show ranked leaderboard table');
    logger.info('  --report       Generate BENCHMARK_REPORT.md');
    logger.info('  --startup      Benchmark CLI startup time with regression detection');
    logger.info('  --harness      Run completion truthfulness benchmarks');
    logger.info('    --suite <id>   Run specific benchmark suite');
    logger.info('    --task <id>    Run specific benchmark task');
    logger.info('    --all          Run all benchmark suites');
  });
}
