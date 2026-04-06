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
 * Execute the measurement command and extract a numeric value from stdout.
 * The command is expected to print a number (possibly amid other text); the
 * first floating-point value found in stdout is used as the metric.
 */
export async function runMeasurement(
  config: AutoResearchConfig,
  execFn: ExecFileFn = execFileAsync as unknown as ExecFileFn,
): Promise<number> {
  const MEASUREMENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes hard cap

  // Split command into executable + args to avoid shell injection.
  const parts = splitCommand(config.measurementCommand);
  const [executable, ...args] = parts;

  if (!executable) {
    throw new Error('Empty measurement command');
  }

  const { stdout } = await execFn(executable, args, {
    cwd: config.cwd,
    timeout: MEASUREMENT_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env,
  });

  const value = extractNumber(stdout);
  if (value === null) {
    throw new Error(
      `Measurement command produced no parseable number. stdout: ${stdout.slice(0, 300)}`,
    );
  }

  return value;
}

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
