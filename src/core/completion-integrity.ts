// completion-integrity.ts — Callable CIP engine.
// Wraps the 14-point audit protocol into a single runCIPCheck() function
// that command surfaces (harden-crusade, crusade, daemon, autoforge) call
// before declaring FRONTIER_REACHED, ALL_DONE, or target-reached.
// "Code without a receipt is a hypothesis, not a feature." — Scoring Doctrine Rule 7

import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  scanForStubs,
  isInCriticalPath,
  runCapabilityTest,
  computeScoreCap,
  classifyStatus,
} from './integrity-audit.js';
import { classifyOutcomeKind } from '../matrix/engines/outcome-quality.js';

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CIPResult {
  dimensionId: string;
  /** Score derived from the 14-point protocol — may differ from storedScore. */
  cipScore: number;
  /** Raw self-score currently in matrix.json (pre-audit). */
  storedScore: number;
  cipClass: 'verified' | 'partially-verified' | 'structural' | 'claimed' | 'missing';
  /** When true the caller MUST NOT emit FRONTIER_REACHED — work remains. */
  blocksFrontierReached: boolean;
  /** Human-readable list of what's missing or failing. */
  gaps: string[];
  stubsFound: number;
  outcomesRun: number;
  outcomesPassed: number;
  /** null when no capability_test is declared for this dimension. */
  capabilityTestPassed: boolean | null;
}

export interface CIPOptions {
  cwd?: string;
  /** Score threshold for blocksFrontierReached (default 9.0). */
  target?: number;
/** When true, omit the src/ pattern integrity scan (faster, less reliable — dry-run only). */
  skipStubScan?: boolean;
  /** Per-outcome execution timeout in ms (default 30_000). */
  timeout?: number;
}

