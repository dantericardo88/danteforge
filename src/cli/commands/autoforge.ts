// autoforge — deterministic state machine that auto-orchestrates the DanteForge pipeline
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import {
  analyzeProjectState,
  planAutoForge,
  executeAutoForgePlan,
  displayPlan,
} from '../../core/autoforge.js';
import {
  runAutoforgeLoop,
  AutoforgeLoopState,
  type AutoforgeLoopContext,
} from '../../core/autoforge-loop.js';
import { withSpinner } from '../../core/progress.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import {
  scoreAllArtifacts,
  persistScoreResult,
  type ScoreResult,
  type ScoredArtifact,
} from '../../core/pdse.js';
import {
  computeCompletionTracker,
  detectProjectType,
} from '../../core/completion-tracker.js';
import { SCORE_THRESHOLDS, ARTIFACT_COMMAND_MAP } from '../../core/pdse-config.js';
import { loadLatestVerdict } from '../../core/reflection-engine.js';

export async function autoforge(goal?: string, options: {
  dryRun?: boolean;
  maxWaves?: number;
  light?: boolean;
  prompt?: boolean;
  scoreOnly?: boolean;
  auto?: boolean;
  force?: boolean;
  profile?: string;
  parallel?: boolean;
  worktree?: boolean;
  cwd?: string;
  /** Pause loop when avg PDSE score reaches this value */
  pauseAt?: number;
  // Injection seams for testing
  _runLoop?: (ctx: AutoforgeLoopContext) => Promise<AutoforgeLoopContext>;
  _runScoreOnlyMode?: () => Promise<void>;
  _analyzeProjectState?: typeof analyzeProjectState;
  _planAutoForge?: typeof planAutoForge;
  _displayPlan?: typeof displayPlan;
  _executeAutoForgePlan?: typeof executeAutoForgePlan;
  _loadLatestVerdict?: typeof loadLatestVerdict;
} = {}): Promise<void> {
  return withErrorBoundary('autoforge', async () => {
  const maxWaves = options.maxWaves ?? 3;
  const cwd = options.cwd ?? process.cwd();

  logger.success('DanteForge AutoForge - Agentic Pipeline Orchestrator');
  logger.info('');

  // --score-only mode: score existing artifacts and write guidance
  if (options.scoreOnly) {
    await (options._runScoreOnlyMode ?? runScoreOnlyMode)();
    return;
  }

  // ── Autonomous loop mode (--auto flag) ──────────────────────────────────────
  // Runs the full state-machine convergence loop until 95%+ completion or BLOCKED.
  if (options.auto) {
    logger.info('[AutoForge] Autonomous mode — running convergence loop...');
    const state = await loadState({ cwd });
    const isWebProject = (state.projectType ?? 'unknown') === 'web';
    const ctx: AutoforgeLoopContext = {
      goal: goal ?? 'Advance the project to completion',
      cwd,
      state,
      loopState: AutoforgeLoopState.IDLE,
      cycleCount: 0,
      startedAt: new Date().toISOString(),
      retryCounters: {},
      blockedArtifacts: [],
      lastGuidance: null,
      isWebProject,
      force: options.force ?? false,
      dryRun: options.dryRun,
      maxRetries: 3,
      ...(options.pauseAt !== undefined ? { pauseAtScore: options.pauseAt } : {}),
    };
    const loopFn = options._runLoop ?? runAutoforgeLoop;
    const finalCtx = await loopFn(ctx);
    if (finalCtx.loopState === AutoforgeLoopState.BLOCKED) {
      process.exitCode = 1;
    }
    return;
  }

  // Analyze current project state
  const analyzeFn = options._analyzeProjectState ?? analyzeProjectState;
  const input = await withSpinner(
    'Analyzing project state...',
    () => analyzeFn(),
    'Project state analyzed',
  );

  // Generate the plan
  const planFn = options._planAutoForge ?? planAutoForge;
  const plan = planFn(input, maxWaves, goal);

  // --prompt mode: generate copy-paste prompt
  if (options.prompt) {
    const prompt = generateAutoForgePrompt(plan, input);
    logger.success('=== COPY-PASTE PROMPT (start) ===');
    process.stdout.write('\n' + prompt + '\n\n');
    logger.success('=== COPY-PASTE PROMPT (end) ===');
    logger.info('');
    logger.info('Paste this into your LLM interface to get guidance on executing these steps.');
    return;
  }

  // --dry-run mode: display plan without executing
  if (options.dryRun) {
    const dpy = options._displayPlan ?? displayPlan;
    dpy(plan);
    logger.info('[AutoForge] Dry run complete — no commands were executed.');
    return;
  }

  // Execute the plan
  const execFn = options._executeAutoForgePlan ?? executeAutoForgePlan;
  const result = await withSpinner(
    `Executing autoforge plan (${maxWaves} waves)...`,
    () => execFn(plan, {
      dryRun: false,
      light: options.light,
      profile: options.profile,
      parallel: options.parallel,
      worktree: options.worktree,
    }),
    'Autoforge waves complete',
  );

  // Report results
  logger.info('');
  logger.info('='.repeat(60));
  if (result.failed.length > 0) {
    logger.error('  AUTOFORGE COMPLETED WITH FAILURES');
  } else if (result.paused) {
    logger.info('  AUTOFORGE PAUSED AT CHECKPOINT');
  } else {
    logger.success('  AUTOFORGE COMPLETE');
  }
  logger.info('='.repeat(60));
  logger.info('');

  if (result.completed.length > 0) {
    logger.success(`Completed: ${result.completed.join(' -> ')}`);
  }
  if (result.failed.length > 0) {
    logger.error(`Failed: ${result.failed.join(', ')}`);
    logger.info('Run `danteforge doctor` to diagnose, then `danteforge autoforge` to retry.');
    process.exitCode = 1;
  }
  if (result.paused) {
    logger.info(`Paused after ${maxWaves} waves. Run \`danteforge autoforge\` again to continue.`);
  }

  // Show reflection score if available
  try {
    const verdictFn = options._loadLatestVerdict ?? loadLatestVerdict;
    const verdict = await verdictFn();
    if (verdict) {
      const score = Math.round(verdict.confidence * 100);
      logger.info('');
      logger.info(`Reflection: ${score}/100 (${verdict.status})${verdict.stuck ? ' [STUCK]' : ''}`);
      if (verdict.remainingWork.length > 0) {
        logger.warn(`Remaining: ${verdict.remainingWork.slice(0, 3).join(', ')}`);
      }
    }
  } catch {
    // Reflection not available — no problem
  }
  });
}

