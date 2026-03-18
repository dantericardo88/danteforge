import { callLLM, isLLMAvailable } from '../../../core/llm.js';
import { logger } from '../../../core/logger.js';

export async function runAgentPrompt(
  agentName: string,
  prompt: string,
  successMessage: string,
): Promise<string> {
  const llmReady = await isLLMAvailable();
  if (!llmReady) {
    throw new Error(`${agentName} requires a verified live LLM provider.`);
  }

  try {
    const response = await callLLM(prompt, undefined, { enrichContext: true });
    logger.success(successMessage);
    return response;
  } catch (err) {
    throw new Error(`${agentName} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
