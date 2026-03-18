// Workflow Enforcer — mandatory state machine for DanteForge pipeline transitions
import { loadState } from './state.js';
import {
  requireConstitution,
  requireSpec,
  requireClarify,
  requirePlan,
  requireTests,
  GateError,
} from './gates.js';
import { logger } from './logger.js';
import type { WorkflowStage } from './state.js';

export interface WorkflowTransition {
  from: WorkflowStage[];
  to: WorkflowStage;
  gates: ((light?: boolean) => Promise<void>)[];
  artifacts: string[];
}

const WORKFLOW_GRAPH: WorkflowTransition[] = [
  { from: ['initialized'], to: 'review', gates: [], artifacts: ['CURRENT_STATE.md'] },
  { from: ['initialized', 'review'], to: 'constitution', gates: [], artifacts: ['CONSTITUTION.md'] },
  { from: ['constitution'], to: 'specify', gates: [requireConstitution], artifacts: ['SPEC.md'] },
  { from: ['specify'], to: 'clarify', gates: [requireSpec], artifacts: ['CLARIFY.md'] },
  { from: ['clarify', 'specify'], to: 'plan', gates: [requireSpec], artifacts: ['PLAN.md'] },
  { from: ['plan'], to: 'tasks', gates: [requirePlan], artifacts: ['TASKS.md'] },
  { from: ['tasks', 'plan'], to: 'design', gates: [requirePlan], artifacts: ['DESIGN.op'] },
  { from: ['tasks', 'design'], to: 'forge', gates: [requirePlan, requireTests], artifacts: [] },
  { from: ['forge'], to: 'ux-refine', gates: [], artifacts: [] },
  { from: ['forge', 'ux-refine'], to: 'verify', gates: [], artifacts: [] },
  { from: ['verify'], to: 'synthesize', gates: [], artifacts: ['UPR.md'] },
];

// Map command names to their target workflow stages
const COMMAND_STAGE_MAP: Record<string, WorkflowStage> = {
  review: 'review',
  constitution: 'constitution',
  specify: 'specify',
  clarify: 'clarify',
  plan: 'plan',
  tasks: 'tasks',
  design: 'design',
  forge: 'forge',
  'ux-refine': 'ux-refine',
  verify: 'verify',
  synthesize: 'synthesize',
};

export interface TransitionResult {
  valid: boolean;
  blocked: GateError[];
  transition?: WorkflowTransition;
}

/**
 * Check if a transition from current stage to target stage is allowed.
 */
export async function validateTransition(
  currentStage: WorkflowStage,
  targetStage: WorkflowStage,
  light = false,
): Promise<TransitionResult> {
  // Find matching transition in the graph
  const transition = WORKFLOW_GRAPH.find(
    t => t.to === targetStage && t.from.includes(currentStage),
  );

  if (!transition) {
    // Check if there's ANY transition to this target (wrong source stage)
    const anyTransition = WORKFLOW_GRAPH.find(t => t.to === targetStage);
    if (anyTransition) {
      return {
        valid: false,
        blocked: [
          new GateError(
            `Cannot transition from '${currentStage}' to '${targetStage}'. Valid source stages: ${anyTransition.from.join(', ')}`,
            'workflow-enforcer',
            `Complete the '${anyTransition.from[anyTransition.from.length - 1]}' stage first.`,
          ),
        ],
      };
    }
    return {
      valid: false,
      blocked: [
        new GateError(
          `Unknown workflow target: '${targetStage}'`,
          'workflow-enforcer',
          'Run "danteforge help" to see the workflow pipeline.',
        ),
      ],
    };
  }

  // In light mode, skip gate checks but still validate the graph edge
  if (light) {
    return { valid: true, blocked: [], transition };
  }

  // Run all gates for this transition
  const blocked: GateError[] = [];
  for (const gateFn of transition.gates) {
    try {
      await gateFn(false);
    } catch (err) {
      if (err instanceof GateError) {
        blocked.push(err);
      } else {
        throw err;
      }
    }
  }

  return {
    valid: blocked.length === 0,
    blocked,
    transition,
  };
}

/**
 * Enforce workflow transition at the top of a CLI command.
 * In 'advisory' mode: logs warnings but allows execution.
 * In 'strict' mode: blocks execution on gate failure.
 */
export async function enforceWorkflow(
  command: string,
  targetStage?: WorkflowStage,
  light = false,
  cwd?: string,
): Promise<void> {
  if (command === 'verify' || command === 'ux-refine') {
    return;
  }

  const target = targetStage ?? COMMAND_STAGE_MAP[command];
  if (!target) return; // Command not in workflow graph (e.g., config, doctor)

  if (light) return;

  const state = await loadState({ cwd });
  const currentStage = state.workflowStage;
  const enforcementMode = state.enforcementMode ?? 'strict';

  // Same stage or re-running is always allowed
  if (currentStage === target) return;

  // Allow review to reset stale execution sessions once task execution has started.
  if (target === 'review' && state.currentPhase > 0) {
    return;
  }

  const result = await validateTransition(currentStage, target, light);

  if (result.valid) return;

  // Report gate failures
  for (const err of result.blocked) {
    logger.error(err.message);
    logger.info(`Remedy: ${err.remedy}`);
  }

  if (enforcementMode === 'strict' && !light) {
    throw new GateError(
      `Workflow blocked: cannot run '${command}' from stage '${currentStage}'`,
      'workflow-enforcer',
      result.blocked.map(e => e.remedy).join('; '),
    );
  }

  // Advisory mode — warn but proceed
  logger.warn(`Workflow advisory: '${command}' is running outside the expected sequence (current: ${currentStage})`);
}

/**
 * Get valid next workflow stages from the current position.
 */
export function getNextSteps(currentStage: WorkflowStage): WorkflowStage[] {
  return WORKFLOW_GRAPH
    .filter(t => t.from.includes(currentStage))
    .map(t => t.to);
}

/**
 * Check if all artifacts for a given stage exist.
 */
export async function isStageComplete(stage: WorkflowStage, cwd?: string): Promise<boolean> {
  const transition = WORKFLOW_GRAPH.find(t => t.to === stage);
  if (!transition || transition.artifacts.length === 0) return true;

  const fs = await import('fs/promises');
  const path = await import('path');
  const stateDir = path.join(cwd ?? process.cwd(), '.danteforge');

  for (const artifact of transition.artifacts) {
    try {
      await fs.access(path.join(stateDir, artifact));
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Get the full workflow graph for introspection (used by autoforge, doctor, help).
 */
export function getWorkflowGraph(): WorkflowTransition[] {
  return [...WORKFLOW_GRAPH];
}

/**
 * Get the command-to-stage mapping.
 */
export function getCommandStageMap(): Record<string, WorkflowStage> {
  return { ...COMMAND_STAGE_MAP };
}
