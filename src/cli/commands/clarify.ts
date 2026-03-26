import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState, recordWorkflowStage, saveState } from '../../core/state.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { displayPrompt, savePrompt } from '../../core/prompt-builder.js';
import { buildLocalClarify, writeArtifact } from '../../core/local-artifacts.js';
import { runGate, requireSpec } from '../../core/gates.js';

const STATE_DIR = '.danteforge';

export async function clarify(options: {
  prompt?: boolean;
  light?: boolean;
  /** Injection seam for testing: replaces runGate + requireSpec */
  _runGate?: () => Promise<boolean>;
  /** Injection seam for testing: replaces isLLMAvailable */
  _isLLMAvailable?: () => Promise<boolean>;
  /** Injection seam for testing: replaces callLLM */
  _callLLM?: (prompt: string) => Promise<string>;
  /** Injection seam for testing: replaces writeArtifact */
  _writeArtifact?: (name: string, content: string) => Promise<void>;
} = {}) {
  logger.info('Running clarification Q&A on current spec...');

  const _gate = options._runGate ?? (() => runGate(() => requireSpec(options.light)));
  if (!(await _gate())) { process.exitCode = 1; return; }

  const state = await loadState();

  let specContent = '';
  let currentState = '';
  try {
    specContent = await fs.readFile(path.join(STATE_DIR, 'SPEC.md'), 'utf8');
  } catch {}
  try {
    currentState = await fs.readFile(path.join(STATE_DIR, 'CURRENT_STATE.md'), 'utf8');
  } catch {}

  const prompt = `You are a senior QA engineer reviewing a software specification for gaps, ambiguities, and inconsistencies.

${state.constitution ? `Project principles (must be enforced):\n${state.constitution}\n` : ''}
${specContent ? `Specification to review:\n${specContent.slice(0, 4000)}\n` : '(No spec found - generate general clarification questions)'}
${currentState ? `Current project state:\n${currentState.slice(0, 2000)}\n` : ''}

Generate a CLARIFY.md with:
1. **Ambiguities Found** - vague requirements that need clarification
2. **Missing Requirements** - gaps in the spec (edge cases, error handling, etc.)
3. **Consistency Issues** - contradictions between spec sections or with project principles
4. **Clarification Questions** - numbered list of specific questions to resolve each issue
5. **Suggested Defaults** - for each question, suggest a reasonable default answer

Output ONLY the markdown content - no preamble.`;

  if (options.prompt) {
    const savedPath = await savePrompt('clarify', prompt);
    displayPrompt(prompt, [
      'Paste into your LLM, then run: danteforge import <file> --as CLARIFY.md',
      `Prompt saved to: ${savedPath}`,
    ].join('\n'));
    state.auditLog.push(`${new Date().toISOString()} | clarify: prompt generated`);
    await saveState(state);
    return;
  }

  const _isLLMAvailableFn = options._isLLMAvailable ?? isLLMAvailable;
  const _callLLMFn = options._callLLM ?? ((p: string) => callLLM(p, undefined, { enrichContext: true }));
  const _writeArtifactFn = options._writeArtifact ?? writeArtifact;

  const llmAvailable = await _isLLMAvailableFn();
  if (llmAvailable) {
    logger.info('Sending to LLM for spec review...');
    try {
      const clarifyMd = await _callLLMFn(prompt);
      await _writeArtifactFn('CLARIFY.md', clarifyMd);

      const timestamp = recordWorkflowStage(state, 'clarify');
      state.auditLog.push(`${timestamp} | clarify: CLARIFY.md generated via API`);
      await saveState(state);
      logger.success('CLARIFY.md generated - review and resolve, then run "danteforge plan"');
      return;
    } catch (err) {
      logger.warn(`API call failed: ${err instanceof Error ? err.message : String(err)}`);
      logger.info('Falling back to local artifact generation...');
    }
  }

  await _writeArtifactFn('CLARIFY.md', buildLocalClarify(specContent, currentState));
  const timestamp = recordWorkflowStage(state, 'clarify');
  state.auditLog.push(`${timestamp} | clarify: CLARIFY.md generated locally`);
  await saveState(state);
  logger.success('CLARIFY.md generated locally - review and resolve, then run "danteforge plan"');
  if (!llmAvailable) {
    logger.info('Tip: Set up an API key for richer clarification output: danteforge config --set-key "grok:<key>"');
  }
}
