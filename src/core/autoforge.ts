// AutoForge — deterministic state machine for auto-orchestrating the DanteForge pipeline
import fs from 'fs/promises';
import { loadState, saveState, type DanteState } from './state.js';
import { enforceWorkflow, getNextSteps, isStageComplete, getCommandStageMap } from './workflow-enforcer.js';
import type { WorkflowStage } from './state.js';
import { getMemoryBudget, getRecentMemory, recordMemory } from './memory-engine.js';
import { logger } from './logger.js';
import { isLLMAvailable } from './llm.js';
import { getProjectCharacteristicsFor } from './mcp-adapter.js';
import { recordDecision, getSession } from './decision-node-recorder.js';
import {
  loadCausalWeightMatrix,
  saveCausalWeightMatrix,
  applyAttributionOutcomes,
} from './causal-weight-matrix.js';
import { attributeBatch, extractOutcomes } from './prediction-attribution.js';
import type { DimensionName } from './causal-weight-matrix.js';

// ---------------------------------------------------------------------------
// Predictor auto-wire factory
// ---------------------------------------------------------------------------

/**
 * Build a live PredictStepFn using the configured LLM provider.
 * Used by executeAutoForgePlan to enable prediction layer in production runs.
 * Returns undefined when no LLM is available, disabling prediction silently.
 */
export async function buildPredictStepFn(cwd?: string): Promise<PredictStepFn | undefined> {
  try {
    const { callLLM } = await import('./llm.js');
    const matrix = await loadCausalWeightMatrix(cwd);
    const { predict } = await import('../../packages/predictor/src/predictor.js');
    const { DEFAULT_PREDICTOR_CONFIG } = await import('../../packages/predictor/src/types.js');
    type PriorRecord = import('../../packages/predictor/src/types.js').PriorPredictionRecord;

    const llmCaller = async (prompt: string) => callLLM(prompt);

    return async (command: string, reason: string, currentOverall: number): Promise<{ delta: number; confidence: number }> => {
      const causalWeights: Partial<Record<string, number>> = {};
      for (const [dim, acc] of Object.entries(matrix.perDimensionAccuracy)) {
        if (acc && acc.sampleCount >= 3) causalWeights[dim] = acc.directionAccuracy;
      }

      // Build recentHistory from the rolling attribution window stored in the matrix
      const recentHistory: PriorRecord[] = (matrix.recentAttributions ?? [])
        .slice(-DEFAULT_PREDICTOR_CONFIG.contextWindowSize)
        .map((attr) => ({
          action: attr.actionType,
          predictedDelta: { [attr.dimension]: attr.predictedDelta },
          measuredDelta: { [attr.dimension]: attr.measuredDelta },
          aligned: attr.classification === 'causally-aligned',
        }));

      const result = await predict(
        {
          proposedAction: { command, reason, estimatedComplexity: 'medium' },
          currentState: {
            workflowStage: command,
            dimensionScores: { functionality: currentOverall / 10 },
            totalCostUsd: 0,
            cycleCount: matrix.totalAttributions,
          },
          recentHistory,
          causalWeights,
          budgetEnvelope: { maxUsd: DEFAULT_PREDICTOR_CONFIG.maxBudgetUsd, maxLatencyMs: 30_000 },
        },
        llmCaller,
        DEFAULT_PREDICTOR_CONFIG,
      );

      const primaryDelta = Object.values(result.predicted.scoreImpact)[0] ?? 0;

      // Emit proof-anchored receipt (best-effort — never blocks prediction)
      try {
        const { createReceipt } = await import('../../packages/evidence-chain/src/index.js');
        const receipt = createReceipt({
          action: 'autoforge:predict',
          payload: {
            command,
            reason,
            predictedAt: result.predictedAt,
            confidence: result.predicted.confidence,
            scoreImpact: result.predicted.scoreImpact,
          },
        });
        result.receiptHash = receipt.hash;
      } catch {
        // evidence-chain unavailable — proceed without receipt
      }

      // Emit cost telemetry to .danteforge/economy/ (PRD §4.1 — best-effort)
      try {
        const { writePredictorCostRecord } = await import('./predictor-cost-telemetry.js');
        await writePredictorCostRecord({
          predictedAt: result.predictedAt,
          command,
          costUsd: result.predicted.costUsd,
          confidence: result.predicted.confidence,
          predictorVersion: result.predictorVersion,
          receiptHash: result.receiptHash,
        }, cwd);
      } catch {
        // economy dir unavailable — proceed without cost record
      }

      return { delta: primaryDelta, confidence: result.predicted.confidence };
    };
  } catch {
    return undefined;
  }
}

