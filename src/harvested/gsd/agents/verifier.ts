// Verification agent - validates task output against acceptance criteria.
import { callLLM, isLLMAvailable } from '../../../core/llm.js';
import { logger } from '../../../core/logger.js';

/**
 * Verify whether a task output satisfies the given acceptance criteria.
 * This path is fail-closed: missing live verification or empty output is a failure.
 */
export async function verify(taskOutput: string, criteria: string): Promise<boolean> {
  logger.info(`Verifying output against criteria: ${criteria}`);

  if (!taskOutput || taskOutput.trim().length === 0) {
    logger.error('Verification blocked: task output is empty.');
    process.exitCode = 1;
    return false;
  }

  if (!await isLLMAvailable()) {
    logger.error('Verification blocked: no verified live LLM provider is available.');
    process.exitCode = 1;
    return false;
  }

  try {
    const prompt = [
      'You are a strict quality assurance reviewer. Evaluate whether the ',
      'following task output meets ALL of the acceptance criteria listed below.\n\n',
      '## Task Output\n',
      taskOutput,
      '\n\n## Acceptance Criteria\n',
      criteria,
      '\n\n',
      'Respond with exactly one of the following on the first line:\n',
      'PASS - if the output meets ALL criteria\n',
      'FAIL - if the output does NOT meet one or more criteria\n\n',
      'Then provide a brief explanation of your assessment on subsequent lines.',
    ].join('');

    const response = await callLLM(prompt, undefined, { enrichContext: true });
    const result = parseVerdict(response);

    if (result.passed) {
      logger.success(`Verification PASSED: ${result.explanation}`);
      return true;
    }

    logger.error(`Verification FAILED: ${result.explanation}`);
    process.exitCode = 1;
    return false;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`LLM verification failed: ${message}`);
    process.exitCode = 1;
    return false;
  }
}

/**
 * Parse the LLM response for a PASS/FAIL verdict and extract the explanation.
 * Uses anchored regex to prevent prompt injection via mid-sentence keywords.
 */
function parseVerdict(response: string): { passed: boolean; explanation: string } {
  const lines = response.trim().split('\n');
  const firstLine = (lines[0] ?? '').trim().toUpperCase();
  const failMatch = /^(FAIL|FAILED)\b/.test(firstLine);
  const passMatch = /^(PASS|PASSED)\b/.test(firstLine);
  const passed = passMatch && !failMatch;
  const explanation = lines.slice(1).join('\n').trim() || 'No explanation provided';

  return { passed, explanation };
}
