// Task verification - validates task output against acceptance criteria.
import { loadState, saveState } from './state.js';
import { logger } from './logger.js';
import { buildVerifyPrompt, savePrompt, displayPrompt } from './prompt-builder.js';
import { isLLMAvailable, callLLM } from './llm.js';

/**
 * Parse a PASS/FAIL verdict from an LLM response.
 * Looks at the first non-empty line for an explicit verdict keyword.
 */
function parseVerdict(response: string): { passed: boolean; explanation: string } {
  const lines = response.trim().split('\n');
  const firstLine = (lines[0] ?? '').trim().toUpperCase();

  const failMatch = /^(FAIL|FAILED)\b/.test(firstLine);
  const passMatch = /^(PASS|PASSED)\b/.test(firstLine);
  const passed = passMatch && !failMatch;
  const explanation = lines.slice(1).join('\n').trim();

  return { passed, explanation };
}

export async function verifyTask(task: { name: string; verify?: string }, taskOutput?: string): Promise<boolean> {
  logger.info(`Verifying: ${task.name}`);
  const state = await loadState();
  const criteria = task.verify ?? 'Output matches spec and is production-ready';
  const timestamp = new Date().toISOString();

  if (!taskOutput || taskOutput.trim().length === 0) {
    logger.error(`Verification blocked: no task output was provided for "${task.name}".`);
    state.auditLog.push(`${timestamp} | verify: ${task.name} - BLOCKED (missing task output)`);
    await saveState(state);
    process.exitCode = 1;
    return false;
  }

  const llmReady = await isLLMAvailable();
  if (!llmReady) {
    logger.error(`Verification blocked: no verified live LLM provider is available for "${task.name}".`);
    logger.info(`Run "danteforge feedback" or generate a manual verification prompt for "${task.name}".`);
    state.auditLog.push(`${timestamp} | verify: ${task.name} - BLOCKED (no live verifier)`);
    await saveState(state);
    process.exitCode = 1;
    return false;
  }

  try {
    const prompt = buildVerifyPrompt(task.name, taskOutput, criteria, state.constitution);
    const response = await callLLM(prompt, undefined, { enrichContext: true });
    const { passed, explanation } = parseVerdict(response);

    if (passed) {
      logger.success(`Verification PASSED: ${task.name}`);
    } else {
      logger.error(`Verification FAILED: ${task.name}`);
      if (explanation) {
        logger.info(`Reason: ${explanation.slice(0, 500)}`);
      }
    }

    state.auditLog.push(`${timestamp} | verify: ${task.name} - ${passed ? 'PASS' : 'FAIL'} (LLM)`);
    await saveState(state);
    if (!passed) process.exitCode = 1;
    return passed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`LLM verification failed: ${message}`);
    state.auditLog.push(`${timestamp} | verify: ${task.name} - ERROR (LLM: ${message})`);
    await saveState(state);
    process.exitCode = 1;
    return false;
  }
}

export { parseVerdict };

/**
 * Generate a verification prompt for manual LLM review.
 */
export async function generateVerifyPrompt(taskName: string, taskOutput: string, criteria: string): Promise<string> {
  const state = await loadState();
  const prompt = buildVerifyPrompt(taskName, taskOutput, criteria, state.constitution);
  const savedPath = await savePrompt(`verify-${taskName.replace(/\s+/g, '-').toLowerCase()}`, prompt);

  displayPrompt(prompt, [
    'Paste into Claude Code / ChatGPT to get a PASS/FAIL verification.',
    `Prompt saved to: ${savedPath}`,
  ].join('\n'));

  state.auditLog.push(`${new Date().toISOString()} | verify prompt generated for: ${taskName}`);
  await saveState(state);
  return prompt;
}
