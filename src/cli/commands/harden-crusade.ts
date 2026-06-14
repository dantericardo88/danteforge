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
import { nextLevelGoalSuffix } from '../../core/rubric-ladder.js';
import { resolveAutonomousTarget } from '../../core/autonomy-cap.js';
import { runCIPCheck, type CIPOptions, type CIPResult } from '../../core/completion-integrity.js';
import { startWave, finishWave, type WaveReceipt } from '../../core/wave-ledger.js';
import { resolveResumeIndex } from '../../core/wave-replay.js';
import { runGit } from '../../core/git-safe.js';
import {
  resolveDanteForgeExec, defaultRunAutoResearch, mergeBackIsolatedBranch, defaultRunCapTest,
  capabilityTestCommand, defaultRunOutcomesForDim, defaultGetScore, defaultRunHardenForDim,
} from './harden-crusade-runners.js';
// Re-exported so existing importers (tests/laws/laws-l1-isolation.test.ts) keep their path.
export { mergeBackIsolatedBranch };

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
  /**
   * Wall-clock budget for the WHOLE run, in minutes. Captured at run start; before STARTING another
   * per-dim autoresearch cycle, if elapsed + (timeMinutes + 2m of merge-back/refresh slack) would
   * exceed this, the run stops CLEANLY: report written as usual, budgetReached=true, exit 0.
   * Partial progress is success — the orchestrator's next cycle continues from the re-ranked queue.
   * Unset = unguarded (prior behavior).
   */
  maxMinutes?: number;
  loop?: boolean;             // re-rank + repeat until ALL_DONE (default false)
  cwd?: string;
  skipLLMCheck?: boolean;
  /** depth_doctrine auto re-entry (CH-022): resume each dim from the WaveLedger's last successful wave
   *  (run hc-<dim>) instead of restarting at wave 0 — skips already-completed cycles of a crashed run. */
  resume?: boolean;
  // Injection seams
  _runAutoResearch?: (dimensionId: string, goal: string, cwd: string, timeMinutes: number, measurementCommand?: string) => Promise<void>;
  /** After autoresearch commits, refresh outcome evidence for this dim before re-scoring. */
  _runOutcomesForDim?: (dimensionId: string, cwd: string) => Promise<void>;
  _getScore?: (dimensionId: string, cwd: string) => Promise<number>;
  _runHardenForDim?: (dimensionId: string, cwd: string) => Promise<HardenDimResult>;
  /** L8 pre-dispatch probe: exit code of the dim's capability_test (0 = already passing →
   *  builder dispatch is skipped; the exit-code metric would be unimprovable). */
  _runCapTest?: (dim: MatrixDimension, cwd: string) => Promise<number>;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _loadState?: ((opts: { cwd?: string }) => Promise<{ wavesSinceLastRegrade?: number }>) | null;
  /** If set, promote this dimension to the front of each work queue (intel-driven targeting). */
  focusDimension?: string;
  /** Skip CIP verification before FRONTIER_REACHED (development escape hatch — never default). */
  skipCIP?: boolean;
  /** Injection seam: override runCIPCheck for tests. */
  _cipCheck?: (dimensionId: string, options: CIPOptions) => Promise<CIPResult>;
  /** Injection seam: clock in epoch ms for the --max-minutes wall-clock guard (default Date.now). */
  _now?: () => number;
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
  status: 'FRONTIER_REACHED' | 'AT_CEILING' | 'GATE_BLOCKED' | 'MAX_CYCLES' | 'FAILED' | 'CIP_BLOCKED' | 'CHECKPOINT';
  reason: string;
  cipScore?: number;
}

export interface HardenCrusadeResult {
  status: 'ALL_DONE' | 'PARTIAL';
  /** True when the run stopped at the --max-minutes wall-clock checkpoint (clean partial progress → exit 0). */
  budgetReached?: boolean;
  dimensions: DimHardenCrusadeResult[];
  reportPath?: string;
}


// ── Depth wave: run outcomes to produce receipts ────────────────────────────

