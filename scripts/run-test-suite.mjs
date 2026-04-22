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
    if (entry.isDirectory()) {
      files.push(...await listTestFiles(absolutePath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      files.push(absolutePath);
    }
  }

  return files;
}

function flushLine(target, line) {
  if (!line || NOISY_LOG_PREFIX.test(line)) {
    return;
  }

  target.write(`${line}\n`);
}

function pipeFiltered(stream, target) {
  let buffer = '';

  stream.setEncoding('utf8');
  stream.on('data', chunk => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      flushLine(target, line);
    }
  });

  stream.on('end', () => {
    if (buffer.length > 0) {
      flushLine(target, buffer);
    }
  });
}

const testFiles = (await listTestFiles(testsRoot))
  .sort((left, right) => left.localeCompare(right))
  .map(file => path.relative(repoRoot, file));
const testPlan = buildTestPlan(testFiles);

if (testFiles.length === 0) {
  process.stderr.write('No test files found under tests/**/*.test.ts\n');
  process.exit(1);
}

try {
  await fs.access(tsxCliPath);
} catch {
  process.stderr.write(`Unable to locate tsx CLI at ${tsxCliPath}\n`);
  process.exit(1);
}

function runLane(lane) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const args = [
      tsxCliPath,
      '--test',
      `--test-concurrency=${lane.concurrency}`,
      ...lane.nodeArgs,
      ...lane.files,
    ];
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    pipeFiltered(child.stdout, process.stdout);
    pipeFiltered(child.stderr, process.stderr);

    child.on('error', reject);
    child.on('close', (code, signal) => {
      const durationMs = Date.now() - start;
      if (signal) {
        reject(new Error(`Lane ${lane.id} exited with signal ${signal} after ${durationMs}ms`));
        return;
      }

      resolve({
        id: lane.id,
        durationMs,
        code: code ?? 1,
      });
    });
  });
}

process.stderr.write(`[tests] Running ${testFiles.length} files across ${testPlan.length} deterministic lane(s)\n`);

try {
  for (const lane of testPlan) {
    process.stderr.write(
      `[tests] Lane ${lane.id}: ${lane.files.length} file(s), concurrency=${lane.concurrency} - ${lane.description}\n`,
    );

    const result = await runLane(lane);
    const durationSeconds = (result.durationMs / 1000).toFixed(1);
    process.stderr.write(`[tests] Lane ${result.id} completed in ${durationSeconds}s\n`);

    if (result.code !== 0) {
      await writeCommandCheckReceipt({
        id: 'test',
        command: 'npm test',
        status: 'fail',
        durationMs: Date.now() - suiteStart,
      }, repoRoot);
      process.exit(result.code);
    }
  }

  await writeCommandCheckReceipt({
    id: 'test',
    command: 'npm test',
    status: 'pass',
    durationMs: Date.now() - suiteStart,
  }, repoRoot);
} catch (error) {
  await writeCommandCheckReceipt({
    id: 'test',
    command: 'npm test',
    status: 'fail',
    durationMs: Date.now() - suiteStart,
  }, repoRoot);
  throw error;
}
