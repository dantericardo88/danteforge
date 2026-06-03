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
import { loadMatrix, decisionDimScore, type CompeteMatrix, type MatrixDimension } from '../../core/compete-matrix.js';
import { SCORING_DOCTRINE_SHORT } from '../../core/scoring-doctrine.js';
import { runCIPCheck, type CIPOptions, type CIPResult } from '../../core/completion-integrity.js';

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
  _runAutoResearch?: (dimensionId: string, goal: string, cwd: string, timeMinutes: number, measurementCommand?: string) => Promise<void>;
  /** After autoresearch commits, refresh outcome evidence for this dim before re-scoring. */
  _runOutcomesForDim?: (dimensionId: string, cwd: string) => Promise<void>;
  _getScore?: (dimensionId: string, cwd: string) => Promise<number>;
  _runHardenForDim?: (dimensionId: string, cwd: string) => Promise<HardenDimResult>;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _loadState?: ((opts: { cwd?: string }) => Promise<{ wavesSinceLastRegrade?: number }>) | null;
  /** If set, promote this dimension to the front of each work queue (intel-driven targeting). */
  focusDimension?: string;
  /** Skip CIP verification before FRONTIER_REACHED (development escape hatch — never default). */
  skipCIP?: boolean;
  /** Injection seam: override runCIPCheck for tests. */
  _cipCheck?: (dimensionId: string, options: CIPOptions) => Promise<CIPResult>;
  /**
   * Injection seam: override the autonomy-rules check.
   *   undefined → run real checkAutonomyRules (production path)
   *   null      → skip check entirely — returns { kind: 'proceed' } (test isolation)
   *   function  → injected checker returning a custom verdict
   */
  _checkAutonomyRules?: ((cwd?: string) => Promise<{ kind: string; reason?: string }>) | null;
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
  status: 'FRONTIER_REACHED' | 'AT_CEILING' | 'GATE_BLOCKED' | 'MAX_CYCLES' | 'FAILED' | 'CIP_BLOCKED';
  reason: string;
  cipScore?: number;
}

export interface HardenCrusadeResult {
  status: 'ALL_DONE' | 'PARTIAL';
  dimensions: DimHardenCrusadeResult[];
  reportPath?: string;
}

// ── Default subprocess drivers ──────────────────────────────────────────────

async function resolveDanteForgeExec(cwd: string): Promise<{ file: string; argsPrefix: string[] }> {
  const localDistEntry = path.join(cwd, 'dist', 'index.js');
  try {
    await fs.access(localDistEntry);
    return { file: process.execPath, argsPrefix: [localDistEntry] };
  } catch {
    // Fall through to the currently executing CLI entry, then finally PATH.
  }

  const currentEntry = process.argv[1];
  if (currentEntry && currentEntry.endsWith('index.js')) {
    return { file: process.execPath, argsPrefix: [currentEntry] };
  }

  return { file: 'danteforge', argsPrefix: [] };
}

/**
 * Run a child to completion with its stdio INHERITED (streamed straight to the terminal) — NOT
 * buffered. A long autoresearch run (30 min) easily exceeds execFile's default ~1 MB stdout buffer,
 * which destroys the pipe and surfaces as EPIPE / exit 127 mid-build (DanteSecurity DS-024). Inherit
 * has no buffer to overflow. Resolves on exit 0, rejects on non-zero / spawn error / timeout.
 */
