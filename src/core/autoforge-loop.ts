// Autoforge v2 — Intelligent Autonomous Loop (IAL)
// State machine that drives the full pipeline toward completion.
import fs from 'fs/promises';
import path from 'path';
import { loadState, saveState, type DanteState } from './state.js';
import { scoreAllArtifacts, persistScoreResult, computeAutoforgeDecision } from './pdse.js';
import type { ScoreResult, ScoredArtifact } from './pdse.js';
import { computeCompletionTracker, detectProjectType, type CompletionTracker } from './completion-tracker.js';
import { SCORE_THRESHOLDS, ARTIFACT_COMMAND_MAP, ANTI_STUB_PATTERNS } from './pdse-config.js';
import { logger } from './logger.js';
import { recordMemory } from './memory-engine.js';
import { assessMaturity, type MaturityAssessment } from './maturity-engine.js';
import type { MaturityLevel } from './maturity-levels.js';

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
  targetMaturityLevel?: MaturityLevel; // Optional maturity target override
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

export async function runAutoforgeLoop(ctx: AutoforgeLoopContext): Promise<AutoforgeLoopContext> {
  let interrupted = false;
  let consecutiveFailures = 0;

  // SIGINT handler for graceful shutdown
  const sigintHandler = () => {
    interrupted = true;
    logger.info('\n[Autoforge] Interrupt received — completing current step and saving progress...');
  };
  process.on('SIGINT', sigintHandler);

  try {
    ctx.loopState = AutoforgeLoopState.RUNNING;
    ctx.startedAt = new Date().toISOString();

    while (!interrupted) {
      ctx.cycleCount++;

      // 1. Score all artifacts
      ctx.loopState = AutoforgeLoopState.SCORING;
      const cwd = ctx.cwd;
      const scores = await scoreAllArtifacts(cwd, ctx.state);
      for (const result of Object.values(scores)) {
        await persistScoreResult(result, cwd);
      }

      // 2. Compute completion
      if (!ctx.state.projectType || ctx.state.projectType === 'unknown') {
        ctx.state.projectType = await detectProjectType(cwd);
      }
      const tracker = computeCompletionTracker(ctx.state, scores);
      ctx.state.completionTracker = tracker;

      // 3. Check completion threshold
      if (tracker.overall >= COMPLETION_THRESHOLD) {
        ctx.loopState = AutoforgeLoopState.COMPLETE;
        logger.success(`[Autoforge] Overall completion: ${tracker.overall}% — target reached!`);

        // Write final guidance (include maturity assessment if available)
        const { maturityAssessment: finalMaturity } = await findBlockedArtifacts(scores, ctx);
        const guidance = buildGuidance(tracker, scores, ctx, finalMaturity);
        ctx.lastGuidance = guidance;
        await writeGuidanceFile(guidance, cwd);

        // Print summary table
        printSummaryTable(scores);

        // Record to memory
        await recordMemory({
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
        await saveState(ctx.state, { cwd });

        break;
      }

      // 4. Find blocking artifacts (maturity-aware)
      const { blocked: blockedArtifacts, maturityAssessment } = await findBlockedArtifacts(scores, ctx);

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

          await recordMemory({
            category: 'error',
            summary: `Autoforge circuit breaker tripped after ${consecutiveFailures} consecutive failures`,
            detail: guidance.blockingIssues.map(i => `${i.artifact}: ${i.remediation}`).join('\n'),
            tags: ['autoforge-loop', 'circuit-breaker', 'blocked'],
            relatedCommands: ['autoforge'],
          }, cwd);

          ctx.state.auditLog.push(
            `${new Date().toISOString()} | autoforge-loop: circuit breaker tripped after ${consecutiveFailures} consecutive failures`,
          );
          await saveState(ctx.state, { cwd });

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

            await recordMemory({
              category: 'error',
              summary: `Autoforge BLOCKED on ${permanentlyBlocked.join(', ')}`,
              detail: guidance.blockingIssues.map(i => `${i.artifact}: ${i.remediation}`).join('\n'),
              tags: ['autoforge-loop', 'blocked'],
              relatedCommands: ['autoforge'],
            }, cwd);

            ctx.state.auditLog.push(
              `${new Date().toISOString()} | autoforge-loop: BLOCKED on ${permanentlyBlocked.join(', ')}`,
            );
            await saveState(ctx.state, { cwd });

            break;
          }

          // Try refining blocked artifacts — apply exponential backoff before retry
          ctx.loopState = AutoforgeLoopState.REFINING;
          for (const blocked of blockedArtifacts) {
            const retryCount = ctx.retryCounters[blocked.artifact] ?? 0;
            const backoffMs = computeBackoff(retryCount);
            logger.info(`[Autoforge] Backing off ${backoffMs}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, backoffMs));

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

      logger.info(`[Autoforge] Executing: ${nextCommand}`);
      ctx.state.auditLog.push(
        `${new Date().toISOString()} | autoforge-loop: cycle ${ctx.cycleCount} executing ${nextCommand}`,
      );
      await saveState(ctx.state, { cwd });

      // Reload state after execution
      ctx.state = await loadState({ cwd });
    }

    if (interrupted) {
      logger.info('[Autoforge] Interrupted — progress saved.');
      ctx.state.auditLog.push(
        `${new Date().toISOString()} | autoforge-loop: interrupted at cycle ${ctx.cycleCount}`,
      );
      await saveState(ctx.state, { cwd: ctx.cwd });
    }

    return ctx;
  } finally {
    process.removeListener('SIGINT', sigintHandler);
  }
}

// ── Score-only pass ─────────────────────────────────────────────────────────

export async function runScoreOnlyPass(cwd: string): Promise<{
  scores: Record<ScoredArtifact, ScoreResult>;
  tracker: CompletionTracker;
  guidance: AutoforgeGuidance;
}> {
  const state = await loadState({ cwd });
  if (!state.projectType || state.projectType === 'unknown') {
    state.projectType = await detectProjectType(cwd);
  }

  const scores = await scoreAllArtifacts(cwd, state);
  for (const result of Object.values(scores)) {
    await persistScoreResult(result, cwd);
  }

  const tracker = computeCompletionTracker(state, scores);
  state.completionTracker = tracker;
  state.auditLog.push(
    `${new Date().toISOString()} | autoforge-loop: score-only pass, overall ${tracker.overall}%`,
  );
  await saveState(state, { cwd });

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

async function findBlockedArtifacts(
  scores: Record<ScoredArtifact, ScoreResult>,
  ctx: AutoforgeLoopContext,
): Promise<{ blocked: BlockingIssue[]; maturityAssessment?: MaturityAssessment }> {
  const blocked: BlockingIssue[] = [];

  // Standard PDSE-based blocking check
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

  // Maturity-aware override: If target maturity level is met, proceed even if PDSE < 95
  let maturityAssessment: MaturityAssessment | undefined;
  if (ctx.targetMaturityLevel) {
    try {
      maturityAssessment = await assessMaturity({
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
      logger.warn(`[Autoforge] Maturity assessment failed: ${err instanceof Error ? err.message : String(err)}`);
      // Fall back to PDSE-only decision
    }
  }

  return { blocked, maturityAssessment };
}

function determineNextCommand(
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

function buildGuidance(
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
    maturityAssessment,
  };
}

function findBottleneck(
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

function getRecommendationReason(
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
