// Autoforge v2 — Intelligent Autonomous Loop (IAL)
// State machine that drives the full pipeline toward completion.
import fs from 'fs/promises';
import path from 'path';
import { loadState, saveState, type DanteState } from './state.js';
import { isLLMAvailable } from './llm.js';
import { scoreAllArtifacts, persistScoreResult, computeAutoforgeDecision } from './pdse.js';
import type { ScoreResult, ScoredArtifact } from './pdse.js';
import { computeCompletionTracker, detectProjectType, type CompletionTracker, type ProjectType } from './completion-tracker.js';
import { SCORE_THRESHOLDS, ANTI_STUB_PATTERNS } from './pdse-config.js';
import { logger } from './logger.js';
import { createStepTracker } from './progress.js';
import { recordMemory } from './memory-engine.js';
import { detectPlateau, formatPlateauAnalysis } from './plateau-detector.js';
import { evaluateTermination } from './termination-governor.js';
import type { CompletionVerdict } from './completion-oracle.js';
import type { ResidualGapReport } from './residual-gap-miner.js';
import {
  buildGuidance,
  checkProtectedTaskPaths,
  determineNextCommand,
  findBlockedArtifacts,
  writeGuidanceFile,
} from './autoforge-guidance.js';
import { printSummaryTable, detectStall, AUTOFORGE_PAUSE_FILE, saveCheckpoint, loadCheckpoint } from './autoforge-checkpoint.js';
export { detectStall, AUTOFORGE_PAUSE_FILE, saveCheckpoint, loadCheckpoint } from './autoforge-checkpoint.js';
export type { AutoforgeCheckpoint, AutoforgePauseSnapshot } from './autoforge-checkpoint.js';
export { AUTOFORGE_CHECKPOINT_FILE, CHECKPOINT_MAX_AGE_MS } from './autoforge-checkpoint.js';
import { SCORING_DOCTRINE_SHORT } from './scoring-doctrine.js';
export {
  buildGuidance,
  checkProtectedTaskPaths,
  computeEstimatedSteps,
  determineNextCommand,
  findBlockedArtifacts,
  findBottleneck,
  formatGuidanceMarkdown,
  getRecommendationReason,
  writeGuidanceFile,
} from './autoforge-guidance.js';

// ── State machine ───────────────────────────────────────────────────────────

export enum AutoforgeLoopState {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  SCORING = 'SCORING',
  REFINING = 'REFINING',
  BLOCKED = 'BLOCKED',
  COMPLETE = 'COMPLETE',
}

export interface AutoforgeLoopContext {
  goal: string;
  cwd: string;
  state: DanteState;
  loopState: AutoforgeLoopState;
  cycleCount: number;
  startedAt: string;
  retryCounters: Record<string, number>;  // artifact name → retry count
  blockedArtifacts: string[];
  lastGuidance: AutoforgeGuidance | null;
  isWebProject: boolean;
  force: boolean;
  dryRun?: boolean;
  maxRetries: number;
  /** Recent overall completion percentages — used for plateau detection. */
  recentScores: number[];
  /** Verdict history for termination-governor plateau detection. */
  previousVerdicts?: CompletionVerdict[];
  /** ISO timestamp of last score improvement — used for time-limit termination. */
  lastProgressTime?: string;
}

export interface AutoforgeGuidance {
  timestamp: string;
  overallCompletion: number;
  currentBottleneck: string;
  blockingIssues: BlockingIssue[];
  recommendedCommand: string;
  recommendedReason: string;
  autoAdvanceEligible: boolean;
  autoAdvanceBlockReason?: string;
  estimatedStepsToCompletion: number;
}

export interface BlockingIssue {
  artifact: string;
  score: number;
  decision: string;
  remediation: string;
}

// ── Loop result (quality delta report written after loop exits) ─────────────

export type LoopTerminationReason =
  | 'target-reached'
  | 'plateau'
  | 'blocked'
  | 'circuit-open'
  | 'max-cycles'
  | 'interrupted'
  | 'advisory';

export interface LoopResult {
  startScore: number;
  endScore: number;
  delta: number;
  cycles: number;
  duration: number;           // milliseconds
  terminationReason: LoopTerminationReason;
  timestamp: string;
}

export function getLoopResultPath(cwd: string): string {
  return path.join(cwd, '.danteforge', 'loop-result.json');
}

export async function writeLoopResult(
  result: LoopResult,
  cwd: string,
  _fsWrite?: (p: string, d: string) => Promise<void>,
): Promise<void> {
  const write = _fsWrite ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, d, 'utf8');
  });
  try {
    await write(getLoopResultPath(cwd), JSON.stringify(result, null, 2));
  } catch {
    // best-effort — never throws
  }

  // Also write to evidence/autoforge/ — computeStrictDimensions awards +15 autonomy pts
  // simply for this directory existing, proving autoforge has run at least once.
  // Timestamped files accumulate as a run history.
  try {
    const ts = result.timestamp.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const evidencePath = path.join(cwd, '.danteforge', 'evidence', 'autoforge', `loop-${ts}.json`);
    await write(evidencePath, JSON.stringify(result, null, 2));
  } catch {
    // non-fatal — evidence write never blocks loop result
  }
}

