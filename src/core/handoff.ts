// Seamless handoff engine — phase transitions between pipeline stages
import fs from 'fs/promises';
import path from 'path';
import { loadState, saveState } from './state.js';
import { logger } from './logger.js';
import { FIRST_EXECUTION_PHASE } from './local-artifacts.js';
import { recordMemory } from './memory-engine.js';

/** Map handoff sources to the artifact file that must exist before the transition. */
const HANDOFF_ARTIFACT_MAP: Record<string, string | null> = {
  constitution: 'CONSTITUTION.md',
  spec: 'SPEC.md',
  review: 'CURRENT_STATE.md',
  design: 'DESIGN.op',
  forge: null, // execution step — no single artifact
  party: null,
  'ux-refine': null,
};

async function assertHandoffArtifact(from: string, cwd?: string): Promise<void> {
  const expectedFile = HANDOFF_ARTIFACT_MAP[from];
  if (!expectedFile) return; // no artifact to check for execution steps
  const artifactPath = path.join(cwd ?? process.cwd(), '.danteforge', expectedFile);
  try {
    await fs.access(artifactPath);
  } catch {
    throw new Error(
      `Handoff blocked: expected artifact "${expectedFile}" does not exist on disk. ` +
      `The "${from}" command must write this file before advancing the workflow.`,
    );
  }
}

export async function handoff(
  from: 'constitution' | 'spec' | 'forge' | 'party' | 'review' | 'ux-refine' | 'design',
  artifact: { constitution?: string; tasks?: { name: string; files?: string[]; verify?: string }[]; stateFile?: string; designFile?: string },
  options: { cwd?: string } = {},
) {
  // Fail-closed: verify the expected artifact exists on disk before advancing state
  await assertHandoffArtifact(from, options.cwd);

  const state = await loadState(options);
  state.lastHandoff = `${from} -> next (${new Date().toISOString()})`;
  if (from === 'constitution') {
    state.constitution = artifact.constitution;
    state.workflowStage = 'constitution';
  }
  if (from === 'spec') {
    state.constitution = artifact.constitution;
    state.workflowStage = 'specify';
    if (artifact.tasks) {
      state.tasks[FIRST_EXECUTION_PHASE] = artifact.tasks;
    }
  }
  if (from === 'review') {
    state.workflowStage = 'review';
    state.auditLog.push(`${new Date().toISOString()} | review artifact: ${artifact.stateFile ?? 'CURRENT_STATE.md'}`);
  }
  if (from === 'design') {
    state.workflowStage = 'design';
    state.designEnabled = true;
    state.designFilePath = artifact.designFile;
    state.auditLog.push(`${new Date().toISOString()} | design: .op artifact created`);
  }
  if (from === 'forge' || from === 'party') {
    state.workflowStage = 'forge';
  }
  if (from === 'ux-refine') {
    state.workflowStage = 'ux-refine';
  }
  state.auditLog.push(`${new Date().toISOString()} | handoff: ${from} -> next`);
  await saveState(state, options);
  await recordMemory({
    category: 'decision',
    summary: `Handoff: ${from} -> ${state.workflowStage}`,
    detail: `Workflow advanced from ${from} to ${state.workflowStage}.`,
    tags: ['handoff', from, state.workflowStage],
    relatedCommands: [from],
  }, options.cwd);
  logger.success(`Handoff complete: ${from} -> next phase`);
}
