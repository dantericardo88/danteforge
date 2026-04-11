// Autoforge v2 — Intelligent Autonomous Loop (IAL)
// State machine that drives the full pipeline toward completion.
import fs from 'fs/promises';
import path from 'path';
import { loadState, saveState, type DanteState } from './state.js';
import { scoreAllArtifacts, persistScoreResult, computeAutoforgeDecision } from './pdse.js';
import type { ScoreResult, ScoredArtifact } from './pdse.js';
import { computeCompletionTracker, detectProjectType, type CompletionTracker, type ProjectType } from './completion-tracker.js';
import { SCORE_THRESHOLDS, ARTIFACT_COMMAND_MAP, ANTI_STUB_PATTERNS } from './pdse-config.js';
import { logger } from './logger.js';
import { recordMemory } from './memory-engine.js';
import { isProtectedPath, requestSelfEditApproval, type SelfEditPolicy } from './safe-self-edit.js';

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

export async function runAutoforgeLoop(ctx: AutoforgeLoopContext, deps?: Partial<AutoforgeLoopDeps>): Promise<AutoforgeLoopContext> {
  // Resolve deps with defaults
  const _scoreAllArtifacts = deps?.scoreAllArtifacts ?? scoreAllArtifacts;
  const _persistScoreResult = deps?.persistScoreResult ?? persistScoreResult;
  const _detectProjectType = deps?.detectProjectType ?? detectProjectType;
  const _computeCompletionTracker = deps?.computeCompletionTracker ?? computeCompletionTracker;
  const _recordMemory = deps?.recordMemory ?? recordMemory;
  const _loadState = deps?.loadState ?? loadState;
  const _saveState = deps?.saveState ?? saveState;
  const _setTimeout = deps?.setTimeout ?? globalThis.setTimeout;
  const _checkProtectedPaths = deps?._checkProtectedPaths ??
    ((s: DanteState, o: { cwd?: string }) => checkProtectedTaskPaths(s, o));
  const _executeCommand = deps?._executeCommand;
  const _addSignal = deps?._addSignalListener ?? ((s: string, h: () => void) => process.on(s, h));
  const _removeSignal = deps?._removeSignalListener ?? ((s: string, h: () => void) => process.removeListener(s, h));

  let interrupted = false;
  let consecutiveFailures = 0;
  let consecutiveExecFailures = 0;

  // SIGINT handler for graceful shutdown
  const sigintHandler = () => {
    interrupted = true;
    logger.info('\n[Autoforge] Interrupt received — completing current step and saving progress...');
  };
  _addSignal('SIGINT', sigintHandler);

  try {
    ctx.loopState = AutoforgeLoopState.RUNNING;
    ctx.startedAt = new Date().toISOString();

    while (!interrupted) {
      ctx.cycleCount++;

      // 1. Score all artifacts
      ctx.loopState = AutoforgeLoopState.SCORING;
      const cwd = ctx.cwd;
      const scores = await _scoreAllArtifacts(cwd, ctx.state);
      for (const result of Object.values(scores)) {
        await _persistScoreResult(result, cwd);
      }

      // 2. Compute completion
      if (!ctx.state.projectType || ctx.state.projectType === 'unknown') {
        ctx.state.projectType = await _detectProjectType(cwd);
      }
      const tracker = _computeCompletionTracker(ctx.state, scores);
      ctx.state.completionTracker = tracker;

      // 3. Check completion threshold
      if (tracker.overall >= COMPLETION_THRESHOLD) {
        ctx.loopState = AutoforgeLoopState.COMPLETE;
        logger.success(`[Autoforge] Overall completion: ${tracker.overall}% — target reached!`);

        // Write final guidance
        const guidance = buildGuidance(tracker, scores, ctx);
        ctx.lastGuidance = guidance;
        await writeGuidanceFile(guidance, cwd);

        // Print summary table
        printSummaryTable(scores);

        // Record to memory
        await _recordMemory({
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
        await _saveState(ctx.state, { cwd });

        break;
      }

      // 4. Find blocking artifacts
      const blockedArtifacts = findBlockedArtifacts(scores);

      // 5. Handle BLOCKED state
      if (blockedArtifacts.length > 0) {
        consecutiveFailures++;

        // Circuit breaker: trip if consecutive failures exceed limit
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

            break;
          }

          // Try refining blocked artifacts — apply exponential backoff before retry
          ctx.loopState = AutoforgeLoopState.REFINING;
          for (const blocked of blockedArtifacts) {
            const retryCount = ctx.retryCounters[blocked.artifact] ?? 0;
            const backoffMs = computeBackoff(retryCount);
            logger.info(`[Autoforge] Backing off ${backoffMs}ms before retry...`);
            await new Promise(resolve => _setTimeout(resolve as () => void, backoffMs));

            ctx.retryCounters[blocked.artifact] = retryCount + 1;
            logger.info(`[Autoforge] Refining ${blocked.artifact} (attempt ${ctx.retryCounters[blocked.artifact]}/${ctx.maxRetries})`);
          }
        }
      } else {
        // No blocking artifacts — reset consecutive failure counter
        consecutiveFailures = 0;
      }

      // Best-effort complexity-based preset recommendation.
      try {
        const { assessComplexity } = await import('./complexity-classifier.js');
        const tasks = Object.values(ctx.state.tasks).flat();
        if (tasks.length > 0) {
          const assessment = assessComplexity(tasks, ctx.state);
          logger.info(`[Autoforge] Complexity: ${assessment.score}/100 → Recommended: ${assessment.recommendedPreset}${assessment.shouldUseParty ? ' (party mode suggested)' : ''}`);
        }
      } catch (err) { logger.verbose(`[best-effort] preset recommendation: ${err instanceof Error ? err.message : String(err)}`); }

      // 6. Determine next command
      const nextCommand = determineNextCommand(ctx.state, tracker, scores);
      if (!nextCommand) {
        ctx.loopState = AutoforgeLoopState.COMPLETE;
        break;
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

      // Protected path gate — block forge waves that touch protected files without approval
      if (nextCommand === 'forge') {
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
          break;
        }
      }

      // Safety: without an executor and not in dry-run, emit guidance and exit advisory mode
      if (!_executeCommand) {
        logger.info('[Autoforge] No executor provided — advisory mode: guidance written, exiting loop');
        break;
      }

      logger.info(`[Autoforge] Executing: ${nextCommand}`);
      ctx.state.auditLog.push(
        `${new Date().toISOString()} | autoforge-loop: cycle ${ctx.cycleCount} executing ${nextCommand}`,
      );
      await _saveState(ctx.state, { cwd });

      const execResult = await _executeCommand(nextCommand, cwd);
      if (!execResult.success) {
        logger.warn(`[Autoforge] ${nextCommand} reported failure — continuing loop`);
        consecutiveExecFailures++;
        if (consecutiveExecFailures >= CIRCUIT_BREAKER_CONSECUTIVE_FAILURE_LIMIT) {
          ctx.loopState = AutoforgeLoopState.BLOCKED;
          logger.error(`[Autoforge] Circuit breaker tripped after ${consecutiveExecFailures} consecutive command failures`);
          ctx.state.auditLog.push(
            `${new Date().toISOString()} | autoforge-loop: circuit breaker tripped on command failures`,
          );
          await _saveState(ctx.state, { cwd });
          break;
        }
      } else {
        consecutiveExecFailures = 0;
      }

      // Reload state after execution
      ctx.state = await _loadState({ cwd });
    }

    if (interrupted) {
      logger.info('[Autoforge] Interrupted — progress saved.');
      ctx.state.auditLog.push(
        `${new Date().toISOString()} | autoforge-loop: interrupted at cycle ${ctx.cycleCount}`,
      );
      await _saveState(ctx.state, { cwd: ctx.cwd });
    }

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

export function findBlockedArtifacts(scores: Record<ScoredArtifact, ScoreResult>): BlockingIssue[] {
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
): AutoforgeGuidance {
  const blockingIssues = findBlockedArtifacts(scores);
  const bottleneck = findBottleneck(tracker, scores);
  const nextCommand = determineNextCommand(ctx.state, tracker, scores) ?? 'ship --dry-run';
  const estimatedSteps = computeEstimatedSteps(ctx);
  const autoAdvanceEligible = blockingIssues.length === 0 && tracker.overall < COMPLETION_THRESHOLD;

  return {
    timestamp: new Date().toISOString(),
    overallCompletion: tracker.overall,
    currentBottleneck: bottleneck,
    blockingIssues,
    recommendedCommand: `danteforge ${nextCommand}`,
    recommendedReason: getRecommendationReason(tracker, blockingIssues),
    autoAdvanceEligible,
    autoAdvanceBlockReason: !autoAdvanceEligible && blockingIssues.length > 0
      ? `${blockingIssues.length} artifact(s) below score threshold`
      : undefined,
    estimatedStepsToCompletion: estimatedSteps,
  };
}

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

// ── Protected path gate ─────────────────────────────────────────────────────

export interface CheckProtectedTaskPathsOpts {
  cwd?: string;
  _requestApproval?: typeof requestSelfEditApproval;
}

/**
 * Scans tasks for the current phase and checks whether any declared files are
 * protected paths. For each protected file, calls requestSelfEditApproval with
 * the state's selfEditPolicy (defaulting to 'deny').
 *
 * Returns { approved: true, blocked: [] } if all protected paths are approved
 * or if there are no protected paths. Returns { approved: false, blocked: [...] }
 * if any protected path was denied.
 */
export async function checkProtectedTaskPaths(
  state: DanteState,
  opts: CheckProtectedTaskPathsOpts = {},
): Promise<{ blocked: string[]; approved: boolean }> {
  const { cwd, _requestApproval = requestSelfEditApproval } = opts;
  const policy: SelfEditPolicy = state.selfEditPolicy ?? 'deny';
  const phaseTasks = state.tasks[state.currentPhase ?? 1] ?? [];

  const blocked: string[] = [];

  for (const task of phaseTasks) {
    const files = task.files ?? [];
    for (const file of files) {
      if (!isProtectedPath(file)) continue;

      const approved = await _requestApproval(file, task.name, { cwd, policy });
      if (!approved) {
        blocked.push(file);
      }
    }
  }

  return { blocked, approved: blocked.length === 0 };
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

// ── Pause file (used by resume command) ──────────────────────────

export const AUTOFORGE_PAUSE_FILE = '.danteforge/AUTOFORGE_PAUSED';

export interface AutoforgePauseSnapshot {
  pausedAt: string;
  avgScore: number;
  cycleCount: number;
  goal: string;
  retryCounters: Record<string, number>;
  blockedArtifacts: string[];
}