async function runDepthWave(
  dim: MatrixDimension,
  cwd: string,
  target: number,
  cipOpts?: { skipCIP?: boolean; _cipCheck?: (dimensionId: string, opts: CIPOptions) => Promise<CIPResult> },
): Promise<DimHardenCrusadeResult> {
  // Honest decision score on BOTH ends (fleet run 3b: raw scores.self read 9.00 → 9.00 and minted
  // FRONTIER_REACHED while the decision score was 5.0 — the depth wave must measure what the
  // orchestrator decides with, or the two disagree forever and ascend ceilings the dim).
  const initialScore = decisionDimScore(dim);
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
    // --preserve-sessions, NOT --force-cold: force-cold re-stamps every receipt with this run's
    // single session_id, wiping the ≥2-distinct-session diversity T7 (9.0) requires (df09c52).
    // Legacy ascend's depth wave already made this switch; this callsite had the same bug.
    await execFileAsync(cli.file, [...cli.argsPrefix, 'validate', dim.id, '--preserve-sessions'], { cwd, timeout: 15 * 60 * 1000 });
  } catch (err) {
    logger.warn(`[harden-crusade:${dim.id}] depth wave validate failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Re-score after validation run (outcomes refresh automatically updates derived score)
  const { loadMatrix: lm } = await import('../../core/compete-matrix.js');
  const matrix = await lm(cwd);
  const updatedDim = matrix?.dimensions.find(d => d.id === dim.id);
  const finalScore = updatedDim ? decisionDimScore(updatedDim) : initialScore;

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
      // FAIL CLOSED: an integrity check that ERRORS must not let a dim claim the frontier. The old
      // code logged and fell through to FRONTIER_REACHED — a CIP exception silently bypassed the gate
      // (council/Codex). A check we couldn't run is not a check that passed.
      logger.warn(`[harden-crusade:${dim.id}] depth wave: CIP check errored — failing CLOSED — ${String(err)}`);
      return {
        dimensionId: dim.id, label: dim.label, initialScore, finalScore,
        cyclesRun: 1, autoresearchRuns: 0, hardenPassed: false, finalCap: 10,
        status: 'CIP_BLOCKED',
        reason: `depth wave: score ${finalScore.toFixed(2)} >= target but CIP check errored (failing closed) — ${String(err)}`,
      };
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
  wallClockExhausted?: () => boolean,
): Promise<DimHardenCrusadeResult> {
  const cwd = options.cwd ?? process.cwd();
  const target = resolveAutonomousTarget(options.target, DEFAULT_TARGET);
  const maxDimCycles = options.maxDimCycles ?? DEFAULT_MAX_CYCLES;
  const timeMinutes = options.timeMinutes ?? DEFAULT_TIME_MIN;
  const runAutoResearch = options._runAutoResearch ?? defaultRunAutoResearch;
  const runOutcomesForDim = options._runOutcomesForDim ?? defaultRunOutcomesForDim;
  const getScore = options._getScore ?? defaultGetScore;
  const runHardenForDim = options._runHardenForDim ?? defaultRunHardenForDim;
  const runCapTest = options._runCapTest ?? defaultRunCapTest;

  // Start from the same honest decision score the loop MEASURES with (fleet run 3b: seeding from
  // raw scores.self logged "9.00 → 5.00 (Δ-4.00)" on a dim that never moved — the two reads are
  // different metrics, and a stale-high self would also defeat the Δ<=0 stall/evidence-bound checks).
  const initialScore = await getScore(dim.id, cwd);
  let score = initialScore;
  let cycle = 0;
  // depth_doctrine AUTO RE-ENTRY (CH-022): when resuming, start this dim's cycle counter from the
  // WaveLedger's resume index so we SKIP waves a prior (crashed) run already completed, instead of
  // redoing them from 0. `cycle++` runs before the wave below, so starting at resumeIdx-1 lands the
  // first new wave at resumeIdx — a continuous run id (hc-<dim>), not a restart. Best-effort: no
  // ledger / read error → 0 (cold start), so a fresh run is never wedged.
  if (options.resume) {
    const resumeIdx = await resolveResumeIndex(cwd, `hc-${dim.id}`);
    if (resumeIdx > 0) {
      cycle = resumeIdx - 1;
      logger.info(`[harden-crusade:${dim.id}] RESUME — ${resumeIdx - 1} wave(s) already completed; first new wave is ${resumeIdx} (not a restart).`);
    }
  }
  let autoresearchRuns = 0;
  let lastHarden: HardenDimResult = { allowed: true, scoreCap: 10, failedChecks: [] };

  logger.info(`[harden-crusade:${dim.id}] Start ${score.toFixed(2)} → target ${target}`);

  while (cycle < maxDimCycles) {
    // Wall-clock checkpoint (fleet run 2 dead-loop fix): never START an autoresearch cycle that
    // cannot finish inside the --max-minutes budget. Stopping HERE — between cycles — means every
    // already-merged cycle persists; the old alternative (the orchestrator's tree-kill landing
    // mid-cycle) persisted nothing and restarted the whole queue at dim001 every outer cycle.
    if (wallClockExhausted?.()) {
      return {
        dimensionId: dim.id, label: dim.label, initialScore, finalScore: score,
        cyclesRun: cycle, autoresearchRuns,
        hardenPassed: lastHarden.allowed, finalCap: lastHarden.scoreCap,
        status: 'CHECKPOINT',
        reason: `wall-clock budget reached before cycle ${cycle + 1} — clean checkpoint exit; ${cycle} cycle(s) of progress preserved`,
      };
    }
    cycle++;
    // depth_doctrine WAVE LEDGER: open a durable super-step receipt for this cycle (best-effort — a
    // ledger write must NEVER break the crusade). finishWave below closes it with the outcome. This is
    // what makes harden-crusade emit the SAME receipt schema as every other loop (the rung-8 bar).
    let wave: WaveReceipt | null = null;
    try {
      wave = await startWave(cwd, {
        runId: `hc-${dim.id}`, loopName: 'harden-crusade', waveIndex: cycle, dimensionId: dim.id,
        scoreBefore: score, gitShaBefore: await runGit(['rev-parse', 'HEAD'], cwd).then(s => s.trim() || null).catch(() => null),
      });
    } catch { /* ledger is best-effort */ }
    // Build toward the SPECIFIC, competitor-grounded next level ("to reach a 9: <criteria>"), parsed
    // from this dim's universe Score Ladder — not a vague "improve". Empty if no ladder (no fabrication).
    const rubricSuffix = await nextLevelGoalSuffix(cwd, dim.id, score).catch(() => '');
    const dimGoal = `Improve "${dim.label}" from ${score.toFixed(2)} to ${target}` + rubricSuffix;

    // 1. Autoresearch wave — driven by the dim's capability_test as the measurement metric.
    //    A dim with no capability_test (meta-dims like token_economy) has nothing to measure, so
    //    autoresearch is skipped rather than invoked without a metric (which crashes/hangs the loop).
    const measurementCommand = capabilityTestCommand(dim);
    let evidenceBoundCycle = false;
    let capExit: number | null = null;
    if (!measurementCommand) {
      logger.info(`[harden-crusade:${dim.id}] Cycle ${cycle}: no capability_test — skipping autoresearch (nothing to measure)`);
    } else if ((capExit = await runCapTest(dim, cwd)) === 0) {
      // LAW L8 — EVIDENCE-BOUND ROUTING (live finding, fleet run 3): when the capability test
      // ALREADY PASSES, the exit-code metric is 0 — structurally unimprovable — so dispatching
      // builders guarantees a full budget of discards (11 straight on documentation, live). A
      // passing capability with a sub-target score means the gap is EVIDENCE (missing/stale
      // outcomes), not capability: skip the builder, run the depth pass below, and if the score
      // still holds, stop with the honest evidence-bound verdict instead of grinding.
      logger.info(`[harden-crusade:${dim.id}] Cycle ${cycle}: capability_test ALREADY PASSES — builder dispatch skipped (unimprovable exit-code metric); running the depth pass (outcomes refresh + gate)`);
      evidenceBoundCycle = true;
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
    // Close this cycle's wave receipt with the measured outcome (best-effort). scoreBefore/After here
    // are REAL (the loop measures both in-scope), so harden-crusade emits the strongest receipt — the
    // proof that ≥1 production loop genuinely drives the shared cadence ledger.
    if (wave) {
      try {
        await finishWave(cwd, wave, {
          status: 'completed', scoreAfter: score, capabilityTestExit: capExit,
          gitShaAfter: await runGit(['rev-parse', 'HEAD'], cwd).then(s => s.trim() || null).catch(() => null),
          commandsRun: [evidenceBoundCycle ? 'depth-pass: outcomes-refresh + harden-gate' : `autoresearch --metric ${dim.id}`],
          decision: delta > 0 ? 'continue' : 'stall',
        });
      } catch { /* ledger is best-effort */ }
    }

    // 3. Harden gate
    lastHarden = await runHardenForDim(dim.id, cwd);

    // L8 terminal: the capability passes, the depth pass ran, and the score still holds below
    // target — building cannot move this dim. Stop honestly, naming the real remaining work
    // (outcome authoring: validate/session-record), instead of burning the remaining cycles.
    if (evidenceBoundCycle && score < target && delta <= 0) {
      return {
        dimensionId: dim.id, label: dim.label, initialScore, finalScore: score,
        cyclesRun: cycle, autoresearchRuns,
        hardenPassed: lastHarden.allowed, finalCap: lastHarden.scoreCap,
        status: 'AT_CEILING',
        reason: `evidence-bound: capability_test already passes and the depth pass did not move the score (${score.toFixed(2)} < ${target}) — the gap is missing/stale OUTCOME evidence, not capability. Needs validate/session-record depth work (real receipts), never builder dispatch.`,
      };
    }

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
  const target = resolveAutonomousTarget(options.target, DEFAULT_TARGET);
  const loadMatrixFn = options._loadMatrix ?? loadMatrix;
  const writeFile = options._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));

  // ── Wall-clock budget guard (--max-minutes) ────────────────────────────────
  // Captured ONCE at run start. The closure answers "would another full cycle (timeMinutes + 2m of
  // merge-back/outcome-refresh slack) overrun the budget?" and latches budgetReached when it trips,
  // so the run can exit 0 with its report written — partial progress is success, the orchestrator
  // re-plans from the re-ranked queue. Unset maxMinutes → never trips (prior behavior).
  const now = options._now ?? Date.now;
  const runStartMs = now();
  const cycleMinutes = (options.timeMinutes ?? DEFAULT_TIME_MIN) + 2;
  let budgetReached = false;
  const wallClockExhausted = (): boolean => {
    if (options.maxMinutes === undefined) return false;
    const elapsedMin = (now() - runStartMs) / 60_000;
    if (elapsedMin + cycleMinutes > options.maxMinutes) { budgetReached = true; return true; }
    return false;
  };

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

  // FIX B (fleet run 3b): a dim that stalls with ZERO score movement in BOTH wave types is
  // exhausted for this invocation — nothing changes between passes, so re-selecting it burned
  // 10 identical passes live while the next-weakest dim never got a build slot. Any progress
  // (or a wall-clock CHECKPOINT / transient FAILED) keeps the dim eligible.
  const exhaustedWaves = new Map<string, { breadth: boolean; depth: boolean }>();
  const markStalls = (results: DimHardenCrusadeResult[], wave: 'breadth' | 'depth'): void => {
    for (const r of results) {
      if (r.status === 'CHECKPOINT' || r.status === 'FAILED') continue;
      if (r.finalScore > r.initialScore || r.status === 'FRONTIER_REACHED') {
        exhaustedWaves.delete(r.dimensionId);
        continue;
      }
      const s = exhaustedWaves.get(r.dimensionId) ?? { breadth: false, depth: false };
      s[wave] = true;
      exhaustedWaves.set(r.dimensionId, s);
    }
  };
  const isExhausted = (dimId: string): boolean => {
    const s = exhaustedWaves.get(dimId);
    return Boolean(s?.breadth && s?.depth);
  };

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

    // Selection sees only non-exhausted dims, so when the weakest dim is wave-stalled the
    // NEXT-weakest gets the build slot instead of an identical re-run (FIX B).
    const matrixView = exhaustedWaves.size === 0 ? matrix : {
      ...matrix,
      dimensions: matrix.dimensions.filter(d => !isExhausted(d.id)),
    } as CompeteMatrix;
    const todo = pickWeakestDims(matrixView, target, parallel, options.focusDimension);
    if (todo.length === 0) {
      const skipped = matrix.dimensions.filter(d => isExhausted(d.id)).map(d => d.id);
      if (skipped.length > 0) {
        logger.info(`[harden-crusade] Remaining sub-target dim(s) stalled in BOTH wave types this run (evidence-bound — needs outcome authoring, not more passes): ${skipped.join(', ')}`);
      } else {
        logger.success(`[harden-crusade] All dims at target ${target} or at-ceiling. ALL_DONE.`);
      }
      break;
    }

    // Wall-clock checkpoint between passes (checked AFTER the empty-queue break so a genuinely
    // finished run still reads ALL_DONE): do not start a pass whose first cycle cannot finish.
    // Within a breadth pass, runDimensionLoop re-checks before EVERY cycle.
    if (wallClockExhausted()) break;

    logger.info('');
    logger.info(
      chalk.bold(`[harden-crusade] Pass ${pass}/${maxPasses} [${waveType.toUpperCase()} WAVE]: pushing ${todo.length} dim(s):`) +
      (waveType === 'depth'
        ? chalk.dim(' — running outcomes to lift score ceiling')
        : chalk.dim(' — autoresearch to forge new capabilities (ceiling 6)')),
    );
    for (const d of todo) {
      logger.info(`  • ${d.id.padEnd(28)} score=${decisionDimScore(d).toFixed(2)} target=${target}`);
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
      markStalls(depthPassResults, 'depth');
    } else {
      // Breadth wave: run autoresearch to forge new capabilities.
      const passResults = await Promise.all(
        todo.map(d => runDimensionLoop(d, options, wallClockExhausted).catch(err => ({
          dimensionId: d.id, label: d.label,
          initialScore: d.scores['self'] ?? 0, finalScore: d.scores['self'] ?? 0,
          cyclesRun: 0, autoresearchRuns: 0,
          hardenPassed: false, finalCap: 0,
          status: 'FAILED' as const,
          reason: err instanceof Error ? err.message : String(err),
        }))),
      );
      allResults.push(...passResults);
      markStalls(passResults, 'breadth');
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

  if (budgetReached) {
    const advanced = allResults.filter(r => r.finalScore > r.initialScore).length;
    const elapsedMin = Math.round((now() - runStartMs) / 60_000);
    logger.info(`[harden-crusade] wall-clock budget reached (${elapsedMin}m/${options.maxMinutes}m) — exiting cleanly with ${advanced} dim(s) advanced; the orchestrator's next cycle continues from the re-ranked queue`);
  }

  // Write report
  const report = buildReport(allResults, options.goal, target);
  const reportPath = path.join(cwd, 'HARDEN_CRUSADE_REPORT.md');
  await writeFile(reportPath, report);

  const everyDimSettled = allResults.every(r =>
    r.status === 'FRONTIER_REACHED' || r.status === 'AT_CEILING'
  );
  return {
    // A budget stop can NEVER read ALL_DONE: unattempted work may remain past the checkpoint
    // (the empty-queue break above — the only true ALL_DONE — fires before the budget check).
    status: everyDimSettled && !budgetReached ? 'ALL_DONE' : 'PARTIAL',
    budgetReached,
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
  lines.push(`- GATE_BLOCKED / MAX_CYCLES / FAILED / CHECKPOINT: ${results.length - reached - atCeiling}`);
  return lines.join('\n');
}
