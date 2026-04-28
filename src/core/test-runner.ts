// test-runner.ts — Structured test/typecheck execution for LLM repair loops
// Captures full output + extracts failing test names and tsc errors for downstream LLM prompts.
// Distinct from pdse-toolchain.ts which counts integers for scoring; this captures structured
// error detail needed for repair prompts.
import { exec } from 'node:child_process';
import path from 'node:path';
import { ValidationError } from './errors.js';
import { filterShellResult, type FilterShellResultInput, type FilterShellResultOutput } from './context-economy/runtime.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TestRunResult {
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  failingTests: string[];      // extracted failing test names
  typecheckErrors: string[];   // extracted tsc error lines
}

export interface TestRunnerOptions {
  cwd?: string;
  timeout?: number;            // default 120_000
  organ?: string;
  writeContextEconomyLedger?: boolean;
  _exec?: (
    cmd: string,
    opts: { cwd: string; timeout: number },
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  _readFile?: (p: string) => Promise<string>;
  _sanitize?: (cmd: string) => void;
  _filterShellResult?: (input: FilterShellResultInput) => Promise<FilterShellResultOutput>;
}

// ── Shell injection denylist ──────────────────────────────────────────────────

/** Characters that indicate shell injection when present in a test command. */
export const SHELL_METACHARACTERS = /[;|&`$><\n\r]/;

/**
 * Validate that a shell command contains no injection metacharacters.
 * Throws ValidationError if a dangerous pattern is detected.
 * The optional _sanitize seam replaces the entire check (for testing).
 */
export function sanitizeShellCommand(cmd: string, _sanitize?: (cmd: string) => void): void {
  if (_sanitize) { _sanitize(cmd); return; }
  if (SHELL_METACHARACTERS.test(cmd) || cmd.includes('$(')) {
    throw new ValidationError(
      `Shell injection attempt detected in test command: "${cmd.slice(0, 80)}"`,
      'Remove shell metacharacters (;, |, &&, `, $(...), >, <, newlines) from the command',
    );
  }
}

// ── Default exec implementation ───────────────────────────────────────────────

async function defaultExec(
  cmd: string,
  opts: { cwd: string; timeout: number },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = exec(cmd, { cwd: opts.cwd, timeout: opts.timeout }, (error, stdout, stderr) => {
      const exitCode = error?.code !== undefined
        ? (typeof error.code === 'number' ? error.code : 1)
        : 0;
      resolve({ exitCode, stdout: stdout ?? '', stderr: stderr ?? '' });
    });
    void child;
  });
}

// ── Private helpers ───────────────────────────────────────────────────────────

function extractFailingTests(output: string): string[] {
  const patterns = [
    /^not ok \d+ (.+)$/m,            // TAP
    /✗ (.+)$/m,                       // unicode fail
    /× (.+)$/m,                       // unicode X
    /● (.+)$/m,                       // Jest
    /FAIL (.+)$/m,                    // generic FAIL
    /^\s+at .*\((.+\.test\.\w+):/m,  // stack trace file
  ];
  const results = new Set<string>();
  for (const pattern of patterns) {
    const matches = output.matchAll(new RegExp(pattern.source, 'gm'));
    for (const m of matches) {
      if (m[1]) results.add(m[1].trim());
    }
  }
  return [...results].slice(0, 50);
}

function extractTypecheckErrors(output: string): string[] {
  const lines = output.split('\n');
  return lines
    .filter(l => /error TS\d+:/.test(l) || /\.ts\(\d+,\d+\)/.test(l))
    .map(l => l.trim())
    .filter(Boolean)
    .slice(0, 50);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect the test command from package.json scripts.test, falling back to 'npm test'.
 * All errors are silently caught — never throws.
 */
export async function detectTestCommand(
  cwd: string,
  opts?: Pick<TestRunnerOptions, '_readFile'>,
): Promise<string> {
  try {
    const readFile = opts?._readFile ??
      ((p: string) => import('node:fs/promises').then(m => m.readFile(p, 'utf8')));
    const raw = await readFile(path.join(cwd, 'package.json'));
    const pkg = JSON.parse(raw) as { scripts?: { test?: string } };
    return pkg.scripts?.test ?? 'npm test';
  } catch {
    return 'npm test';
  }
}

/**
 * Run the project's test suite and return structured results.
 * Test command is auto-detected from package.json scripts.test.
 */
export async function runProjectTests(opts?: TestRunnerOptions): Promise<TestRunResult> {
  const cwd = opts?.cwd ?? process.cwd();
  const timeout = opts?.timeout ?? 120_000;
  const execFn = opts?._exec ?? defaultExec;

  const testCmd = await detectTestCommand(cwd, { _readFile: opts?._readFile });
  sanitizeShellCommand(testCmd, opts?._sanitize);
  const start = Date.now();
  const { exitCode, stdout, stderr } = await execFn(testCmd, { cwd, timeout });
  const filtered = await (opts?._filterShellResult ?? filterShellResult)({
    command: testCmd,
    stdout,
    stderr,
    cwd,
    organ: opts?.organ ?? 'forge',
    writeLedger: opts?.writeContextEconomyLedger,
  });

  const combined = filtered.stdout + '\n' + filtered.stderr;
  const failingTests = extractFailingTests(combined);

  return {
    passed: exitCode === 0,
    exitCode,
    stdout: filtered.stdout,
    stderr: filtered.stderr,
    durationMs: Date.now() - start,
    failingTests,
    typecheckErrors: [],
  };
}

/**
 * Run `npx tsc --noEmit` and return structured results including extracted error lines.
 */
export async function runTypecheck(opts?: TestRunnerOptions): Promise<TestRunResult> {
  const cwd = opts?.cwd ?? process.cwd();
  const timeout = opts?.timeout ?? 120_000;
  const execFn = opts?._exec ?? defaultExec;
  const command = 'npx tsc --noEmit';

  const start = Date.now();
  const { exitCode, stdout, stderr } = await execFn(command, { cwd, timeout });
  const filtered = await (opts?._filterShellResult ?? filterShellResult)({
    command,
    stdout,
    stderr,
    cwd,
    organ: opts?.organ ?? 'forge',
    writeLedger: opts?.writeContextEconomyLedger,
  });

  const combined = filtered.stdout + '\n' + filtered.stderr;
  const typecheckErrors = extractTypecheckErrors(combined);

  return {
    passed: exitCode === 0,
    exitCode,
    stdout: filtered.stdout,
    stderr: filtered.stderr,
    durationMs: Date.now() - start,
    failingTests: [],
    typecheckErrors,
  };
}

/**
 * Format a TestRunResult into a concise error summary suitable for LLM repair prompts.
 * Strips ANSI codes, truncates to 50 lines, and highlights failing items.
 */
export function formatErrorsForLLM(result: TestRunResult): string {
  // Strip ANSI escape codes — inline, no external package
  const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');

  const combined = stripAnsi(result.stdout + '\n' + result.stderr);
  const lines = combined.split('\n').filter(Boolean).slice(0, 50);

  const errorItems = result.typecheckErrors.length > 0
    ? result.typecheckErrors
    : result.failingTests;

  const parts = ['The following errors occurred:', lines.join('\n')];
  if (errorItems.length > 0) {
    parts.push('\nFailing items:\n' + errorItems.slice(0, 10).join('\n'));
  }
  return parts.join('\n').trim();
}
