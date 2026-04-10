// Autoforge v2 — Intelligent Autonomous Loop (IAL)
// State machine that drives the full pipeline toward completion.
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { loadState, saveState, type DanteState } from './state.js';
import { scoreAllArtifacts, persistScoreResult, computeAutoforgeDecision } from './pdse.js';
import type { ScoreResult, ScoredArtifact } from './pdse.js';
import { computeCompletionTracker, detectProjectType, type CompletionTracker } from './completion-tracker.js';
import { SCORE_THRESHOLDS, ARTIFACT_COMMAND_MAP, ANTI_STUB_PATTERNS } from './pdse-config.js';
import { logger } from './logger.js';
import { recordMemory } from './memory-engine.js';
import { emitScoreUpdate, emitCycleComplete } from './event-bus.js';
import { assessMaturity, type MaturityAssessment } from './maturity-engine.js';
import type { MaturityLevel } from './maturity-levels.js';
import { LINT_INTERVAL_CYCLES } from './wiki-schema.js';
import { wikiIngest, getWikiHealth } from './wiki-engine.js';
import { runLintCycle } from './wiki-linter.js';
import { detectAnomalies } from './pdse-anomaly.js';
import { createStepTracker, type StepTracker } from './progress.js';
import { evaluateTermination, scopeNextWave, type TerminationDecision } from './termination-governor.js';
import { WaveDeltaTracker } from './wave-delta-tracker.js';
import { withErrorHandling, withRetry, DanteError, ValidationError, TimeoutError } from './errors.js';
import { validateCompletion, type CompletionOracleResult } from './completion-oracle.js';
import { RunLedger } from './run-ledger.js';

// ── Elapsed time formatter ──────────────────────────────────────────────────

