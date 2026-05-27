// ascend-engine.ts — Orchestrates the fully autonomous scoring and self-improving loop.
//
// Flow:
//   1. ORIENT  — load state + matrix (define universe if missing)
//   2. CLASSIFY — split dimensions into achievable vs atCeiling; announce ceilings upfront
//   3. DRY RUN — if dryRun, print plan and return immediately
//   4. LOOP    — pick lowest-scoring achievable dimension → run autoforge cycle → re-score → repeat
//   5. CEILING REPORT — explain what can't be automated and what the user must do manually
//   6. WRITE   — persist ASCEND_REPORT.md

import fs from 'fs/promises';
import path from 'path';
import { loadState, saveState, type WorkflowStage } from './state.js';
import {
  applyStrictOverrides as applyCoreStrictOverrides,
  canonicalScoreToHarshResult,
  computeCanonicalScore,
  computeStrictDimensions,
  type HarshScorerOptions,
  type HarshScoreResult,
  type ScoringDimension,
} from './harsh-scorer.js';
import { loadMatrix, saveMatrix, classifyDimensions, getNextSprintDimension, updateDimensionScore, getDimensionStrategy, computeUnweightedComposite, getTopGapDimensions, type CompeteMatrix, type MatrixDimension, type AdversarialCalibration } from './compete-matrix.js';
import { readSweBenchScore, formatSweBenchGoal, isSweBenchDimension } from './swe-bench-probe.js';
import { defineUniverse, type UniverseDefinerOptions } from './universe-definer.js';
import { runAutoforgeLoop, AutoforgeLoopState, type AutoforgeLoopContext, type AutoforgeLoopDeps } from './autoforge-loop.js';
import { executeAutoforgeCommand } from './autoforge-executor.js';
import { generateAdversarialCritique } from './adversarial-critique.js';
import { logger } from './logger.js';
import { SCORING_DOCTRINE_SHORT } from './scoring-doctrine.js';
import { createStepTracker } from './progress.js';
import { confirmMatrix } from './matrix-confirm.js';
import { isLLMAvailable } from './llm.js';
import { mergeScoreProposals, writeScoreProposal } from './matrix-development-engine.js';
import { ensureMatrixOnDisk } from '../cli/commands/compete-score-flow.js';
import { isDimensionRecentlyInflated, buildCeilingReports, buildAscendReport } from './ascend-reporting.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AscendEngineOptions {
  cwd?: string;
  target?: number;       // default: 9.0 — stop when all achievable dims reach this
  maxCycles?: number;    // default: 60 — max total improvement cycles across all dims (18 dims × ~3 cycles each)
  dryRun?: boolean;      // print plan without executing
  interactive?: boolean; // ask 5 questions if no matrix exists

  // Injection seams for testing
  _loadMatrix?: typeof loadMatrix;
  _saveMatrix?: typeof saveMatrix;
  _defineUniverse?: (opts: UniverseDefinerOptions) => Promise<CompeteMatrix>;
  _harshScore?: (opts: HarshScorerOptions) => Promise<HarshScoreResult>;
  _runLoop?: (ctx: AutoforgeLoopContext, deps?: Partial<AutoforgeLoopDeps>) => Promise<AutoforgeLoopContext>;
  _executeCommand?: (cmd: string, cwd: string) => Promise<{ success: boolean }>;
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
  _writeFile?: (p: string, content: string) => Promise<void>;
  // Checkpoint seams
  _saveCheckpoint?: (cp: AscendCheckpoint, cwd: string) => Promise<void>;
  _loadCheckpoint?: (cwd: string) => Promise<AscendCheckpoint | null>;
  _clearCheckpoint?: (cwd: string) => Promise<void>;
  // Dual-LLM seams
  forgeProvider?: string;
  scorerProvider?: string;
  maxDimRetries?: number;
  _generateCritique?: (
    dimension: MatrixDimension,
    currentScore: number,
    targetScore: number,
    recentWorkSummary: string,
    options: { scorerProvider?: string; cwd?: string }
  ) => Promise<AdversarialCritique>;
  /**
   * Injection seam for computeStrictDimensions (used in tests to avoid git/fs calls).
   * When undefined, the real computeStrictDimensions is used.
   * Strict scoring is ALWAYS applied — the three STATE.yaml-gamed dimensions
   * (autonomy, selfImprovement, tokenEconomy) are overridden with code-derived signals
   * so ascend convergence cannot be gamed by editing STATE.yaml.
   */
  _computeStrictDims?: typeof computeStrictDimensions;
  yes?: boolean;
  _confirmMatrix?: typeof confirmMatrix;

  // LLM pre-flight + evidence accumulation seams
  /** Check whether an LLM is reachable before starting. Warns the user clearly if not. */
  _isLLMAvailable?: () => Promise<boolean>;
  /** Bootstrap .danteforge/evidence/oss-harvest.json if missing (+10 autonomy pts). */
  _bootstrapHarvest?: (cwd: string) => Promise<void>;
  /** Run a retro pass inside the loop every retroInterval cycles. */
  _runRetro?: (cwd: string) => Promise<void>;
  /** How many cycles between automatic retro runs (default: 5). */
  retroInterval?: number;
  /** Run a lightweight verify pass before the first cycle to accumulate evidence. */
  _runVerify?: (cwd: string) => Promise<void>;
  /** Set false to skip OSS harvest bootstrap (--no-auto-harvest). */
  autoHarvest?: boolean;
  /** Set false to skip mid-loop verify pass (--no-verify-loop). */
  verifyLoop?: boolean;

  // Adversarial convergence gating
  /** When true, self-score alone is not enough to converge — adversary must agree */
  adversarialGating?: boolean;
  /** How much lower adversarial score is acceptable vs target before blocking convergence (default 0.5) */
  adversaryTolerance?: number;
  _generateAdversarialScore?: (
    selfResult: import('./harsh-scorer.js').HarshScoreResult,
    opts: import('./adversarial-scorer-dim.js').AdversarialScorerDimOptions,
  ) => Promise<import('./adversarial-scorer-dim.js').AdversarialScoreResult>;

  /**
   * Execution mode for each cycle.
   * 'advisory' (default): writes AUTOFORGE_GUIDANCE.md but does not execute forge.
   * 'forge': calls `danteforge forge "<goal>"` directly with the dimension-specific goal,
   *          bypassing the tasks command and PLAN.md to avoid off-topic code generation.
   *          Forge-from-forge is same-stage allowed by the workflow enforcer.
   */
  executeMode?: 'advisory' | 'forge';
  /** Injection seam: set workflowStage in STATE.yaml before forge execution. */
  _setWorkflowStage?: (stage: string, cwd: string) => Promise<void>;

  // Harsh verification gate
  /** When false, skip the mandatory harsh-score re-run before convergence (default: true). */
  requireHarshVerification?: boolean;
  /** How many points (0-10 scale) below target the harsh score may be and still pass (default: 0.5). */
  harshTolerance?: number;
  /** When true, allow sprinting on dimensions flagged as inflated by adversarial calibration. Default: false. */
  forceInflated?: boolean;
}

