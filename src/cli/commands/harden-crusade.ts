// harden-crusade.ts — Crusade variant: autoresearch per-dim + harden-gate verifier.
//
// Why this exists: the regular `/crusade` uses `inferno` as its primary driver
// and falls back to `autoresearch` only when a dim stalls. Inferno depends on
// local Ollama for the OSS-analysis sub-step, which times out frequently. This
// command flips the order — autoresearch is the primary driver from cycle 1,
// and the deterministic 7-check harden gate verifies whether the proposed
// score is honest after every cycle.
//
// Behavior per dim per cycle:
//   1. Run `danteforge autoresearch --metric <dim>` for a time budget
//   2. Re-score the dim
//   3. Run `danteforge harden --dim <dim>` to verify the gate
//   4. If gate passes AND score >= target → FRONTIER_REACHED
//   5. If gate caps below target → AT_CEILING (with reason)
//   6. If progress made → continue
//   7. Else MAX_CYCLES
//
// Honors all existing autonomy rules (R1-R6) via the shared checkAutonomyRules
// helper. Honors the dispensation-TTL fix shipped in f272f46.

import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { loadMatrix, type CompeteMatrix, type MatrixDimension } from '../../core/compete-matrix.js';

const MAX_WAVES_WITHOUT_REGRADE = 3;
const DEFAULT_TARGET = 9.0;
const DEFAULT_PARALLEL = 4;
const DEFAULT_MAX_CYCLES = 6;
const DEFAULT_TIME_MIN = 30;

// ── Types ────────────────────────────────────────────────────────────────────

export interface HardenCrusadeOptions {
  goal: string;
  parallel?: number;          // default 4
  target?: number;            // default 9.0
  maxDimCycles?: number;      // default 6 (autoresearch is slower than inferno)
  timeMinutes?: number;       // autoresearch time budget per cycle (default 30)
  loop?: boolean;             // re-rank + repeat until ALL_DONE (default false)
  cwd?: string;
  skipLLMCheck?: boolean;
  // Injection seams
  _runAutoResearch?: (dimensionId: string, goal: string, cwd: string, timeMinutes: number) => Promise<void>;
  _getScore?: (dimensionId: string, cwd: string) => Promise<number>;
  _runHardenForDim?: (dimensionId: string, cwd: string) => Promise<HardenDimResult>;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _loadState?: ((opts: { cwd?: string }) => Promise<{ wavesSinceLastRegrade?: number }>) | null;
}

export interface HardenDimResult {
  /** True when every applicable check passed. */
  allowed: boolean;
  /** Lowest cap from any failed check (10 when none failed). */
  scoreCap: number;
  /** Names of checks that failed. */
  failedChecks: string[];
}

export interface DimHardenCrusadeResult {
  dimensionId: string;
  label: string;
  initialScore: number;
  finalScore: number;
  cyclesRun: number;
  autoresearchRuns: number;
  hardenPassed: boolean;
  finalCap: number;
  status: 'FRONTIER_REACHED' | 'AT_CEILING' | 'GATE_BLOCKED' | 'MAX_CYCLES' | 'FAILED';
  reason: string;
}

export interface HardenCrusadeResult {
  status: 'ALL_DONE' | 'PARTIAL';
  dimensions: DimHardenCrusadeResult[];
  reportPath?: string;
}

// ── Default subprocess drivers ──────────────────────────────────────────────

async function defaultRunAutoResearch(
  dimensionId: string, goal: string, cwd: string, timeMinutes: number,
): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  // timeMinutes + 1 min slack on the subprocess timeout (in ms).
  const timeoutMs = (timeMinutes + 1) * 60 * 1000;
  await execFileAsync(
    'danteforge',
    ['autoresearch', goal, '--metric', dimensionId, '--time', `${timeMinutes}m`, '--allow-dirty'],
    { cwd, timeout: timeoutMs },
  );
}