// ── Score-only mode ─────────────────────────────────────────────────────────

async function runScoreOnlyMode(): Promise<void> {
  const cwd = process.cwd();
  logger.info('Scoring existing artifacts...');

  const state = await loadState();
  state.projectType = await detectProjectType(cwd);

  const scores = await scoreAllArtifacts(cwd, state);

  // Persist all scores
  for (const result of Object.values(scores)) {
    await persistScoreResult(result, cwd);
  }

  // Compute completion tracker
  const tracker = computeCompletionTracker(state, scores);
  state.completionTracker = tracker;
  state.auditLog.push(
    `${new Date().toISOString()} | pdse-score | score-only pass — overall: ${tracker.overall}%`,
  );
  await saveState(state);

  // Write AUTOFORGE_GUIDANCE.md
  const guidance = buildGuidanceMarkdown(scores, tracker);
  const guidancePath = path.join(cwd, '.danteforge', 'AUTOFORGE_GUIDANCE.md');
  await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
  await fs.writeFile(guidancePath, guidance);

  // Print score table
  logger.info('');
  logger.success('DanteForge v0.15.0 — Score-Only Pass');
  logger.info('━'.repeat(40));

  const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];
  for (const name of artifacts) {
    const result = scores[name];
    const icon = result.score >= SCORE_THRESHOLDS.EXCELLENT ? '✓ EXCELLENT'
      : result.score >= SCORE_THRESHOLDS.ACCEPTABLE ? '✓ ACCEPTABLE'
      : result.score >= SCORE_THRESHOLDS.NEEDS_WORK ? '⚠ NEEDS WORK'
      : '✗ BLOCKED';
    const padded = `${name}.md`.padEnd(22);
    logger.info(`${padded}${String(result.score).padStart(3)}  ${icon}`);
  }

  logger.info('');
  logger.info(`Overall completion:  ${tracker.overall}%`);

  // Reflection score (from last reflection verdict)
  const verdict = await loadLatestVerdict(cwd);
  if (verdict) {
    const reflectionScore = Math.round(verdict.confidence * 100);
    const reflectionIcon = reflectionScore >= 80 ? '✓' : reflectionScore >= 50 ? '⚠' : '✗';
    logger.info(`Reflection score:    ${reflectionScore}  ${reflectionIcon} (${verdict.status})`);
  }

  // Find bottleneck
  const bottleneck = findBottleneck(scores);
  if (bottleneck) {
    logger.info(`Current bottleneck:  ${bottleneck.artifact}.md (${bottleneck.worstDimension}: ${bottleneck.worstScore}/${bottleneck.maxScore})`);
  }

  // Recommended next action
  const recommendation = getRecommendation(scores);
  if (recommendation) {
    logger.info('');
    logger.info('Recommended next action:');
    logger.info(`  danteforge ${recommendation.command}`);
    logger.info(`  Reason: ${recommendation.reason}`);
  }

  logger.info('');
  logger.info(`Guidance written to: ${guidancePath}`);
}