async function spawnStreamed(file: string, args: string[], cwd: string, timeoutMs: number): Promise<void> {
  const { spawn } = await import('node:child_process');
  const { trackChild, untrackChild, killTree, SPAWN_DETACHED } = await import('../../core/process-tree.js');
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    // stdin:'ignore' — an unattended autoresearch that hits a prompt gets EOF and fails fast instead
    // of blocking forever (the silent ~15-min hang the fleet hit). stdout/stderr inherit (no buffer).
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, detached: SPAWN_DETACHED });
    trackChild(child.pid);
    const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); untrackChild(child.pid); fn(); } };
    // Tree-kill on timeout — autoresearch spawns its own workers; killing only the direct child orphans them.
    const timer = setTimeout(() => { killTree(child.pid); finish(() => reject(new Error(`timed out after ${Math.round(timeoutMs / 60000)}m`))); }, timeoutMs);
    child.on('error', (e: NodeJS.ErrnoException) => finish(() => reject(e)));
    child.on('close', (code, signal) => finish(() => code === 0 ? resolve() : reject(new Error(`exit ${code ?? signal}`))));
  });
}

async function defaultRunAutoResearch(
  dimensionId: string, goal: string, cwd: string, timeMinutes: number, measurementCommand?: string,
): Promise<void> {
  const cli = await resolveDanteForgeExec(cwd);
  // timeMinutes + 1 min slack on the subprocess timeout (in ms).
  const timeoutMs = (timeMinutes + 1) * 60 * 1000;
  // The dim's capability_test IS the natural metric. Without --measurement-command, autoresearch
  // can't measure an arbitrary dimension id and exits 1 ("needs an explicit measurement command")
  // — the root cause of the build-to-7 crash/hang. Always pass it; the caller guarantees one exists.
  const args = [...cli.argsPrefix, 'autoresearch', goal, '--metric', dimensionId, '--time', `${timeMinutes}m`, '--allow-dirty'];
  if (measurementCommand) args.push('--measurement-command', measurementCommand);
  // Streamed (inherit) — a 30-min autoresearch must not buffer into an EPIPE/127.
  await spawnStreamed(cli.file, args, cwd, timeoutMs);
}

/** Resolve a dim's capability_test shell command (the autoresearch measurement metric), or null. */
function capabilityTestCommand(dim: MatrixDimension): string | null {
  const ct = (dim as unknown as { capability_test?: { command?: string }; no_capability_test?: boolean });
  if (ct.no_capability_test) return null;
  return ct.capability_test?.command ?? null;
}