type DeclaredOutcome = {
  id?: string;
  command?: string;
  cli_args?: string[];
  expected_exit?: number;
  expected_stdout_patterns?: string[];
  timeout_ms?: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// On Windows, cmd.exe wraps the /c argument in extra quotes when Node.js spawns
// it, corrupting nested double-quotes in `node -e "..."` commands. Parse those
// and run node directly (no shell) to avoid the quoting issue.
function parseNodeECommand(cmd: string): [string, string[]] | null {
  const m = cmd.match(/^node\s+-e\s+"([\s\S]+)"$/);
  if (m) return ['node', ['-e', m[1]!]];
  return null;
}

async function runDeclaredOutcomes(
  outcomes: DeclaredOutcome[],
  cwd: string,
  timeoutMs: number,
): Promise<{ total: number; passing: number }> {
  if (!outcomes || outcomes.length === 0) return { total: 0, passing: 0 };
  let passing = 0;
  for (const outcome of outcomes) {
    try {
      if (outcome.command) {
        const t = outcome.timeout_ms ?? timeoutMs;
        const direct = parseNodeECommand(outcome.command);
        if (direct) {
          const [exe, args] = direct;
          await execFileAsync(exe, args, { cwd, timeout: t });
        } else {
          const shell = process.platform === 'win32' ? 'cmd' : 'sh';
          const shellArgs = process.platform === 'win32'
            ? ['/c', outcome.command]
            : ['-c', outcome.command];
          await execFileAsync(shell, shellArgs, { cwd, timeout: t });
        }
        passing++;
      } else if (outcome.cli_args && outcome.cli_args.length > 0) {
        const expectedExit = outcome.expected_exit ?? 0;
        let stdout = '';
        let exitCode = 0;
        try {
          const result = await execFileAsync(
            'node', ['dist/index.js', ...outcome.cli_args],
            { cwd, timeout: outcome.timeout_ms ?? timeoutMs },
          );
          stdout = result.stdout;
        } catch (err: unknown) {
          const e = err as { code?: number; stdout?: string };
          exitCode = e.code ?? 1;
          stdout = e.stdout ?? '';
        }
        if (exitCode !== expectedExit) continue;
        if ((outcome.expected_stdout_patterns ?? []).some(p => !stdout.includes(p))) continue;
        passing++;
      }
      // outcomes with neither command nor cli_args count as failing
    } catch {
      // outcome threw — counts as failing
    }
  }
  return { total: outcomes.length, passing };
}

async function hasSrcImplementation(dimId: string, cwd: string): Promise<boolean> {
  const srcDir = path.join(cwd, 'src');
  const words = dimId.split('_').filter(w => w.length >= 4);
  for (const word of words) {
    try {
      const { stdout } = await execFileAsync(
        'grep', ['-rl', '--include=*.ts', word, srcDir],
        { cwd, timeout: 5000 },
      ).catch(() => ({ stdout: '' }));
      if (stdout.trim()) return true;
    } catch {
      return true; // grep failed — assume exists to avoid false floors
    }
  }
  return false;
}

function makeMissingResult(dimensionId: string, storedScore: number, gaps: string[]): CIPResult {
  return {
    dimensionId,
    cipScore: 0,
    storedScore,
    cipClass: 'missing',
    blocksFrontierReached: true,
    gaps,
    stubsFound: 0,
    outcomesRun: 0,
    outcomesPassed: 0,
    capabilityTestPassed: null,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Run the 14-point Completion Integrity Protocol for a single dimension.
 *
 * Returns a CIPResult with blocksFrontierReached=true if the dimension does NOT
 * yet have sufficient end-to-end evidence to claim FRONTIER_REACHED. Callers
 * (harden-crusade, crusade, daemon) must check this before emitting terminal
 * status — Scoring Doctrine Rule 14.
 */
export async function runCIPCheck(
  dimensionId: string,
  options: CIPOptions = {},
): Promise<CIPResult> {
  const cwd = options.cwd ?? process.cwd();
  const target = options.target ?? 9.0;
  const timeoutMs = options.timeout ?? 30_000;

  // Load raw matrix.json — do NOT use loadMatrix() which applies derived scores.
  // The audit must start from raw stored scores to detect self-reported inflation.
  const matrixPath = path.join(cwd, '.danteforge', 'compete', 'matrix.json');
  type RawMatrix = { dimensions: Array<Record<string, unknown>> };
  let rawMatrix: RawMatrix | null = null;
  try {
    const raw = await fs.readFile(matrixPath, 'utf8');
    rawMatrix = JSON.parse(raw) as RawMatrix;
  } catch {
    return makeMissingResult(dimensionId, 0, ['matrix.json not found — run `danteforge compete` first']);
  }
  if (!rawMatrix) {
    return makeMissingResult(dimensionId, 0, ['matrix.json is empty or malformed']);
  }

  const dimRaw = rawMatrix.dimensions.find(d => d['id'] === dimensionId);
  if (!dimRaw) {
    return makeMissingResult(dimensionId, 0, [`Dimension "${dimensionId}" not found in matrix`]);
  }

  // Cast to the shape integrity-audit expects
  type AuditDim = Parameters<typeof runCapabilityTest>[0];
  const dim = dimRaw as unknown as AuditDim;
  const storedScore = (dimRaw['scores'] as Record<string, number> | undefined)?.['self'] ?? 0;

  // Step 1: capability_test (Fix A gate — Scoring Doctrine Rule 10)
  const capTestResult = await runCapabilityTest(dim, cwd);

  // Step 2: Re-execute declared outcomes directly — never trust stored evidence (Rule 9)
  const rawOutcomes = dimRaw['outcomes'] as DeclaredOutcome[] | undefined;
  const { total: outcomesRun, passing: outcomesPassed } = await runDeclaredOutcomes(
    rawOutcomes ?? [], cwd, timeoutMs,
  );

  // Step 3: Stubs in critical path (Rule 7 — receipts required)
  let stubsInCriticalPath = 0;
  const gaps: string[] = [];
  if (!options.skipStubScan) {
    const allStubs = await scanForStubs(cwd);
    const criticalStubs = allStubs.filter(s => isInCriticalPath(s.file, dim));
    stubsInCriticalPath = criticalStubs.length;
    if (stubsInCriticalPath > 0) {
      const examples = criticalStubs.slice(0, 3).map(s => `${s.file}:${s.line}`).join(', ');
      gaps.push(`${stubsInCriticalPath} mock/placeholder/TODO marker(s) in critical path (${examples})`);
    }
  }

  // Step 4: Implementation existence check
  const hasImpl = await hasSrcImplementation(dimensionId, cwd);

  // Step 5: Score cap from pass/fail rubric (Rule 8 — runtime verification above 7.0)
  const capResult = computeScoreCap({
    capabilityTestResult: capTestResult,
    outcomeCount: outcomesRun,
    passingOutcomes: outcomesPassed,
    criticalPathStubCount: stubsInCriticalPath,
    anyStubInPath: stubsInCriticalPath > 0,
    hasSrcImplementation: hasImpl,
  });

  // Step 6: Quality ceiling — weakest outcome kind limits the max achievable score.
  // File-existence→7.0, unit-tests→8.0, cli-smoke→8.5, E2E→9.0, benchmark→9.5.
  const outcomesToClassify = (rawOutcomes ?? []) as Parameters<typeof classifyOutcomeKind>[0][];
  const qualityCeiling = outcomesToClassify.length > 0
    ? Math.min(...outcomesToClassify.map(o => classifyOutcomeKind(o).maxScore))
    : 9.0;

  const cipScore = Math.min(capResult.cap, qualityCeiling, 9.5);
  const cipClass = classifyStatus(capResult);
  const capabilityTestPassed = capTestResult ? capTestResult.passed : null;

  // Populate gaps list
  if (!hasImpl) gaps.push('No implementation found in src/');
  if (capabilityTestPassed === false) {
    gaps.push(`capability_test failed (exit ${capTestResult?.exitCode ?? '?'}): ${capTestResult?.command ?? ''}`);
  }
  if (outcomesRun === 0) {
    gaps.push('No outcomes declared — zero-evidence fallback (Scoring Doctrine Rule 9)');
  } else if (outcomesPassed === 0) {
    gaps.push(`0/${outcomesRun} declared outcomes passing`);
  } else if (outcomesPassed < outcomesRun) {
    gaps.push(`Only ${outcomesPassed}/${outcomesRun} outcomes passing`);
  }
  if (cipScore < storedScore - 0.5) {
    gaps.push(`CIP score ${cipScore.toFixed(2)} is ≥0.5 below stored score ${storedScore.toFixed(2)}`);
  }

  // Rule 14: CIP blocks FRONTIER_REACHED when ANY of these fire
  const blocksFrontierReached =
    cipClass === 'claimed' ||
    cipClass === 'missing' ||
    cipScore < target - 0.5 ||
    stubsInCriticalPath > 0 ||
    capabilityTestPassed === false ||
    outcomesRun === 0;

  return {
    dimensionId,
    cipScore,
    storedScore,
    cipClass,
    blocksFrontierReached,
    gaps,
    stubsFound: stubsInCriticalPath,
    outcomesRun,
    outcomesPassed,
    capabilityTestPassed,
  };
}
