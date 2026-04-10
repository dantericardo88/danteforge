import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { handoff } from '../../core/handoff.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { displayPrompt, savePrompt, sanitizeInput } from '../../core/prompt-builder.js';
import { requireConstitution, runGate } from '../../core/gates.js';
import { buildLocalSpec, extractNumberedTasks, writeArtifact } from '../../core/local-artifacts.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

const STATE_DIR = '.danteforge';

export async function specify(idea: string, options: { prompt?: boolean; light?: boolean } = {}) {
  return withErrorBoundary('specify', async () => {
  if (!(await runGate(() => requireConstitution(options.light)))) return;

  const safeIdea = sanitizeInput(idea, 2000);
  logger.info(`Specifying: ${safeIdea}`);

  const state = await loadState();

  let currentState = '';
  try {
    currentState = await fs.readFile(path.join(STATE_DIR, 'CURRENT_STATE.md'), 'utf8');
  } catch {
    // Current state review is optional context.
  }

  const safeConstitution = state.constitution ? sanitizeInput(state.constitution, 5000) : '';
  const safeCurrentState = currentState ? sanitizeInput(currentState.slice(0, 3000), 3000) : '';

  const prompt = `You are a senior software architect creating a detailed specification from a high-level idea.

Idea: "${safeIdea}"

${safeConstitution ? `Project principles:\n${safeConstitution}\n` : ''}
${safeCurrentState ? `Current project state:\n${safeCurrentState}\n` : ''}

Generate a complete SPEC.md with:
1. **Feature Name** and one-line summary
2. **Constitution Reference** - which principles apply
3. **What & Why** - detailed description and motivation
4. **User Stories** - as a [role], I want [action], so that [benefit]
5. **Non-functional Requirements** - performance, security, accessibility
6. **Acceptance Criteria** - specific, testable conditions
7. **Task Breakdown** - numbered list with parallel flags [P] where applicable
8. **Dependencies & Risks**

Output ONLY the markdown content - no preamble.`;

  if (options.prompt) {
    const savedPath = await savePrompt('specify', prompt);
    displayPrompt(prompt, [
      'Paste into your LLM, then run: danteforge import <file> --as SPEC.md',
      `Prompt saved to: ${savedPath}`,
    ].join('\n'));
    state.auditLog.push(`${new Date().toISOString()} | specify: prompt generated for "${safeIdea}"`);
    await saveState(state);
    return;
  }

  const llmAvailable = await isLLMAvailable();
  if (llmAvailable) {
    logger.info('Sending to LLM for spec generation...');
    try {
      const specMd = await callLLM(prompt, undefined, { enrichContext: true });
      await writeArtifact('SPEC.md', specMd);

      const tasks = extractNumberedTasks(specMd, 'Task Breakdown');
      const normalizedTasks = tasks.length > 0
        ? tasks
        : [{ name: `Implement ${safeIdea}`, verify: 'All acceptance criteria met' }];

      await handoff('spec', { constitution: state.constitution, tasks: normalizedTasks });
      logger.success(`SPEC.md generated for "${safeIdea}" - ${normalizedTasks.length} tasks identified`);
      logger.info('Run "danteforge clarify" next, then continue with "danteforge plan" and "danteforge tasks" before forge.');
      return;
    } catch (err) {
      logger.warn(`API call failed: ${err instanceof Error ? err.message : String(err)}`);
      logger.info('Falling back to local artifact generation...');
    }
  }

  const localSpec = buildLocalSpec(safeIdea, state.constitution, currentState);
  await writeArtifact('SPEC.md', localSpec.markdown);
  await handoff('spec', { constitution: state.constitution ?? 'Loaded from .danteforge', tasks: localSpec.tasks });
  logger.success(`SPEC.md generated locally for "${safeIdea}" - ${localSpec.tasks.length} tasks identified`);
  logger.info('Run "danteforge clarify" next, then continue with "danteforge plan" and "danteforge tasks" before forge.');
  if (!llmAvailable) {
    logger.info('Tip: Set up an API key for richer specs: danteforge config --set-key "grok:<key>"');
  }
  });
}