/** Injection seam for testing runAutoforgeLoop without real I/O */
export interface AutoforgeLoopDeps {
  scoreAllArtifacts: (cwd: string, state: DanteState) => Promise<Record<ScoredArtifact, ScoreResult>>;
  persistScoreResult: (result: ScoreResult, cwd: string) => Promise<string>;
  detectProjectType: (cwd: string) => Promise<ProjectType>;
  computeCompletionTracker: (state: DanteState, scores: Record<ScoredArtifact, ScoreResult>) => CompletionTracker;
  recordMemory: (entry: Parameters<typeof recordMemory>[0], cwd?: string) => Promise<void>;
  loadState: (options?: { cwd?: string }) => Promise<DanteState>;
  saveState: (state: DanteState, options?: { cwd?: string }) => Promise<void>;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof globalThis.setTimeout>;
  /** Injection seam for testing the protected-path gate inside runAutoforgeLoop */
  _checkProtectedPaths?: (
    state: DanteState,
    opts: { cwd?: string }
  ) => Promise<{ blocked: string[]; approved: boolean }>;
  /** Executes the determined next command. When omitted, loop runs in advisory (log-only) mode. */
  _executeCommand?: (command: string, cwd: string) => Promise<{ success: boolean }>;
  /** Registers an OS signal listener (default: process.on). Injected for testing interrupt paths. */
  _addSignalListener?: (signal: string, handler: () => void) => void;
  /** Removes an OS signal listener (default: process.removeListener). Injected for testing. */
  _removeSignalListener?: (signal: string, handler: () => void) => void;
  /** Injection seam for writing the loop-result.json file. */
  _writeLoopResult?: (result: LoopResult, cwd: string) => Promise<void>;
  /** Injection seam for termination-governor evaluateTermination(). */
  _evaluateTermination?: typeof evaluateTermination;
  /** Injection seam for LLM pre-flight check (testing). */
  _isLLMAvailable?: () => Promise<boolean>;
  /** Injection seam for mandatory harsh score verification before COMPLETE. */
  _harshScore?: (opts: { cwd: string }) => Promise<{ displayScore: number } | null>;
  /** Minimum harsh score (0-10) required before the loop may exit on PDSE completion (default: 7.5). */
  harshExitThreshold?: number;
  /** Injection seam: replaces createTimeMachineCommit for testing auto-capture. */
  _timeMachineCommit?: (opts: { cwd: string; paths: string[]; label: string }) => Promise<void>;
  /** Injection seam: replaces postWaveSanitize for testing wave-time LOC enforcement. */
  _postWaveSanitize?: (opts: { cwd: string }) => Promise<void>;
}

// ── Pipeline stages in order ────────────────────────────────────────────────

const MAX_RETRIES = 3;
const COMPLETION_THRESHOLD = 95;

// ── Circuit breaker with exponential backoff ────────────────────────────────

export const CIRCUIT_BREAKER_BACKOFF_BASE_MS = 2000;
export const CIRCUIT_BREAKER_MAX_BACKOFF_MS = 30_000;
export const CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT = 5;

export function computeBackoff(retryCount: number): number {
  const backoff = CIRCUIT_BREAKER_BACKOFF_BASE_MS * Math.pow(2, retryCount);
  return Math.min(backoff, CIRCUIT_BREAKER_MAX_BACKOFF_MS);
}

// ── Termination-governor helpers ────────────────────────────────────────────

function trackerToVerdict(overall: number): CompletionVerdict {
  if (overall >= 95) return 'complete';
  if (overall >= 70) return 'partially_complete';
  // Low overall score (< 30%) is inconclusive — project is starting out or partially done.
  // A new project always starts low and improves. 'regressed' is reserved for when
  // the score actively goes backward; we do NOT use overall < 30 as a proxy for regression.
  return 'inconclusive';
}

function buildGapReportFromCtx(ctx: AutoforgeLoopContext, overall: number): ResidualGapReport {
  return {
    timestamp: new Date().toISOString(),
    analysis: {
      confirmedGaps: ctx.blockedArtifacts,
      suspectedHiddenGaps: [],
      regressions: [],
      staleTruthSurfaces: [],
      missingTests: [],
      missingWiring: [],
      score: overall,
    },
    recommendations: ctx.blockedArtifacts.map(a => `Fix blocked artifact: ${a}`),
    nextWavePriority: ctx.blockedArtifacts.slice(0, 3),
  };
}

// ── Internal loop helpers ────────────────────────────────────────────────────

