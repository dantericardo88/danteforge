// AutoForge — deterministic state machine for auto-orchestrating the DanteForge pipeline
import fs from 'fs/promises';
import { loadState, saveState, type DanteState } from './state.js';
import { enforceWorkflow, getNextSteps, isStageComplete, getCommandStageMap } from './workflow-enforcer.js';
import { getMemoryBudget, getRecentMemory, recordMemory } from './memory-engine.js';
import { logger } from './logger.js';
import { isLLMAvailable } from './llm.js';
import { getProjectCharacteristicsFor } from './mcp-adapter.js';

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
      reasoning: goal
        ? `Fresh project with no artifacts — running full pipeline toward "${goal}".`
        : 'Fresh project with no artifacts — running full pipeline.',
      steps,
      maxWaves,
      goal,
    };
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
    const resumeSteps: AutoForgeStep[] = [
      { command: 'review', reason: `Last session was ${Math.round(lastMemoryAge)}h ago — refresh codebase state` },
    ];
    // Then fall through to mid-project logic
    resumeSteps.push(...getMidProjectSteps(stage, hasDesignOp, hasUI, designViolationCount));
    return {
      scenario: 'multi-session-resume',
      reasoning: `Last activity was ${Math.round(lastMemoryAge)}h ago. Refreshing state before continuing.`,
      steps: resumeSteps,
      maxWaves,
      goal,
    };
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
  } = {},
): Promise<{ completed: string[]; failed: string[]; paused: boolean }> {
  const completed: string[] = [];
  const failed: string[] = [];
  const runStep = options._runStep ?? runAutoForgeStep;
  const checkStageComplete = options._isStageComplete ?? isStageComplete;

  if (options.dryRun) {
    logger.info('[AutoForge] DRY RUN — no commands will be executed');
    displayPlan(plan);
    return { completed: [], failed: [], paused: false };
  }

  const llmReady = await isLLMAvailable();
  if (!llmReady) {
    logger.warn('[AutoForge] No LLM provider available. Some steps may fail.');
  }

  logger.success(`[AutoForge] Scenario: ${plan.scenario}`);
  logger.info(`[AutoForge] ${plan.reasoning}`);
  logger.info(`[AutoForge] ${plan.steps.length} step(s) planned, max ${plan.maxWaves} waves`);
  logger.info('');

  let wavesExecuted = 0;

  for (const step of plan.steps) {
    if (wavesExecuted >= plan.maxWaves) {
      logger.info(`[AutoForge] Checkpoint: completed ${wavesExecuted} waves. Pausing for review.`);
      return { completed, failed, paused: true };
    }

    logger.info(`[AutoForge] Step: ${step.command} — ${step.reason}`);

    try {
      const previousExitCode = process.exitCode;
      process.exitCode = 0;
      await runStep(step.command, options.light, plan.goal, {
        profile: options.profile,
        parallel: options.parallel,
        worktree: options.worktree,
      });
      const exitCode = process.exitCode ?? 0;
      process.exitCode = previousExitCode;

      if (exitCode !== 0) {
        throw new Error(`${step.command} exited with code ${exitCode}`);
      }

      // Verify the step's expected artifact was actually written to disk
      const stageMap = getCommandStageMap();
      const stepStage = stageMap[step.command];
      if (stepStage) {
        const artifactExists = await checkStageComplete(stepStage, options.cwd);
        if (!artifactExists) {
          throw new Error(`${step.command} reported success but its expected artifact is missing from disk`);
        }
      }

      completed.push(step.command);
      wavesExecuted++;
      logger.success(`[AutoForge] ${step.command} complete`);

      // Score artifacts and update completion tracker after each step
      try {
        const { scoreAllArtifacts, persistScoreResult } = await import('./pdse.js');
        const { computeCompletionTracker, detectProjectType } = await import('./completion-tracker.js');
        const postState = await loadState({ cwd: options.cwd });
        if (!postState.projectType || postState.projectType === 'unknown') {
          postState.projectType = await detectProjectType(options.cwd ?? process.cwd());
        }
        const scores = await scoreAllArtifacts(options.cwd ?? process.cwd(), postState);
        for (const result of Object.values(scores)) {
          await persistScoreResult(result, options.cwd ?? process.cwd());
        }
        const tracker = computeCompletionTracker(postState, scores);
        postState.completionTracker = tracker;
        postState.auditLog.push(
          `${new Date().toISOString()} | pdse-score | post-${step.command} overall: ${tracker.overall}%`,
        );
        await saveState(postState, { cwd: options.cwd });

        // Feed PDSE results to model profile engine (best-effort, non-blocking)
        try {
          const { ModelProfileEngine } = await import('./model-profile-engine.js');
          const { resolveProvider } = await import('./config.js');
          const providerInfo = await resolveProvider();
          const modelKey = `${providerInfo.provider}:${providerInfo.model}`;
          const profileEngine = new ModelProfileEngine(options.cwd ?? process.cwd());
          for (const [artifact, scoreResult] of Object.entries(scores)) {
            await profileEngine.recordResult({
              modelKey,
              providerId: providerInfo.provider,
              modelId: providerInfo.model,
              taskDescription: `${artifact} artifact — post-${step.command}`,
              taskCategories: ['configuration'],
              pdseScore: scoreResult.score,
              passed: scoreResult.autoforgeDecision === 'advance',
              antiStubViolations: 0,
              tokensUsed: 0,
              retriesNeeded: 0,
            });
          }
        } catch {
          // Profile recording is best-effort — never block the pipeline
        }
      } catch {
        // Scoring is best-effort — don't fail the pipeline
      }

      await recordMemory({
        category: 'command',
        summary: `AutoForge executed: ${step.command}`,
        detail: `Scenario: ${plan.scenario}. Reason: ${step.reason}${plan.goal ? `. Goal: ${plan.goal}` : ''}`,
        tags: ['autoforge', step.command],
        relatedCommands: [step.command],
      }, options.cwd);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      failed.push(step.command);
      logger.error(`[AutoForge] ${step.command} failed: ${msg}`);

      // 7 Levels Deep root cause analysis for significant forge/verify failures
      if (step.command === 'verify' || step.command === 'forge') {
        try {
          const { SevenLevelsEngine, shouldTriggerSevenLevels } = await import('./seven-levels.js');
          const { recordRootCauseLesson } = await import('./lessons-index.js');
          if (shouldTriggerSevenLevels(undefined, 80)) {
            const engine = new SevenLevelsEngine({ minDepth: 3, earlyStop: true });
            const analysis = await engine.analyze(
              { type: 'step_failure', details: msg },
              {
                taskDescription: step.reason,
                generatedCode: '',
                systemPrompt: '',
                modelId: 'autoforge',
                providerId: 'unknown',
              },
            );
            await recordRootCauseLesson(analysis, options.cwd);
            logger.info(`[7LD] Root cause (${analysis.rootCauseDomain}): ${analysis.rootCause.slice(0, 120)}`);
          }
        } catch {
          // 7LD analysis is best-effort — never block the main failure path
        }
      }

      // Record failure
      await recordMemory({
        category: 'error',
        summary: `AutoForge failed at: ${step.command}`,
        detail: `Error: ${msg}. Scenario: ${plan.scenario}${plan.goal ? `. Goal: ${plan.goal}` : ''}`,
        tags: ['autoforge', 'failure', step.command],
        relatedCommands: [step.command],
      }, options.cwd);

      // Increment failed attempts
      const state = await loadState({ cwd: options.cwd });
      state.autoforgeFailedAttempts = (state.autoforgeFailedAttempts ?? 0) + 1;
      await saveState(state, { cwd: options.cwd });

      break; // Stop on first failure
    }
  }

  // Reset failed attempts on success
  if (failed.length === 0) {
    const state = await loadState({ cwd: options.cwd });
    state.autoforgeFailedAttempts = 0;
    state.autoforgeLastRunAt = new Date().toISOString();
    await saveState(state, { cwd: options.cwd });
  }

  return { completed, failed, paused: false };
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