export type AutoForgeScenario =
  | 'cold-start'
  | 'mid-project'
  | 'stalled'
  | 'frontend'
  | 'multi-session-resume'
  | 'stuck-looping';

export interface AutoForgeStep {
  command: string;
  reason: string;
}

export interface AutoForgePlan {
  scenario: AutoForgeScenario;
  reasoning: string;
  steps: AutoForgeStep[];
  maxWaves: number;
  goal?: string;
}

export interface AutoForgeInput {
  state: DanteState;
  hasDesignOp: boolean;
  hasUI: boolean;
  memoryEntryCount: number;
  lastMemoryAge: number | null; // hours since last memory entry, null if no entries
  failedAttempts: number;
  designViolationCount: number;
}

const CIRCUIT_BREAKER_THRESHOLD = 3;
const STALE_SESSION_HOURS = 24;

/**
 * Gather all inputs needed for AutoForge decision-making.
 */
export async function analyzeProjectState(cwd?: string): Promise<AutoForgeInput> {
  const state = await loadState({ cwd });
  const budget = await getMemoryBudget(cwd);
  const recent = await getRecentMemory(1, cwd);
  const { hasUI, hasDesign } = await getProjectCharacteristicsFor(cwd);

  let lastMemoryAge: number | null = null;
  if (recent.length > 0) {
    const lastTs = new Date(recent[0].timestamp).getTime();
    lastMemoryAge = (Date.now() - lastTs) / (1000 * 60 * 60);
  }

  // Count design violations if .op exists
  let designViolationCount = 0;
  if (hasDesign) {
    try {
      const { parseOP } = await import('../harvested/openpencil/op-codec.js');
      const { evaluateDocument, loadRules, loadRuleConfig } = await import('./design-rules-engine.js');
      const designPath = cwd ? `${cwd}/.danteforge/DESIGN.op` : '.danteforge/DESIGN.op';
      const rulesPath = cwd ? `${cwd}/.danteforge/design-rules.yaml` : '.danteforge/design-rules.yaml';
      const opContent = await fs.readFile(designPath, 'utf8');
      const doc = parseOP(opContent);
      const violations = evaluateDocument(doc, loadRules(rulesPath), loadRuleConfig(rulesPath));
      designViolationCount = violations.filter(v => v.severity === 'error' || v.severity === 'warning').length;
    } catch { /* evaluation failed, skip */ }
  }

  return {
    state,
    hasDesignOp: hasDesign,
    hasUI,
    memoryEntryCount: budget.entryCount,
    lastMemoryAge,
    failedAttempts: state.autoforgeFailedAttempts ?? 0,
    designViolationCount,
  };
}

function buildColdStartPlan(hasUI: boolean, maxWaves: number, goal?: string): AutoForgePlan {
  const steps: AutoForgeStep[] = [
    { command: 'review', reason: 'Scan the codebase to establish baseline' },
    { command: 'constitution', reason: 'Set project principles' },
    { command: 'specify', reason: 'Build the specification' },
    { command: 'clarify', reason: 'Clarify ambiguities in the spec' },
    { command: 'plan', reason: 'Create the implementation plan' },
    { command: 'tasks', reason: 'Break the plan into executable tasks' },
  ];
  if (hasUI) {
    steps.push(
      { command: 'design', reason: 'Generate Design-as-Code (.op) for UI' },
      { command: 'forge', reason: 'Execute the task plan' },
      { command: 'ux-refine', reason: 'Refine UX after forge' },
      { command: 'verify', reason: 'Verify the implementation' },
    );
  } else {
    steps.push(
      { command: 'forge', reason: 'Execute the task plan' },
      { command: 'verify', reason: 'Verify the implementation' },
    );
  }
  return {
    scenario: 'cold-start',
    reasoning: goal ? `Fresh project with no artifacts — running full pipeline toward "${goal}".` : 'Fresh project with no artifacts — running full pipeline.',
    steps, maxWaves, goal,
  };
}