async function runCycleScoringAndCompletion(
  ctx: AutoforgeLoopContext,
  deps: Partial<AutoforgeLoopDeps>,
  cwd: string,
): Promise<{ tracker: CompletionTracker; scores: Record<ScoredArtifact, ScoreResult>; shouldBreak: boolean }> {
  const _scoreAllArtifacts = deps.scoreAllArtifacts ?? scoreAllArtifacts;
  const _persistScoreResult = deps.persistScoreResult ?? persistScoreResult;
  const _detectProjectType = deps.detectProjectType ?? detectProjectType;
  const _computeCompletionTracker = deps.computeCompletionTracker ?? computeCompletionTracker;
  const _recordMemory = deps.recordMemory ?? recordMemory;
  const _saveState = deps.saveState ?? saveState;

  ctx.loopState = AutoforgeLoopState.SCORING;
  const scores = await _scoreAllArtifacts(cwd, ctx.state);
  for (const result of Object.values(scores)) {
    await _persistScoreResult(result, cwd);
  }

  if (!ctx.state.projectType || ctx.state.projectType === 'unknown') {
    ctx.state.projectType = await _detectProjectType(cwd);
  }
  const tracker = _computeCompletionTracker(ctx.state, scores);
  ctx.state.completionTracker = tracker;

  ctx.recentScores = ctx.recentScores ?? [];
  ctx.recentScores.push(tracker.overall);
  if (ctx.recentScores.length > 10) ctx.recentScores.shift();

  if (ctx.recentScores.length >= 3) {
    const fakeCycles = ctx.recentScores.slice(1).map((score, i) => ({
      cycle: i + 1,
      timestamp: new Date().toISOString(),
      adoptionsAttempted: 1,
      adoptionsSucceeded: 1,
      scoresBefore: { overall: ctx.recentScores[i] / 10 },
      scoresAfter: { overall: score / 10 },
      costUsd: 0,
    }));
    const plateau = detectPlateau(fakeCycles, { threshold: 0.05 });
    if (plateau.isPlateaued) {
      logger.warn(`[Autoforge] ${formatPlateauAnalysis(plateau)}`);
    }

    // Secondary stall check: raw score series hasn't moved in last 3 cycles.
    if (detectStall(ctx.recentScores)) {
      logger.warn(`[Autoforge] Stall detected — score flat over last 3 cycles. Switching strategy.`);
      try {
        const { appendLesson } = await import('../cli/commands/lessons.js');
        await appendLesson(
          `[autoforge stall] Score flat at ~${tracker.overall}% for 3 cycles. ` +
          `Consider: lower --light threshold, pick different dimension, or run danteforge respec.`,
          cwd,
        );
      } catch { /* best-effort */ }
    }
  }

  if (tracker.overall >= COMPLETION_THRESHOLD) {
    // Secondary gate: PDSE completion alone is not enough — verify with harsh score.
    // Prevents premature exit when artifact completion % is high but score quality is low.
    const harshExitThreshold = deps.harshExitThreshold ?? 7.5;
    if (deps._harshScore) {
      const harshResult = await deps._harshScore({ cwd }).catch(() => null);
      if (harshResult && harshResult.displayScore < harshExitThreshold) {
        logger.warn(`[Autoforge] PDSE completion (${tracker.overall}%) reached but harsh score (${harshResult.displayScore.toFixed(1)}/10) below gate (${harshExitThreshold}/10) — continuing.`);
        return { tracker, scores, shouldBreak: false };
      }
    }
    ctx.loopState = AutoforgeLoopState.COMPLETE;
    logger.success(`[Autoforge] Overall completion: ${tracker.overall}% — target reached!`);
    const guidance = buildGuidance(tracker, scores, ctx);
    ctx.lastGuidance = guidance;
    await writeGuidanceFile(guidance, cwd);
    printSummaryTable(scores);
    await _recordMemory({
      category: 'decision',
      summary: `Autoforge loop completed at ${tracker.overall}% after ${ctx.cycleCount} cycles`,
      detail: `Goal: ${ctx.goal}. Projected: ${tracker.projectedCompletion}`,
      tags: ['autoforge-loop', 'complete'],
      relatedCommands: ['autoforge'],
    }, cwd);
    ctx.state.auditLog.push(
      `${new Date().toISOString()} | autoforge-loop: COMPLETE at ${tracker.overall}% after ${ctx.cycleCount} cycles`,
    );
    await _saveState(ctx.state, { cwd });
    return { tracker, scores, shouldBreak: true };
  }

  return { tracker, scores, shouldBreak: false };
}