// ── Guidance file generation ────────────────────────────────────────────────

function buildGuidanceMarkdown(
  scores: Record<ScoredArtifact, ScoreResult>,
  tracker: ReturnType<typeof computeCompletionTracker>,
): string {
  const timestamp = new Date().toISOString();
  const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];

  const bottleneck = findBottleneck(scores);
  const recommendation = getRecommendation(scores);
  const blockingIssues = getBlockingIssues(scores);
  const autoAdvance = artifacts.every(a => scores[a].score >= SCORE_THRESHOLDS.NEEDS_WORK);

  const lines: string[] = [
    '# Autoforge Guidance',
    `> Generated: ${timestamp}`,
    '',
    `## Overall Completion: ${tracker.overall}%`,
    '',
    '| Phase | Score | Complete |',
    '|---|---|---|',
    `| Planning | ${tracker.phases.planning.score} | ${tracker.phases.planning.complete ? 'Yes' : 'No'} |`,
    `| Execution | ${tracker.phases.execution.score} | ${tracker.phases.execution.complete ? 'Yes' : 'No'} |`,
    `| Verification | ${tracker.phases.verification.score} | ${tracker.phases.verification.complete ? 'Yes' : 'No'} |`,
    `| Synthesis | ${tracker.phases.synthesis.score} | ${tracker.phases.synthesis.complete ? 'Yes' : 'No'} |`,
    '',
    '## Current Bottleneck',
    bottleneck
      ? `${bottleneck.artifact}.md — ${bottleneck.worstDimension}: ${bottleneck.worstScore}/${bottleneck.maxScore}`
      : '_None_',
    '',
    '## Blocking Issues',
    blockingIssues.length > 0
      ? blockingIssues.map(i => `- **${i.artifact}.md** (${i.score}): ${i.message}`).join('\n')
      : '_None_',
    '',
    '## Artifact Scores',
    '| Artifact | Score | Decision |',
    '|---|---|---|',
    ...artifacts.map(a =>
      `| ${a}.md | ${scores[a].score} | ${scores[a].autoforgeDecision} |`,
    ),
    '',
    '## Recommended Next Action',
    '```',
    recommendation ? `danteforge ${recommendation.command}` : '# No action required',
    '```',
    recommendation ? `**Reason:** ${recommendation.reason}` : '',
    '',
    '## Auto-Advance Eligibility',
    autoAdvance
      ? 'YES — all scores >= 50'
      : `NO — ${artifacts.filter(a => scores[a].score < SCORE_THRESHOLDS.NEEDS_WORK).map(a => `${a}.md`).join(', ')} below threshold`,
    '',
    '## Estimated Steps to Completion',
    `${tracker.projectedCompletion}`,
  ];

  // Append reflection score if available (async not possible here, so read state)
  if (typeof globalThis !== 'undefined') {
    lines.push('', '## Reflection Score');
    lines.push('_Run `danteforge autoforge --score-only` to see latest reflection verdict._');
  }

  return lines.join('\n') + '\n';
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface Bottleneck {
  artifact: ScoredArtifact;
  worstDimension: string;
  worstScore: number;
  maxScore: number;
}

