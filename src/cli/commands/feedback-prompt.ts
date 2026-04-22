// Feedback command - generate a prompt from UPR.md for manual review or live refinement.
import fs from 'fs/promises';
import path from 'path';
import { loadState, saveState } from '../../core/state.js';
import { logger } from '../../core/logger.js';
import { savePrompt, displayPrompt } from '../../core/prompt-builder.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

const STATE_DIR = '.danteforge';

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function feedbackPrompt(options: {
  auto?: boolean;
  _llmCaller?: typeof callLLM;
  _isLLMAvailable?: typeof isLLMAvailable;
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
} = {}) {
  const llmFn = options._llmCaller ?? callLLM;
  const llmAvailFn = options._isLLMAvailable ?? isLLMAvailable;
  const loadFn = options._loadState ?? loadState;
  const saveFn = options._saveState ?? saveState;

  return withErrorBoundary('feedback', async () => {
  const uprPath = path.join(STATE_DIR, 'UPR.md');

  if (!await fileExists(uprPath)) {
    process.exitCode = 1;
    logger.error('UPR.md not found - run "danteforge synthesize" first');
    return;
  }

  const uprContent = await fs.readFile(uprPath, 'utf8');
  const state = await loadFn();
  const timestamp = new Date().toISOString();

  const prompt = `You are a senior software architect and project planner. Review and refine this Ultimate Planning Resource (UPR.md) for a production software project.

Your job:
1. Identify gaps, risks, or inconsistencies in the plan
2. Suggest concrete improvements with actionable steps
3. Prioritize the next 5 tasks to work on
4. Flag any architectural concerns
5. Generate refined specifications for the highest-priority items

${state.constitution ? `Project principles (must be followed):\n${state.constitution}\n` : ''}
Current workflow stage: ${state.workflowStage}
Current execution wave: ${state.currentPhase}
Profile: ${state.profile}

=== FULL UPR CONTENT ===
${uprContent}
=== END UPR ===

Output a refined markdown document with:
- Executive summary of findings
- Prioritized action items (numbered, with effort estimates)
- Refined specs for top 3 items
- Risk assessment
- Suggested next DanteForge commands to run`;

  if (options.auto) {
    const available = await llmAvailFn();
    if (!available) {
      process.exitCode = 1;
      logger.error('feedback --auto requires a verified live LLM provider. Configure a provider with working model access or start Ollama with the configured model first.');
      return;
    }

    logger.info('Sending UPR.md to the configured LLM provider for refinement...');
    try {
      const refined = await llmFn(prompt, undefined, { enrichContext: true });
      const refinedPath = path.join(STATE_DIR, 'REFINED_UPR.md');
      await fs.writeFile(refinedPath, refined);

      state.auditLog.push(`${timestamp} | feedback: REFINED_UPR.md generated via API`);
      await saveFn(state);

      logger.success('REFINED_UPR.md generated via API');
      logger.info('Find it at .danteforge/REFINED_UPR.md');
      logger.info('Run "danteforge synthesize" to merge it into the next UPR.md');
      return;
    } catch (err) {
      process.exitCode = 1;
      logger.error(`feedback --auto failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
  }

  const savedPath = await savePrompt('feedback', prompt);
  displayPrompt(prompt, [
    'Steps:',
    '1. Copy the prompt above',
    '2. Paste into Claude Code, ChatGPT, Codex, or any LLM',
    '3. Copy the generated output',
    '4. Run: danteforge import <file> --as REFINED_UPR.md',
    '5. Run: danteforge synthesize (to merge refinements into next UPR)',
    '',
    `Prompt also saved to: ${savedPath}`,
  ].join('\n'));

  state.auditLog.push(`${timestamp} | feedback: prompt generated for manual LLM`);
  await saveFn(state);
  });
}