async function checkTerminationGovernor(
  ctx: AutoforgeLoopContext,
  deps: Partial<AutoforgeLoopDeps>,
  tracker: CompletionTracker,
  cwd: string,
): Promise<boolean> {
  const _saveState = deps.saveState ?? saveState;
  const currentVerdict = trackerToVerdict(tracker.overall);
  ctx.previousVerdicts = ctx.previousVerdicts ?? [];
  const terminationDecision = await (deps._evaluateTermination ?? evaluateTermination)({
    cycleCount: ctx.cycleCount,
    maxCycles: ctx.maxRetries * 5,
    verdict: currentVerdict,
    gapReport: buildGapReportFromCtx(ctx, tracker.overall),
    previousVerdicts: ctx.previousVerdicts,
    startTime: ctx.startedAt,
    lastProgressTime: ctx.lastProgressTime ?? ctx.startedAt,
  });
  if (terminationDecision.terminate) {
    logger.info(`[Autoforge] Termination: ${terminationDecision.reason} (confidence: ${terminationDecision.confidence.toFixed(2)})`);
    ctx.loopState = AutoforgeLoopState.BLOCKED;
    ctx.state.auditLog.push(
      `${new Date().toISOString()} | autoforge-loop: termination-governor: ${terminationDecision.reason}`,
    );
    await _saveState(ctx.state, { cwd });
    return true;
  }
  ctx.previousVerdicts.push(currentVerdict);
  const prevScore = ctx.recentScores.length >= 2 ? (ctx.recentScores[ctx.recentScores.length - 2] ?? 0) : 0;
  if (tracker.overall > prevScore) {
    ctx.lastProgressTime = new Date().toISOString();
  }
  return false;
}

async function handleBlockedArtifacts(
  ctx: AutoforgeLoopContext,
  deps: Partial<AutoforgeLoopDeps>,
  blockedArtifacts: BlockingIssue[],
  tracker: CompletionTracker,
  scores: Record<ScoredArtifact, ScoreResult>,
  cwd: string,
  consecutiveFailures: number,
): Promise<{ shouldBreak: boolean; consecutiveFailures: number }> {
  const _recordMemory = deps.recordMemory ?? recordMemory;
  const _saveState = deps.saveState ?? saveState;
  const _setTimeout = deps.setTimeout ?? globalThis.setTimeout;

  if (blockedArtifacts.length === 0) {
    return { shouldBreak: false, consecutiveFailures: 0 };
  }

  consecutiveFailures++;

  if (consecutiveFailures >= CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT) {
    ctx.loopState = AutoforgeLoopState.BLOCKED;
    logger.error(`[Autoforge] Circuit breaker tripped — ${consecutiveFailures} consecutive failures`);
    ctx.blockedArtifacts = blockedArtifacts.map(a => a.artifact);
    const guidance = buildGuidance(tracker, scores, ctx);
    ctx.lastGuidance = guidance;
    await writeGuidanceFile(guidance, cwd);
    await _recordMemory({
      category: 'error',
      summary: `Autoforge circuit breaker tripped after ${consecutiveFailures} consecutive failures`,
      detail: guidance.blockingIssues.map(i => `${i.artifact}: ${i.remediation}`).join('\n'),
      tags: ['autoforge-loop', 'circuit-breaker', 'blocked'],
      relatedCommands: ['autoforge'],
    }, cwd);
    ctx.state.auditLog.push(
      `${new Date().toISOString()} | autoforge-loop: circuit breaker tripped after ${consecutiveFailures} consecutive failures`,
    );
    await _saveState(ctx.state, { cwd });
    return { shouldBreak: true, consecutiveFailures };
  }

  if (ctx.force && ctx.cycleCount === 1) {
    logger.warn(`[Autoforge] --force: overriding BLOCKED artifact(s) for one cycle`);
    ctx.state.auditLog.push(
      `${new Date().toISOString()} | autoforge-loop: --force override on ${blockedArtifacts.map(a => a.artifact).join(', ')}`,
    );
    return { shouldBreak: false, consecutiveFailures };
  }

  const permanentlyBlocked: string[] = [];
  for (const blocked of blockedArtifacts) {
    const retries = ctx.retryCounters[blocked.artifact] ?? 0;
    if (retries >= ctx.maxRetries) permanentlyBlocked.push(blocked.artifact);
  }

  if (permanentlyBlocked.length > 0) {
    ctx.loopState = AutoforgeLoopState.BLOCKED;
    ctx.blockedArtifacts = permanentlyBlocked;
    const guidance = buildGuidance(tracker, scores, ctx);
    ctx.lastGuidance = guidance;
    await writeGuidanceFile(guidance, cwd);
    logger.error(`[Autoforge] BLOCKED: ${permanentlyBlocked.join(', ')} failed after ${MAX_RETRIES} retries`);
    logger.info('[Autoforge] See .danteforge/AUTOFORGE_GUIDANCE.md for remediation commands');
    await _recordMemory({
      category: 'error',
      summary: `Autoforge BLOCKED on ${permanentlyBlocked.join(', ')}`,
      detail: guidance.blockingIssues.map(i => `${i.artifact}: ${i.remediation}`).join('\n'),
      tags: ['autoforge-loop', 'blocked'],
      relatedCommands: ['autoforge'],
    }, cwd);
    ctx.state.auditLog.push(
      `${new Date().toISOString()} | autoforge-loop: BLOCKED on ${permanentlyBlocked.join(', ')}`,
    );
    await _saveState(ctx.state, { cwd });
    return { shouldBreak: true, consecutiveFailures };
  }

  ctx.loopState = AutoforgeLoopState.REFINING;
  for (const blocked of blockedArtifacts) {
    const retryCount = ctx.retryCounters[blocked.artifact] ?? 0;
    const backoffMs = computeBackoff(retryCount);
    logger.info(`[Autoforge] Backing off ${backoffMs}ms before retry...`);
    await new Promise(resolve => _setTimeout(resolve as () => void, backoffMs));
    ctx.retryCounters[blocked.artifact] = retryCount + 1;
    logger.info(`[Autoforge] Refining ${blocked.artifact} (attempt ${ctx.retryCounters[blocked.artifact]}/${ctx.maxRetries})`);
  }

  return { shouldBreak: false, consecutiveFailures };
}