function findBottleneck(scores: Record<ScoredArtifact, ScoreResult>): Bottleneck | null {
  let worst: Bottleneck | null = null;
  const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];

  for (const name of artifacts) {
    const result = scores[name];
    if (!worst || result.score < scores[worst.artifact].score) {
      // Find the lowest dimension
      const dims = result.dimensions;
      const dimEntries = Object.entries(dims) as [keyof typeof dims, number][];
      const lowestDim = dimEntries.reduce((a, b) => a[1] <= b[1] ? a : b);
      const maxScore = lowestDim[0] === 'integrationFitness' || lowestDim[0] === 'freshness' ? 10 : 20;
      worst = {
        artifact: name,
        worstDimension: lowestDim[0],
        worstScore: lowestDim[1],
        maxScore,
      };
    }
  }
  return worst;
}

interface Recommendation {
  command: string;
  reason: string;
}

function getRecommendation(scores: Record<ScoredArtifact, ScoreResult>): Recommendation | null {
  const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];

  // Find the worst-scoring artifact that has issues
  let worstArtifact: ScoredArtifact | null = null;
  let worstScore = Infinity;

  for (const name of artifacts) {
    if (scores[name].score < worstScore) {
      worstScore = scores[name].score;
      worstArtifact = name;
    }
  }

  if (!worstArtifact || worstScore >= SCORE_THRESHOLDS.EXCELLENT) return null;

  const result = scores[worstArtifact];
  const command = ARTIFACT_COMMAND_MAP[worstArtifact];
  const topIssue = result.issues[0];
  const reason = topIssue
    ? topIssue.message
    : `Score ${result.score} is below ${SCORE_THRESHOLDS.EXCELLENT}`;

  return { command, reason };
}

interface BlockingIssueInfo {
  artifact: ScoredArtifact;
  score: number;
  message: string;
}

function getBlockingIssues(scores: Record<ScoredArtifact, ScoreResult>): BlockingIssueInfo[] {
  const issues: BlockingIssueInfo[] = [];
  const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];

  for (const name of artifacts) {
    if (scores[name].autoforgeDecision === 'blocked') {
      issues.push({
        artifact: name,
        score: scores[name].score,
        message: scores[name].issues[0]?.message ?? 'Score below threshold',
      });
    }
  }
  return issues;
}

function generateAutoForgePrompt(
  plan: ReturnType<typeof planAutoForge>,
  input: Awaited<ReturnType<typeof analyzeProjectState>>,
): string {
  const lines: string[] = [
    '# AutoForge Pipeline Plan',
    '',
    ...(plan.goal ? [`**Goal:** ${plan.goal}`, ''] : []),
    `**Scenario:** ${plan.scenario}`,
    `**Current Stage:** ${input.state.workflowStage ?? 'initialized'}`,
    `**Reasoning:** ${plan.reasoning}`,
    '',
    '## Steps to Execute',
    '',
  ];

  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    lines.push(`${i + 1}. \`danteforge ${step.command}\` — ${step.reason}`);
  }

  lines.push('', '## Project Context', '');
  lines.push(`- UI Project: ${input.hasUI ? 'Yes' : 'No'}`);
  lines.push(`- Design File: ${input.hasDesignOp ? 'Yes' : 'No'}`);
  lines.push(`- Memory Entries: ${input.memoryEntryCount}`);
  lines.push(`- Design Violations: ${input.designViolationCount}`);
  lines.push(`- Failed Attempts: ${input.failedAttempts}`);

  return lines.join('\n');
}