async function defaultGetScore(dimensionId: string, cwd: string): Promise<number> {
  const matrix = await loadMatrix(cwd);
  if (!matrix) return 0;
  const dim = matrix.dimensions.find(d => d.id === dimensionId);
  return dim?.scores['self'] ?? 0;
}

async function defaultRunHardenForDim(dimensionId: string, cwd: string): Promise<HardenDimResult> {
  // Use the in-process harden engine directly — avoids spawning a subprocess
  // for every cycle. Matches the proposal-merge gate behavior exactly.
  const { runHardenGate } = await import('../../matrix/engines/hardener.js');
  const matrix = await loadMatrix(cwd);
  if (!matrix) {
    return { allowed: false, scoreCap: 0, failedChecks: ['no-matrix'] };
  }
  const dim = matrix.dimensions.find(d => d.id === dimensionId);
  if (!dim) {
    return { allowed: false, scoreCap: 0, failedChecks: ['unknown-dim'] };
  }
  const verdict = await runHardenGate({ dimensionId, dim, cwd });
  return {
    allowed: verdict.allowed,
    scoreCap: verdict.scoreCap,
    failedChecks: verdict.checks.filter(c => !c.passed && !c.skipped).map(c => c.check),
  };
}

// ── Per-dim loop ────────────────────────────────────────────────────────────

