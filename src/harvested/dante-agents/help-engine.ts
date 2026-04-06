// Help engine - context-aware next-step suggestions.
import { loadState, type WorkflowStage } from '../../core/state.js';

const STAGE_SUGGESTIONS: Record<WorkflowStage, string> = {
  initialized: 'Run "danteforge review" to scan an existing project, or "danteforge constitution" to start a new one.',
  review: 'Run "danteforge constitution" to establish project rules before specification.',
  constitution: 'Run "danteforge specify <idea>" to create the working spec.',
  specify: 'Run "danteforge clarify" to resolve gaps before planning.',
  clarify: 'Run "danteforge plan" to build the execution plan.',
  plan: 'Run "danteforge tasks" to break the plan into executable work.',
  tasks: 'Run "danteforge forge 1" to execute the first wave, or use "--prompt" for manual execution.',
  design: 'Run "danteforge ux-refine --openpencil" to extract local design artifacts.',
  forge: 'Run "danteforge verify" to confirm the execution results.',
  'ux-refine': 'Run "danteforge verify" to confirm UX artifacts and workflow consistency.',
  verify: 'Run "danteforge synthesize" to generate UPR.md from the verified workflow.',
  synthesize: 'Run "danteforge feedback" or "danteforge feedback --auto" for the next refinement loop.',
};

export async function getContextualHelp(query?: string, options?: { cwd?: string }): Promise<string> {
  const state = await loadState({ cwd: options?.cwd });

  if (query) {
    return `For "${query}": current workflow stage is "${state.workflowStage}" and execution wave is "${state.currentPhase}".`;
  }

  return STAGE_SUGGESTIONS[state.workflowStage] ?? STAGE_SUGGESTIONS.initialized;
}