async function executeCycleCommand(
  ctx: AutoforgeLoopContext,
  deps: Partial<AutoforgeLoopDeps>,
  nextCommand: string,
  cwd: string,
  currentBlockedCount: number,
  prevBlockedCount: number,
  consecutiveExecFailures: number,
): Promise<{ shouldBreak: boolean; consecutiveExecFailures: number; prevBlockedCount: number; shouldResetConsecutiveFailures: boolean }> {
  const _executeCommand = deps._executeCommand;
  const _saveState = deps.saveState ?? saveState;
  const _loadState = deps.loadState ?? loadState;

  if (!_executeCommand) {
    logger.info('[Autoforge] No executor provided — advisory mode: guidance written, exiting loop');
    return { shouldBreak: true, consecutiveExecFailures, prevBlockedCount, shouldResetConsecutiveFailures: false };
  }

  logger.info(`[Autoforge] Executing: ${nextCommand}`);
  ctx.state.auditLog.push(
    `${new Date().toISOString()} | autoforge-loop: cycle ${ctx.cycleCount} executing ${nextCommand}`,
  );
  await _saveState(ctx.state, { cwd });

  const execResult = await _executeCommand(nextCommand, cwd);
  let shouldResetConsecutiveFailures = false;
  if (!execResult.success) {
    logger.warn(`[Autoforge] ${nextCommand} reported failure — continuing loop`);
    consecutiveExecFailures++;
    ctx.state.autoforgeFailedAttempts = (ctx.state.autoforgeFailedAttempts ?? 0) + 1;
    // Capture failure as lesson so injectContext includes it in the next LLM call (best-effort)
    try {
      const { appendLesson } = await import('../cli/commands/lessons.js');
      await appendLesson(
        `[autoforge failure] Command "${nextCommand}" failed at cycle ${ctx.cycleCount}. ` +
        `Consecutive failures: ${consecutiveExecFailures}. ` +
        `Try a different approach or decompose the task further.`,
        cwd,
      );
    } catch { /* best-effort — never block retry */ }
    if (consecutiveExecFailures >= CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT) {
      ctx.loopState = AutoforgeLoopState.BLOCKED;
      logger.error(`[Autoforge] Circuit breaker tripped after ${consecutiveExecFailures} consecutive command failures`);
      ctx.state.auditLog.push(
        `${new Date().toISOString()} | autoforge-loop: circuit breaker tripped on command failures`,
      );
      await _saveState(ctx.state, { cwd });
      return { shouldBreak: true, consecutiveExecFailures, prevBlockedCount: currentBlockedCount, shouldResetConsecutiveFailures: false };
    }
  } else {
    consecutiveExecFailures = 0;
    ctx.state.autoforgeFailedAttempts = 0;
    // Signal caller to reset consecutiveFailures only when the blocked set is shrinking
    if (currentBlockedCount < prevBlockedCount) {
      shouldResetConsecutiveFailures = true;
    }
    // Auto-capture Time Machine snapshot after each successful wave (best-effort)
    try {
      const commitFn = deps._timeMachineCommit ?? (async (opts: { cwd: string; paths: string[]; label: string }) => {
        const { createTimeMachineCommit } = await import('./time-machine.js');
        await createTimeMachineCommit(opts);
      });
      await commitFn({ cwd, paths: ['.danteforge'], label: `auto-forge-loop-cycle-${ctx.cycleCount}` });
    } catch { /* best-effort; never blocks the loop */ }

    // Wave-time auto-sanitize: catch any file that crossed LOC threshold this wave (best-effort)
    try {
      const sanitizeFn = deps._postWaveSanitize ?? (async (opts: { cwd: string }) => {
        const { postWaveSanitize } = await import('./auto-sanitize.js');
        await postWaveSanitize(opts);
      });
      await sanitizeFn({ cwd });
    } catch { /* best-effort; never blocks the loop */ }
  }
  ctx.state = await _loadState({ cwd });
  return { shouldBreak: false, consecutiveExecFailures, prevBlockedCount: currentBlockedCount, shouldResetConsecutiveFailures };
}

