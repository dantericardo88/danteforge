// LLM Streaming — Wraps existing callLLM with progressive chunk delivery
// Falls back to non-streaming callLLM when streaming isn't available.

import { callLLM, isLLMAvailable, type CallLLMOptions } from './llm.js';
import type { LLMProvider } from './config.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

/**
 * Call LLM with a progress callback for real-time output.
 * Falls back to non-streaming when the provider doesn't support it.
 */
export async function callLLMWithProgress(
  prompt: string,
  onChunk: (chunk: string) => void,
  providerOverride?: LLMProvider,
  options?: CallLLMOptions,
): Promise<string> {
  // Streaming is provider-dependent and requires SDK-level support.
  // For now, fall back to non-streaming with a simulated progress callback.
  const llmReady = await isLLMAvailable();
  if (!llmReady) {
    throw new Error('No verified live LLM provider is available.');
  }

  // Call the standard LLM and deliver the result in chunks
  const response = await callLLM(prompt, providerOverride, options);

  // Simulate streaming by breaking response into chunks
  const chunkSize = 100;
  for (let i = 0; i < response.length; i += chunkSize) {
    const chunk = response.slice(i, i + chunkSize);
    onChunk(chunk);
  }

  return response;
}

/**
 * Check if the current provider supports native streaming.
 */
export async function supportsStreaming(): Promise<boolean> {
  const config = await loadConfig();
  const provider = config.defaultProvider ?? 'ollama';
  // Claude, OpenAI, Grok, and Ollama all support streaming natively
  return ['claude', 'openai', 'grok', 'ollama', 'gemini'].includes(provider);
}