async function defaultRunOutcomesForDim(dimensionId: string, cwd: string): Promise<void> {
  // After autoresearch commits code, the SHA changes and prior SHA-pinned evidence
  // is stale. Re-run only this dim's outcomes so getScore returns an honest value.
  // Times out in 10 min (most dims have 1–3 outcomes; T1=compile is fastest).
  const cli = await resolveDanteForgeExec(cwd);
  try {
    // Streamed (inherit) — same EPIPE/buffer-overflow guard as autoresearch.
    await spawnStreamed(cli.file, [...cli.argsPrefix, 'outcomes', '--dim', dimensionId, '--force-cold'], cwd, 10 * 60 * 1000);
  } catch (err) {
    logger.warn(`[harden-crusade:${dimensionId}] outcomes refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function defaultGetScore(dimensionId: string, cwd: string): Promise<number> {
  const matrix = await loadMatrix(cwd);
  if (!matrix) return 0;
  const dim = matrix.dimensions.find(d => d.id === dimensionId);
  return dim ? decisionDimScore(dim) : 0; // effective, not raw self (anti-inflation)
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

// ── Depth wave: run outcomes to produce receipts ────────────────────────────

async function runDepthWave(
  dim: MatrixDimension,
  cwd: string,
  target: number,
  cipOpts?: { skipCIP?: boolean; _cipCheck?: (dimensionId: string, opts: CIPOptions) => Promise<CIPResult> },
): Promise<DimHardenCrusadeResult> {
  const initialScore = dim.scores['self'] ?? 0;
  const hasOutcomes = Array.isArray((dim as unknown as Record<string, unknown>)['outcomes']) &&
    ((dim as unknown as Record<string, unknown>)['outcomes'] as unknown[]).length > 0;

  if (!hasOutcomes) {
    logger.info(chalk.dim(`[harden-crusade:${dim.id}] depth wave: no outcomes declared — skipping (add outcomes to unlock 7-9)`));
    return {
      dimensionId: dim.id, label: dim.label, initialScore, finalScore: initialScore,
      cyclesRun: 1, autoresearchRuns: 0,
      hardenPassed: false, finalCap: 7,
      status: 'AT_CEILING',
      reason: 'depth wave: no outcomes declared. Add outcomes to matrix.json to lift ceiling above 7.0.',
    };
  }

  logger.info(`[harden-crusade:${dim.id}] depth wave: running validate to produce receipts`);
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const cli = await resolveDanteForgeExec(cwd);
    await execFileAsync(cli.file, [...cli.argsPrefix, 'validate', dim.id, '--force-cold'], { cwd, timeout: 15 * 60 * 1000 });
  } catch (err) {
    logger.warn(`[harden-crusade:${dim.id}] depth wave validate failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Re-score after validation run (outcomes refresh automatically updates derived score)
  const { loadMatrix: lm } = await import('../../core/compete-matrix.js');
  const matrix = await lm(cwd);
  const updatedDim = matrix?.dimensions.find(d => d.id === dim.id);
  const finalScore = updatedDim?.scores['self'] ?? initialScore;

  logger.info(`[harden-crusade:${dim.id}] depth wave: ${initialScore.toFixed(2)} → ${finalScore.toFixed(2)}`);

  // CIP gate before FRONTIER_REACHED — mirrors runDimensionLoop (Rule 14).
  if (finalScore >= target && !cipOpts?.skipCIP) {
    const cipFn = cipOpts?._cipCheck ?? runCIPCheck;
    try {
      const cip = await cipFn(dim.id, { cwd, target });
      if (cip.blocksFrontierReached) {
        logger.warn(`[harden-crusade:${dim.id}] depth wave: CIP blocked FRONTIER_REACHED — ${cip.gaps.join('; ')}`);
        return {
          dimensionId: dim.id, label: dim.label, initialScore, finalScore,
          cyclesRun: 1, autoresearchRuns: 0,
          hardenPassed: false, finalCap: 10,
          status: 'CIP_BLOCKED',
          reason: `depth wave: score ${finalScore.toFixed(2)} >= target but CIP blocked — ${cip.gaps.join('; ')}`,
        };
      }
    } catch (err) {
      logger.warn(`[harden-crusade:${dim.id}] depth wave: CIP check error — ${String(err)}`);
    }
  }

  return {
    dimensionId: dim.id, label: dim.label, initialScore, finalScore,
    cyclesRun: 1, autoresearchRuns: 0,
    hardenPassed: finalScore >= target,
    finalCap: 10,
    status: finalScore >= target ? 'FRONTIER_REACHED' : 'GATE_BLOCKED',
    reason: `depth wave: validated outcomes, score ${initialScore.toFixed(2)} → ${finalScore.toFixed(2)}`,
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
  const runOutcomesForDim = options._runOutcomesForDim ?? defaultRunOutcomesForDim;
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

    // 1. Autoresearch wave — driven by the dim's capability_test as the measurement metric.
    //    A dim with no capability_test (meta-dims like token_economy) has nothing to measure, so
    //    autoresearch is skipped rather than invoked without a metric (which crashes/hangs the loop).
    const measurementCommand = capabilityTestCommand(dim);
    if (!measurementCommand) {
      logger.info(`[harden-crusade:${dim.id}] Cycle ${cycle}: no capability_test — skipping autoresearch (nothing to measure)`);
    } else {
      try {
        logger.info(`[harden-crusade:${dim.id}] Cycle ${cycle}: autoresearch (${timeMinutes}m, metric=capability_test)`);
        await runAutoResearch(dim.id, dimGoal, cwd, timeMinutes, measurementCommand);
        autoresearchRuns++;
      } catch (err) {
        logger.warn(`[harden-crusade:${dim.id}] Autoresearch cycle ${cycle} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 1b. Refresh outcome evidence — autoresearch may have committed, changing the SHA
    //     and invalidating any prior SHA-keyed evidence. Run outcomes for just this dim.
    await runOutcomesForDim(dim.id, cwd);

    // 2. Re-score
    const newScore = await getScore(dim.id, cwd);
    const delta = newScore - score;
    const prev = score;
    score = newScore;
    logger.info(`[harden-crusade:${dim.id}] Cycle ${cycle}: ${prev.toFixed(2)} → ${score.toFixed(2)} (Δ${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`);

    // 3. Harden gate
    lastHarden = await runHardenForDim(dim.id, cwd);

    // 4. Frontier check: score >= target AND gate allows — then CIP gate (Rule 14)
    if (score >= target && lastHarden.allowed) {
      if (!options.skipCIP) {
        const cipFn = options._cipCheck ?? runCIPCheck;
        const cip = await cipFn(dim.id, { cwd, target });
        if (cip.blocksFrontierReached) {
          logger.warn(`[harden-crusade:${dim.id}] CIP blocked FRONTIER_REACHED — ${cip.gaps.join('; ')}`);
          // Treat as non-plateau so the loop tries another autoresearch cycle
          // to fix the gaps (stubs, missing E2E outcomes, failing capability_test).
          continue;
        }
        return {
          dimensionId: dim.id, label: dim.label, initialScore, finalScore: score,
          cyclesRun: cycle, autoresearchRuns,
          hardenPassed: true, finalCap: 10,
          status: 'FRONTIER_REACHED',
          reason: `score ${score.toFixed(2)} >= ${target}, harden gate clean, CIP verified (cipScore=${cip.cipScore.toFixed(2)})`,
          cipScore: cip.cipScore,
        };
      }
      logger.warn(`[harden-crusade:${dim.id}] --skip-cip active — CIP gate bypassed (dev mode only)`);
      // Audit trail — append bypass record so ops can detect misuse
      fs.mkdir(path.join(cwd, '.danteforge', 'integrity-audit'), { recursive: true })
        .then(() => fs.appendFile(
          path.join(cwd, '.danteforge', 'integrity-audit', 'bypass.log'),
          `${new Date().toISOString()} skip-cip harden-crusade ${dim.id}\n`,
          'utf8',
        )).catch(() => { /* best-effort */ });
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

function pickWeakestDims(
  matrix: CompeteMatrix,
  target: number,
  parallel: number,
  focusDimension?: string,
): MatrixDimension[] {
  const excluded = new Set((matrix as unknown as Record<string, unknown>)['excludedDimensions'] as string[] ?? []);
  const candidates = matrix.dimensions
    .filter(d => {
      if (excluded.has(d.id)) return false;
      const score = decisionDimScore(d); // effective, not raw self (anti-inflation)
      const isClosed = (d as unknown as Record<string, unknown>)['status'] === 'closed';
      // Reopen "closed" dims whose derived score dropped significantly below target.
      // "Closed" was set by the old crusade against inflated writable scores. With
      // outcome-derived scoring, a dim at derived=0 is not at frontier regardless
      // of its historical status. Threshold: if derived < 80% of target, reopen.
      const reopenClosed = isClosed && score < target * 0.8;
      if (isClosed && !reopenClosed) return false;
      // Exclude dims already at (or within a rounding-hair of) target — autoresearching a 6.99→7.0
      // dim wastes a build slot and shows the misleading "Improve … from 7.00 to 7" the fleet flagged.
      if (score >= target - 0.05) return false;
      // Use the numeric d.ceiling field (operator-set cap), not declared_ceiling tier.
      if (d.ceiling !== undefined && score >= d.ceiling) return false;
      return true;
    });
  candidates.sort((a, b) => decisionDimScore(a) - decisionDimScore(b));
  const selected = candidates.slice(0, parallel);

  // Intel-driven targeting: promote focusDimension to the front slot if it's eligible.
  if (focusDimension) {
    const focusIdx = selected.findIndex(d => d.id === focusDimension);
    if (focusIdx > 0) {
      // Already in list but not first — move it to front.
      const [focusDim] = selected.splice(focusIdx, 1);
      selected.unshift(focusDim);
    } else if (focusIdx === -1) {
      // Not in list — check if it's eligible and inject at front, dropping the weakest.
      const focusDim = candidates.find(d => d.id === focusDimension);
      if (focusDim) {
        selected.unshift(focusDim);
        if (selected.length > parallel) selected.pop();
      }
    }
  }

  return selected;
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

  logger.info(`[scoring-doctrine] ${SCORING_DOCTRINE_SHORT}`);

  // Pre-flight: regrade cadence (mirrors /crusade)
  const cadence = await checkRegradeCadence(options);
  if (cadence.blocked) {
    logger.error(`[harden-crusade] BLOCKED: ${cadence.reason}`);
    return { status: 'PARTIAL', dimensions: [] };
  }

  // Pre-flight: autonomy rules (R2 dispensation, etc.) via the shared engine.
  // Best-effort — failure here doesn't block, just logs.
  try {
    const checkFn = options._checkAutonomyRules === null
      ? async () => ({ kind: 'proceed' as const })
      : options._checkAutonomyRules ?? (async (c?: string) => {
          const { checkAutonomyRules } = await import('./crusade.js');
          return checkAutonomyRules(c);
        });
    const verdict = await checkFn(cwd);
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
    // Depth doctrine: use shared wave guard (pass is 1-indexed, guard is 0-indexed).
    const { getWaveGuard } = await import('../../core/wave-alternation.js');
    const waveType = getWaveGuard(pass - 1).type;

    const matrix = await loadMatrixFn(cwd);
    if (!matrix) {
      logger.error('[harden-crusade] No matrix.json found.');
      return { status: 'PARTIAL', dimensions: allResults };
    }

    const todo = pickWeakestDims(matrix, target, parallel, options.focusDimension);
    if (todo.length === 0) {
      logger.success(`[harden-crusade] All dims at target ${target} or at-ceiling. ALL_DONE.`);
      break;
    }

    logger.info('');
    logger.info(
      chalk.bold(`[harden-crusade] Pass ${pass}/${maxPasses} [${waveType.toUpperCase()} WAVE]: pushing ${todo.length} dim(s):`) +
      (waveType === 'depth'
        ? chalk.dim(' — running outcomes to lift score ceiling')
        : chalk.dim(' — autoresearch to forge new capabilities (ceiling 6)')),
    );
    for (const d of todo) {
      logger.info(`  • ${d.id.padEnd(28)} self=${(d.scores['self'] ?? 0).toFixed(2)} target=${target}`);
    }

    if (waveType === 'depth') {
      // Depth wave: run `danteforge validate` for each dim to produce receipts.
      // Dims without outcomes are skipped (not yet ready for depth validation).
      const depthPassResults = await Promise.all(
        todo.map(d => runDepthWave(d, cwd, target, { skipCIP: options.skipCIP, _cipCheck: options._cipCheck }).catch(err => ({
          dimensionId: d.id, label: d.label,
          initialScore: d.scores['self'] ?? 0, finalScore: d.scores['self'] ?? 0,
          cyclesRun: 1, autoresearchRuns: 0,
          hardenPassed: false, finalCap: 0,
          status: 'FAILED' as const,
          reason: `depth wave error: ${err instanceof Error ? err.message : String(err)}`,
        }))),
      );
      allResults.push(...depthPassResults);
    } else {
      // Breadth wave: run autoresearch to forge new capabilities.
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
    }

    // Time Machine: record each wave for audit trail.
    try {
      const { createTimeMachineCommit } = await import('../../core/time-machine.js');
      await createTimeMachineCommit({
        cwd,
        paths: ['.danteforge/outcome-evidence', '.danteforge/harden-report.json'],
        label: `harden-crusade/pass-${pass}/${waveType}`,
      });
    } catch { /* best-effort */ }

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