function buildMultiSessionResumePlan(
  lastMemoryAge: number, stage: string, hasDesignOp: boolean, hasUI: boolean,
  designViolationCount: number, maxWaves: number, goal?: string,
): AutoForgePlan {
  const resumeSteps: AutoForgeStep[] = [
    { command: 'review', reason: `Last session was ${Math.round(lastMemoryAge)}h ago — refresh codebase state` },
  ];
  resumeSteps.push(...getMidProjectSteps(stage, hasDesignOp, hasUI, designViolationCount));
  return {
    scenario: 'multi-session-resume',
    reasoning: `Last activity was ${Math.round(lastMemoryAge)}h ago. Refreshing state before continuing.`,
    steps: resumeSteps, maxWaves, goal,
  };
}

/**
 * Pure deterministic function — given project input, return a plan.
 * This is NOT an LLM reasoning loop. It's a priority-ordered decision tree.
 */
export function planAutoForge(input: AutoForgeInput, maxWaves = 3, goal?: string): AutoForgePlan {
  const { state, hasDesignOp, hasUI, memoryEntryCount, lastMemoryAge, failedAttempts, designViolationCount } = input;
  const stage = state.workflowStage ?? 'initialized';

  // 1. CIRCUIT BREAKER
  if (failedAttempts >= CIRCUIT_BREAKER_THRESHOLD) {
    return {
      scenario: 'stuck-looping',
      reasoning: `AutoForge has failed ${failedAttempts} consecutive times. Manual intervention required.`,
      steps: [{ command: 'doctor', reason: 'Diagnose the issue before retrying' }],
      maxWaves,
      goal,
    };
  }

  // 2. COLD START
  if (stage === 'initialized' && !hasAnyArtifacts(state)) {
    return buildColdStartPlan(hasUI, maxWaves, goal);
  }

  // 3. TERMINAL STATE
  if (stage === 'synthesize') {
    return {
      scenario: 'mid-project',
      reasoning: 'Workflow is already complete at "synthesize". No further steps are required.',
      steps: [],
      maxWaves,
      goal,
    };
  }

  // 4. MULTI-SESSION RESUME
  if (memoryEntryCount > 0 && lastMemoryAge !== null && lastMemoryAge > STALE_SESSION_HOURS) {
    return buildMultiSessionResumePlan(lastMemoryAge, stage, hasDesignOp, hasUI, designViolationCount, maxWaves, goal);
  }

  // 4. STALLED — same stage for too long (would need memory analysis)
  // For deterministic mode, detect via empty next steps
  const nextSteps = getNextSteps(stage);
  if (nextSteps.length === 0) {
    return {
      scenario: 'stalled',
      reasoning: `Workflow is at "${stage}" with no valid next steps. Running doctor.`,
      steps: [{ command: 'doctor', reason: 'Diagnose why the workflow is stuck' }],
      maxWaves,
      goal,
    };
  }

  // 5. FRONTEND — design violations need attention
  if (hasDesignOp && designViolationCount > 0) {
    const frontendSteps: AutoForgeStep[] = [
      { command: 'ux-refine', reason: `${designViolationCount} design violations detected — lint and fix` },
    ];
    frontendSteps.push(...getMidProjectSteps(stage, hasDesignOp, hasUI, 0));
    return {
      scenario: 'frontend',
      reasoning: `Design file has ${designViolationCount} violations. Running UX lint before continuing.`,
      steps: frontendSteps,
      maxWaves,
      goal,
    };
  }

  // 6. MID-PROJECT — determine next step from workflow graph
  const midSteps = getMidProjectSteps(stage, hasDesignOp, hasUI, designViolationCount);
  if (midSteps.length > 0) {
    return {
      scenario: 'mid-project',
      reasoning: goal
        ? `Project at "${stage}" stage — advancing toward "${goal}".`
        : `Project at "${stage}" stage — advancing to next steps.`,
      steps: midSteps,
      maxWaves,
      goal,
    };
  }

  // 7. DEFAULT
  return {
    scenario: 'mid-project',
    reasoning: 'Could not determine optimal path. Running doctor for diagnostics.',
    steps: [{ command: 'doctor', reason: 'Fallback diagnostic' }],
    maxWaves,
    goal,
  };
}

