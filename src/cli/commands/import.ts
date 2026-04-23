// Import command – bring externally generated files (from Claude Code / ChatGPT) into .danteforge/
import fs from 'fs/promises';
import path from 'path';
import { loadState, recordWorkflowStage, saveState } from '../../core/state.js';
import { logger } from '../../core/logger.js';
import { handoff } from '../../core/handoff.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { extractNumberedTasks, FIRST_EXECUTION_PHASE } from '../../core/local-artifacts.js';

const STATE_DIR = '.danteforge';

function invalidatesVerification(targetName: string): boolean {
  return [
    'CURRENT_STATE.md',
    'CONSTITUTION.md',
    'SPEC.md',
    'CLARIFY.md',
    'PLAN.md',
    'TASKS.md',
    'DESIGN.op',
    'UX_REFINE.md',
  ].includes(targetName);
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function applyArtifactHandoff(
  targetName: string,
  content: string,
  state: Awaited<ReturnType<typeof loadState>>,
  saveFn: typeof saveState,
  timestamp: string,
): Promise<void> {
  if (targetName === 'CURRENT_STATE.md') {
    state.currentPhase = 0; state.tasks = {};
    await saveFn(state); await handoff('review', { stateFile: 'CURRENT_STATE.md' });
    logger.success(`Imported ${targetName} — review handoff complete`);
    logger.info('Run "danteforge constitution" next, then "danteforge specify <goal>" to continue the pipeline');
    return;
  }
  if (targetName === 'CONSTITUTION.md') {
    await saveFn(state); await handoff('constitution', { constitution: content });
    logger.success(`Imported ${targetName} — constitution handoff complete`);
    logger.info('Run "danteforge specify <goal>" to continue the pipeline');
    return;
  }
  if (targetName === 'SPEC.md') {
    const tasks = extractNumberedTasks(content, 'Task Breakdown');
    await saveFn(state); await handoff('spec', { constitution: state.constitution, tasks: tasks.length > 0 ? tasks : undefined });
    logger.success(`Imported ${targetName} — specification handoff complete`);
    logger.info('Run "danteforge clarify" next, then continue with "danteforge plan" and "danteforge tasks" before forge.');
    return;
  }
  if (targetName === 'CLARIFY.md') {
    recordWorkflowStage(state, 'clarify', timestamp); await saveFn(state);
    logger.success(`Imported ${targetName} into .danteforge/`);
    logger.info('Run "danteforge plan" to turn the clarified spec into an execution plan.');
    return;
  }
  if (targetName === 'PLAN.md') {
    recordWorkflowStage(state, 'plan', timestamp); await saveFn(state);
    logger.success(`Imported ${targetName} into .danteforge/`);
    logger.info('Run "danteforge tasks" to break the plan into executable work.');
    return;
  }
  if (targetName === 'TASKS.md') {
    const tasks = extractNumberedTasks(content, 'Phase 1');
    state.tasks[FIRST_EXECUTION_PHASE] = tasks; state.currentPhase = FIRST_EXECUTION_PHASE;
    recordWorkflowStage(state, 'tasks', timestamp); await saveFn(state);
    logger.success(`Imported ${targetName} into .danteforge/`);
    logger.info('Run "danteforge forge 1" to execute the first wave, or use "--prompt" for manual execution planning.');
    return;
  }
  if (targetName === 'DESIGN.op') {
    await saveFn(state); await handoff('design', { designFile: 'DESIGN.op' });
    logger.success(`Imported ${targetName} — design handoff complete`);
    logger.info('Run "danteforge ux-refine --openpencil" to extract local design artifacts, or continue with "danteforge forge 1".');
    return;
  }
  if (targetName === 'UX_REFINE.md') {
    await saveFn(state); await handoff('ux-refine', {});
    logger.success(`Imported ${targetName} into .danteforge/`);
    logger.info('Run "danteforge verify" to confirm UX artifacts and workflow consistency.');
    return;
  }
  if (targetName === 'UPR.md') {
    recordWorkflowStage(state, 'synthesize', timestamp); await saveFn(state);
    logger.success(`Imported ${targetName} into .danteforge/`);
    logger.info('Run "danteforge feedback" for manual refinement or "danteforge feedback --auto" with a verified live provider.');
    return;
  }
  await saveFn(state);
  logger.success(`Imported ${targetName} into .danteforge/`);
  logger.info('Run "danteforge synthesize" to merge all artifacts into UPR.md');
}

export async function importFile(source: string, options: {
  as?: string;
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
} = {}) {
  const loadFn = options._loadState ?? loadState;
  const saveFn = options._saveState ?? saveState;

  return withErrorBoundary('import', async () => {
  // Resolve the source path
  const sourcePath = path.resolve(source);

  if (!await fileExists(sourcePath)) {
    logger.error(`File not found: ${sourcePath}`);
    logger.info('Usage: danteforge import <path-to-file> [--as CURRENT_STATE.md]');
    return;
  }

  const content = await fs.readFile(sourcePath, 'utf8');
  if (!content.trim()) {
    logger.error('File is empty — nothing to import');
    return;
  }

  // Determine target filename
  const targetName = options.as ?? path.basename(sourcePath);
  const targetPath = path.join(STATE_DIR, targetName);

  await fs.mkdir(STATE_DIR, { recursive: true });

  // Check if target exists and warn
  if (await fileExists(targetPath)) {
    logger.warn(`Overwriting existing ${targetName} in .danteforge/`);
  }

  await fs.writeFile(targetPath, content);

  // Update state
  const timestamp = new Date().toISOString();
  const state = await loadFn();
  state.auditLog.push(`${timestamp} | import: ${targetName} (from ${path.basename(sourcePath)}, ${content.length} bytes)`);
  if (invalidatesVerification(targetName)) state.lastVerifiedAt = undefined;
  await applyArtifactHandoff(targetName, content, state, saveFn, timestamp);
  });
}
