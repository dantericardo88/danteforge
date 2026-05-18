// cli-snapshot.ts — CLI output snapshot testing
// Captures stdout+stderr of any shell command and compares against saved snapshots.
// Snapshots stored in .danteforge/snapshots/<name>.txt

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';

const execFileAsync = promisify(execFile);
const SNAPSHOT_DIR = '.danteforge/snapshots';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SnapshotOptions {
  name: string;
  command: string;
  update?: boolean;
  timeout?: number;
  stripAnsi?: boolean;
  cwd?: string;
  // Injection seams
  _run?: (cmd: string, cwd: string, timeoutMs: number) => Promise<string>;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, data: string) => Promise<void>;
  _exists?: (p: string) => Promise<boolean>;
  _stdout?: (line: string) => void;
}

export type SnapshotStatus = 'created' | 'matched' | 'changed' | 'updated';

export interface SnapshotResult {
  name: string;
  status: SnapshotStatus;
  diff?: string;
  snapshotPath: string;
  exitCode: 0 | 1;
}

export interface SnapshotListOptions {
  cwd?: string;
  _readdir?: (p: string) => Promise<string[]>;
}

export interface SnapshotListResult {
  snapshots: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripAnsiCodes(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[mGKHFABCDJsu]/g, '');
}

function buildDiff(expected: string, actual: string): string {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const maxLen = Math.max(expectedLines.length, actualLines.length);
  const lines: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const e = expectedLines[i];
    const a = actualLines[i];
    if (e === undefined) {
      lines.push(chalk.green(`+ ${a ?? ''}`));
    } else if (a === undefined) {
      lines.push(chalk.red(`- ${e}`));
    } else if (e !== a) {
      lines.push(chalk.red(`- ${e}`));
      lines.push(chalk.green(`+ ${a}`));
    }
  }
  return lines.join('\n');
}

async function defaultRun(cmd: string, cwd: string, timeoutMs: number): Promise<string> {
  const parts = cmd.split(/\s+/);
  const bin = parts[0]!;
  const args = parts.slice(1);
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, { cwd, timeout: timeoutMs });
    return (stdout + stderr).trim();
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return ((e.stdout ?? '') + (e.stderr ?? '') + (e.message ?? '')).trim();
  }
}

function snapshotPath(cwd: string, name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(cwd, SNAPSHOT_DIR, `${safeName}.txt`);
}

// ── Main command ──────────────────────────────────────────────────────────────

export async function cliSnapshot(options: SnapshotOptions): Promise<SnapshotResult> {
  const cwd = options.cwd ?? process.cwd();
  const emit = options._stdout ?? ((line: string) => process.stdout.write(line + '\n'));
  const runFn = options._run ?? defaultRun;
  const readFn = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFn = options._writeFile ?? (async (p: string, data: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data, 'utf8');
  });
  const existsFn = options._exists ?? ((p: string) => fs.access(p).then(() => true).catch(() => false));

  const snapPath = snapshotPath(cwd, options.name);
  const timeoutMs = options.timeout ?? 30_000;

  // Run command and capture output
  let actual = await runFn(options.command, cwd, timeoutMs);
  if (options.stripAnsi !== false) {
    actual = stripAnsiCodes(actual);
  }
  actual = actual.trim() + '\n';

  const exists = await existsFn(snapPath);

  // First run: create snapshot
  if (!exists || options.update) {
    await writeFn(snapPath, actual);
    const status: SnapshotStatus = options.update && exists ? 'updated' : 'created';
    emit(chalk.green(`  ${status === 'created' ? '✓ Snapshot created' : '↺ Snapshot updated'}: ${options.name}`));
    emit(chalk.dim(`    ${snapPath}`));
    return { name: options.name, status, snapshotPath: snapPath, exitCode: 0 };
  }

  // Compare against existing snapshot
  const expected = (await readFn(snapPath)).trim() + '\n';
  if (actual === expected) {
    emit(chalk.green(`  ✓ ${options.name}`));
    return { name: options.name, status: 'matched', snapshotPath: snapPath, exitCode: 0 };
  }

  const diff = buildDiff(expected, actual);
  emit(chalk.red(`  ✗ ${options.name}`) + chalk.dim(' (snapshot changed)'));
  emit('');
  emit(chalk.dim('  Expected (-) / Actual (+):'));
  for (const line of diff.split('\n').slice(0, 20)) {
    emit(`    ${line}`);
  }
  emit('');
  emit(chalk.dim(`  Run with --update to accept new output.`));
  return { name: options.name, status: 'changed', diff, snapshotPath: snapPath, exitCode: 1 };
}

// ── List snapshots ────────────────────────────────────────────────────────────

export async function listSnapshots(options: SnapshotListOptions = {}): Promise<SnapshotListResult> {
  const cwd = options.cwd ?? process.cwd();
  const readdir = options._readdir ?? ((p: string) => fs.readdir(p));
  const dir = path.join(cwd, SNAPSHOT_DIR);
  try {
    const files = (await readdir(dir)).filter(f => f.endsWith('.txt'));
    return { snapshots: files.map(f => f.replace(/\.txt$/, '')) };
  } catch {
    return { snapshots: [] };
  }
}

// ── CLI entry point ────────────────────────────────────────────────────────────

export async function runCliSnapshot(
  name: string,
  command: string,
  opts: { update?: boolean; timeout?: number; list?: boolean; cwd?: string },
): Promise<void> {
  if (opts.list) {
    const { snapshots } = await listSnapshots({ cwd: opts.cwd });
    if (snapshots.length === 0) {
      logger.info('No snapshots found. Create one with: danteforge snapshot <name> --command "<cmd>"');
    } else {
      logger.info(`\nSaved snapshots (${snapshots.length}):`);
      for (const s of snapshots) {
        logger.info(`  • ${s}`);
      }
    }
    return;
  }

  if (!command) {
    logger.error('--command is required. Usage: danteforge snapshot <name> --command "<cmd>"');
    process.exitCode = 1;
    return;
  }

  const result = await cliSnapshot({ name, command, update: opts.update, cwd: opts.cwd });
  if (result.exitCode !== 0) {
    process.exitCode = 1;
  }
}