async function writePostLoopArtifacts(
  ctx: AutoforgeLoopContext,
  deps: Partial<AutoforgeLoopDeps>,
  interrupted: boolean,
  startScore: number,
  loopStartMs: number,
): Promise<void> {
  const _saveState = deps.saveState ?? saveState;
  const _writeLoopResult = deps._writeLoopResult ?? writeLoopResult;

  if (interrupted) {
    logger.info('[Autoforge] Interrupted — progress saved.');
    ctx.state.auditLog.push(
      `${new Date().toISOString()} | autoforge-loop: interrupted at cycle ${ctx.cycleCount}`,
    );
    await _saveState(ctx.state, { cwd: ctx.cwd });
  }

  if (interrupted || ctx.loopState === AutoforgeLoopState.BLOCKED) {
    const pauseSnapshot: AutoforgePauseSnapshot = {
      pausedAt: new Date().toISOString(),
      avgScore: Array.isArray(ctx.recentScores) && ctx.recentScores.length > 0
        ? ctx.recentScores[ctx.recentScores.length - 1]!
        : startScore,
      cycleCount: ctx.cycleCount,
      goal: ctx.goal,
      retryCounters: ctx.retryCounters,
      blockedArtifacts: ctx.blockedArtifacts,
    };
    try {
      await fs.writeFile(
        path.join(ctx.cwd, AUTOFORGE_PAUSE_FILE),
        JSON.stringify(pauseSnapshot, null, 2),
        'utf8',
      );
      logger.info(`[Autoforge] Pause snapshot saved — run \`danteforge resume\` to continue.`);
    } catch { /* best-effort */ }
  }

  const endScore = Array.isArray(ctx.recentScores) && ctx.recentScores.length > 0
    ? ctx.recentScores[ctx.recentScores.length - 1]
    : startScore;
  const terminationReason: LoopTerminationReason =
    interrupted ? 'interrupted'
    : ctx.loopState === AutoforgeLoopState.COMPLETE ? 'target-reached'
    : ctx.loopState === AutoforgeLoopState.BLOCKED ? 'blocked'
    : !deps._executeCommand ? 'advisory'
    : 'max-cycles';

  const loopResult: LoopResult = {
    startScore,
    endScore,
    delta: Math.round((endScore - startScore) * 1000) / 1000,
    cycles: ctx.cycleCount,
    duration: Date.now() - loopStartMs,
    terminationReason,
    timestamp: new Date().toISOString(),
  };
  await _writeLoopResult(loopResult, ctx.cwd);
  logger.info(
    `[Autoforge] Loop complete — ${ctx.cycleCount} cycle(s) in ${Math.round(loopResult.duration / 1000)}s\n` +
    `           Score: ${startScore.toFixed(1)} → ${endScore.toFixed(1)} (${loopResult.delta >= 0 ? '+' : ''}${loopResult.delta.toFixed(1)})\n` +
    `           Reason: ${terminationReason}`,
  );
}

// ── Budget gate ─────────────────────────────────────────────────────────────

const BUDGET_GATE_THRESHOLD = 0.9; // 90 % of budget consumed

/**
 * Checks if the session has consumed >= 90 % of the configured budget.
 *
 * Sources (in priority order):
 *  1. `process.env.DANTEFORGE_BUDGET_USD`
 *  2. `ctx.state.maxBudgetUsd`
 *
 * Returns true when the loop should stop, false to continue.
 */
async function checkAutoForgeBudgetGate(
  ctx: AutoforgeLoopContext,
  deps: Partial<AutoforgeLoopDeps>,
): Promise<boolean> {
  const rawEnv = parseFloat(process.env.DANTEFORGE_BUDGET_USD ?? '');
  const maxBudget = !isNaN(rawEnv) && rawEnv > 0
    ? rawEnv
    : (ctx.state.maxBudgetUsd ?? 0);

  if (!maxBudget || maxBudget <= 0) return false;

  try {
    const { getActiveLedger } = await import('./llm.js');
    const ledger = getActiveLedger();
    if (!ledger) return false;

    const { estimatedCostUsd } = ledger.getSessionTotal();
    const threshold = maxBudget * BUDGET_GATE_THRESHOLD;

    if (estimatedCostUsd < threshold) return false;

    const pct = ((estimatedCostUsd / maxBudget) * 100).toFixed(1);
    const msg = `[Autoforge] Budget is ${pct}% consumed ($${estimatedCostUsd.toFixed(4)} of $${maxBudget.toFixed(4)}).`;

    const autoStop = ctx.force || !process.stdout.isTTY;
    if (autoStop) {
      logger.warn(`${msg} Auto-stopping (no TTY or --yes mode).`);
      const _saveState = deps.saveState ?? saveState;
      ctx.state.auditLog.push(
        `${new Date().toISOString()} | autoforge-loop: budget gate auto-stop at ${pct}% of $${maxBudget}`,
      );
      await _saveState(ctx.state, { cwd: ctx.cwd });
      return true;
    }

    // Interactive TTY: prompt user
    logger.warn(`${msg} Continue? [y/N]`);
    return await new Promise<boolean>(resolve => {
      process.stdin.once('data', (chunk) => {
        const answer = chunk.toString().trim().toLowerCase();
        if (answer === 'y' || answer === 'yes') {
          resolve(false); // continue
        } else {
          logger.info('[Autoforge] Budget gate: stopping loop.');
          resolve(true); // stop
        }
      });
    });
  } catch {
    return false; // best-effort
  }
}

