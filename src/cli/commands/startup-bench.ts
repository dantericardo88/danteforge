/**
 * startup-bench.ts
 *
 * `danteforge startup-bench [--iterations <n>]`
 *
 * Measures CLI startup latency by spawning `danteforge --version` N times
 * and recording wall-clock time for each run.  Results are written to
 * `.danteforge/startup-bench.json` and printed as a summary table.
 *
 * Exit codes:
 *   0  mean latency ≤ 2000 ms
 *   1  mean latency  > 2000 ms (regression detected)
 */

import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { analyzeTopLevelImports, type ClassifiedImport } from '../../core/import-analyzer.js';

// ── types ──────────────────────────────────────────────────────────────────

export interface StartupBenchOptions {
  /** Number of iterations (default 10). */
  iterations?: number;
  /** Project directory (default: cwd). */
  cwd?: string;
  /** Override the binary path for testing. */
  _binaryPath?: string;
  /** Inject a custom spawn implementation for unit tests. */
  _spawnFn?: SpawnFn;
}

export interface StartupBenchResult {
  iterations: number;
  timingsMs: number[];
  minMs: number;
  maxMs: number;
  meanMs: number;
  p95Ms: number;
  reportPath: string;
  heavyImports: ClassifiedImport[];
  exitCode: 0 | 1;
}

// A minimal spawn-like interface so we can inject a test double.
export type SpawnFn = (
  cmd: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv },
) => Promise<number>;

// ── helpers ────────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? sorted[0] ?? 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const defaultSpawn: SpawnFn = (cmd, args, opts) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: opts.env,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 0));
  });

// ── entry point ────────────────────────────────────────────────────────────

/**
 * Run the startup benchmark.
 *
 * @param options - Configuration for the benchmark run.
 * @returns A {@link StartupBenchResult} with latency statistics.
 */
export async function runStartupBench(
  options: StartupBenchOptions = {},
): Promise<StartupBenchResult> {
  const iterations = Math.max(1, options.iterations ?? 10);
  const cwd = options.cwd ?? process.cwd();
  const spawnFn = options._spawnFn ?? defaultSpawn;

  // Resolve binary — prefer locally installed CLI, fall back to `dist/index.js`
  const binaryPath =
    options._binaryPath ??
    (process.argv[1] ?? join(cwd, 'dist', 'index.js'));

  // Run iterations sequentially so they don't inflate each other's times.
  const timingsMs: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    await spawnFn(process.execPath, [binaryPath, '--version'], {
      env: { ...process.env, DANTEFORGE_PERF: undefined as unknown as string },
    });
    timingsMs.push(Date.now() - start);
  }

  const sorted = [...timingsMs].sort((a, b) => a - b);
  const minMs = sorted[0] ?? 0;
  const maxMs = sorted[sorted.length - 1] ?? 0;
  const meanMs = Math.round(mean(timingsMs));
  const p95Ms = Math.round(percentile(sorted, 95));

  // Locate the entry file for import analysis.  Try the bundled dist first;
  // fall back to the TypeScript source path (for development runs).
  const candidateEntryFiles = [
    binaryPath,
    join(cwd, 'dist', 'index.js'),
    join(cwd, 'src', 'cli', 'index.ts'),
  ];
  const entryFile =
    candidateEntryFiles.find((f) => existsSync(f)) ??
    candidateEntryFiles[candidateEntryFiles.length - 1] ??
    '';

  // Analyse top-level imports and surface the heavy ones.
  const allImports = await analyzeTopLevelImports(entryFile);
  const heavyImports = allImports
    .filter((i) => i.weight === 'heavy')
    .slice(0, 10);

  // Write results to .danteforge/startup-bench.json.
  const reportDir = join(cwd, '.danteforge');
  if (!existsSync(reportDir)) {
    await mkdir(reportDir, { recursive: true });
  }
  const reportPath = join(reportDir, 'startup-bench.json');
  const report = {
    timestamp: new Date().toISOString(),
    iterations,
    timingsMs,
    minMs,
    maxMs,
    meanMs,
    p95Ms,
    binaryPath,
    heavyImports,
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  // Print summary.
  process.stdout.write('\nStartup Benchmark Results\n');
  process.stdout.write('─'.repeat(40) + '\n');
  process.stdout.write(`  Iterations : ${iterations}\n`);
  process.stdout.write(`  Min        : ${minMs} ms\n`);
  process.stdout.write(`  Max        : ${maxMs} ms\n`);
  process.stdout.write(`  Mean       : ${meanMs} ms\n`);
  process.stdout.write(`  p95        : ${p95Ms} ms\n`);
  process.stdout.write(`  Report     : ${reportPath}\n`);

  if (meanMs > 1000) {
    process.stdout.write(
      `\n  WARNING: mean startup time ${meanMs} ms exceeds 1000 ms threshold.\n`,
    );
    if (heavyImports.length > 0) {
      process.stdout.write('  Top heavy top-level imports:\n');
      for (const imp of heavyImports) {
        process.stdout.write(`    [heavy] ${imp.specifier}\n`);
      }
    }
  }

  const exitCode: 0 | 1 = meanMs > 2000 ? 1 : 0;
  if (exitCode === 1) {
    process.stdout.write(
      `\n  ERROR: mean startup time ${meanMs} ms exceeds 2000 ms hard limit.\n`,
    );
  }

  return {
    iterations,
    timingsMs,
    minMs,
    maxMs,
    meanMs,
    p95Ms,
    reportPath,
    heavyImports,
    exitCode,
  };
}
