// autoresearch-engine — pure logic module for the Karpathy-style autoresearch loop
// No runtime side effects; all functions are independently testable.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface AutoResearchConfig {
  goal: string;
  metric: string;
  timeBudgetMinutes: number;
  measurementCommand: string;
  cwd: string;
  /**
   * When true, the metric IS the exit code (0 = passing/target, non-zero =
   * failing/baseline) and ANY number the command prints to stdout is IGNORED.
   * Set for pass/fail capability_tests: a test that prints e.g. "42 passing"
   * must NOT have that 42 parsed as a lower-is-better metric and then be driven
   * toward FEWER passing tests (the DanteCode field finding). Genuine numeric
   * metrics (bundle size, lint count) leave this false and parse stdout.
   */
  exitCodeMetric?: boolean;
}

export interface ExperimentResult {
  id: number;
  description: string;
  metricValue: number | null;
  status: 'keep' | 'discard' | 'crash';
  commitHash?: string;
}

export interface AutoResearchReport {
  goal: string;
  metric: string;
  duration: string;
  baseline: number;
  final: number;
  improvement: number;
  improvementPercent: number;
  experiments: ExperimentResult[];
  kept: number;
  discarded: number;
  crashed: number;
  insights: string[];
}

// ── Measurement ───────────────────────────────────────────────────────────────

/**
 * Run the measurement command and parse a numeric result from stdout.
 * Throws if the command fails or produces no parseable number.
 */
export async function runBaseline(config: AutoResearchConfig, execFn?: ExecFileFn): Promise<number> {
  const value = await runMeasurement(config, execFn);
  return value;
}

/**
 * Run a single experiment: execute the measurement command and decide whether
 * to keep the change based on comparison against the best known value.
 */
export async function runExperiment(
  config: AutoResearchConfig,
  experimentId: number,
  description: string,
  execFn?: ExecFileFn,
): Promise<ExperimentResult> {
  let metricValue: number | null = null;
  let status: ExperimentResult['status'] = 'crash';

  try {
    metricValue = await runMeasurement(config, execFn);
    status = 'keep'; // default; caller should override with shouldKeep result
  } catch {
    status = 'crash';
  }

  return {
    id: experimentId,
    description,
    metricValue,
    status,
  };
}

// ── Decision logic ─────────────────────────────────────────────────────────────

/**
 * Returns true only when the improvement exceeds the noise margin.
 * For timing metrics (ms, seconds, latency) the margin is 1%; otherwise 0.5%.
 * A lower metric value is "better" (timing, size, latency).
 *
 * @param current The newly measured value.
 * @param best    The best value recorded so far.
 * @param noiseMargin A fraction, e.g. 0.01 for 1%.
 */
export function shouldKeep(current: number, best: number, noiseMargin: number): boolean {
  if (best === 0) {
    // Avoid division by zero; any decrease is a win.
    return current < best;
  }
  const relativeChange = (best - current) / Math.abs(best);
  return relativeChange > noiseMargin;
}

// ── Formatting ─────────────────────────────────────────────────────────────────

/**
 * Render results.tsv content including a header row.
 */
export function formatResultsTsv(experiments: ExperimentResult[]): string {
  const header = 'experiment\tmetric_value\tstatus\tdescription';
  const rows = experiments.map(e =>
    `${e.id}\t${e.metricValue ?? 'crash'}\t${e.status}\t${e.description}`,
  );
  return [header, ...rows].join('\n');
}

/**
 * Generate the full AUTORESEARCH_REPORT.md markdown string.
 */
