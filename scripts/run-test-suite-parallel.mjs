// Parallel test-suite runner — EXPERIMENTAL (do not use as default).
//
// **Pass 15 finding: parallel-lane execution is SLOWER than sequential on
// CPU-bound machines.** Real measurement on an 8-core laptop:
//   sequential (npm test):                            265.9s = 4.4 min
//   parallel  (npm run test:parallel-experimental):   384.4s = 6.4 min  (45% slower)
// CPU oversubscription (12 worker processes for 8 CPUs) caused each lane to
// run 2-3x slower than alone (default 103.9s -> 269.3s, cli-process 150.3s -> 382.4s,
// orchestration-heavy 10.1s -> 31.4s). **Use the sequential `npm test` for normal work.**
//
// This script is retained as an experimental harness for future investigation
// on machines with significantly more CPU headroom (e.g., 16+ cores) where
// parallel lanes might pay off. Do NOT wire into the default `verify` chain.
//
// Lane scheduling rules (preserves correctness):
//  - orchestration-heavy and orchestration-e2e MUST run sequentially (the whole
//    reason e2e was split into its own lane is they conflict with autonomous-loop
//    suites in heavy). e2e runs AFTER heavy.
//  - default and cli-process are orthogonal; can run concurrently in principle.
//
// Strategy:
//  Phase A (concurrent): default + cli-process + orchestration-heavy
//  Phase B (after heavy completes): orchestration-e2e
//
// Output: lanes' stdout/stderr are buffered + emitted on lane completion to
// keep terminal output legible. Final summary mirrors run-test-suite.mjs.

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildTestPlan } from './test-manifest.mjs';
import { writeCommandCheckReceipt } from './command-check-receipts.mjs';

const repoRoot = process.cwd();
const testsRoot = path.join(repoRoot, 'tests');
const tsxCliPath = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const NOISY_LOG_PREFIX = /^\[(INFO|WARN|OK)\]\s/;
const suiteStart = Date.now();

async function listTestFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) { files.push(...await listTestFiles(absolutePath)); continue; }
    if (entry.isFile() && entry.name.endsWith('.test.ts')) files.push(absolutePath);
  }
  return files;
}

function bufferLines(stream, target, prefix) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line && !NOISY_LOG_PREFIX.test(line)) target.push(`${prefix}${line}`);
    }
  });
  stream.on('end', () => {
    if (buffer.length > 0 && !NOISY_LOG_PREFIX.test(buffer)) target.push(`${prefix}${buffer}`);
  });
}

function runLane(lane) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const args = [
      tsxCliPath, '--test',
      `--test-concurrency=${lane.concurrency}`,
      ...lane.nodeArgs,
      ...lane.files,
    ];
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    const lineBuffer = [];
    const prefix = `[${lane.id}] `;
    bufferLines(child.stdout, lineBuffer, prefix);
    bufferLines(child.stderr, lineBuffer, prefix);

    child.on('error', reject);
    child.on('close', (code, signal) => {
      const durationMs = Date.now() - start;
      if (signal) {
        reject(new Error(`Lane ${lane.id} exited with signal ${signal} after ${durationMs}ms`));
        return;
      }
      resolve({ id: lane.id, durationMs, code: code ?? 1, lines: lineBuffer });
    });
  });
}

const testFiles = (await listTestFiles(testsRoot))
  .sort((l, r) => l.localeCompare(r))
  .map(f => path.relative(repoRoot, f));
const testPlan = buildTestPlan(testFiles);

if (testFiles.length === 0) {
  process.stderr.write('No test files found under tests/**/*.test.ts\n');
  process.exit(1);
}

try { await fs.access(tsxCliPath); } catch {
  process.stderr.write(`Unable to locate tsx CLI at ${tsxCliPath}\n`);
  process.exit(1);
}

const lanesById = Object.fromEntries(testPlan.map(l => [l.id, l]));
const phaseA = ['default', 'cli-process', 'orchestration-heavy'].map(id => lanesById[id]).filter(Boolean);
const phaseB = ['orchestration-e2e'].map(id => lanesById[id]).filter(Boolean);

process.stderr.write(`[tests] PARALLEL mode: Phase A (${phaseA.map(l => l.id).join(', ')}) concurrent, then Phase B (${phaseB.map(l => l.id).join(', ')})\n`);
for (const lane of [...phaseA, ...phaseB]) {
  process.stderr.write(`[tests]   ${lane.id}: ${lane.files.length} file(s), concurrency=${lane.concurrency}\n`);
}

let totalFailures = 0;
let firstNonZeroCode = 0;

async function runPhase(phaseLabel, lanes) {
  if (lanes.length === 0) return;
  const phaseStart = Date.now();
  const results = await Promise.all(lanes.map(l => runLane(l)));
  for (const result of results) {
    for (const line of result.lines) process.stdout.write(line + '\n');
    const durationSeconds = (result.durationMs / 1000).toFixed(1);
    process.stderr.write(`[tests] Lane ${result.id} completed in ${durationSeconds}s\n`);
    if (result.code !== 0) {
      totalFailures++;
      if (firstNonZeroCode === 0) firstNonZeroCode = result.code;
    }
  }
  const phaseSeconds = ((Date.now() - phaseStart) / 1000).toFixed(1);
  process.stderr.write(`[tests] ${phaseLabel} completed in ${phaseSeconds}s\n`);
}

try {
  await runPhase('Phase A (parallel)', phaseA);
  if (totalFailures > 0) {
    await writeCommandCheckReceipt({ id: 'test', command: 'npm run test:fast', status: 'fail', durationMs: Date.now() - suiteStart }, repoRoot);
    process.exit(firstNonZeroCode || 1);
  }
  await runPhase('Phase B (sequential after heavy)', phaseB);
  if (totalFailures > 0) {
    await writeCommandCheckReceipt({ id: 'test', command: 'npm run test:fast', status: 'fail', durationMs: Date.now() - suiteStart }, repoRoot);
    process.exit(firstNonZeroCode || 1);
  }
  await writeCommandCheckReceipt({ id: 'test', command: 'npm run test:fast', status: 'pass', durationMs: Date.now() - suiteStart }, repoRoot);
  process.stderr.write(`[tests] PARALLEL suite completed in ${((Date.now() - suiteStart)/1000).toFixed(1)}s\n`);
} catch (error) {
  await writeCommandCheckReceipt({ id: 'test', command: 'npm run test:fast', status: 'fail', durationMs: Date.now() - suiteStart }, repoRoot);
  throw error;
}
