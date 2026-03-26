import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState, recordWorkflowStage, saveState } from '../../core/state.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { displayPrompt, savePrompt } from '../../core/prompt-builder.js';
import { requirePlan, runGate } from '../../core/gates.js';
import {
  buildLocalTasks,
  extractNumberedTasks,
  FIRST_EXECUTION_PHASE,
  writeArtifact,
} from '../../core/local-artifacts.js';

const STATE_DIR = '.danteforge';

export async function tasks(options: { prompt?: boolean; light?: boolean } = {}) {
  if (!(await runGate(() => requirePlan(options.light)))) { process.exitCode = 1; return; }

  logger.info('Breaking plan into executable tasks...');

  const state = await loadState();

  let planContent = '';
  let specContent = '';
  try {
    planContent = await fs.readFile(path.join(STATE_DIR, 'PLAN.md'), 'utf8');
  } catch {}
  try {
    specContent = await fs.readFile(path.join(STATE_DIR, 'SPEC.md'), 'utf8');
  } catch {}

  const prompt = `You are a project manager breaking down a software plan into atomic, executable tasks.

${state.constitution ? `Project principles:\n${state.constitution}\n` : ''}
${planContent ? `Implementation plan:\n${planContent.slice(0, 3000)}\n` : ''}
${specContent ? `Specification:\n${specContent.slice(0, 2000)}\n` : ''}

Generate a TASKS.md with:
1. **Task List** - each task as a numbered item with:
   - Clear action verb (Implement, Create, Configure, Test, etc.)
   - Files to modify (if known)
   - Verification criteria
   - [P] flag for tasks that can run in parallel
   - Effort estimate (S/M/L)
2. **Dependencies** - which tasks must complete before others
3. **Phase Grouping** - group tasks into execution waves (Phase 1, Phase 2, etc.)

Format each task as:
\`N. [P?] <action> - files: <paths> - verify: <criteria> - effort: <S/M/L>\`

Output ONLY the markdown content - no preamble.`;

  if (options.prompt) {
    const savedPath = await savePrompt('tasks', prompt);
    displayPrompt(prompt, [
      'Paste into your LLM, then run: danteforge import <file> --as TASKS.md',
      `Prompt saved to: ${savedPath}`,
    ].join('\n'));
    state.auditLog.push(`${new Date().toISOString()} | tasks: prompt generated`);
    await saveState(state);
    return;
  }

  const llmAvailable = await isLLMAvailable();
  if (llmAvailable) {
    logger.info('Sending to LLM for task breakdown...');
    try {
      const tasksMd = await callLLM(prompt, undefined, { enrichContext: true });
      await writeArtifact('TASKS.md', tasksMd);

      const parsedTasks = extractNumberedTasks(tasksMd, 'Phase 1');
      if (parsedTasks.length > 0) {
        state.tasks[FIRST_EXECUTION_PHASE] = parsedTasks;
        if (state.currentPhase < FIRST_EXECUTION_PHASE) {
          state.currentPhase = FIRST_EXECUTION_PHASE;
        }
      }

      const timestamp = recordWorkflowStage(state, 'tasks');
      state.auditLog.push(`${timestamp} | tasks: ${parsedTasks.length} tasks generated via API`);
      await saveState(state);
      logger.success(`TASKS.md generated - ${parsedTasks.length} tasks ready for forge`);
      logger.info('Run "danteforge forge 1" to start executing');
      return;
    } catch (err) {
      logger.warn(`API call failed: ${err instanceof Error ? err.message : String(err)}`);
      logger.info('Falling back to local artifact generation...');
    }
  }

  const localTasks = buildLocalTasks(planContent, specContent);
  await writeArtifact('TASKS.md', localTasks.markdown);
  state.tasks[FIRST_EXECUTION_PHASE] = localTasks.tasks;
  if (state.currentPhase < FIRST_EXECUTION_PHASE) {
    state.currentPhase = FIRST_EXECUTION_PHASE;
  }
  const timestamp = recordWorkflowStage(state, 'tasks');
  state.auditLog.push(`${timestamp} | tasks: ${localTasks.tasks.length} tasks generated locally`);
  await saveState(state);
  logger.success(`TASKS.md generated locally - ${localTasks.tasks.length} tasks ready for forge`);
  logger.info('Run "danteforge forge 1" to start executing');
  if (!llmAvailable) {
    logger.info('Tip: Set up an API key for richer task breakdowns: danteforge config --set-key "grok:<key>"');
  }
}