export function formatReport(report: AutoResearchReport): string {
  const keepRate =
    report.experiments.length > 0
      ? ((report.kept / report.experiments.length) * 100).toFixed(1)
      : '0.0';

  const improvementSign = report.improvement <= 0 ? '' : '+';
  const totalImprovement = `${improvementSign}${report.improvement.toFixed(4)} (${report.improvementPercent >= 0 ? '+' : ''}${report.improvementPercent.toFixed(2)}%)`;

  const lines: string[] = [
    `## AutoResearch Report: ${report.goal}`,
    '',
    `**Duration**: ${report.duration}`,
    `**Experiments run**: ${report.experiments.length}`,
    `**Kept**: ${report.kept} | **Discarded**: ${report.discarded} | **Crashed**: ${report.crashed}`,
    `**Keep rate**: ${keepRate}%`,
    '',
    '### Metric Progress',
    `- Baseline: ${report.baseline}`,
    `- Final: ${report.final}`,
    `- Total improvement: ${totalImprovement}`,
    '',
    '### Winning Experiments (in order applied)',
  ];

  const winners = report.experiments.filter(e => e.status === 'keep');

  if (winners.length === 0) {
    lines.push('_No experiments were kept._');
  } else {
    lines.push('| # | Description | Commit |');
    lines.push('|---|------------|--------|');
    for (const e of winners) {
      const hash = e.commitHash ?? '_uncommitted_';
      lines.push(`| ${e.id} | ${e.description} | ${hash} |`);
    }
  }

  lines.push('');
  lines.push('### Notable Failures (informative)');

  const failures = report.experiments.filter(e => e.status === 'discard' || e.status === 'crash');

  if (failures.length === 0) {
    lines.push('_No failures recorded._');
  } else {
    lines.push('| # | Description | Why it failed |');
    lines.push('|---|------------|--------------|');
    for (const e of failures) {
      const reason = e.status === 'crash' ? 'Crashed or timed out' : 'Metric did not improve beyond noise margin';
      lines.push(`| ${e.id} | ${e.description} | ${reason} |`);
    }
  }

  lines.push('');
  lines.push('### Key Insights');

  if (report.insights.length === 0) {
    lines.push('_No insights recorded._');
  } else {
    for (const insight of report.insights) {
      lines.push(`- ${insight}`);
    }
  }

  lines.push('');
  lines.push('### Full Results Log');
  lines.push('```');
  lines.push(formatResultsTsv(report.experiments));
  lines.push('```');
  lines.push('');

  return lines.join('\n');
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Injection-seam type for execFile — accepts just what runMeasurement needs. */
export type ExecFileFn = (
  file: string,
  args: string[],
  opts: { cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv | undefined },
) => Promise<{ stdout: string }>;

/**
 * A spawn failure (ENOENT / 127) is a SOLVABLE obstacle, not a dead stop — the DNA's first production
 * caller. Route it through the obstacle registry (spawn-failure solver: shell-route / npx --yes /
 * install-then-retry). A runShell threaded onto execFn captures the recovering run's metric, so a
 * recovered command returns its real exit/stdout. null = genuinely unrecoverable (then the caller throws).
 */
async function recoverSpawnFailure(config: AutoResearchConfig, execFn: ExecFileFn): Promise<{ stdout: string; exitCode: number } | null> {
  const { registerCoreSolvers } = await import('./solvers/register-core.js');
  const { solveObstacle } = await import('./obstacle-registry.js');
  registerCoreSolvers();
  let lastStdout = '';
  let lastCode = 1;
  const runShell = async (command: string, cwd: string): Promise<number> => {
    const [file, args] = process.platform === 'win32'
      ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command]]
      : ['/bin/sh', ['-c', command]];
    try {
      const res = await execFn(file as string, args as string[], { cwd, timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024, env: process.env });
      lastStdout = res.stdout ?? ''; lastCode = 0; return 0;
    } catch (e) {
      const er = e as { code?: number | string; stdout?: string };
      lastStdout = er.stdout ?? '';
      lastCode = typeof er.code === 'number' ? er.code : 1;
      return er.code === 'ENOENT' ? 127 : lastCode;
    }
  };
  const solve = await solveObstacle(
    { kind: 'spawn-failure', signal: 'ENOENT', context: { command: config.measurementCommand, cwd: config.cwd } },
    { runShell },
  );
  return solve.solved ? { stdout: lastStdout, exitCode: lastCode } : null;
}

/**
 * Execute the measurement command and extract a numeric value from stdout.
 * The command is expected to print a number (possibly amid other text); the
 * first floating-point value found in stdout is used as the metric.
 */