export function formatElapsed(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m${rem > 0 ? `${rem}s` : ''}`;
}

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
  lastOracleResult?: CompletionOracleResult;
  waveDeltaTracker?: WaveDeltaTracker;
  previousVerdicts?: CompletionVerdict[];
}

export const AUTOFORGE_PAUSE_FILE = '.danteforge/AUTOFORGE_PAUSED';

export interface AutoforgePauseSnapshot {
  pausedAt: string;
  avgScore: number;
  cycleCount: number;
  goal: string;
  retryCounters: Record<string, number>;
  blockedArtifacts: string[];
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
  maturityAssessment?: MaturityAssessment; // Maturity-aware quality scoring
}

export interface BlockingIssue {
  artifact: string;
  score: number;
  decision: string;
  remediation: string;
}

// ── Dependency injection interface ─────────────────────────────────────────

export interface AutoforgeLoopDeps {
  scoreAllArtifacts?: typeof import('./pdse.js').scoreAllArtifacts;
  persistScoreResult?: typeof import('./pdse.js').persistScoreResult;
  detectProjectType?: typeof import('./completion-tracker.js').detectProjectType;
  computeCompletionTracker?: typeof import('./completion-tracker.js').computeCompletionTracker;
  recordMemory?: typeof import('./memory-engine.js').recordMemory;
  loadState?: (opts?: { cwd?: string }) => Promise<DanteState>;
  saveState?: (state: DanteState, opts?: { cwd?: string }) => Promise<void>;
  setTimeout?: (fn: () => void, ms: number) => ReturnType<typeof globalThis.setTimeout>;
  _checkProtectedPaths?: (state: DanteState) => Promise<{ approved: boolean; blocked: string[] }>;
  _executeCommand?: (cmd: string, cwd: string) => Promise<{ success: boolean }>;
  _addSignalListener?: (event: string, fn: (...args: unknown[]) => void) => void;
  _removeSignalListener?: (event: string, fn: (...args: unknown[]) => void) => void;
  _syncContext?: (opts: { cwd: string; target: 'cursor' }) => Promise<void>;
  _existsSync?: (p: string) => boolean;
  _createStepTracker?: typeof createStepTracker;
}

// ── Protected path check ────────────────────────────────────────────────────

export interface CheckProtectedTaskPathsOptions {
  _requestApproval?: (
    file: string,
    reason: string,
    opts?: { policy: import('./safe-self-edit.js').SelfEditPolicy },
  ) => Promise<boolean>;
}

/**
 * Check if any tasks in the current phase touch protected paths.
 * Returns { approved: true, blocked: [] } if all paths are safe or approved.
 */
export async function checkProtectedTaskPaths(
  state: DanteState,
  opts?: CheckProtectedTaskPathsOptions,
): Promise<{ approved: boolean; blocked: string[] }> {
  const { isProtectedPath } = await import('./safe-self-edit.js');
  const policy = state.selfEditPolicy ?? 'deny';
  const phaseTasks = state.tasks[state.currentPhase] ?? [];
  const blocked: string[] = [];

  for (const task of phaseTasks) {
    for (const file of task.files ?? []) {
      if (!isProtectedPath(file)) continue;
      const requestApproval = opts?._requestApproval ?? (async (_f, _r, o) => {
        if (o?.policy === 'allow-with-audit') return true;
        return false;
      });
      const approved = await requestApproval(file, `Task "${task.name}" requires editing protected path`, { policy });
      if (!approved) blocked.push(file);
    }
  }

  return { approved: blocked.length === 0, blocked };
}

// ── Pipeline stages in order ────────────────────────────────────────────────

const PIPELINE_STAGES = [
  'review', 'constitution', 'specify', 'clarify', 'plan', 'tasks',
  'forge', 'verify', 'synthesize',
] as const;

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

// ── Main loop ───────────────────────────────────────────────────────────────

// Temporarily stubbed due to syntax errors
export async function runAutoforgeLoop(ctx: AutoforgeLoopContext, deps?: AutoforgeLoopDeps): Promise<AutoforgeLoopContext> {
  // TODO: Implement proper autoforge loop
  return ctx;
}

/*
// Temporarily commented out due to syntax errors
  // Step tracker for progress display (injected or auto-created)
  const createTrackerFn = deps?._createStepTracker ?? createStepTracker;
  const stepTracker = ctx._stepTracker ?? createTrackerFn(10);

  // Validate context
  if (!ctx.goal || ctx.goal.trim().length === 0) {
    throw new ValidationError('Goal is required for autoforge loop', 'goal');
  }
  if (!ctx.cwd || ctx.cwd.trim().length === 0) {
    throw new ValidationError('Working directory is required', 'cwd');
  }

    while (!interrupted) {
      ctx.cycleCount++;
      stepTracker.step(`Cycle ${ctx.cycleCount} — scoring artifacts`);

      // 1. Score all artifacts
      ctx.loopState = AutoforgeLoopState.SCORING;
      const cwd = ctx.cwd;
      const scores = await withRetry(
        () => scoreAllArtifactsFn(cwd, ctx.state),
        'score-all-artifacts',
        2,
        500,
        { cwd, cycle: ctx.cycleCount }
      );
      for (const result of Object.values(scores)) {
        await persistScoreResultFn(result, cwd);
      }

      // 1a. PDSE anomaly detection (best-effort — never blocks loop)
      try {
        const anomalyFlags = await Promise.all(
          Object.entries(scores).map(([artifact, result]) =>
            detectAnomalies(artifact, result.score, { cwd }),
          ),
        );
        const activeFlags = anomalyFlags.filter(Boolean);
        if (activeFlags.length > 0) {
          for (const flag of activeFlags) {
            logger.warn(`[Wiki] PDSE anomaly: ${flag!.artifact} jumped ${flag!.delta > 0 ? '+' : ''}${flag!.delta} pts (avg: ${flag!.previousAvg})`);
            ctx.state.auditLog.push(
              `${new Date().toISOString()} | wiki-anomaly: ${flag!.artifact} delta=${flag!.delta} avg=${flag!.previousAvg}`,
            );
          }
        }
      } catch {
        // Non-fatal
      }

      // 1b. Wiki lint every LINT_INTERVAL_CYCLES cycles (best-effort)
      if (ctx.cycleCount % LINT_INTERVAL_CYCLES === 0) {
        try {
          await runLintCycle({ cwd, heuristicOnly: true });
          logger.info(`[Wiki] Lint cycle completed (cycle ${ctx.cycleCount})`);
      } catch {
        // Non-fatal
      }

      // 6. Evidence-based termination check using completion oracle
      if (ctx.lastOracleResult && ctx.waveDeltaTracker) {
        const terminationContext = {
          cycleCount: ctx.cycleCount,
          maxCycles: opts.maxCycles || 20,
          verdict: ctx.lastOracleResult.verdict,
          gapReport: {
            score: 100 - ctx.lastOracleResult.score,
            confirmedGaps: ctx.lastOracleResult.reasons,
            suspectedHiddenGaps: [],
            regressions: [],
            staleTruthSurfaces: [],
            missingTests: [],
            missingWiring: [],
            recommendations: ctx.lastOracleResult.recommendations
          } as any,
          previousVerdicts: ctx.previousVerdicts || [],
          startTime: ctx.startedAt,
          lastProgressTime: new Date().toISOString()
        };

        const terminationDecision = await evaluateTermination(terminationContext);

        if (terminationDecision.terminate) {
          ctx.loopState = AutoforgeLoopState.COMPLETE;
          ctx.finalDecision = 'terminated';
          ctx.terminationReason = terminationDecision.reason;
          ctx.terminationDecision = terminationDecision;
          logger.info(`[Autoforge] Termination governor: ${terminationDecision.reason} (confidence: ${(terminationDecision.confidence * 100).toFixed(1)}%)`);
          await emitCycleComplete(ctx.cycleCount, tracker.overall);
          break;
        }
      }

      // 2. Compute completion
      if (!ctx.state.projectType || ctx.state.projectType === 'unknown') {
        ctx.state.projectType = await detectProjectTypeFn(cwd);
      }
      const tracker = computeCompletionTrackerFn(ctx.state, scores);
      ctx.state.completionTracker = tracker;

      // Compute avg score for ROI / auto-lessons / pause-at checks
      const scoreValues = Object.values(scores).map(r => r.score);
      const avgScore = scoreValues.length > 0 ? Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length) : 0;

      // 2a. PDSE snapshot for VS Code status bar (best-effort)
      try {
        const { writePdseSnapshot } = await import('./pdse-snapshot.js');
        await writePdseSnapshot(scores, cwd);
      } catch {
        // Non-fatal
      }

      // 2b. Auto-lessons: detect regressions and record lessons (best-effort)
      try {
        const { detectLessonEvents, captureAutoLesson } = await import('./auto-lessons.js');
        const events = detectLessonEvents(
          ctx.prevToolchainMetrics ?? null,
          null,
          ctx.prevAvgScore ?? null,
          avgScore,
        );
        for (const event of events) {
          await captureAutoLesson(event, {
            artifact: 'autoforge',
            prevValue: ctx.prevAvgScore ?? undefined,
            currValue: avgScore,
            cycleCount: ctx.cycleCount,
            cwd,
          });
        }
        ctx.prevAvgScore = avgScore;
      } catch {
        // Non-fatal
      }

      // 2c. Token ROI tracking — real spend from cost reports (best-effort)
      await withErrorHandling(async () => {
        const { buildROIEntry, appendROIEntry } = await import('./token-roi.js');

        // Try to get real token data from the latest cost report written by forge/party subprocess
        let tokensSpent = 0;
        let cycleSpendUsd = 0;
        try {
          const reportsDir = path.join(cwd, '.danteforge', 'reports');
          const files = (await fs.readdir(reportsDir).catch(() => [] as string[]))
            .filter(f => f.startsWith('cost-'))
            .sort();
          const latest = files.at(-1);
          if (latest) {
            const raw = await fs.readFile(path.join(reportsDir, latest), 'utf8');
            const report = JSON.parse(raw) as { totalInputTokens?: number; totalOutputTokens?: number; totalCostUsd?: number };
            tokensSpent = (report.totalInputTokens ?? 0) + (report.totalOutputTokens ?? 0);
            cycleSpendUsd = report.totalCostUsd ?? 0;
          }

          // Fall back to token estimator if no report available
          if (tokensSpent === 0) {
            tokensSpent = ctx._estimateTokens ? ctx._estimateTokens() : 0;
          }

          ctx.totalSpendUsd = (ctx.totalSpendUsd ?? 0) + cycleSpendUsd;

          // Budget enforcement
          if (ctx.maxBudgetUsd && ctx.totalSpendUsd && ctx.totalSpendUsd >= ctx.maxBudgetUsd) {
            logger.warn(`[Autoforge] Budget limit reached ($${ctx.totalSpendUsd.toFixed(2)}/$${ctx.maxBudgetUsd.toFixed(2)}) — stopping loop`);
            ctx.loopState = AutoforgeLoopState.COMPLETE;
            break;
          }

          if (tokensSpent > 0 && ctx.prevAvgScore !== undefined) {
            const entry = buildROIEntry(ctx.cycleCount, tokensSpent, ctx.prevAvgScore, avgScore);
            await appendROIEntry(entry, cwd);
          }
        } catch {
          // Non-fatal
        }

      // 2d. Pause-at-score check (Wave 4 escape hatch)
      if (ctx.pauseAtScore !== undefined && avgScore >= ctx.pauseAtScore) {
        const writePauseFile = ctx._writePauseFile ?? ((p, c) => fs.writeFile(p, c, 'utf8'));
        try {
          const pauseSnapshot: AutoforgePauseSnapshot = {
            pausedAt: new Date().toISOString(),
            avgScore,
            cycleCount: ctx.cycleCount,
            goal: ctx.goal,
            retryCounters: ctx.retryCounters,
            blockedArtifacts: ctx.blockedArtifacts,
          };
          const pauseFilePath = path.join(cwd, AUTOFORGE_PAUSE_FILE);
          await fs.mkdir(path.dirname(pauseFilePath), { recursive: true });
          await writePauseFile(pauseFilePath, JSON.stringify(pauseSnapshot, null, 2));
          logger.success(`[Autoforge] Score ${avgScore} >= pause target ${ctx.pauseAtScore} — paused. Run: danteforge resume`);
          ctx.loopState = AutoforgeLoopState.COMPLETE;
          ctx.state.auditLog.push(
            `${new Date().toISOString()} | autoforge-loop: paused at score ${avgScore} (target ${ctx.pauseAtScore})`,
          );
          await saveStateFn(ctx.state, { cwd });
        } catch {
          // Non-fatal — if write fails, keep going
        }
        if (ctx.loopState === AutoforgeLoopState.COMPLETE) break;
      }

      const spendStr = ctx.totalSpendUsd && ctx.totalSpendUsd > 0
        ? ` | $${ctx.totalSpendUsd.toFixed(3)} spent`
        : '';
      logger.info(`[Autoforge] Cycle ${ctx.cycleCount} — score: ${avgScore}% avg | completion: ${tracker.overall}%${spendStr} | elapsed: ${formatElapsed(ctx.startedAt)}`);
      emitScoreUpdate('completion', tracker.overall);
      emitCycleComplete(ctx.cycleCount, tracker.overall);

      // 3. Check completion threshold
      if (tracker.overall >= COMPLETION_THRESHOLD) {
        ctx.loopState = AutoforgeLoopState.COMPLETE;
        const elapsed = formatElapsed(ctx.startedAt);
        const totalSpendStr = ctx.totalSpendUsd && ctx.totalSpendUsd > 0
          ? ` | total: $${ctx.totalSpendUsd.toFixed(3)}`
          : '';
        logger.success(`[Autoforge] Overall completion: ${tracker.overall}% — target reached! (${ctx.cycleCount} cycles, ${elapsed}${totalSpendStr})`);

        // Write final guidance (include maturity assessment if available)
        const { maturityAssessment: finalMaturity } = await findBlockedArtifactsWithMaturity(scores, ctx);
        const guidance = buildGuidance(tracker, scores, ctx, finalMaturity);
        ctx.lastGuidance = guidance;
        await writeGuidanceFile(guidance, cwd);

        // Print summary table
        printSummaryTable(scores);

        // Record to memory
        await recordMemoryFn({
          category: 'decision',
          summary: `Autoforge loop completed at ${tracker.overall}% after ${ctx.cycleCount} cycles`,
          detail: `Goal: ${ctx.goal}. Projected: ${tracker.projectedCompletion}`,
          tags: ['autoforge-loop', 'complete'],
          relatedCommands: ['autoforge'],
        }, cwd);

        // Save state
        ctx.state.auditLog.push(
          `${new Date().toISOString()} | autoforge-loop: COMPLETE at ${tracker.overall}% after ${ctx.cycleCount} cycles`,
        );
        await saveStateFn(ctx.state, { cwd });

        break;
      }

      // 4. Find blocking artifacts (maturity-aware)
      const { blocked: blockedArtifacts, maturityAssessment } = await findBlockedArtifactsWithMaturity(scores, ctx);

      // 5. Handle BLOCKED state
      if (blockedArtifacts.length > 0) {
        consecutiveFailures++;

        // Circuit breaker: trip if consecutive failures exceed limit
        if (consecutiveFailures >= CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT) {
          ctx.loopState = AutoforgeLoopState.BLOCKED;
          logger.error(`[Autoforge] Circuit breaker tripped — ${consecutiveFailures} consecutive failures`);

          ctx.blockedArtifacts = blockedArtifacts.map(a => a.artifact);
          const guidance = buildGuidance(tracker, scores, ctx, maturityAssessment);
          ctx.lastGuidance = guidance;
          await writeGuidanceFile(guidance, cwd);

          await recordMemoryFn({
            category: 'error',
            summary: `Autoforge circuit breaker tripped after ${consecutiveFailures} consecutive failures`,
            detail: guidance.blockingIssues.map(i => `${i.artifact}: ${i.remediation}`).join('\n'),
            tags: ['autoforge-loop', 'circuit-breaker', 'blocked'],
            relatedCommands: ['autoforge'],
          }, cwd);

          ctx.state.auditLog.push(
            `${new Date().toISOString()} | autoforge-loop: circuit breaker tripped after ${consecutiveFailures} consecutive failures`,
          );
          await saveStateFn(ctx.state, { cwd });

          break;
        }

        // Check if force flag allows one override
        if (ctx.force && ctx.cycleCount === 1) {
          logger.warn(`[Autoforge] --force: overriding BLOCKED artifact(s) for one cycle`);
          ctx.state.auditLog.push(
            `${new Date().toISOString()} | autoforge-loop: --force override on ${blockedArtifacts.map(a => a.artifact).join(', ')}`,
          );
        } else {
          // Check retry limits
          const permanentlyBlocked: string[] = [];
          for (const blocked of blockedArtifacts) {
            const retries = ctx.retryCounters[blocked.artifact] ?? 0;
            if (retries >= ctx.maxRetries) {
              permanentlyBlocked.push(blocked.artifact);
            }
          }

          if (permanentlyBlocked.length > 0) {
            ctx.loopState = AutoforgeLoopState.BLOCKED;
            ctx.blockedArtifacts = permanentlyBlocked;

            const guidance = buildGuidance(tracker, scores, ctx, maturityAssessment);
            ctx.lastGuidance = guidance;
            await writeGuidanceFile(guidance, cwd);

            logger.error(`[Autoforge] BLOCKED: ${permanentlyBlocked.join(', ')} failed after ${MAX_RETRIES} retries`);
            logger.info('[Autoforge] See .danteforge/AUTOFORGE_GUIDANCE.md for remediation commands');

            await recordMemoryFn({
              category: 'error',
              summary: `Autoforge BLOCKED on ${permanentlyBlocked.join(', ')}`,
              detail: guidance.blockingIssues.map(i => `${i.artifact}: ${i.remediation}`).join('\n'),
              tags: ['autoforge-loop', 'blocked'],
              relatedCommands: ['autoforge'],
            }, cwd);

            ctx.state.auditLog.push(
              `${new Date().toISOString()} | autoforge-loop: BLOCKED on ${permanentlyBlocked.join(', ')}`,
            );
            await saveStateFn(ctx.state, { cwd });

            break;
          }

          // Try refining blocked artifacts — apply exponential backoff before retry
          ctx.loopState = AutoforgeLoopState.REFINING;
          for (const blocked of blockedArtifacts) {
            const retryCount = ctx.retryCounters[blocked.artifact] ?? 0;
            const backoffMs = computeBackoff(retryCount);
            logger.info(`[Autoforge] Backing off ${backoffMs}ms before retry...`);
            await new Promise<void>(resolve => setTimeoutFn(resolve, backoffMs));

            ctx.retryCounters[blocked.artifact] = retryCount + 1;
            logger.info(`[Autoforge] Refining ${blocked.artifact} (attempt ${ctx.retryCounters[blocked.artifact]}/${ctx.maxRetries})`);
          }
        }
      } else {
        // No blocking artifacts — reset consecutive failure counter
        consecutiveFailures = 0;
      }

      // 6. Determine next command
      const nextCommand = determineNextCommand(ctx.state, tracker, scores);
      if (!nextCommand) {
        ctx.loopState = AutoforgeLoopState.COMPLETE;
        break;
      }

      // 6b. Protected path gate — only checked when about to forge
      if (nextCommand.includes('forge') && !ctx.dryRun) {
        const checkFn = deps?._checkProtectedPaths ?? ((s: DanteState) => checkProtectedTaskPaths(s));
        try {
          const { approved, blocked: protectedBlocked } = await checkFn(ctx.state);
          if (!approved) {
            ctx.loopState = AutoforgeLoopState.BLOCKED;
            ctx.blockedArtifacts = protectedBlocked;
            ctx.state.auditLog.push(
              `${new Date().toISOString()} | autoforge-loop: BLOCKED by protected path gate: ${protectedBlocked.join(', ')}`,
            );
            await saveStateFn(ctx.state, { cwd });
            break;
          }
        } catch {
          // Non-fatal - protected path check failures shouldn't stop the loop
        }

      // 7. Write guidance
      const guidance = buildGuidance(tracker, scores, ctx);
      ctx.lastGuidance = guidance;
      await writeGuidanceFile(guidance, cwd);

      // 8. Execute (or dry-run)
      if (ctx.dryRun) {
        logger.info(`[Autoforge] DRY RUN — would execute: ${nextCommand}`);
        logger.info(`[Autoforge] Overall: ${tracker.overall}% | Bottleneck: ${guidance.currentBottleneck}`);
        break;
      }

      // Advisory mode: if no executor provided, write guidance and break
      if (!executeCommandFn) {
        logger.info(`[Autoforge] Advisory mode — next command: ${nextCommand}`);
        logger.info('[Autoforge] No executor provided. See .danteforge/AUTOFORGE_GUIDANCE.md for commands.');
        break;
      }

      logger.info(`[Autoforge] Executing: ${nextCommand}`);
      ctx.state.auditLog.push(
        `${new Date().toISOString()} | autoforge-loop: cycle ${ctx.cycleCount} executing ${nextCommand}`,
      );
      await saveStateFn(ctx.state, { cwd });

      const execResult = await executeCommandFn(nextCommand, cwd);
      if (execResult.success) {
        consecutiveExecFailures = 0;
      } else {
        consecutiveExecFailures++;
        logger.warn(`[Autoforge] Command failed: ${nextCommand} (consecutive failures: ${consecutiveExecFailures})`);
        if (consecutiveExecFailures >= CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT) {
          ctx.loopState = AutoforgeLoopState.BLOCKED;
          ctx.state.auditLog.push(
            `${new Date().toISOString()} | autoforge-loop: execution circuit breaker tripped after ${consecutiveExecFailures} failures`,
          );
          await saveStateFn(ctx.state, { cwd });
          break;
        }
      }

      // Reload state after execution
      ctx.state = await loadStateFn({ cwd });

      // Post-execution wiki ingestion (best-effort — never blocks loop)
      try {
        await wikiIngest({ cwd });
      } catch {
        // Non-fatal
      }

      // Auto-sync Cursor context after each wave (best-effort — never blocks loop)
      try {
        const hasCursor = (deps?._existsSync ?? existsSync)(path.join(cwd, '.cursor'));
        if (hasCursor) {
          const syncFn = deps?._syncContext ?? (async (opts: { cwd: string; target: 'cursor' }) => {
            const { syncContext } = await import('./context-syncer.js');
            await syncContext(opts);
          });
          await syncFn({ cwd, target: 'cursor' });
        }
      } catch (error) {
        // Non-fatal — cursor sync failures shouldn't stop the loop
        logger.debug(`Cursor sync failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (interrupted) {
      const elapsed = formatElapsed(ctx.startedAt);
      const interruptSpendStr = ctx.totalSpendUsd && ctx.totalSpendUsd > 0
        ? ` | $${ctx.totalSpendUsd.toFixed(3)} spent`
        : '';
      logger.info(`[Autoforge] Interrupted after ${ctx.cycleCount} cycles (${elapsed}${interruptSpendStr}) — progress saved.`);
      ctx.state.auditLog.push(
        `${new Date().toISOString()} | autoforge-loop: interrupted at cycle ${ctx.cycleCount}`,
      );
      await saveStateFn(ctx.state, { cwd: ctx.cwd });
    }

    return ctx;

    // Cleanup
    removeListener('SIGINT', sigintHandler);
    if (process.platform !== 'win32') {
      removeListener('SIGTERM', sigintHandler);
    }
}, 'autoforge-loop', { cwd: ctx.cwd });

