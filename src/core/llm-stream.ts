// LLM Streaming — Real token streaming for Ollama (NDJSON) and Claude (SSE).
// Falls back to simulation for other providers.

import { callLLM, isLLMAvailable, type CallLLMOptions } from './llm.js';
import { loadConfig, getDefaultModel, getDefaultBaseUrl } from './config.js';
import { logger } from './logger.js';
import { NetworkError, LLMError } from './errors.js';

export interface LLMStreamDeps {
  _fetchStream?: typeof fetch;
  _loadConfig?: typeof loadConfig;
  _callLLM?: typeof callLLM;
  _isLLMAvailable?: () => Promise<boolean>;
}

async function streamOllama(
  prompt: string,
  model: string,
  baseUrl: string,
  onChunk: (chunk: string) => void,
  deps: LLMStreamDeps,
): Promise<string> {
  const fetchFn = deps._fetchStream ?? fetch;
  const response = await fetchFn(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: true }),
  });

  if (!response.ok || !response.body) {
    throw new LLMError(`Ollama streaming failed: ${response.status}`, 'ollama');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { response?: string; done?: boolean };
        if (parsed.response) {
          accumulated += parsed.response;
          onChunk(parsed.response);
        }
        if (parsed.done) break;
      } catch {
        // Skip malformed lines
      }
    }
  }

  return accumulated;
}

async function streamClaude(
  prompt: string,
  model: string,
  apiKey: string,
  onChunk: (chunk: string) => void,
  deps: LLMStreamDeps,
): Promise<string> {
  const fetchFn = deps._fetchStream ?? fetch;
  const response = await fetchFn('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      stream: true,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok || !response.body) {
    throw new LLMError(`Claude streaming failed: ${response.status}`, 'claude');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') break;
      try {
        const parsed = JSON.parse(data) as { type?: string; delta?: { type?: string; text?: string } };
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta' && parsed.delta.text) {
          accumulated += parsed.delta.text;
          onChunk(parsed.delta.text);
        }
      } catch {
        // Skip malformed SSE events
      }
    }
  }

  return accumulated;
}

export async function callLLMWithProgress(
  prompt: string,
  onChunk: (chunk: string) => void,
  providerOverride?: string,
  options?: CallLLMOptions,
  deps: LLMStreamDeps = {},
): Promise<string> {
  const llmAvailableFn = deps._isLLMAvailable ?? isLLMAvailable;
  const llmReady = await llmAvailableFn();
  if (!llmReady) {
    throw new NetworkError('No verified live LLM provider is available.');
  }

  const configFn = deps._loadConfig ?? loadConfig;
  const config = await configFn();
  const provider = providerOverride ?? config.defaultProvider ?? 'ollama';

  try {
    if (provider === 'ollama') {
      const providerCfg = config.providers?.['ollama'];
      const baseUrl = providerCfg?.baseUrl ?? getDefaultBaseUrl('ollama') ?? 'http://127.0.0.1:11434';
      const model = providerCfg?.model ?? config.ollamaModel ?? getDefaultModel('ollama');
      return await streamOllama(prompt, model, baseUrl, onChunk, deps);
    }

    if (provider === 'claude') {
      const providerCfg = config.providers?.['claude'];
      const apiKey = providerCfg?.apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
      const model = providerCfg?.model ?? getDefaultModel('claude');
      return await streamClaude(prompt, model, apiKey, onChunk, deps);
    }
  } catch (err) {
    // Fall through to simulation on streaming failure
    logger.warn(`Real streaming failed for ${provider}, falling back to simulation: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Simulation fallback for all other providers
  const callFn = deps._callLLM ?? callLLM;
  let response: string;
  try {
    response = await callFn(prompt, providerOverride as any, options);
  } catch (err) {
    throw new LLMError(
      `Streaming call failed: ${err instanceof Error ? err.message : String(err)}`,
      providerOverride ?? undefined,
    );
  }

  const chunkSize = 100;
  for (let i = 0; i < response.length; i += chunkSize) {
    onChunk(response.slice(i, i + chunkSize));
  }
  return response;
}

export function supportsStreaming(provider: string): boolean {
  return ['claude', 'ollama'].includes(provider);
}