async function runPostStepScoring(stepCommand: string, profile: string | undefined, cwd: string | undefined): Promise<void> {
  const { scoreAllArtifacts, persistScoreResult } = await import('./pdse.js');
  const { computeCompletionTracker, detectProjectType } = await import('./completion-tracker.js');
  const postState = await loadState({ cwd });
  if (!postState.projectType || postState.projectType === 'unknown') {
    postState.projectType = await detectProjectType(cwd ?? process.cwd());
  }
  const scores = await scoreAllArtifacts(cwd ?? process.cwd(), postState);
  for (const result of Object.values(scores)) {
    await persistScoreResult(result, cwd ?? process.cwd());
  }
  const tracker = computeCompletionTracker(postState, scores);
  postState.completionTracker = tracker;
  postState.auditLog.push(`${new Date().toISOString()} | pdse-score | post-${stepCommand} overall: ${tracker.overall}%`);
  await saveState(postState, { cwd });

  try {
    const { ModelProfileEngine } = await import('./model-profile-engine.js');
    const { resolveProvider } = await import('./config.js');
    const providerInfo = await resolveProvider();
    const modelKey = `${providerInfo.provider}:${providerInfo.model}`;
    const profileEngine = new ModelProfileEngine(cwd ?? process.cwd());
    for (const [artifact, scoreResult] of Object.entries(scores)) {
      await profileEngine.recordResult({
        modelKey, providerId: providerInfo.provider, modelId: providerInfo.model,
        taskDescription: `${artifact} artifact — post-${stepCommand}`,
        taskCategories: ['configuration'], pdseScore: scoreResult.score,
        passed: scoreResult.autoforgeDecision === 'advance',
        antiStubViolations: 0, tokensUsed: 0, retriesNeeded: 0,
      });
    }
  } catch (err) { logger.verbose(`[best-effort] model profile: ${err instanceof Error ? err.message : String(err)}`); }

  try {
    const { recordComplexityOutcome, assessComplexity: assess, mapScoreToPreset, adjustWeightsFromOutcome, persistComplexityWeights, loadComplexityWeights } = await import('./complexity-classifier.js');
    const tasks = Object.values(postState.tasks).flat();
    if (tasks.length > 0) {
      const assessment = assess(tasks, postState);
      const validPresets = ['spark', 'ember', 'magic', 'blaze', 'inferno'] as const;
      const actualPreset = validPresets.includes(profile as typeof validPresets[number])
        ? (profile as typeof validPresets[number])
        : mapScoreToPreset(assessment.score);
      const lesson = recordComplexityOutcome(assessment, actualPreset, assessment.estimatedCostUsd);
      if (lesson) {
        logger.info(`[AutoForge] Complexity calibration: ${lesson}`);
        postState.auditLog.push(`${new Date().toISOString()} | complexity-calibration | ${lesson}`);
        await saveState(postState, { cwd });
        const currentWeights = await loadComplexityWeights(cwd);
        const adjusted = adjustWeightsFromOutcome(currentWeights, assessment.recommendedPreset, actualPreset);
        if (adjusted) await persistComplexityWeights(adjusted, cwd);
      }
    }
  } catch (err) { logger.verbose(`[best-effort] calibration: ${err instanceof Error ? err.message : String(err)}`); }
}

type RunStepFn = (command: string, light?: boolean, goal?: string, runtime?: { profile?: string; parallel?: boolean; worktree?: boolean }) => Promise<void>;
type FailureAnalyzerFn = (stepCommand: string, message: string, reason: string, cwd?: string) => Promise<void>;
/** Injected for testing — given a step command + context, returns predicted score delta and confidence */
export type PredictStepFn = (command: string, reason: string, currentOverall: number, cwd?: string) => Promise<{ delta: number; confidence: number }>;
const FAILURE_ANALYSIS_TIMEOUT_MS = 10_000;