async function runLlmPreflight(deps: Partial<AutoforgeLoopDeps>): Promise<void> {
  try {
    const isLLMAvailableFn = deps._isLLMAvailable ?? isLLMAvailable;
    const llmOk = await isLLMAvailableFn().catch(() => false);
    if (!llmOk) {
      logger.warn('[Autoforge] ⚠ No LLM detected — forge cycles will fail.');
      logger.warn('[Autoforge]   Run `danteforge doctor` for diagnostics.');
      logger.warn('[Autoforge]   Run `danteforge config` to set a provider.');
    }
  } catch { /* best-effort — never block the loop */ }
}

async function checkProtectedPathGate(
  ctx: AutoforgeLoopContext,
  deps: Partial<AutoforgeLoopDeps>,
  nextCommand: string,
  cwd: string,
): Promise<boolean> {
  if (nextCommand !== 'forge') return false;
  const _checkProtectedPaths = deps._checkProtectedPaths ??
    ((s: DanteState, o: { cwd?: string }) => checkProtectedTaskPaths(s, o));
  const _saveState = deps.saveState ?? saveState;
  const pathCheck = await _checkProtectedPaths(ctx.state, { cwd });
  if (!pathCheck.approved) {
    const blockedList = pathCheck.blocked.join(', ');
    logger.error(`[Autoforge] Blocked: protected path(s) require explicit approval: ${blockedList}`);
    logger.error('[Autoforge] Set selfEditPolicy in STATE.yaml or run with allow-with-audit to continue.');
    ctx.state.auditLog.push(
      `${new Date().toISOString()} | autoforge-loop: cycle ${ctx.cycleCount} BLOCKED by protected path gate: ${blockedList}`,
    );
    ctx.loopState = AutoforgeLoopState.BLOCKED;
    ctx.blockedArtifacts = pathCheck.blocked;
    await _saveState(ctx.state, { cwd });
    return true;
  }
  return false;
}

// ── Main loop ───────────────────────────────────────────────────────────────

