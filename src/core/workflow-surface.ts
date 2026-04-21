import type { WorkflowStage } from './state.js';

export const REPO_PIPELINE_STEPS = [
  'review',
  'constitution',
  'specify',
  'clarify',
  'tech-decide',
  'plan',
  'tasks',
  'design',
  'forge',
  'ux-refine',
  'verify',
  'synthesize',
  'retro',
  'ship',
] as const;

export const CORE_PIPELINE_STEPS = [
  'review',
  'constitution',
  'specify',
  'clarify',
  'plan',
  'tasks',
  'forge',
  'verify',
  'synthesize',
] as const;

export const SPARK_PLANNING_STEPS = [
  'review',
  'constitution',
  'specify',
  'clarify',
  'tech-decide',
  'plan',
  'tasks',
] as const;

export const CANVAS_PRESET_STEPS = [
  'design',
  'autoforge',
  'ux-refine',
  'verify',
] as const;

export const STATE_MACHINE_STEPS: readonly WorkflowStage[] = [
  'initialized',
  'review',
  'constitution',
  'specify',
  'clarify',
  'plan',
  'tasks',
  'design',
  'forge',
  'ux-refine',
  'verify',
  'synthesize',
];

export function formatWorkflowSteps(steps: readonly string[]): string {
  return steps.join(' -> ');
}

export function renderWorkflowCodeBlock(
  steps: readonly string[],
  infoString = 'text',
): string {
  return [`\`\`\`${infoString}`, formatWorkflowSteps(steps), '```'].join('\n');
}

export const REPO_PIPELINE_TEXT = formatWorkflowSteps(REPO_PIPELINE_STEPS);
export const CORE_PIPELINE_TEXT = formatWorkflowSteps(CORE_PIPELINE_STEPS);
export const SPARK_PLANNING_TEXT = formatWorkflowSteps(SPARK_PLANNING_STEPS);
export const CANVAS_PRESET_TEXT = formatWorkflowSteps(CANVAS_PRESET_STEPS);
export const STATE_MACHINE_TEXT = formatWorkflowSteps(STATE_MACHINE_STEPS);