async function withBestEffortTimeout<T>(work: Promise<T>, timeoutMs: number, label: string): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => {
          logger.verbose(`[best-effort] ${label} timed out after ${timeoutMs}ms`);
          resolve(undefined);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function executeForgeSteps(
  plan: AutoForgePlan,
  opts: { cwd?: string; light?: boolean; profile?: string; parallel?: boolean; worktree?: boolean },
  runStep: RunStepFn,
  checkStageComplete: (stage: WorkflowStage, cwd?: string) => Promise<boolean>,
  memoryRecorder: typeof recordMemory,
  failureAnalyzer: FailureAnalyzerFn,
  decisionRecorderFn: typeof recordDecision,
  planNodeId: string | null,
  predictFn?: PredictStepFn,
): Promise<{ completed: string[]; failed: string[]; paused: boolean }> {
  const completed: string[] = [];
  const failed: string[] = [];
  let wavesExecuted = 0;

  for (const step of plan.steps) {
    if (wavesExecuted >= plan.maxWaves) {
      logger.info(`[AutoForge] Checkpoint: completed ${wavesExecuted} waves. Pausing for review.`);
      return { completed, failed, paused: true };
    }
    logger.info(`[AutoForge] Step: ${step.command} — ${step.reason}`);

    // Capture pre-step score for causal attribution measurement
    let preStepOverall = 0;
    let predictedDelta = 0;
    let predictedConfidence = 0.1;
    try {
      const preState = await loadState({ cwd: opts.cwd });
      preStepOverall = preState.completionTracker?.overall ?? 0;
      if (predictFn) {
        const pred = await predictFn(step.command, step.reason, preStepOverall, opts.cwd);
        predictedDelta = pred.delta;
        predictedConfidence = pred.confidence;
      }
    } catch { /* best-effort */ }

    // Store prediction in pre-execution DecisionNode (PRD §4.3 — predict-execute-measure chain)
    let predictionNodeId: string | null = null;
    try {
      if (planNodeId && predictFn) {
        const session = getSession(opts.cwd);
        const predNode = await decisionRecorderFn({
          session,
          parentNodeId: planNodeId,
          actorType: 'agent',
          prompt: `predict: ${step.command}`,
          context: { reason: step.reason, preStepOverall },
          result: {
            predicted: { scoreImpact: { functionality: predictedDelta }, confidence: predictedConfidence },
          },
          success: true,
          costUsd: 0,
          latencyMs: 0,
        });
        predictionNodeId = predNode.id;
      }
    } catch { /* best-effort — prediction node never blocks execution */ }

    try {
      const { assessComplexity, formatAssessment } = await import('./complexity-classifier.js');
      const state = await loadState({ cwd: opts.cwd });
      const tasks = Object.values(state.tasks).flat();
      if (tasks.length > 0) logger.info(`[AutoForge] ${formatAssessment(assessComplexity(tasks, state))}`);
    } catch (err) { logger.verbose(`[best-effort] classifier: ${err instanceof Error ? err.message : String(err)}`); }

    try {
      // v0.10.0 — removed exitCode save/restore pattern (concurrency bug).
      await runStep(step.command, opts.light, plan.goal, { profile: opts.profile, parallel: opts.parallel, worktree: opts.worktree });
      const stageMap = getCommandStageMap();
      const stepStage = stageMap[step.command];
      if (stepStage && !await checkStageComplete(stepStage, opts.cwd)) {
        throw new Error(`${step.command} reported success but its expected artifact is missing from disk`);
      }
      completed.push(step.command);
      wavesExecuted++;
      logger.success(`[AutoForge] ${step.command} complete`);
      try {
        if (planNodeId) {
          const session = getSession(opts.cwd);
          await decisionRecorderFn({
            session,
            parentNodeId: (predictionNodeId ?? planNodeId) ?? undefined,
            actorType: 'agent',
            prompt: step.command,
            result: { reason: step.reason, scenario: plan.scenario },
            success: true,
            costUsd: 0,
            latencyMs: 0,
          });
        }
      } catch { /* best-effort */ }
      try { await runPostStepScoring(step.command, opts.profile, opts.cwd); } catch (err) { logger.verbose(`[best-effort] scoring: ${err instanceof Error ? err.message : String(err)}`); }

      // Causal attribution: measure actual delta and attribute against prediction
      try {
        const postState = await loadState({ cwd: opts.cwd });
        const postStepOverall = postState.completionTracker?.overall ?? preStepOverall;
        const measuredDelta = (postStepOverall - preStepOverall) / 10;
        const matrix = await loadCausalWeightMatrix(opts.cwd);
        const batch = attributeBatch([{
          actionType: step.command,
          dimension: 'functionality' as DimensionName,
          predictedDelta,
          measuredDelta,
          predictedConfidence,
        }]);
        const updated = applyAttributionOutcomes(matrix, extractOutcomes(batch));
        await saveCausalWeightMatrix(updated, opts.cwd);
        try {
          const { createReceipt } = await import('../../packages/evidence-chain/src/index.js');
          const receipt = createReceipt({
            action: 'autoforge:attribute',
            payload: {
              actionType: step.command,
              classification: batch.pairs[0]?.classification ?? 'noise',
              predictedDelta,
              measuredDelta,
              overallAlignment: batch.summary.overallAlignment,
            },
          });
          batch.receiptHash = receipt.hash;
        } catch { /* evidence-chain unavailable — proceed without receipt */ }
        logger.verbose(`[AutoForge] Causal attribution: ${batch.pairs[0]?.classification ?? 'unknown'} (predicted ${predictedDelta > 0 ? '+' : ''}${predictedDelta.toFixed(3)}, measured ${measuredDelta > 0 ? '+' : ''}${measuredDelta.toFixed(3)})`);
      } catch { /* best-effort — attribution never blocks execution */ }
      await memoryRecorder({ category: 'command', summary: `AutoForge executed: ${step.command}`, detail: `Scenario: ${plan.scenario}. Reason: ${step.reason}${plan.goal ? `. Goal: ${plan.goal}` : ''}`, tags: ['autoforge', step.command], relatedCommands: [step.command] }, opts.cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push(step.command);
      logger.error(`[AutoForge] ${step.command} failed: ${msg}`);
      try {
        if (planNodeId) {
          const session = getSession(opts.cwd);
          await decisionRecorderFn({
            session,
            parentNodeId: (predictionNodeId ?? planNodeId) ?? undefined,
            actorType: 'agent',
            prompt: step.command,
            result: { error: msg, reason: step.reason, scenario: plan.scenario },
            success: false,
            costUsd: 0,
            latencyMs: 0,
          });
        }
      } catch { /* best-effort */ }
      await withBestEffortTimeout(
        failureAnalyzer(step.command, msg, step.reason, opts.cwd),
        FAILURE_ANALYSIS_TIMEOUT_MS,
        `autoforge failure analysis for ${step.command}`,
      );
      await memoryRecorder({ category: 'error', summary: `AutoForge failed at: ${step.command}`, detail: `Error: ${msg}. Scenario: ${plan.scenario}${plan.goal ? `. Goal: ${plan.goal}` : ''}`, tags: ['autoforge', 'failure', step.command], relatedCommands: [step.command] }, opts.cwd);
      const state = await loadState({ cwd: opts.cwd });
      state.autoforgeFailedAttempts = (state.autoforgeFailedAttempts ?? 0) + 1;
      await saveState(state, { cwd: opts.cwd });
      break;
    }
  }
  return { completed, failed, paused: false };
}

/**
 * Execute an AutoForge plan step by step.
 * Pauses at maxWaves for a human checkpoint.
 */
export async function executeAutoForgePlan(
  plan: AutoForgePlan,
  options: {
    dryRun?: boolean;
    light?: boolean;
    cwd?: string;
    profile?: string;
    parallel?: boolean;
    worktree?: boolean;
    /** Injected for testing — replaces runAutoForgeStep to avoid real CLI execution */
    _runStep?: (command: string, light?: boolean, goal?: string, runtime?: { profile?: string; parallel?: boolean; worktree?: boolean }) => Promise<void>;
    /** Injected for testing — replaces isStageComplete to avoid real fs artifact check */
    _isStageComplete?: (stage: string, cwd?: string) => Promise<boolean>;
    /** Injected for testing — replaces LLM/provider availability probing */
    _isLLMAvailable?: () => Promise<boolean>;
    /** Injected for testing — replaces memory recording side effects */
    _recordMemory?: typeof recordMemory;
    /** Injected for testing — replaces expensive failure analysis */
    _runFailureAnalysis?: (stepCommand: string, message: string, reason: string, cwd?: string) => Promise<void>;
    /** Injected for testing — replaces decision-node recording side effects */
    _recordDecision?: typeof recordDecision;
    /** Injected for testing — provides forward predictions for causal attribution */
    _predictFn?: PredictStepFn;
  } = {},
): Promise<{ completed: string[]; failed: string[]; paused: boolean }> {
  const runStep = options._runStep ?? runAutoForgeStep;
  const checkStageComplete = options._isStageComplete ?? isStageComplete;
  const llmAvailabilityProbe = options._isLLMAvailable ?? isLLMAvailable;
  const memoryRecorder = options._recordMemory ?? recordMemory;
  const failureAnalyzer = options._runFailureAnalysis ?? runAutoForgeFailureAnalysis;
  const decisionRecorder = options._recordDecision ?? recordDecision;

  if (options.dryRun) {
    logger.info('[AutoForge] DRY RUN — no commands will be executed');
    displayPlan(plan);
    return { completed: [], failed: [], paused: false };
  }

  const llmReady = await llmAvailabilityProbe();
  if (!llmReady) logger.warn('[AutoForge] No LLM provider available. Some steps may fail.');

  logger.success(`[AutoForge] Scenario: ${plan.scenario}`);
  logger.info(`[AutoForge] ${plan.reasoning}`);
  logger.info(`[AutoForge] ${plan.steps.length} step(s) planned, max ${plan.maxWaves} waves`);
  logger.info('');

  let planNodeId: string | null = null;
  try {
    const session = getSession(options.cwd);
    const planNode = await decisionRecorder({
      session,
      actorType: 'agent',
      prompt: `autoforge: ${plan.scenario}${plan.goal ? ` — ${plan.goal}` : ''}`,
      result: { scenario: plan.scenario, steps: plan.steps.length, maxWaves: plan.maxWaves },
      success: true,
      costUsd: 0,
      latencyMs: 0,
    });
    planNodeId = planNode.id;
  } catch { /* best-effort */ }

  const result = await executeForgeSteps(plan, options, runStep, checkStageComplete, memoryRecorder, failureAnalyzer, decisionRecorder, planNodeId, options._predictFn);

  try {
    if (planNodeId) {
      const session = getSession(options.cwd);
      await decisionRecorder({
        session,
        parentNodeId: planNodeId,
        actorType: 'agent',
        prompt: `autoforge-complete: ${plan.scenario}`,
        result: { completed: result.completed, failed: result.failed, paused: result.paused },
        success: result.failed.length === 0,
        costUsd: 0,
        latencyMs: 0,
      });
    }
  } catch { /* best-effort */ }

  if (result.failed.length === 0 && !result.paused) {
    const state = await loadState({ cwd: options.cwd });
    state.autoforgeFailedAttempts = 0;
    state.autoforgeLastRunAt = new Date().toISOString();
    await saveState(state, { cwd: options.cwd });
  }

  return result;
}

async function runAutoForgeFailureAnalysis(
  stepCommand: string,
  message: string,
  reason: string,
  cwd?: string,
): Promise<void> {
  if (stepCommand !== 'verify' && stepCommand !== 'forge') {
    return;
  }

  try {
    const { SevenLevelsEngine, shouldTriggerSevenLevels } = await import('./seven-levels.js');
    const { recordRootCauseLesson } = await import('./lessons-index.js');
    if (shouldTriggerSevenLevels(undefined, 80)) {
      const engine = new SevenLevelsEngine({ minDepth: 3, earlyStop: true });
      const analysis = await engine.analyze(
        { type: 'step_failure', details: message },
        {
          taskDescription: reason,
          generatedCode: '',
          systemPrompt: '',
          modelId: 'autoforge',
          providerId: 'unknown',
        },
      );
      await recordRootCauseLesson(analysis, cwd);
      logger.info(`[7LD] Root cause (${analysis.rootCauseDomain}): ${analysis.rootCause.slice(0, 120)}`);
    }
  } catch (err) {
    logger.verbose(`[best-effort] 7LD analysis: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Display a plan in human-readable format.
 */
export function displayPlan(plan: AutoForgePlan): void {
  logger.info('');
  logger.success('=== AutoForge Plan ===');
  logger.info(`Scenario: ${plan.scenario}`);
  if (plan.goal) {
    logger.info(`Goal: ${plan.goal}`);
  }
  logger.info(`Reasoning: ${plan.reasoning}`);
  logger.info(`Max waves: ${plan.maxWaves}`);
  logger.info('');
  logger.info('Steps:');
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i];
    logger.info(`  ${i + 1}. ${step.command} — ${step.reason}`);
  }
  logger.info('');
}

// Helpers

function hasAnyArtifacts(state: DanteState): boolean {
  // Check if project has moved beyond initialized
  return !!(state.constitution || state.workflowStage !== 'initialized' ||
    Object.keys(state.tasks).length > 0);
}

function getMidProjectSteps(
  stage: string,
  hasDesignOp: boolean,
  hasUI: boolean,
  designViolationCount: number,
): AutoForgeStep[] {
  const steps: AutoForgeStep[] = [];

  switch (stage) {
    case 'initialized':
    case 'review':
      steps.push({ command: 'constitution', reason: 'Establish project principles' });
      break;
    case 'constitution':
      steps.push({ command: 'specify', reason: 'Build the specification' });
      break;
    case 'specify':
      steps.push({ command: 'clarify', reason: 'Clarify spec ambiguities' });
      break;
    case 'clarify':
      steps.push({ command: 'plan', reason: 'Create the implementation plan' });
      break;
    case 'plan':
      steps.push({ command: 'tasks', reason: 'Break the plan into tasks' });
      break;
    case 'tasks':
      if (hasUI && !hasDesignOp) {
        steps.push({ command: 'design', reason: 'UI project needs Design-as-Code' });
      }
      steps.push({ command: 'forge', reason: 'Execute tasks' });
      break;
    case 'design':
      steps.push({ command: 'forge', reason: 'Execute tasks after design' });
      break;
    case 'forge':
      if (hasDesignOp && designViolationCount > 0) {
        steps.push({ command: 'ux-refine', reason: 'Refine UX after forge' });
      }
      steps.push({ command: 'verify', reason: 'Verify the implementation' });
      break;
    case 'ux-refine':
      steps.push({ command: 'verify', reason: 'Verify after UX refinement' });
      break;
    case 'verify':
      steps.push({ command: 'synthesize', reason: 'Generate final summary' });
      break;
    case 'synthesize':
      // Pipeline complete
      break;
  }

  return steps;
}

async function runAutoForgeStep(
  command: string,
  light?: boolean,
  goal?: string,
  runtime: { profile?: string; parallel?: boolean; worktree?: boolean } = {},
): Promise<void> {
  await enforceWorkflow(command, undefined, Boolean(light));

  switch (command) {
    case 'review': {
      const { review } = await import('../cli/commands/review.js');
      await review({ prompt: false });
      return;
    }
    case 'constitution': {
      const { constitution } = await import('../cli/commands/constitution.js');
      await constitution();
      return;
    }
    case 'specify': {
      const { specify } = await import('../cli/commands/specify.js');
      await specify(goal ?? 'AutoForge: continue from current spec');
      return;
    }
    case 'clarify': {
      const { clarify } = await import('../cli/commands/clarify.js');
      await clarify();
      return;
    }
    case 'plan': {
      const { plan } = await import('../cli/commands/plan.js');
      await plan();
      return;
    }
    case 'tasks': {
      const { tasks } = await import('../cli/commands/tasks.js');
      await tasks();
      return;
    }
    case 'design': {
      const { design } = await import('../cli/commands/design.js');
      await design(goal ? `AutoForge: ${goal}` : 'AutoForge: generate design for current spec');
      return;
    }
    case 'forge': {
      const { forge } = await import('../cli/commands/forge.js');
      await forge('1', {
        profile: runtime.profile ?? 'balanced',
        parallel: runtime.parallel,
        worktree: runtime.worktree,
      });
      return;
    }
    case 'ux-refine': {
      const { uxRefine } = await import('../cli/commands/ux-refine.js');
      await uxRefine({ magic: true, afterForge: true });
      return;
    }
    case 'verify': {
      const { verify } = await import('../cli/commands/verify.js');
      await verify();
      return;
    }
    case 'synthesize': {
      const { synthesize } = await import('../cli/commands/synthesize.js');
      await synthesize();
      return;
    }
    case 'doctor': {
      const { doctor } = await import('../cli/commands/doctor.js');
      await doctor();
      return;
    }
    default:
      throw new Error(`Unknown autoforge step: ${command}`);
  }
}