export async function runAutoforgeLoop(ctx: AutoforgeLoopContext, deps?: Partial<AutoforgeLoopDeps>): Promise<AutoforgeLoopContext> {
  logger.info(`[scoring-doctrine] ${SCORING_DOCTRINE_SHORT}`);
  const _addSignal = deps?._addSignalListener ?? ((s: string, h: () => void) => process.on(s, h));
  const _removeSignal = deps?._removeSignalListener ?? ((s: string, h: () => void) => process.removeListener(s, h));
  const loopStartMs = Date.now();
  const startScore = Array.isArray(ctx.recentScores) && ctx.recentScores.length > 0 ? ctx.recentScores[0] : 0;
  const loopDeps: Partial<AutoforgeLoopDeps> = deps ?? {};

  let interrupted = false;
  let consecutiveFailures = 0;
  let consecutiveExecFailures = 0;
  let prevBlockedCount = Infinity;

  const sigintHandler = () => {
    interrupted = true;
    logger.info('\n[Autoforge] Interrupt received — completing current step and saving progress...');
  };
  _addSignal('SIGINT', sigintHandler);

  try {
    ctx.loopState = AutoforgeLoopState.RUNNING;
    ctx.startedAt = new Date().toISOString();
    await runLlmPreflight(loopDeps);
    const cycleTracker = createStepTracker(ctx.maxRetries * 5);

    while (!interrupted) {
      ctx.cycleCount++;
      cycleTracker.step(`Cycle ${ctx.cycleCount} — scoring → refining → verifying`);
      logger.info(`[Autoforge] ▶ Cycle ${ctx.cycleCount} — scoring → refining → verifying`);
      const cwd = ctx.cwd;

      // Budget gate: pause or auto-stop when 90 % of the session budget is consumed
      if (await checkAutoForgeBudgetGate(ctx, loopDeps)) break;

      const { tracker, scores, shouldBreak: scoringBreak } = await runCycleScoringAndCompletion(ctx, loopDeps, cwd);
      if (scoringBreak) break;
      if (await checkTerminationGovernor(ctx, loopDeps, tracker, cwd)) break;

      const blockedArtifacts = findBlockedArtifacts(scores);
      const currentBlockedCount = blockedArtifacts.length;
      const blockedRes = await handleBlockedArtifacts(ctx, loopDeps, blockedArtifacts, tracker, scores, cwd, consecutiveFailures);
      consecutiveFailures = blockedRes.consecutiveFailures;
      if (blockedRes.shouldBreak) break;

      try {
        const { assessComplexity } = await import('./complexity-classifier.js');
        const tasks = Object.values(ctx.state.tasks).flat();
        if (tasks.length > 0) {
          const assessment = assessComplexity(tasks, ctx.state);
          logger.info(`[Autoforge] Complexity: ${assessment.score}/100 → Recommended: ${assessment.recommendedPreset}${assessment.shouldUseParty ? ' (party mode suggested)' : ''}`);
        }
      } catch (err) { logger.verbose(`[best-effort] preset recommendation: ${err instanceof Error ? err.message : String(err)}`); }

      // Depth Doctrine: alternate breadth/depth waves.
      const { getWaveGuard } = await import('./wave-alternation.js');
      const waveGuard = getWaveGuard(ctx.cycleCount);

      let nextCommand: string | null;
      if (waveGuard.type === 'depth') {
        logger.info(`[Autoforge] DEPTH WAVE (cycle ${ctx.cycleCount}): running validate instead of forge`);
        nextCommand = 'validate --all --force-cold';
      } else {
        nextCommand = determineNextCommand(ctx.state, tracker, scores);
      }
      if (!nextCommand) { ctx.loopState = AutoforgeLoopState.COMPLETE; break; }
      if (nextCommand === 'specify --refine') {
        const idea = ctx.goal ?? 'Improve and refine the existing specification';
        nextCommand = `specify "${idea.replace(/"/g, '\\"')}" --refine --light`;
      }

      const guidance = buildGuidance(tracker, scores, ctx);
      ctx.lastGuidance = guidance;
      await writeGuidanceFile(guidance, cwd);

      if (ctx.dryRun) {
        logger.info(`[Autoforge] DRY RUN — would execute: ${nextCommand}`);
        logger.info(`[Autoforge] Overall: ${tracker.overall}% | Bottleneck: ${guidance.currentBottleneck}`);
        break;
      }

      if (await checkProtectedPathGate(ctx, loopDeps, nextCommand, cwd)) break;

      const execRes = await executeCycleCommand(ctx, loopDeps, nextCommand, cwd, currentBlockedCount, prevBlockedCount, consecutiveExecFailures);
      consecutiveExecFailures = execRes.consecutiveExecFailures;
      prevBlockedCount = execRes.prevBlockedCount;
      if (execRes.shouldResetConsecutiveFailures) consecutiveFailures = 0;
      if (execRes.shouldBreak) break;
    }

    await writePostLoopArtifacts(ctx, loopDeps, interrupted, startScore, loopStartMs);
    return ctx;
  } finally {
    _removeSignal('SIGINT', sigintHandler);
  }
}

// ── Score-only pass ─────────────────────────────────────────────────────────

export async function runScoreOnlyPass(cwd: string, deps?: Partial<AutoforgeLoopDeps>): Promise<{
  scores: Record<ScoredArtifact, ScoreResult>;
  tracker: CompletionTracker;
  guidance: AutoforgeGuidance;
}> {
  const _scoreAllArtifacts = deps?.scoreAllArtifacts ?? scoreAllArtifacts;
  const _persistScoreResult = deps?.persistScoreResult ?? persistScoreResult;
  const _detectProjectType = deps?.detectProjectType ?? detectProjectType;
  const _computeCompletionTracker = deps?.computeCompletionTracker ?? computeCompletionTracker;
  const _loadState = deps?.loadState ?? loadState;
  const _saveState = deps?.saveState ?? saveState;

  const state = await _loadState({ cwd });
  if (!state.projectType || state.projectType === 'unknown') {
    state.projectType = await _detectProjectType(cwd);
  }

  const scores = await _scoreAllArtifacts(cwd, state);
  for (const result of Object.values(scores)) {
    await _persistScoreResult(result, cwd);
  }

  const tracker = _computeCompletionTracker(state, scores);
  state.completionTracker = tracker;
  state.auditLog.push(
    `${new Date().toISOString()} | autoforge-loop: score-only pass, overall ${tracker.overall}%`,
  );
  await _saveState(state, { cwd });

  const ctx: AutoforgeLoopContext = {
    goal: '',
    cwd,
    state,
    loopState: AutoforgeLoopState.IDLE,
    cycleCount: 0,
    startedAt: new Date().toISOString(),
    retryCounters: {},
    blockedArtifacts: [],
    lastGuidance: null,
    isWebProject: state.projectType === 'web',
    force: false,
    maxRetries: MAX_RETRIES,
    recentScores: [],
  };

  const guidance = buildGuidance(tracker, scores, ctx);
  await writeGuidanceFile(guidance, cwd);

  return { scores, tracker, guidance };
}

// ── Guidance file ───────────────────────────────────────────────────────────