async function runDimensionLoop(
  dim: MatrixDimension,
  options: HardenCrusadeOptions,
): Promise<DimHardenCrusadeResult> {
  const cwd = options.cwd ?? process.cwd();
  const target = options.target ?? DEFAULT_TARGET;
  const maxDimCycles = options.maxDimCycles ?? DEFAULT_MAX_CYCLES;
  const timeMinutes = options.timeMinutes ?? DEFAULT_TIME_MIN;
  const runAutoResearch = options._runAutoResearch ?? defaultRunAutoResearch;
  const getScore = options._getScore ?? defaultGetScore;
  const runHardenForDim = options._runHardenForDim ?? defaultRunHardenForDim;

  const initialScore = dim.scores['self'] ?? 0;
  let score = initialScore;
  let cycle = 0;
  let autoresearchRuns = 0;
  let lastHarden: HardenDimResult = { allowed: true, scoreCap: 10, failedChecks: [] };

  logger.info(`[harden-crusade:${dim.id}] Start ${score.toFixed(2)} → target ${target}`);

  while (cycle < maxDimCycles) {
    cycle++;
    const dimGoal = `Improve "${dim.label}" from ${score.toFixed(2)} to ${target}`;

    // 1. Autoresearch wave
    try {
      logger.info(`[harden-crusade:${dim.id}] Cycle ${cycle}: autoresearch (${timeMinutes}m)`);
      await runAutoResearch(dim.id, dimGoal, cwd, timeMinutes);
      autoresearchRuns++;
    } catch (err) {
      logger.warn(`[harden-crusade:${dim.id}] Autoresearch cycle ${cycle} failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 2. Re-score
    const newScore = await getScore(dim.id, cwd);
    const delta = newScore - score;
    const prev = score;
    score = newScore;
    logger.info(`[harden-crusade:${dim.id}] Cycle ${cycle}: ${prev.toFixed(2)} → ${score.toFixed(2)} (Δ${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`);

    // 3. Harden gate
    lastHarden = await runHardenForDim(dim.id, cwd);

    // 4. Frontier check: score >= target AND gate allows
    if (score >= target && lastHarden.allowed) {
      return {
        dimensionId: dim.id, label: dim.label, initialScore, finalScore: score,
        cyclesRun: cycle, autoresearchRuns,
        hardenPassed: true, finalCap: 10,
        status: 'FRONTIER_REACHED',
        reason: `score ${score.toFixed(2)} >= ${target} and harden gate clean`,
      };
    }

    // 5. Ceiling check: harden capped below target (legitimate ceiling)
    if (!lastHarden.allowed && lastHarden.scoreCap < target) {
      return {
        dimensionId: dim.id, label: dim.label, initialScore, finalScore: Math.min(score, lastHarden.scoreCap),
        cyclesRun: cycle, autoresearchRuns,
        hardenPassed: false, finalCap: lastHarden.scoreCap,
        status: 'AT_CEILING',
        reason: `capped at ${lastHarden.scoreCap.toFixed(1)} by ${lastHarden.failedChecks.join(', ')}`,
      };
    }

    // 6. No progress + autoresearch failed → bail
    if (delta < 0.05 && autoresearchRuns >= 2) {
      return {
        dimensionId: dim.id, label: dim.label, initialScore, finalScore: score,
        cyclesRun: cycle, autoresearchRuns,
        hardenPassed: lastHarden.allowed, finalCap: lastHarden.scoreCap,
        status: 'GATE_BLOCKED',
        reason: `no progress after ${autoresearchRuns} autoresearch runs (Δ < 0.05); score=${score.toFixed(2)}, target=${target}`,
      };
    }
  }

  return {
    dimensionId: dim.id, label: dim.label, initialScore, finalScore: score,
    cyclesRun: cycle, autoresearchRuns,
    hardenPassed: lastHarden.allowed, finalCap: lastHarden.scoreCap,
    status: 'MAX_CYCLES',
    reason: `ran ${maxDimCycles} cycles without reaching target ${target}`,
  };
}

// ── Outer crusade loop ──────────────────────────────────────────────────────

function pickWeakestDims(matrix: CompeteMatrix, target: number, parallel: number): MatrixDimension[] {
  const excluded = new Set((matrix as unknown as Record<string, unknown>)['excludedDimensions'] as string[] ?? []);
  const candidates = matrix.dimensions
    .filter(d =>
      !excluded.has(d.id) &&
      (d as unknown as Record<string, unknown>)['status'] !== 'closed' &&
      (d.scores['self'] ?? 0) < target &&
      // Use the numeric d.ceiling field (operator-set cap), not declared_ceiling tier.
      // declared_ceiling is informational; the harden gate is the true arbiter.
      (d.ceiling === undefined || (d.scores['self'] ?? 0) < d.ceiling),
    );
  candidates.sort((a, b) => (a.scores['self'] ?? 0) - (b.scores['self'] ?? 0));
  return candidates.slice(0, parallel);
}

async function checkRegradeCadence(
  options: HardenCrusadeOptions,
): Promise<{ blocked: boolean; reason?: string }> {
  if (options._loadState === null) return { blocked: false };
  try {
    const loadStateFn = options._loadState
      ?? (async (o: { cwd?: string }) => {
        const { loadState } = await import('../../core/state.js');
        return loadState(o);
      });
    const state = await loadStateFn({ cwd: options.cwd });
    const waves = state.wavesSinceLastRegrade ?? 0;
    if (waves > MAX_WAVES_WITHOUT_REGRADE) {
      return {
        blocked: true,
        reason: `${waves} crusade waves since last regrade (max: ${MAX_WAVES_WITHOUT_REGRADE}). Run: danteforge honest-rescore --regrade`,
      };
    }
  } catch { /* best-effort */ }
  return { blocked: false };
}

export async function runHardenCrusade(options: HardenCrusadeOptions): Promise<HardenCrusadeResult> {
  const cwd = options.cwd ?? process.cwd();
  const parallel = options.parallel ?? DEFAULT_PARALLEL;
  const target = options.target ?? DEFAULT_TARGET;
  const loadMatrixFn = options._loadMatrix ?? loadMatrix;
  const writeFile = options._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));

  // Pre-flight: regrade cadence (mirrors /crusade)
  const cadence = await checkRegradeCadence(options);
  if (cadence.blocked) {
    logger.error(`[harden-crusade] BLOCKED: ${cadence.reason}`);
    return { status: 'PARTIAL', dimensions: [] };
  }

  // Pre-flight: autonomy rules (R2 dispensation, etc.) via the shared engine.
  // Best-effort — failure here doesn't block, just logs.
  try {
    const { checkAutonomyRules } = await import('./crusade.js');
    const verdict = await checkAutonomyRules(cwd);
    if (verdict.kind === 'halt') {
      logger.error(`[harden-crusade] AUTONOMY HALT: ${('reason' in verdict ? verdict.reason : '')}`);
      return { status: 'PARTIAL', dimensions: [] };
    }
  } catch { /* best-effort */ }

  const allResults: DimHardenCrusadeResult[] = [];
  let pass = 0;
  const maxPasses = options.loop ? 10 : 1;

  while (pass < maxPasses) {
    pass++;
    const matrix = await loadMatrixFn(cwd);
    if (!matrix) {
      logger.error('[harden-crusade] No matrix.json found.');
      return { status: 'PARTIAL', dimensions: allResults };
    }

    const todo = pickWeakestDims(matrix, target, parallel);
    if (todo.length === 0) {
      logger.success(`[harden-crusade] All dims at target ${target} or at-ceiling. ALL_DONE.`);
      break;
    }

    logger.info('');
    logger.info(chalk.bold(`[harden-crusade] Pass ${pass}/${maxPasses}: pushing ${todo.length} dim(s):`));
    for (const d of todo) {
      logger.info(`  • ${d.id.padEnd(28)} self=${(d.scores['self'] ?? 0).toFixed(2)} target=${target}`);
    }

    // Run all dims in this pass in parallel
    const passResults = await Promise.all(
      todo.map(d => runDimensionLoop(d, options).catch(err => ({
        dimensionId: d.id, label: d.label,
        initialScore: d.scores['self'] ?? 0, finalScore: d.scores['self'] ?? 0,
        cyclesRun: 0, autoresearchRuns: 0,
        hardenPassed: false, finalCap: 0,
        status: 'FAILED' as const,
        reason: err instanceof Error ? err.message : String(err),
      }))),
    );
    allResults.push(...passResults);

    if (!options.loop) break;
  }

  // Write report
  const report = buildReport(allResults, options.goal, target);
  const reportPath = path.join(cwd, 'HARDEN_CRUSADE_REPORT.md');
  await writeFile(reportPath, report);

  const everyDimSettled = allResults.every(r =>
    r.status === 'FRONTIER_REACHED' || r.status === 'AT_CEILING'
  );
  return {
    status: everyDimSettled ? 'ALL_DONE' : 'PARTIAL',
    dimensions: allResults,
    reportPath,
  };
}

// ── Report rendering ────────────────────────────────────────────────────────

function buildReport(results: DimHardenCrusadeResult[], goal: string, target: number): string {
  const lines: string[] = [
    '# HARDEN_CRUSADE_REPORT.md',
    '',
    `**Goal:** ${goal}`,
    `**Target:** ${target}`,
    `**Timestamp:** ${new Date().toISOString()}`,
    `**Mode:** autoresearch per dim + 7-check harden gate verification`,
    '',
    '## Dimension Results',
    '',
  ];
  for (const r of results) {
    const delta = r.finalScore - r.initialScore;
    lines.push(`### ${r.label} (\`${r.dimensionId}\`)`);
    lines.push(`- Status: **${r.status}**`);
    lines.push(`- Score: ${r.initialScore.toFixed(2)} → ${r.finalScore.toFixed(2)} (Δ${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`);
    lines.push(`- Cycles: ${r.cyclesRun} | Autoresearch runs: ${r.autoresearchRuns}`);
    lines.push(`- Harden: ${r.hardenPassed ? 'allowed' : `capped at ${r.finalCap.toFixed(1)}`}`);
    lines.push(`- Reason: ${r.reason}`);
    lines.push('');
  }
  const reached = results.filter(r => r.status === 'FRONTIER_REACHED').length;
  const atCeiling = results.filter(r => r.status === 'AT_CEILING').length;
  lines.push(`## Summary`);
  lines.push(`- FRONTIER_REACHED: ${reached}`);
  lines.push(`- AT_CEILING: ${atCeiling}`);
  lines.push(`- GATE_BLOCKED / MAX_CYCLES / FAILED: ${results.length - reached - atCeiling}`);
  return lines.join('\n');
}