export async function runMeasurement(
  config: AutoResearchConfig,
  execFn: ExecFileFn = execFileAsync as unknown as ExecFileFn,
): Promise<number> {
  const MEASUREMENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes hard cap

  // A capability_test / measurement command frequently contains shell plumbing — a pipe, a redirect,
  // `&&`, or `2>&1` (see deriveMeasurementCommand). execFile spawns NO shell, so a token-split runs
  // `npm test 2>&1 | tail -1` as the literal argv [npm, test, 2>&1, |, tail, -1] → the pipe never
  // applies and the spawn fails (exit 127 / garbage). When shell metacharacters are present, route the
  // WHOLE command through the platform shell so the plumbing actually works. The simple case (no
  // operators) keeps the safe token-split (no shell injection surface).
  // On Windows, npx/npm/yarn/pnpm/tsx are `.cmd` wrappers — execFile cannot launch them (ENOENT), so a
  // token-split command starting with one must also route through cmd (which resolves .cmd). Without this
  // the build loop's measurement command `npx tsx --test …` fails baseline ENOENT — the first integration
  // bug the live autopilot key-turn surfaced.
  const firstToken = config.measurementCommand.trim().split(/\s+/)[0] ?? '';
  const winCmdWrapper = process.platform === 'win32' && /^(?:npx|pnpx|npm|yarn|pnpm|tsx)(?:\.cmd)?$/i.test(firstToken);
  let executable: string;
  let args: string[];
  if (NEEDS_SHELL.test(config.measurementCommand) || winCmdWrapper) {
    if (process.platform === 'win32') {
      executable = process.env.ComSpec || 'cmd.exe';
      args = ['/d', '/s', '/c', config.measurementCommand];
    } else {
      executable = '/bin/sh';
      args = ['-c', config.measurementCommand];
    }
  } else {
    const parts = splitCommand(config.measurementCommand);
    [executable, ...args] = parts;
  }

  if (!executable) {
    throw new Error('Empty measurement command');
  }

  // A capability_test is a PASS/FAIL command: it exits 0 when the capability works and non-zero when
  // it doesn't. The sub-7 dims are EXACTLY the ones whose test currently FAILS — that failing exit is
  // the valid BASELINE autoresearch exists to drive to 0, NOT a "broken measurement command." So a
  // non-zero exit must NOT throw (the bug that aborted build-to-7 on every dim that needed work).
  // Only a genuine spawn failure (command not found) or a timeout is fatal.
  let stdout = '';
  let exitCode = 0;
  try {
    const res = await execFn(executable, args, {
      cwd: config.cwd, timeout: MEASUREMENT_TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024, env: process.env,
    });
    stdout = res.stdout ?? '';
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; killed?: boolean; signal?: string };
    // "The command RAN and exited non-zero" is signalled by a numeric exit code or captured stdout.
    const ranButFailed = typeof err.code === 'number' || typeof err.stdout === 'string';
    const isSpawnFailure = err.code === 'ENOENT' || err.code === 127;
    if (isSpawnFailure) {
      // DNA: a spawn failure is a SOLVABLE obstacle, not a dead stop. Route it through the obstacle
      // registry, which auto-solves it (shell-route / npx --yes / install-then-retry) and captures the
      // metric — the loop self-heals the exact class a human had to fix this session. No human.
      const recovered = await recoverSpawnFailure(config, execFn);
      if (!recovered) {
        throw new Error(`Measurement command could not run (${err.code ?? 'error'}) and the obstacle solver could not recover it: ${config.measurementCommand}`);
      }
      stdout = recovered.stdout;
      exitCode = recovered.exitCode;
    } else if (err.killed || err.signal === 'SIGTERM' || !ranButFailed) {
      throw new Error(`Measurement command could not run (${err.killed || err.signal ? 'timed out' : err.code ?? 'error'}): ${config.measurementCommand}`);
    } else {
      // The command RAN and exited non-zero (e.g. a failing test). That's a real, measurable baseline.
      stdout = err.stdout ?? '';
      exitCode = typeof err.code === 'number' ? err.code : 1;
    }
  }

  // Pass/fail capability_test: the metric IS the exit code. Ignore any number the command prints
  // (e.g. a test runner's "42 passing") — parsing it would make autoresearch minimize the wrong
  // quantity (driving toward FEWER passing tests). Lower is better, so it drives the exit code to 0.
  if (config.exitCodeMetric) return exitCode;
  // Otherwise prefer a numeric metric the command printed (e.g. "bundle size 123.4"); fall back to
  // the exit code so a bare pass/fail command is still a measurable metric (0 = passing/target).
  const value = extractNumber(stdout);
  return value !== null ? value : exitCode;
}

/**
 * Shell metacharacters that mean the measurement command can only run through a shell: pipes,
 * redirects, command separators, sub-shells, and the `2>&1` fd-dup. When ANY of these are present,
 * runMeasurement spawns the platform shell instead of token-splitting (which would mangle them).
 */
export const NEEDS_SHELL = /[|&;<>`]|\$\(|\d?>&\d/;

/**
 * Split a shell-style command string into tokens without spawning a shell.
 * Handles quoted strings and basic escaping.
 */
export function splitCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === ' ' && !inSingle && !inDouble) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Extract the first floating-point number found in a string.
 * Returns null if no number is found.
 */
export function extractNumber(text: string): number | null {
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = parseFloat(match[0]!);
  return Number.isFinite(parsed) ? parsed : null;
}