// ── Score-only pass ─────────────────────────────────────────────────────────

// Temporarily commented out due to syntax errors
// export async function runScoreOnlyPass(cwd: string, deps?: Partial<AutoforgeLoopDeps>): Promise<{
//   scores: Record<ScoredArtifact, ScoreResult>;
//   tracker: CompletionTracker;
//   guidance: AutoforgeGuidance;
// }> {
  const loadStateFn = deps?.loadState ?? loadState;
  const detectProjectTypeFn = deps?.detectProjectType ?? detectProjectType;
  const scoreAllArtifactsFn = deps?.scoreAllArtifacts ?? scoreAllArtifacts;
  const persistScoreResultFn = deps?.persistScoreResult ?? persistScoreResult;
  const computeCompletionTrackerFn = deps?.computeCompletionTracker ?? computeCompletionTracker;
  const saveStateFn = deps?.saveState ?? saveState;

  const state = await loadStateFn({ cwd });
  if (!state.projectType || state.projectType === 'unknown') {
    state.projectType = await detectProjectTypeFn(cwd);
  }

  const scores = await scoreAllArtifactsFn(cwd, state);
  for (const result of Object.values(scores)) {
    await persistScoreResultFn(result, cwd);
  }

  const tracker = computeCompletionTrackerFn(state, scores);
  state.completionTracker = tracker;
  state.auditLog.push(
    `${new Date().toISOString()} | autoforge-loop: score-only pass, overall ${tracker.overall}%`,
  );
  await saveStateFn(state, { cwd });

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
  };

  const guidance = buildGuidance(tracker, scores, ctx);
  await writeGuidanceFile(guidance, cwd);

  return { scores, tracker, guidance };
}