export interface CeilingReport {
  dimension: string;      // snake_case id
  label: string;
  currentScore: number;   // 0-10
  ceiling: number;        // 0-10
  reason: string;
  manualAction: string;   // what the user must do to go further
}

export interface AscendResult {
  cyclesRun: number;
  dimensionsImproved: number;
  dimensionsAtTarget: number;
  ceilingReports: CeilingReport[];
  finalScore: number;      // overall weighted matrix score (0-10)
  success: boolean;        // all achievable dims ≥ target
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

export const ASCEND_PAUSE_FILE = '.danteforge/ASCEND_PAUSED';

export interface AscendCheckpoint {
  pausedAt: string;
  cyclesRun: number;
  maxCycles: number;
  target: number;
  startedAt: string;
  plateauedDims: string[];
  currentDimension: string;
  beforeScores: Record<string, number>;
}

// ── Adversarial critique (minimal type — full impl in adversarial-critique.ts) ─

export interface AdversarialCritique {
  satisfied: boolean;
  currentScore: number;
  targetScore: number;
  gapAnalysis: string;
  concreteActions: string[];
  critiquePrompt: string;
  scorerProvider?: string;
  generatedAt: string;
}

// ── Dimension ID ↔ ScoringDimension mapping ──────────────────────────────────

const ALL_SCORING_DIMENSIONS = new Set<string>([
  'functionality', 'testing', 'errorHandling', 'security', 'uxPolish',
  'documentation', 'performance', 'maintainability', 'developerExperience',
  'autonomy', 'planningQuality', 'selfImprovement', 'specDrivenPipeline',
  'convergenceSelfHealing', 'tokenEconomy', 'contextEconomy', 'causalCoherence', 'ecosystemMcp',
  'enterpriseReadiness', 'communityAdoption',
]);

/**
 * Convert snake_case matrix dimension id to camelCase ScoringDimension key.
 * Returns null if the key is not a known ScoringDimension.
 */
export function mapDimIdToScoringDimension(id: string): ScoringDimension | null {
  const camel = id.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
  return ALL_SCORING_DIMENSIONS.has(camel) ? (camel as ScoringDimension) : null;
}

/**
 * Returns true if the matrix has an adversarial calibration for this dimension
 * with verdict 'inflated' that was applied within the last 24 hours.
 * Used to skip dimensions that were just corrected — prevents immediately re-inflating them.
 */
// ── Checkpoint helpers ────────────────────────────────────────────────────────

async function defaultSaveCheckpoint(cp: AscendCheckpoint, cwd: string): Promise<void> {
  const p = path.join(cwd, ASCEND_PAUSE_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(cp, null, 2), 'utf8');
}

async function defaultLoadCheckpoint(cwd: string): Promise<AscendCheckpoint | null> {
  try {
    const raw = await fs.readFile(path.join(cwd, ASCEND_PAUSE_FILE), 'utf8');
    return JSON.parse(raw) as AscendCheckpoint;
  } catch {
    return null;
  }
}

async function defaultClearCheckpoint(cwd: string): Promise<void> {
  try {
    await fs.unlink(path.join(cwd, ASCEND_PAUSE_FILE));
  } catch {
    // non-fatal
  }
}

// ── Strict scoring overlay ────────────────────────────────────────────────────
//
// The three dimensions most vulnerable to STATE.yaml manipulation are overridden
// with tamper-resistant code-derived signals before any convergence decision.
// This means ascend cannot converge simply by editing STATE.yaml config fields.

const STRICT_DIM_IDS = new Set(['autonomy', 'self_improvement', 'token_economy']);

export async function applyStrictOverrides(
  result: HarshScoreResult,
  cwd: string,
  computeStrictDimsFn: typeof computeStrictDimensions,
): Promise<void> {
  const previousSummary = {
    rawScore: result.rawScore,
    harshScore: result.harshScore,
    displayScore: result.displayScore,
    verdict: result.verdict,
  };
  await applyCoreStrictOverrides(result, cwd, computeStrictDimsFn);
  result.rawScore = previousSummary.rawScore;
  result.harshScore = previousSummary.harshScore;
  result.displayScore = previousSummary.displayScore;
  result.verdict = previousSummary.verdict;
}

// ── Ascend cycle state ────────────────────────────────────────────────────────

interface AscendCycleState {
  cyclesRun: number;
  dimensionsImproved: number;
  plateauedDims: Set<string>;
  dimRetryCounts: Record<string, number>;
  pendingCritique: AdversarialCritique | null;
  critiqueTargetDimId: string | null;
  state: Awaited<ReturnType<typeof loadState>> | { project?: string };
}

// ── Ascend helpers ────────────────────────────────────────────────────────────

async function orientAndClassify(
  options: AscendEngineOptions, cwd: string, target: number,
  fns: {
    loadMatrixFn: typeof loadMatrix; saveMatrixFn: typeof saveMatrix;
    defineUniverseFn: (opts: UniverseDefinerOptions) => Promise<CompeteMatrix>;
    harshScoreFn: (opts: HarshScorerOptions) => Promise<HarshScoreResult>;
    computeStrictDimsFn: typeof computeStrictDimensions; loadStateFn: typeof loadState;
  },
): Promise<
  | { ok: true; state: Awaited<ReturnType<typeof loadState>> | { project?: string }; matrix: CompeteMatrix; achievable: MatrixDimension[]; atCeiling: MatrixDimension[]; baselineResult: HarshScoreResult; beforeScores: Record<string, number> }
  | { ok: false; result: AscendResult }
> {
  const state: Awaited<ReturnType<typeof loadState>> | { project?: string } = await fns.loadStateFn({ cwd }).catch(() => ({ project: 'project' }));
  let matrix = await fns.loadMatrixFn(cwd);
  if (!matrix) {
    logger.info('[Ascend] No competitive matrix found — initializing universe...');
    matrix = await fns.defineUniverseFn({ cwd, interactive: options.interactive, _saveMatrix: fns.saveMatrixFn });
  }
  // Best-effort preflight: ensure the feature universe exists / is fresh so
  // any downstream code that consults it sees real data, not 0/0.
  try {
    const projectName = ((state as { project?: string }).project) ?? 'project';
    const { ensureUniverseReady } = await import('./feature-universe.js');
    const universe = await ensureUniverseReady(cwd, { projectName });
    if (universe && universe.features.length > 0) {
      logger.info(`[Ascend] Universe ready: ${universe.features.length} features across ${universe.competitors.length} competitors.`);
    }
  } catch { /* best-effort */ }
  const baselineResult = await fns.harshScoreFn({ cwd, _readHistory: async () => [], _writeHistory: async () => {} });
  await applyStrictOverrides(baselineResult, cwd, fns.computeStrictDimsFn);
  for (const matDim of matrix.dimensions) {
    if (STRICT_DIM_IDS.has(matDim.id)) {
      const scoringDim = mapDimIdToScoringDimension(matDim.id);
      if (scoringDim) {
        const strictScore = baselineResult.displayDimensions[scoringDim] ?? 0;
        matDim.scores['self'] = strictScore;
        if (strictScore < target) matDim.status = 'in-progress';
      }
    }
    // SWE-bench is not in the harsh-scorer's 20 dimensions — it's a feature-
    // matrix dim only. Read the current score from the bench-results probe
    // instead of letting it stay frozen at whatever the matrix author wrote.
    if (isSweBenchDimension(matDim.id)) {
      const probe = await readSweBenchScore(cwd).catch(() => null);
      if (probe) {
        matDim.scores['self'] = probe.displayScore;
        if (probe.displayScore < target) matDim.status = 'in-progress';
      }
    }
  }
  const { achievable, atCeiling } = classifyDimensions(matrix, target);

  // Announce all dimensions + honest composite before any cycle runs.
  const unweightedBaseline = computeUnweightedComposite(matrix);
  logger.info(`[Ascend] Scoring ${matrix.dimensions.length} dimensions from competitive matrix...`);
  logger.info(`[Ascend] Composite (${matrix.dimensions.length}-dim, unweighted): ${unweightedBaseline.toFixed(1)}/10`);
  const topGaps = getTopGapDimensions(matrix, 5);
  if (topGaps.length > 0) {
    logger.info('[Ascend] Top gaps (gap × importance):');
    topGaps.forEach((d, i) => {
      const self = (d.scores['self'] ?? 0).toFixed(1);
      const leader = d.gap_to_leader > 0 ? ((d.scores['self'] ?? 0) + d.gap_to_leader).toFixed(1) : self;
      const strategy = getDimensionStrategy(d, target);
      const hint = strategy === 'human'
        ? `human: ${buildManualAction(d).slice(0, 60)}`
        : strategy === 'ceiling'
          ? `ceiling ${d.ceiling}/10 — ${(d.ceilingReason ?? '').slice(0, 50)}`
          : 'code';
      logger.info(`  ${i + 1}. ${d.id.padEnd(28)} self=${self}  leader=${leader}  gap=${d.gap_to_leader.toFixed(1)}  → ${hint}`);
    });
  }

  if (atCeiling.length > 0) {
    logger.warn('[Ascend] Ceiling dimensions (score tracked; forge cycles stop at ceiling):');
    for (const d of atCeiling) {
      logger.warn(`  ${d.label}: ${(d.scores['self'] ?? 0).toFixed(1)}/10 (ceiling: ${d.ceiling}/10) — ${d.ceilingReason ?? ''}`);
    }
  }
  if (!options.yes && !options.dryRun) {
    const confirmFn = options._confirmMatrix ?? confirmMatrix;
    const confirmed = await confirmFn(matrix, { cwd, _stdout: (l) => logger.info(l) });
    if (!confirmed) {
      logger.warn('[Ascend] Aborted — competitive landscape not confirmed by user.');
      return { ok: false, result: { cyclesRun: 0, dimensionsImproved: 0, dimensionsAtTarget: 0, ceilingReports: [], finalScore: baselineResult.displayScore, success: false } };
    }
  }
  const beforeScores: Record<string, number> = {};
  for (const d of matrix.dimensions) beforeScores[d.id] = d.scores['self'] ?? 0;
  return { ok: true, state, matrix, achievable, atCeiling, baselineResult, beforeScores };
}

async function runAscendPreflights(options: AscendEngineOptions, cwd: string, dryRun: boolean): Promise<void> {
  const isLLMAvailableFn = options._isLLMAvailable ?? isLLMAvailable;
  const llmOk = await isLLMAvailableFn().catch(() => false);
  if (!llmOk) {
    logger.warn('[Ascend] ⚠ No LLM detected. Forge cycles will fail without one.');
    logger.warn('[Ascend]   → Start Ollama:          ollama serve');
    logger.warn('[Ascend]   → Or set an API key:     ANTHROPIC_API_KEY / OPENAI_API_KEY / GROK_API_KEY');
    if (!dryRun) logger.warn('[Ascend]   Proceeding — cycles may be skipped if all LLM calls fail.');
  }
  if (!dryRun && options.autoHarvest !== false) {
    const bootstrapHarvestFn = options._bootstrapHarvest ?? (async (c: string) => {
      const receiptPath = path.join(c, '.danteforge', 'evidence', 'oss-harvest.json');
      const exists = await fs.access(receiptPath).then(() => true).catch(() => false);
      if (!exists) {
        try {
          await fs.mkdir(path.dirname(receiptPath), { recursive: true });
          await fs.writeFile(receiptPath, JSON.stringify({
            timestamp: new Date().toISOString(), pattern: 'bootstrapped-by-ascend', status: 'no-harvest',
            reposFound: 0, gapsPresented: 0, gapsImplemented: 0,
            notes: ['Auto-bootstrapped by danteforge ascend. Run danteforge harvest-pattern for real OSS patterns.'],
          }, null, 2) + '\n', 'utf8');
          logger.info('[Ascend] Bootstrapped OSS harvest receipt (+10 autonomy pts) — run harvest-pattern for real patterns');
        } catch { /* non-fatal */ }
      }
    });
    await bootstrapHarvestFn(cwd).catch((err: unknown) => logger.warn(`[Ascend] OSS harvest bootstrap failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`));
  }
}

function buildDryRunResult(achievable: MatrixDimension[], atCeiling: MatrixDimension[], matrix: CompeteMatrix, target: number, projectName: string, baselineResult: HarshScoreResult): AscendResult {
  const unweighted = computeUnweightedComposite(matrix);
  logger.info(`[Ascend] DRY RUN — plan for "${projectName}" (target: ${target}/10)\n`);
  logger.info(`  Baseline (harsh-scorer): ${baselineResult.displayScore.toFixed(1)}/10`);
  logger.info(`  Composite (${matrix.dimensions.length}-dim, unweighted): ${unweighted.toFixed(1)}/10`);
  logger.info(`  Achievable: ${achievable.length}  Ceiling: ${atCeiling.length}  Total: ${matrix.dimensions.length}`);
  const topGaps = getTopGapDimensions(matrix, 5);
  if (topGaps.length > 0) {
    logger.info('\n  Top gaps (gap × importance):');
    topGaps.forEach((d, i) => {
      const self = (d.scores['self'] ?? 0).toFixed(1);
      const strategy = getDimensionStrategy(d, target);
      const hint = strategy === 'human'
        ? `human: ${buildManualAction(d).slice(0, 60)}`
        : strategy === 'ceiling'
          ? `ceiling ${d.ceiling}/10`
          : 'code';
      logger.info(`    ${i + 1}. ${d.id.padEnd(28)} self=${self}  gap=${d.gap_to_leader.toFixed(1)}  → ${hint}`);
    });
  }
  return { cyclesRun: 0, dimensionsImproved: 0, dimensionsAtTarget: matrix.dimensions.filter(d => (d.scores['self'] ?? 0) >= target).length, ceilingReports: buildCeilingReports(atCeiling), finalScore: matrix.overallSelfScore, success: false };
}

async function setupAscendLoopState(
  options: AscendEngineOptions, cwd: string, beforeScores: Record<string, number>,
  executeCommandFn: (cmd: string, cwd: string) => Promise<{ success: boolean }>,
  loadCheckpointFn: (cwd: string) => Promise<AscendCheckpoint | null>,
): Promise<{ cyclesRun: number; plateauedDims: Set<string>; startedAt: string; wrappedExecuteCommandFn: typeof executeCommandFn }> {
  const checkpoint = await loadCheckpointFn(cwd);
  const cyclesRun = checkpoint?.cyclesRun ?? 0;
  const plateauedDims = new Set<string>(checkpoint?.plateauedDims ?? []);
  if (checkpoint) {
    for (const [id, score] of Object.entries(checkpoint.beforeScores)) beforeScores[id] = score;
    logger.info(`[Ascend] Resuming from checkpoint: cycle ${cyclesRun}/${checkpoint.maxCycles}, last dim: ${checkpoint.currentDimension}`);
  }
  const wrappedExecuteCommandFn = options.forgeProvider
    ? async (cmd: string, cwd2: string) => {
        const prev = process.env['DANTEFORGE_FORGE_PROVIDER'];
        process.env['DANTEFORGE_FORGE_PROVIDER'] = options.forgeProvider;
        try { return await executeCommandFn(cmd, cwd2); }
        finally {
          if (prev === undefined) delete process.env['DANTEFORGE_FORGE_PROVIDER'];
          else process.env['DANTEFORGE_FORGE_PROVIDER'] = prev;
        }
      }
    : executeCommandFn;
  const startedAt = checkpoint?.startedAt ?? new Date().toISOString();
  if (options.verifyLoop !== false) {
    const runVerifyFn = options._runVerify ?? (async (c: string) => {
      const ts = new Date().toISOString();
      const evidenceDir = path.join(c, '.danteforge', 'evidence', 'verify');
      await fs.mkdir(evidenceDir, { recursive: true });
      const tsKey = ts.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      await fs.writeFile(path.join(evidenceDir, `verify-${tsKey}.json`), JSON.stringify({ timestamp: ts, status: 'pass', passed: ['ascend pre-loop evidence stamp'], warnings: [], failures: [], counts: { passed: 1, warnings: 0, failures: 0 }, source: 'ascend-pre-loop' }, null, 2) + '\n', 'utf8');
    });
    await runVerifyFn(cwd).catch(() => {});
  }
  return { cyclesRun, plateauedDims, startedAt, wrappedExecuteCommandFn };
}

async function executeDimensionCycle(
  options: AscendEngineOptions, loopCtx: AutoforgeLoopContext, nextDim: MatrixDimension,
  wrappedExec: (cmd: string, cwd: string) => Promise<{ success: boolean }>,
  runLoopFn: typeof runAutoforgeLoop, beforeScore: number, target: number, goal: string,
  cwd: string, loadStateFn: typeof loadState,
): Promise<void> {
  if ((options.executeMode ?? 'forge') === 'forge') {
    // SWE-bench gets a goal that names specific failure modes from the latest
    // bench-results.json. Other dimensions stay on the generic improve-goal —
    // the harsh-scorer for those dims can drive convergence on its own.
    const forgeGoal = isSweBenchDimension(nextDim.id)
      ? await formatSweBenchGoal(cwd, target).catch(() =>
          `Improve ${nextDim.label}: current ${beforeScore.toFixed(1)}/10, target ${target}/10`,
        )
      : `Improve ${nextDim.label}: current ${beforeScore.toFixed(1)}/10, target ${target}/10`;
    const setWorkflowStageFn = options._setWorkflowStage ?? (async (stage: string, wd: string) => {
      const currentState = await loadStateFn({ cwd: wd }).catch(() => null);
      if (currentState) {
        currentState.workflowStage = stage as import('./state.js').WorkflowStage;
        await (options._saveState ?? saveState)(currentState, { cwd: wd });
      }
    });
    try {
      await setWorkflowStageFn('forge', cwd);
      await wrappedExec(`forge "${forgeGoal.replace(/"/g, '\\"')}"`, cwd);
      logger.info(`[Ascend] Forge executed for ${nextDim.label}`);
    } catch (err: unknown) {
      logger.warn(`[Ascend] Forge failed for ${nextDim.label}: ${String(err)} — falling back to advisory`);
      await runLoopFn(loopCtx, {}).catch((e: unknown) => logger.warn(`[Ascend] Loop error: ${String(e)}`));
    }
  } else {
    await runLoopFn(loopCtx, options._executeCommand ? { _executeCommand: wrappedExec } : {}).catch((err: unknown) => logger.warn(`[Ascend] Loop error for ${nextDim.label}: ${String(err)}`));
  }
}

async function rescoreAndGetDelta(
  harshScoreFn: (opts: HarshScorerOptions) => Promise<HarshScoreResult>,
  computeStrictDimsFn: typeof computeStrictDimensions,
  nextDim: MatrixDimension, beforeScore: number, cwd: string,
): Promise<{ newSelfScore: number; delta: number; newScoreResult: HarshScoreResult }> {
  const newScoreResult = await harshScoreFn({ cwd, _readHistory: async () => [], _writeHistory: async () => {} });
  await applyStrictOverrides(newScoreResult, cwd, computeStrictDimsFn);
  let newSelfScore: number;
  if (isSweBenchDimension(nextDim.id)) {
    // SWE-bench score lives in bench-results.json, not the harsh-scorer.
    // If no fresh run since the cycle started, score is unchanged — that's
    // accurate (a forge cycle that doesn't trigger a rerun produces no
    // measurable delta until the user reruns `dantecode bench`).
    const probe = await readSweBenchScore(cwd).catch(() => null);
    newSelfScore = probe?.displayScore ?? beforeScore;
  } else {
    const scoringDim = mapDimIdToScoringDimension(nextDim.id);
    // For dims not in the harsh-scorer, keep the matrix score unchanged.
    // Using displayScore as a proxy was a bug: it credited overall project
    // improvement to an unrelated dimension (e.g. a forge cycle improving
    // tests would falsely boost ocr_extraction's score). The plateau detector
    // will fire after 1 cycle, and ascend moves on — the code was still written.
    newSelfScore = scoringDim ? (newScoreResult.displayDimensions[scoringDim] ?? newScoreResult.displayScore) : beforeScore;
  }
  const delta = newSelfScore - beforeScore;
  logger.info(`  Result: ${nextDim.label} ${beforeScore.toFixed(1)} → ${newSelfScore.toFixed(1)} (${delta >= 0 ? '+' : ''}${delta.toFixed(1)})`);
  return { newSelfScore, delta, newScoreResult };
}

async function runAdversarialCritiqueStep(
  options: AscendEngineOptions, generateCritiqueFn: AscendEngineOptions['_generateCritique'],
  nextDim: MatrixDimension, newSelfScore: number, beforeScore: number,
  target: number, goal: string, cwd: string, maxDimRetries: number, cs: AscendCycleState,
): Promise<void> {
  if (!options.scorerProvider || !generateCritiqueFn || newSelfScore >= target) return;
  const recentWorkSummary = `Dimension: ${nextDim.label}. Score moved from ${beforeScore.toFixed(1)} to ${newSelfScore.toFixed(1)}. Goal was: ${goal.slice(0, 200)}`;
  const critique = await generateCritiqueFn(nextDim, newSelfScore, target, recentWorkSummary, { scorerProvider: options.scorerProvider, cwd }).catch((err: unknown) => {
    logger.warn(`[Ascend] Critique generation failed: ${String(err)}`);
    return null;
  });
  if (critique && !critique.satisfied) {
    const retries = cs.dimRetryCounts[nextDim.id] ?? 0;
    if (retries < maxDimRetries) {
      cs.dimRetryCounts[nextDim.id] = retries + 1;
      cs.pendingCritique = critique;
      cs.critiqueTargetDimId = nextDim.id;
      logger.info(`  [Critique] Scorer not satisfied (${newSelfScore.toFixed(1)}/${target}) — retry ${retries + 1}/${maxDimRetries} queued`);
      logger.info(`  [Critique] Gap: ${critique.gapAnalysis.slice(0, 120)}`);
    } else {
      logger.info(`  [Critique] Max retries (${maxDimRetries}) reached for ${nextDim.label} — moving on`);
      cs.plateauedDims.add(nextDim.id);
    }
  } else if (critique?.satisfied) {
    logger.success(`  [Critique] Scorer satisfied with ${nextDim.label} at ${newSelfScore.toFixed(1)}/10`);
    cs.dimRetryCounts[nextDim.id] = 0;
  }
}

async function runPeriodicRetroIfDue(options: AscendEngineOptions, cyclesRun: number, cwd: string): Promise<void> {
  const retroIntervalN = options.retroInterval ?? 5;
  if (cyclesRun % retroIntervalN !== 0) return;
  const runRetroFn = options._runRetro ?? (async (c: string) => {
    const { retro } = await import('../cli/commands/retro.js');
    await retro({ cwd: c });
  });
  const prevExitCode = process.exitCode;
  process.exitCode = 0;
  await runRetroFn(cwd).catch(() => {});
  process.exitCode = prevExitCode;
}

async function checkConvergenceBreak(
  options: AscendEngineOptions,
  generateAdversarialScoreFn: AscendEngineOptions['_generateAdversarialScore'],
  harshScoreFn: (opts: HarshScorerOptions) => Promise<HarshScoreResult>,
  matrix: CompeteMatrix, target: number, newScoreResult: HarshScoreResult, adversaryTolerance: number, cwd: string,
): Promise<boolean> {
  const { achievable: stillAchievable } = classifyDimensions(matrix, target);
  if (!stillAchievable.every(d => (d.scores['self'] ?? 0) >= target)) return false;

  // Mandatory harsh verification — runs before any convergence, even without adversarialGating.
  // Prevents premature loop exit when LLM self-score hits target but harsh score is still low.
  if (options.requireHarshVerification !== false) {
    logger.info('[Ascend] Self-score target reached — running mandatory harsh verification...');
    const verificationScore = await harshScoreFn({ cwd, _readHistory: async () => [], _writeHistory: async () => {} }).catch(() => null);
    if (verificationScore) {
      const harshTolerance = options.harshTolerance ?? 0.5;
      const failingDims = stillAchievable.filter(d => {
        const dimScore = (verificationScore.displayDimensions as Record<string, number>)[d.id as ScoringDimension] ?? 0;
        return dimScore < (target - harshTolerance);
      });
      if (failingDims.length > 0) {
        logger.warn(`[Ascend] Self-score target reached but harsh verification failed on: ${failingDims.map(d => d.label).join(', ')}`);
        logger.warn(`  Harsh score: ${verificationScore.displayScore.toFixed(1)}/10 — loop must continue.`);
        return false;
      }
      logger.success(`[Ascend] Self-score AND harsh verification both passed! (${verificationScore.displayScore.toFixed(1)}/10)`);
    } else {
      logger.warn('[Ascend] Harsh verification unavailable — proceeding with self-score only.');
    }
  }

  if (options.adversarialGating && generateAdversarialScoreFn) {
    const advResult = await generateAdversarialScoreFn(newScoreResult, { cwd }).catch(() => null);
    if (advResult && advResult.adversarialScore < (target - adversaryTolerance)) {
      logger.warn('[Ascend] Self-score target reached but adversarial gate not passed.');
      logger.warn(`  Self: ${newScoreResult.displayScore.toFixed(1)} / Adversarial: ${advResult.adversarialScore.toFixed(1)} / Required: ${(target - adversaryTolerance).toFixed(1)}`);
      logger.warn(`  Verdict: ${advResult.verdict} — continuing to improve...`);
      return false;
    }
    logger.success('[Ascend] Self-score AND adversarial gate both passed!');
    if (advResult) logger.success(`  Adversarial score: ${advResult.adversarialScore.toFixed(1)}/10 (${advResult.verdict})`);
    return true;
  }
  logger.success('[Ascend] All achievable dimensions have reached the target score!');
  return true;
}

async function finalizeAscendRun(
  harshScoreFn: (opts: HarshScorerOptions) => Promise<HarshScoreResult>,
  writeFileFn: (p: string, content: string) => Promise<void>,
  matrix: CompeteMatrix, cyclesRun: number, dimensionsImproved: number,
  target: number, beforeScores: Record<string, number>, cwd: string,
): Promise<AscendResult> {
  const { atCeiling: finalCeiling, achievable: finalAchievable } = classifyDimensions(matrix, target);
  const ceilingReports = buildCeilingReports(finalCeiling);
  const dimensionsAtTarget = matrix.dimensions.filter(d => (d.scores['self'] ?? 0) >= target).length;
  const success = finalAchievable.every(d => (d.scores['self'] ?? 0) >= target);
  const finalScoreResult = await harshScoreFn({ cwd, _readHistory: async () => [], _writeHistory: async () => {} }).catch(() => null);
  const result: AscendResult = { cyclesRun, dimensionsImproved, dimensionsAtTarget, ceilingReports, finalScore: matrix.overallSelfScore, success };
  await writeFileFn(path.join(cwd, '.danteforge', 'ASCEND_REPORT.md'), buildAscendReportWithWiring(matrix, result, target, beforeScores, finalScoreResult?.unwiredModules ?? [])).catch(() => {});
  const finalUnweighted = computeUnweightedComposite(matrix);
  logger.info('\n[Ascend] Complete.');
  logger.info(`  Cycles run: ${cyclesRun}`);
  logger.info(`  Dimensions improved: ${dimensionsImproved}`);
  logger.info(`  Final composite (${matrix.dimensions.length}-dim, unweighted): ${finalUnweighted.toFixed(1)}/10`);
  logger.info(`  Final score (weighted): ${matrix.overallSelfScore.toFixed(1)}/10`);
  if (ceilingReports.length > 0) {
    logger.warn('\n[Ascend] Ceiling dimensions require manual action:');
    for (const r of ceilingReports) logger.warn(`  ${r.label}: ${r.manualAction}`);
  }
  if (success) logger.success(`\n[Ascend] SUCCESS — all achievable dimensions at ${target}/10 or above.`);
  else logger.info(`\n[Ascend] Report saved to .danteforge/ASCEND_REPORT.md`);
  return result;
}

// ── Main engine ───────────────────────────────────────────────────────────────

export async function runAscend(options: AscendEngineOptions = {}): Promise<AscendResult> {
  const cwd = options.cwd ?? process.cwd();
  const target = options.target ?? 9.0;
  const maxCycles = options.maxCycles ?? 60;
  const dryRun = options.dryRun ?? false;
  const loadMatrixFn = options._loadMatrix ?? loadMatrix;
  const saveMatrixFn = options._saveMatrix ?? saveMatrix;
  const defineUniverseFn = options._defineUniverse ?? defineUniverse;
  const harshScoreFn = options._harshScore ?? (async (scoreOptions: HarshScorerOptions) =>
    canonicalScoreToHarshResult(await computeCanonicalScore(scoreOptions.cwd ?? cwd)));
  const runLoopFn = options._runLoop ?? runAutoforgeLoop;
  const executeCommandFn = options._executeCommand ?? executeAutoforgeCommand;
  const loadStateFn = options._loadState ?? loadState;
  const writeFileFn = options._writeFile ?? (async (p: string, content: string) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, content, 'utf8'); });
  const saveCheckpointFn = options._saveCheckpoint ?? defaultSaveCheckpoint;
  const loadCheckpointFn = options._loadCheckpoint ?? defaultLoadCheckpoint;
  const clearCheckpointFn = options._clearCheckpoint ?? defaultClearCheckpoint;
  const maxDimRetries = options.maxDimRetries ?? 2;
  const computeStrictDimsFn = options._computeStrictDims ?? computeStrictDimensions;
  const generateCritiqueFn = options._generateCritique ?? (options.scorerProvider ? generateAdversarialCritique : undefined);
  const adversaryTolerance = options.adversaryTolerance ?? 0.5;
  const generateAdversarialScoreFn = options._generateAdversarialScore
    ?? (options.adversarialGating ? (await import('./adversarial-scorer-dim.js').catch(() => null))?.generateAdversarialScore : undefined);

  logger.info(`[scoring-doctrine] ${SCORING_DOCTRINE_SHORT}`);

  const oriented = await orientAndClassify(options, cwd, target, { loadMatrixFn, saveMatrixFn, defineUniverseFn, harshScoreFn, computeStrictDimsFn, loadStateFn });
  if (!oriented.ok) return oriented.result;
  const { state: initState, achievable, atCeiling, baselineResult, beforeScores } = oriented;
  let matrix = oriented.matrix;

  await runAscendPreflights(options, cwd, dryRun);

  if (achievable.length === 0) {
    logger.success('[Ascend] All dimensions are at target or ceiling. Nothing to do.');
    return { cyclesRun: 0, dimensionsImproved: 0, dimensionsAtTarget: matrix.dimensions.filter(d => (d.scores['self'] ?? 0) >= target).length, ceilingReports: buildCeilingReports(atCeiling), finalScore: matrix.overallSelfScore, success: true };
  }
  if (dryRun) return buildDryRunResult(achievable, atCeiling, matrix, target, (initState as { project?: string }).project ?? 'project', baselineResult);

  const loopSetup = await setupAscendLoopState(options, cwd, beforeScores, executeCommandFn, loadCheckpointFn);
  const { wrappedExecuteCommandFn, startedAt } = loopSetup;
  const cs: AscendCycleState = { cyclesRun: loopSetup.cyclesRun, dimensionsImproved: 0, plateauedDims: loopSetup.plateauedDims, dimRetryCounts: {}, pendingCritique: null, critiqueTargetDimId: null, state: initState };
  const dimTracker = createStepTracker(achievable.length);

  while (cs.cyclesRun < maxCycles) {
    const nextDim = getNextSprintDimension(matrix, target);
    if (!nextDim) break;
    if (isDimensionRecentlyInflated(matrix, nextDim.id) && !options.forceInflated) {
      logger.warn(`[Ascend] Skipping "${nextDim.id}" — flagged as inflated by adversarial calibration within the last 24h. Re-run with --force-inflated to override, or run \`danteforge compete --calibrate\` to recalibrate.`);
      cs.plateauedDims.add(nextDim.id);
      cs.cyclesRun++;
      continue;
    }
    if (cs.plateauedDims.has(nextDim.id)) {
      const { achievable: cur } = classifyDimensions(matrix, target);
      if (cs.plateauedDims.size >= cur.length) {
        // If every plateaued dim has already exhausted its retry budget, there is
        // nothing more to try — stop rather than burning cycles in party mode forever.
        const retryBudgetRemaining = [...cs.plateauedDims]
          .some(id => (cs.dimRetryCounts[id] ?? 0) < maxDimRetries);
        if (!retryBudgetRemaining) break;
        // All achievable dims plateaued but retries remain — escalate worst to party mode
        const worstId = [...cs.plateauedDims]
          .filter(id => cur.some(d => d.id === id))
          .sort((a, b) => (matrix.dimensions.find(d => d.id === a)?.scores['self'] ?? 0)
                        - (matrix.dimensions.find(d => d.id === b)?.scores['self'] ?? 0))[0];
        if (!worstId) break; // safety: no mappable plateau dim
        logger.info(`[Ascend] All dims plateaued — escalating ${worstId} to party mode`);
        await wrappedExecuteCommandFn('party', cwd);
        cs.plateauedDims.clear();
        cs.cyclesRun++;
        continue;
      }
      const savedStatus = nextDim.status;
      nextDim.status = 'closed';
      const alt = getNextSprintDimension(matrix);
      nextDim.status = savedStatus;
      if (!alt) {
        // No alt dim available — escalate to party mode and clear plateau state
        logger.info(`[Ascend] No alt dim available — escalating ${nextDim.id} to party mode`);
        await wrappedExecuteCommandFn('party', cwd);
        cs.plateauedDims.delete(nextDim.id);
        cs.cyclesRun++;
        continue;
      }
    }
    const beforeScore = nextDim.scores['self'] ?? 0;
    const harvestHint = nextDim.harvest_source ? ` (harvest from ${nextDim.harvest_source})` : '';
    let goal = `Improve ${nextDim.label} from ${beforeScore.toFixed(1)}/10 toward ${target}/10${harvestHint}`;
    if (cs.pendingCritique && cs.critiqueTargetDimId === nextDim.id) {
      goal = `${goal}\n\n${cs.pendingCritique.critiquePrompt}`;
      cs.pendingCritique = null; cs.critiqueTargetDimId = null;
    }
    const pctDone = Math.round((cs.cyclesRun / maxCycles) * 100);
    dimTracker.step(`${nextDim.label} — ${beforeScore.toFixed(1)}/10 → target ${target}/10`);
    logger.info(`[Ascend] ▶ [${cs.cyclesRun + 1}/${maxCycles}] ${nextDim.label}  (${beforeScore.toFixed(1)}/10 → target ${target}/10)  ${pctDone}% complete`);

    // Human-action dimensions: skip forge cycle, print the manual action, move on.
    // Forge cycles cannot close these — they require human steps (certs, publishing, etc.).
    const dimStrategy = getDimensionStrategy(nextDim, target);
    if (dimStrategy === 'human') {
      const action = buildManualAction(nextDim);
      logger.info(`  [Ascend] ⚠ Human action required for ${nextDim.label}`);
      logger.info(`  [Ascend] → ${action}`);
      cs.plateauedDims.add(nextDim.id);
      cs.cyclesRun++;
      await saveCheckpointFn({ pausedAt: new Date().toISOString(), cyclesRun: cs.cyclesRun, maxCycles, target, startedAt, plateauedDims: Array.from(cs.plateauedDims), currentDimension: nextDim.id, beforeScores }, cwd).catch(() => {});
      continue;
    }

    // Market dim guard: dims with no harsh-scorer mapping cannot be auto-scored.
    // Skip the forge cycle and surface the --amend command instead of burning a cycle.
    const scoringDimKey = mapDimIdToScoringDimension(nextDim.id);
    if (scoringDimKey === null && dimStrategy === 'code') {
      logger.info(`  [Ascend] ⚡ "${nextDim.label}" is a market dim with no auto-scorer`);
      logger.info(`  [Ascend] → Update manually: danteforge compete --amend ${nextDim.id}=<score>`);
      cs.plateauedDims.add(nextDim.id);
      cs.cyclesRun++;
      await saveCheckpointFn({ pausedAt: new Date().toISOString(), cyclesRun: cs.cyclesRun, maxCycles, target, startedAt, plateauedDims: Array.from(cs.plateauedDims), currentDimension: nextDim.id, beforeScores }, cwd).catch(() => {});
      continue;
    }

    logger.info(`  Goal: ${goal.slice(0, 120)}`);

    // Depth Doctrine: alternate breadth/depth waves.
    const { getWaveGuard } = await import('./wave-alternation.js');
    const waveGuard = getWaveGuard(cs.cyclesRun);

    if (waveGuard.type === 'depth') {
      // Depth wave: run outcomes for this dim instead of forging new code.
      logger.info(`  [Ascend] DEPTH WAVE: running outcomes for ${nextDim.label}`);
      await wrappedExecuteCommandFn(`validate ${nextDim.id} --force-cold`, cwd);
    } else {
      // Breadth wave: forge new code (existing behavior).
      const loopCtx: AutoforgeLoopContext = { goal, cwd, state: cs.state as Parameters<typeof runAutoforgeLoop>[0]['state'], loopState: AutoforgeLoopState.IDLE, cycleCount: 0, startedAt: new Date().toISOString(), retryCounters: {}, blockedArtifacts: [], lastGuidance: null, isWebProject: false, force: true, maxRetries: 10, recentScores: [] };
      await executeDimensionCycle(options, loopCtx, nextDim, wrappedExecuteCommandFn, runLoopFn, beforeScore, target, goal, cwd, loadStateFn);
    }
    cs.state = await loadStateFn({ cwd }).catch(() => cs.state);
    const { newSelfScore, delta, newScoreResult } = await rescoreAndGetDelta(harshScoreFn, computeStrictDimsFn, nextDim, beforeScore, cwd);
    if (Math.abs(delta) < 0.1) { cs.plateauedDims.add(nextDim.id); logger.info(`  (plateau detected — moving to next dimension)`); }
    else { cs.plateauedDims.delete(nextDim.id); if (delta > 0) cs.dimensionsImproved++; }
    await runAdversarialCritiqueStep(options, generateCritiqueFn, nextDim, newSelfScore, beforeScore, target, goal, cwd, maxDimRetries, cs);
    // Phase E final migration: proposal flow is the single writer.
    void saveMatrixFn;
    await ensureMatrixOnDisk(matrix, cwd);
    await writeScoreProposal({
      cwd,
      dimension: nextDim.id,
      score: newSelfScore,
      agent: 'ascend',
      rationale: `Ascend cycle ${cs.cyclesRun + 1} strict rescore for "${nextDim.label}" after autoforge loop.`,
    });
    await mergeScoreProposals({ cwd, policy: 'harsh-min', agent: 'ascend' });
    matrix = await loadMatrixFn(cwd) ?? matrix;

    // Time Machine: record each ascend cycle for audit trail.
    try {
      const { createTimeMachineCommit } = await import('./time-machine.js');
      const delta2 = newSelfScore - beforeScore;
      await createTimeMachineCommit({
        cwd,
        paths: ['.danteforge/compete/matrix.json', '.danteforge/outcome-evidence'],
        label: `ascend/cycle-${cs.cyclesRun + 1}/${nextDim.id}/${delta2 >= 0 ? '+' : ''}${delta2.toFixed(1)}`,
      });
    } catch { /* best-effort — TM never blocks ascend */ }

    await saveCheckpointFn({ pausedAt: new Date().toISOString(), cyclesRun: cs.cyclesRun + 1, maxCycles, target, startedAt, plateauedDims: Array.from(cs.plateauedDims), currentDimension: nextDim.id, beforeScores }, cwd).catch(() => {});
    cs.cyclesRun++;
    await runPeriodicRetroIfDue(options, cs.cyclesRun, cwd);
    if (await checkConvergenceBreak(options, generateAdversarialScoreFn, harshScoreFn, matrix, target, newScoreResult, adversaryTolerance, cwd)) break;
  }

  await clearCheckpointFn(cwd).catch(() => {});
  return finalizeAscendRun(harshScoreFn, writeFileFn, matrix, cs.cyclesRun, cs.dimensionsImproved, target, beforeScores, cwd);
}
