import { callLLM, isLLMAvailable } from '../../../core/llm.js';
import { logger } from '../../../core/logger.js';

export async function runAgentPrompt(
  agentName: string,
  prompt: string,
  successMessage: string,
  _isLLMAvailable?: () => Promise<boolean>,
  _callLLM?: (prompt: string, override?: unknown, opts?: unknown) => Promise<string>,
): Promise<string> {
  const llmReady = await (_isLLMAvailable ?? isLLMAvailable)();
  if (!llmReady) {
    throw new Error(`${agentName} requires a verified live LLM provider.`);
  }

  try {
    const response = await (_callLLM ?? callLLM)(prompt, undefined, { enrichContext: true });
    logger.success(successMessage);
    return response;
  } catch (err) {
    throw new Error(`${agentName} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