// ── Guidance file ───────────────────────────────────────────────────────────

export async function writeGuidanceFile(guidance: AutoforgeGuidance, cwd: string): Promise<void> {
  const content = formatGuidanceMarkdown(guidance);
  const filePath = path.join(cwd, '.danteforge', 'AUTOFORGE_GUIDANCE.md');
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

export function formatGuidanceMarkdown(guidance: AutoforgeGuidance): string {
  const lines: string[] = [
    '# Autoforge Guidance',
    '',
    `**Generated:** ${guidance.timestamp}`,
    `**Overall Completion:** ${guidance.overallCompletion}%`,
    `**Current Bottleneck:** ${guidance.currentBottleneck}`,
    `**Recommended Action:** \`${guidance.recommendedCommand}\``,
    `**Reason:** ${guidance.recommendedReason}`,
    `**Auto-Advance Eligible:** ${guidance.autoAdvanceEligible ? 'Yes' : 'No'}`,
  ];

  if (guidance.autoAdvanceBlockReason) {
    lines.push(`**Block Reason:** ${guidance.autoAdvanceBlockReason}`);
  }

  lines.push(`**Estimated Steps to Completion:** ${guidance.estimatedStepsToCompletion}`);
  lines.push('');

  // Maturity assessment section
  if (guidance.maturityAssessment) {
    const m = guidance.maturityAssessment;
    const levelNames: Record<MaturityLevel, string> = {
      1: 'Sketch', 2: 'Prototype', 3: 'Alpha', 4: 'Beta', 5: 'Customer-Ready', 6: 'Enterprise-Grade',
    };
    lines.push('## Maturity Assessment');
    lines.push('');
    lines.push(`**Current Level:** ${levelNames[m.currentLevel]} (${m.currentLevel}/6)`);
    lines.push(`**Target Level:** ${levelNames[m.targetLevel]} (${m.targetLevel}/6)`);
    lines.push(`**Overall Score:** ${m.overallScore}/100`);
    lines.push(`**Recommendation:** ${m.recommendation}`);
    lines.push('');

    if (m.gaps.length > 0) {
      lines.push('### Quality Gaps');
      lines.push('');
      lines.push('| Dimension | Current | Target | Gap | Severity |');
      lines.push('|-----------|---------|--------|-----|----------|');
      for (const gap of m.gaps) {
        lines.push(`| ${gap.dimension} | ${gap.currentScore} | ${gap.targetScore} | ${gap.gapSize} | ${gap.severity} |`);
      }
      lines.push('');
    }
  }

  if (guidance.blockingIssues.length > 0) {
    lines.push('## Blocking Issues');
    lines.push('');
    lines.push('| Artifact | Score | Decision | Remediation |');
    lines.push('|----------|-------|----------|-------------|');
    for (const issue of guidance.blockingIssues) {
      lines.push(`| ${issue.artifact} | ${issue.score} | ${issue.decision} | \`${issue.remediation}\` |`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('*Generated by DanteForge Autoforge v2 IAL*');

  return lines.join('\n');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function findBlockedArtifacts(
  scores: Record<ScoredArtifact, ScoreResult>,
): BlockingIssue[] {
  const blocked: BlockingIssue[] = [];
  for (const [name, result] of Object.entries(scores)) {
    if (result.score < SCORE_THRESHOLDS.NEEDS_WORK) {
      const command = ARTIFACT_COMMAND_MAP[name as ScoredArtifact] ?? name.toLowerCase();
      blocked.push({
        artifact: name,
        score: result.score,
        decision: result.autoforgeDecision,
        remediation: `danteforge ${command} --refine`,
      });
    }
  }
  return blocked;
}

async function findBlockedArtifactsWithMaturity(
  scores: Record<ScoredArtifact, ScoreResult>,
  ctx: AutoforgeLoopContext,
): Promise<{ blocked: BlockingIssue[]; maturityAssessment?: MaturityAssessment }> {
  const blocked: BlockingIssue[] = findBlockedArtifacts(scores);

  // Maturity-aware override: If target maturity level is met, proceed even if PDSE < 95
  let maturityAssessment: MaturityAssessment | undefined;
  if (ctx.targetMaturityLevel) {
    const assessMaturityFn = ctx._assessMaturity ?? assessMaturity;
    try {
      maturityAssessment = await assessMaturityFn({
        cwd: ctx.cwd,
        state: ctx.state,
        pdseScores: scores,
        targetLevel: ctx.targetMaturityLevel,
      });

      // If current maturity >= target, override PDSE blocking
      if (maturityAssessment.currentLevel >= maturityAssessment.targetLevel) {
        logger.info(`[Autoforge] Maturity target met (${maturityAssessment.currentLevel}/${maturityAssessment.targetLevel}) - proceeding despite PDSE score`);
        return { blocked: [], maturityAssessment };
      }

      // If maturity recommendation is 'blocked', add critical gaps to blocking issues
      if (maturityAssessment.recommendation === 'blocked') {
        const criticalGaps = maturityAssessment.gaps.filter(g => g.severity === 'critical');
        for (const gap of criticalGaps) {
          blocked.push({
            artifact: `maturity:${gap.dimension}`,
            score: gap.currentScore,
            decision: 'blocked',
            remediation: gap.recommendation,
          });
        }
      }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`[Autoforge] Loop error: ${errorMessage}`);
    stopReason = 'error';

    // Record error in context
    ctx.error = err instanceof Error ? err : new Error(errorMessage);
  }
  }

  return { blocked, maturityAssessment };
}

export function determineNextCommand(
  state: DanteState,
  tracker: CompletionTracker,
  scores: Record<ScoredArtifact, ScoreResult>,
): string | null {
  // Priority 1: Planning phase incomplete
  if (!tracker.phases.planning.complete) {
    for (const artifact of ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'] as ScoredArtifact[]) {
      const score = scores[artifact];
      if (score.score < SCORE_THRESHOLDS.ACCEPTABLE) {
        return ARTIFACT_COMMAND_MAP[artifact];
      }
    }
  }

  // Priority 2: Execution phase
  if (!tracker.phases.execution.complete) {
    return 'forge';
  }

  // Priority 3: Verification phase
  if (!tracker.phases.verification.complete) {
    return 'verify';
  }

  // Priority 4: Synthesis phase
  if (!tracker.phases.synthesis.complete) {
    return 'synthesize';
  }

  return null;
}

export function computeEstimatedSteps(ctx: AutoforgeLoopContext): number {
  const tracker = ctx.state.completionTracker;
  if (!tracker) return PIPELINE_STAGES.length;

  let steps = 0;
  if (!tracker.phases.planning.complete) {
    const incomplete = Object.values(tracker.phases.planning.artifacts)
      .filter(a => !a.complete).length;
    steps += incomplete;
  }
  if (!tracker.phases.execution.complete) {
    steps += tracker.phases.execution.totalWaves - tracker.phases.execution.wavesComplete;
  }
  if (!tracker.phases.verification.complete) steps += 1;
  if (!tracker.phases.synthesis.complete) steps += 1;
  return Math.max(1, steps);
}

export function buildGuidance(
  tracker: CompletionTracker,
  scores: Record<ScoredArtifact, ScoreResult>,
  ctx: AutoforgeLoopContext,
  maturityAssessment?: MaturityAssessment,
): AutoforgeGuidance {
  // Note: findBlockedArtifacts is now async, but this function is called from sync contexts
  // We use the maturityAssessment passed in instead of calling it again
  const blockingIssues: BlockingIssue[] = [];
  for (const [name, result] of Object.entries(scores)) {
    if (result.score < SCORE_THRESHOLDS.NEEDS_WORK) {
      const command = ARTIFACT_COMMAND_MAP[name as ScoredArtifact] ?? name.toLowerCase();
      blockingIssues.push({
        artifact: name,
        score: result.score,
        decision: result.autoforgeDecision,
        remediation: `danteforge ${command} --refine`,
      });
    }
  }

  const bottleneck = findBottleneck(tracker, scores);
  const nextCommand = determineNextCommand(ctx.state, tracker, scores) ?? 'ship --dry-run';
  const estimatedSteps = computeEstimatedSteps(ctx);
  const autoAdvanceEligible = blockingIssues.length === 0 && tracker.overall < COMPLETION_THRESHOLD;

  const guidance = buildGuidance(tracker, scores, ctx);

//   return {
//     scores,
//     tracker,
//     guidance,
//   };
// }

export function findBottleneck(
  tracker: CompletionTracker,
  scores: Record<ScoredArtifact, ScoreResult>,
): string {
  // Find lowest scoring artifact
  let lowestArtifact = '';
  let lowestScore = Infinity;
  for (const [name, result] of Object.entries(scores)) {
    if (result.score < lowestScore) {
      lowestScore = result.score;
      lowestArtifact = name;
    }
  }

  if (lowestScore < SCORE_THRESHOLDS.NEEDS_WORK) {
    return `${lowestArtifact} (score: ${lowestScore}, blocked)`;
  }
  if (!tracker.phases.planning.complete) return 'Planning phase incomplete';
  if (!tracker.phases.execution.complete) return 'Execution phase incomplete';
  if (!tracker.phases.verification.complete) return 'Verification phase incomplete';
  if (!tracker.phases.synthesis.complete) return 'Synthesis phase incomplete';
  return 'None';
}

export function getRecommendationReason(
  tracker: CompletionTracker,
  blockingIssues: BlockingIssue[],
): string {
  if (blockingIssues.length > 0) {
    return `${blockingIssues.length} artifact(s) need remediation before advancement`;
  }
  if (!tracker.phases.planning.complete) return 'Complete planning artifacts to advance';
  if (!tracker.phases.execution.complete) return 'Execute remaining forge waves';
  if (!tracker.phases.verification.complete) return 'Run verification checks';
  if (!tracker.phases.synthesis.complete) return 'Generate synthesis report';
  return 'Project ready for ship';
}
*/

/*
function printSummaryTable(scores: Record<ScoredArtifact, ScoreResult>): void {
  logger.info('\n┌────────────────┬───────┬──────────┐');
  logger.info('│ Artifact       │ Score │ Decision │');
  logger.info('├────────────────┼───────┼──────────┤');
  for (const [name, result] of Object.entries(scores)) {
    const paddedName = name.padEnd(14);
    const paddedScore = String(result.score).padStart(5);
    const paddedDecision = result.autoforgeDecision.padEnd(8);
    logger.info(`│ ${paddedName} │ ${paddedScore} │ ${paddedDecision} │`);
  }
  logger.info('└────────────────┴───────┴──────────┘');
}
*/
