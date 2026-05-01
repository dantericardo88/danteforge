// Multi-provider LLM client - Grok, Claude, OpenAI, Gemini, Ollama + registry providers
// Uses direct HTTP calls so package installs work without optional provider SDKs.
import type { CallLLMOptions } from './llm-pipeline.js';
import { resolveProvider, loadConfig, getDefaultModel, type LLMProvider } from './config.js';
import { getProvider as getRegistryProvider, isRegisteredProvider } from './llm-provider.js';
import { checkContextRot, truncateContext } from '../harvested/gsd/hooks/context-rot.js';
import { warnIfExpensive } from './token-estimator.js';
import { logger } from './logger.js';
import { loadState, saveState } from './state.js';
import { injectContext } from './context-injector.js';
import { recordMemory } from './memory-engine.js';
import { LLMError } from './errors.js';

const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [1000, 3000];
export const DEFAULT_LLM_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS = 180_000;

export interface ProbeResult {
  ok: boolean;
  provider: LLMProvider;
  model: string;
  message: string;
}

export const VERIFIED_LLM_PROVIDER_LABEL = 'verified live LLM provider';

function parseTimeoutMs(rawValue: string | undefined, fallbackMs: number): number {
  const value = rawValue?.trim();
  if (!value) return fallbackMs;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackMs;
  }

  return parsed;
}

export function resolveProviderRequestTimeoutMs(
  provider: LLMProvider,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const baseTimeout = parseTimeoutMs(
    env.DANTEFORGE_LLM_TIMEOUT_MS ?? env.DANTEFORGE_LIVE_TIMEOUT_MS,
    DEFAULT_LLM_REQUEST_TIMEOUT_MS,
  );

  if (provider === 'ollama') {
    return parseTimeoutMs(
      env.OLLAMA_TIMEOUT_MS,
      Math.max(baseTimeout, DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS),
    );
  }

  return baseTimeout;
}

export function isRetryableError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('econnreset')
    || msg.includes('econnrefused')
    || msg.includes('etimedout')
    || msg.includes('socket hang up')
    || msg.includes('request timed out after')
    || msg.includes('fetch failed')
    || msg.includes('rate limit')
    || msg.includes('429')
    || msg.includes('503')
    || msg.includes('502');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function displayProvider(provider: LLMProvider): string {
  switch (provider) {
    case 'grok': return 'xAI Grok';
    case 'claude': return 'Anthropic Claude';
    case 'openai': return 'OpenAI';
    case 'gemini': return 'Google Gemini';
    case 'ollama': return 'Ollama';
    default: {
      const adapter = getRegistryProvider(provider);
      return adapter?.displayName ?? provider;
    }
  }
}

function normalizeBaseUrl(provider: LLMProvider, baseUrl?: string): string {
  if (baseUrl) {
    return baseUrl.replace(/\/+$/, '');
  }

  switch (provider) {
    case 'grok': return 'https://api.x.ai/v1';
    case 'openai': return 'https://api.openai.com/v1';
    case 'claude': return 'https://api.anthropic.com';
    case 'gemini': return 'https://generativelanguage.googleapis.com/v1beta';
    case 'ollama': return 'http://127.0.0.1:11434';
    default: {
      const adapter = getRegistryProvider(provider);
      return adapter?.defaultBaseUrl ?? 'https://api.openai.com/v1';
    }
  }
}

function resolveStandardProviderApiKey(provider: LLMProvider): string | undefined {
  switch (provider) {
    case 'claude':
      return process.env.ANTHROPIC_API_KEY ?? process.env.DANTEFORGE_ANTHROPIC_API_KEY;
    case 'openai':
      return process.env.OPENAI_API_KEY;
    case 'grok':
      return process.env.XAI_API_KEY ?? process.env.GROK_API_KEY;
    case 'gemini':
      return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    case 'together':
      return process.env.TOGETHER_API_KEY;
    case 'groq':
      return process.env.GROQ_API_KEY;
    case 'mistral':
      return process.env.MISTRAL_API_KEY;
    default:
      return undefined;
  }
}

function requireApiKey(provider: LLMProvider, apiKey: string | undefined): string {
  if (!apiKey) {
    throw new Error(
      `No API key found for provider '${provider}'.\n` +
      `  Fix: run \`danteforge config --set-key ${provider}\`\n` +
      `  Or:  set the ${provider.toUpperCase()}_API_KEY environment variable.\n` +
      `  Or:  run \`danteforge init\` to configure a provider interactively.`
    );
  }
  return apiKey;
}

function normalizeProviderError(provider: LLMProvider, status: number, body: string): Error {
  const label = displayProvider(provider);
  const snippet = body.replace(/\s+/g, ' ').slice(0, 240).trim();

  if (status === 401 || status === 403) {
    return new Error(
      `${label} authentication failed (HTTP ${status}).\n` +
      `  Your API key may be expired or invalid.\n` +
      `  Fix: run \`danteforge config --set-key ${provider}\` with a fresh key.`
    );
  }
  if (status === 404) {
    return new Error(`${label} endpoint or model was not found (404). Check the configured base URL and model.`);
  }
  if (status === 408) {
    return new Error(`${label} request timed out (408).`);
  }
  if (status === 429) {
    return new Error(`${label} rate limit exceeded (429). Retry later or lower request volume.`);
  }
  if (status >= 500) {
    return new Error(`${label} is temporarily unavailable (${status}).`);
  }

  return new Error(`${label} request failed (${status})${snippet ? `: ${snippet}` : ''}`);
}

async function fetchProviderJson(
  provider: LLMProvider,
  url: string,
  init: RequestInit,
  timeoutMs = resolveProviderRequestTimeoutMs(provider),
  fetchFn?: typeof globalThis.fetch,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const useFetch = fetchFn ?? _llmFetchOverride ?? globalThis.fetch;

  try {
    const response = await useFetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    const raw = await response.text();
    if (!response.ok) {
      throw normalizeProviderError(provider, response.status, raw);
    }

    if (!raw.trim()) {
      return {};
    }

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`${displayProvider(provider)} returned invalid JSON.`);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`${displayProvider(provider)} request timed out after ${timeoutMs}ms.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function extractOpenAICompatibleText(payload: unknown): string {
  const content = (payload as {
    choices?: Array<{
      message?: {
        content?: string | Array<{ text?: string; type?: string }>;
      };
    }>;
  })?.choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map(part => part?.text ?? '')
      .join('')
      .trim();
  }

  return '';
}

function extractClaudeText(payload: unknown): string {
  const content = (payload as {
    content?: Array<{ type?: string; text?: string }>;
  })?.content ?? [];

  return content
    .filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text)
    .join('')
    .trim();
}

function extractGeminiText(payload: unknown): string {
  const candidates = (payload as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  })?.candidates ?? [];

  return candidates
    .flatMap(candidate => candidate.content?.parts ?? [])
    .map(part => part.text ?? '')
    .join('')
    .trim();
}

function normalizeModelName(model: string): string {
  return model.trim().toLowerCase().replace(/^models\//, '');
}

function modelMatches(configuredModel: string, candidateModel: string): boolean {
  const configured = normalizeModelName(configuredModel);
  const candidate = normalizeModelName(candidateModel);

  if (configured === candidate) return true;

  const configuredBase = configured.split(':')[0] ?? configured;
  const candidateBase = candidate.split(':')[0] ?? candidate;
  return configuredBase === candidateBase;
}

function dedupeModelNames(models: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const model of models) {
    const normalized = normalizeModelName(model);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(model);
  }
  return unique;
}

function extractProviderModelNames(provider: LLMProvider, payload: unknown): string[] {
  switch (provider) {
    case 'grok':
    case 'openai':
    case 'claude': {
      const models = (payload as { data?: Array<{ id?: string; name?: string }> })?.data ?? [];
      return models.flatMap(model => [model.id, model.name].filter((value): value is string => Boolean(value)));
    }
    case 'gemini': {
      const models = (payload as { models?: Array<{ name?: string; displayName?: string }> })?.models ?? [];
      return models.flatMap(model => [model.name, model.displayName].filter((value): value is string => Boolean(value)));
    }
    case 'ollama': {
      const models = (payload as { models?: Array<{ name?: string; model?: string }> })?.models ?? [];
      return models.flatMap(model => [model.model, model.name].filter((value): value is string => Boolean(value)));
    }
    default:
      return [];
  }
}

function resolveOllamaModelName(configuredModel: string, availableModels: string[]): string {
  const configured = normalizeModelName(configuredModel);
  const exactMatch = availableModels.find(candidate => normalizeModelName(candidate) === configured);
  if (exactMatch) return exactMatch;

  const configuredBase = configured.split(':')[0] ?? configured;
  const baseMatches = availableModels.filter(candidate => {
    const candidateBase = normalizeModelName(candidate).split(':')[0] ?? normalizeModelName(candidate);
    return candidateBase === configuredBase;
  });

  if (baseMatches.length === 1) {
    return baseMatches[0]!;
  }
  if (baseMatches.length > 1) {
    throw new Error(
      `Multiple Ollama models match "${configuredModel}": ${baseMatches.join(', ')}. Configure the exact Ollama model tag.`,
    );
  }

  throw new Error(`Ollama model "${configuredModel}" is not available from the configured endpoint.`);
}

function resolveConfiguredModelName(provider: LLMProvider, configuredModel: string, payload: unknown): string {
  const availableModels = dedupeModelNames(extractProviderModelNames(provider, payload));
  if (availableModels.length === 0) {
    throw new Error(`${displayProvider(provider)} model listing was reachable, but no models were returned.`);
  }

  if (provider === 'ollama') {
    return resolveOllamaModelName(configuredModel, availableModels);
  }

  const match = availableModels.find(candidate => modelMatches(configuredModel, candidate));
  if (!match) {
    throw new Error(`${displayProvider(provider)} model "${configuredModel}" is not available from the configured endpoint.`);
  }
  return match;
}

async function resolveOllamaCallableModel(configuredModel: string, baseUrl: string, fetchFn?: typeof globalThis.fetch): Promise<string> {
  const payload = await fetchProviderJson('ollama', `${baseUrl}/api/tags`, {
    method: 'GET',
  }, undefined, fetchFn);
  return resolveConfiguredModelName('ollama', configuredModel, payload);
}

async function resolveCallTarget(providerOverride?: LLMProvider, modelOverride?: string) {
  const resolved = await resolveProvider();
  const provider = providerOverride ?? resolved.provider;
  const config = await loadConfig();
  const providerConfig = config.providers[provider];

  // When the provider is overridden, fall back to that provider's own defaults rather than
  // bleeding the default-provider's model/apiKey/baseUrl (e.g. Ollama's URL for a Claude call).
  const isOverridden = Boolean(providerOverride);
  const fallbackModel = isOverridden ? getDefaultModel(provider) : resolved.model;
  const fallbackApiKey = isOverridden ? undefined : resolved.apiKey;
  const fallbackBaseUrl = isOverridden ? undefined : resolved.baseUrl;

  return {
    provider,
    model: modelOverride ?? providerConfig?.model ?? fallbackModel,
    apiKey: providerConfig?.apiKey
      ?? fallbackApiKey
      ?? resolveStandardProviderApiKey(provider)
      // CI/CD: DANTEFORGE_LLM_API_KEY (generic) or DANTEFORGE_<PROVIDER>_API_KEY (provider-specific)
      ?? process.env[`DANTEFORGE_${provider.toUpperCase()}_API_KEY`]
      ?? process.env.DANTEFORGE_LLM_API_KEY,
    baseUrl: normalizeBaseUrl(provider, providerConfig?.baseUrl ?? fallbackBaseUrl),
    ollamaModel: config.ollamaModel || resolved.model,
  };
}

/**
 * Call the configured LLM provider with automatic retry for transient failures.
 * Includes token estimation warnings for expensive calls.
 * Supports onUsage callback and budgetFence for per-call cost tracking.
 * onUsage?: (usage: LLMUsageMetadata) => void
 */
export async function callLLM(
  prompt: string,
  providerOverride?: LLMProvider,
  options: CallLLMOptions = {},
): Promise<string> {
  return _callLLMInner(prompt, providerOverride, options);
}

async function handleCallSuccess(
  result: ProviderCallResult,
  options: CallLLMOptions,
  target: Awaited<ReturnType<typeof resolveCallTarget>>,
  modelUsed: string,
  enrichedPrompt: string,
  attempt: number,
): Promise<string> {
  if (result.usage && (options.onUsage || options.budgetFence)) {
    try {
      const { estimateCost } = await import('./token-estimator.js');
      const totalTokens = result.usage.inputTokens + result.usage.outputTokens;
      const costData = estimateCost(totalTokens, target.provider);
      const usageMeta: LLMUsageMetadata = {
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd: costData.totalEstimate,
        model: modelUsed,
        provider: target.provider,
      };
      if (options.onUsage) {
        try { options.onUsage(usageMeta); } catch { /* best-effort */ }
      }
      if (options.budgetFence) {
        options.budgetFence.currentSpendUsd += costData.totalEstimate;
        if (options.budgetFence.currentSpendUsd >= options.budgetFence.maxBudgetUsd) {
          options.budgetFence.isExceeded = true;
        }
      }
    } catch { /* best-effort usage tracking */ }
  }
  // Audit-log the LLM call. Wrapped in try-catch because concurrent CLI processes can
  // corrupt STATE.yaml via simultaneous read-modify-write; losing one audit entry is
  // acceptable but crashing the caller is not.
  try {
    const state = await loadState({ cwd: options.cwd });
    state.auditLog.push(`${new Date().toISOString()} | llm: ${target.provider}/${modelUsed} (${result.text.length} chars returned${attempt > 0 ? `, attempt ${attempt + 1}` : ''})`);
    await saveState(state, { cwd: options.cwd });
  } catch { /* best-effort audit logging — concurrent writers can corrupt STATE.yaml */ }
  if (options.recordMemory !== false) {
    await recordMemory({
      category: 'command',
      summary: `LLM call: ${target.provider}/${modelUsed}`,
      detail: `Prompt chars: ${enrichedPrompt.length}. Response chars: ${result.text.length}.`,
      tags: ['llm', target.provider, modelUsed],
      relatedCommands: ['llm'],
    }, options.cwd);
  }
  return result.text;
}

async function _callLLMInner(
  prompt: string,
  providerOverride?: LLMProvider,
  options: CallLLMOptions = {},
): Promise<string> {
  // Resolve the per-call fetch: prefer per-call _fetch, then module-level override, then globalThis
  const perCallFetch: typeof globalThis.fetch | undefined = options._fetch ?? _llmFetchOverride;

  const target = await resolveCallTarget(providerOverride, options.model);
  let modelUsed = target.model;
  let enrichedPrompt = options.enrichContext
    ? await injectContext(prompt, undefined, options.cwd)
    : prompt;

  const rotResult = checkContextRot(enrichedPrompt.length);
  if (rotResult.shouldTruncate && rotResult.truncateTarget) {
    enrichedPrompt = truncateContext(enrichedPrompt, rotResult.truncateTarget);
  }
  await warnIfExpensive(enrichedPrompt, target.provider);
  logger.info(`LLM call: ${target.provider}/${modelUsed} (${enrichedPrompt.length} chars)`);

  // Enforce budget fence before making any API call
  if (options.budgetFence) {
    const fence = options.budgetFence;
    if (fence.isExceeded || fence.currentSpendUsd >= fence.maxBudgetUsd) {
      throw new Error(`Budget fence exceeded for ${fence.agentRole}: $${fence.currentSpendUsd.toFixed(4)} of $${fence.maxBudgetUsd.toFixed(4)} max`);
    }
  }

  let result: ProviderCallResult = { text: '' };
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      switch (target.provider) {
        case 'grok':
        case 'openai':
          result = await callOpenAICompatible(enrichedPrompt, target.provider, target.apiKey, target.model, target.baseUrl, perCallFetch);
          break;
        case 'claude':
          result = await callClaude(enrichedPrompt, target.apiKey, target.model, target.baseUrl, perCallFetch);
          break;
        case 'gemini':
          result = await callGemini(enrichedPrompt, target.apiKey, target.model, target.baseUrl, perCallFetch);
          break;
        case 'ollama': {
          modelUsed = await resolveOllamaCallableModel(target.ollamaModel, target.baseUrl, perCallFetch);
          result = await callOllama(enrichedPrompt, modelUsed, target.baseUrl, perCallFetch);
          break;
        }
        default: {
          // Try the provider registry for additional providers (together, groq, mistral, etc.)
          const adapter = getRegistryProvider(target.provider);
          if (adapter) {
            const timeoutMs = resolveProviderRequestTimeoutMs(target.provider);
            const model = target.model || adapter.defaultModel;
            const baseUrl = target.baseUrl || adapter.defaultBaseUrl;
            const text = await adapter.call(enrichedPrompt, model, baseUrl, target.apiKey, timeoutMs);
            result = { text };
          } else {
            throw new LLMError(`Unknown provider: ${target.provider}. Built-in: grok, claude, openai, gemini, ollama. Extended: together, groq, mistral.`, target.provider, undefined, 'LLM_UNKNOWN_PROVIDER');
          }
        }
      }

      return await handleCallSuccess(result, options, target, modelUsed, enrichedPrompt, attempt);
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES && isRetryableError(err)) {
        const delay = RETRY_DELAYS_MS[attempt]!;
        logger.warn(`LLM call failed (attempt ${attempt + 1}/${MAX_RETRIES + 1}): ${err instanceof Error ? err.message : String(err)} - retrying in ${delay}ms`);
        await sleep(delay);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
}

/**
 * Check if the configured LLM has a usable live path.
 */
export async function isLLMAvailable(): Promise<boolean> {
  const probe = await probeLLMProvider();
  return probe.ok;
}

export async function probeLLMProvider(providerOverride?: LLMProvider): Promise<ProbeResult> {
  const target = await resolveCallTarget(providerOverride);

  try {
    switch (target.provider) {
      case 'grok':
      case 'openai': {
        const key = requireApiKey(target.provider, target.apiKey);
        const payload = await fetchProviderJson(target.provider, `${target.baseUrl}/models`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${key}`,
          },
        });
        const resolvedModel = resolveConfiguredModelName(target.provider, target.model, payload);
        return { ok: true, provider: target.provider, model: resolvedModel, message: `${displayProvider(target.provider)} model "${resolvedModel}" is reachable.` };
      }
      case 'claude': {
        const key = requireApiKey('claude', target.apiKey);
        const payload = await fetchProviderJson('claude', `${target.baseUrl}/v1/models`, {
          method: 'GET',
          headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
          },
        });
        const resolvedModel = resolveConfiguredModelName('claude', target.model, payload);
        return { ok: true, provider: 'claude', model: resolvedModel, message: `Anthropic Claude model "${resolvedModel}" is reachable.` };
      }
      case 'gemini': {
        const key = requireApiKey('gemini', target.apiKey);
        const payload = await fetchProviderJson('gemini', `${target.baseUrl}/models?key=${encodeURIComponent(key)}`, {
          method: 'GET',
        });
        const resolvedModel = resolveConfiguredModelName('gemini', target.model, payload);
        return { ok: true, provider: 'gemini', model: resolvedModel, message: `Google Gemini model "${resolvedModel}" is reachable.` };
      }
      case 'ollama': {
        const resolvedModel = await resolveOllamaCallableModel(target.ollamaModel, target.baseUrl);
        const resolutionMessage = resolvedModel === target.ollamaModel
          ? `Ollama model "${resolvedModel}" is reachable.`
          : `Ollama model "${target.ollamaModel}" resolved to "${resolvedModel}" and is reachable.`;
        return { ok: true, provider: 'ollama', model: resolvedModel, message: resolutionMessage };
      }
      default: {
        // Extended providers — just check if we have an API key
        if (isRegisteredProvider(target.provider)) {
          if (!target.apiKey) {
            return { ok: false, provider: target.provider, model: target.model, message: `No API key for ${target.provider}.` };
          }
          return { ok: true, provider: target.provider, model: target.model, message: `${displayProvider(target.provider)} configured (key present).` };
        }
        return { ok: false, provider: target.provider, model: target.model, message: `Unknown provider: ${target.provider}.` };
      }
    }
  } catch (err) {
    return {
      ok: false,
      provider: target.provider,
      model: target.model,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

type ProviderCallResult = { text: string; usage?: { inputTokens: number; outputTokens: number } };

async function callOpenAICompatible(
  prompt: string,
  provider: 'grok' | 'openai',
  apiKey: string | undefined,
  model: string,
  baseUrl: string,
  fetchFn?: typeof globalThis.fetch,
): Promise<ProviderCallResult> {
  const key = requireApiKey(provider, apiKey);
  const payload = await fetchProviderJson(provider, `${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
    }),
  }, undefined, fetchFn);

  const text = extractOpenAICompatibleText(payload);
  if (!text) {
    throw new Error(`${displayProvider(provider)} returned an empty response.`);
  }
  const usage = extractOpenAIUsageLocal(payload);
  return { text, ...(usage ? { usage } : {}) };
}

async function callClaude(
  prompt: string,
  apiKey: string | undefined,
  model: string,
  baseUrl: string,
  fetchFn?: typeof globalThis.fetch,
): Promise<ProviderCallResult> {
  const key = requireApiKey('claude', apiKey);
  const payload = await fetchProviderJson('claude', `${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    }),
  }, undefined, fetchFn);

  const text = extractClaudeText(payload);
  if (!text) {
    throw new Error('Anthropic Claude returned an empty response.');
  }
  const usage = extractClaudeUsageLocal(payload);
  return { text, ...(usage ? { usage } : {}) };
}

async function callGemini(
  prompt: string,
  apiKey: string | undefined,
  model: string,
  baseUrl: string,
  fetchFn?: typeof globalThis.fetch,
): Promise<ProviderCallResult> {
  const key = requireApiKey('gemini', apiKey);
  const payload = await fetchProviderJson(
    'gemini',
    `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 4096,
        },
      }),
    },
    undefined,
    fetchFn,
  );

  const text = extractGeminiText(payload);
  if (!text) {
    throw new Error('Google Gemini returned an empty response.');
  }
  const usage = extractGeminiUsageLocal(payload);
  return { text, ...(usage ? { usage } : {}) };
}

async function callOllama(
  prompt: string,
  model: string,
  baseUrl: string,
  fetchFn?: typeof globalThis.fetch,
): Promise<ProviderCallResult> {
  const payload = await fetchProviderJson('ollama', `${baseUrl}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: 'user', content: prompt }],
    }),
  }, undefined, fetchFn);

  const content = (payload as { message?: { content?: string } })?.message?.content?.trim() ?? '';
  if (!content) {
    throw new Error('Ollama returned an empty response.');
  }
  const usage = extractOllamaUsageLocal(payload);
  return { text: content, ...(usage ? { usage } : {}) };
}

// Local usage extractors that return the simpler {inputTokens, outputTokens} shape
function extractOpenAIUsageLocal(payload: unknown): { inputTokens: number; outputTokens: number } | undefined {
  const u = (payload as Record<string, unknown> | undefined)?.['usage'];
  if (typeof u !== 'object' || u === null) return undefined;
  const rec = u as Record<string, unknown>;
  const input = Number(rec['prompt_tokens'] ?? 0);
  const output = Number(rec['completion_tokens'] ?? 0);
  return (input > 0 || output > 0) ? { inputTokens: input, outputTokens: output } : undefined;
}

function extractClaudeUsageLocal(payload: unknown): { inputTokens: number; outputTokens: number } | undefined {
  const u = (payload as Record<string, unknown> | undefined)?.['usage'];
  if (typeof u !== 'object' || u === null) return undefined;
  const rec = u as Record<string, unknown>;
  const input = Number(rec['input_tokens'] ?? 0);
  const output = Number(rec['output_tokens'] ?? 0);
  return (input > 0 || output > 0) ? { inputTokens: input, outputTokens: output } : undefined;
}

function extractGeminiUsageLocal(payload: unknown): { inputTokens: number; outputTokens: number } | undefined {
  const meta = (payload as Record<string, unknown> | undefined)?.['usageMetadata'];
  if (typeof meta !== 'object' || meta === null) return undefined;
  const rec = meta as Record<string, unknown>;
  const input = Number(rec['promptTokenCount'] ?? 0);
  const output = Number(rec['candidatesTokenCount'] ?? 0);
  return (input > 0 || output > 0) ? { inputTokens: input, outputTokens: output } : undefined;
}

function extractOllamaUsageLocal(payload: unknown): { inputTokens: number; outputTokens: number } | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined;
  const rec = payload as Record<string, unknown>;
  const input = Number(rec['prompt_eval_count'] ?? 0);
  const output = Number(rec['eval_count'] ?? 0);
  return (input > 0 || output > 0) ? { inputTokens: input, outputTokens: output } : undefined;
}
export type { CallLLMOptions } from './llm-pipeline.js';

// ─── Fetch injection seam ────────────────────────────────────────

// Module-level fetch override for backward-compat with tests that use setLLMFetch/resetLLMFetch
let _llmFetchOverride: typeof globalThis.fetch | undefined;

/** Override the module-level fetch function (for test isolation) */
export function setLLMFetch(fn: typeof globalThis.fetch): void {
  _llmFetchOverride = fn;
}

/** Reset module-level fetch override (for test isolation) */
export function resetLLMFetch(): void {
  _llmFetchOverride = undefined;
}

// ─── Type Guards ─────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getField(obj: unknown, key: string): unknown {
  return isRecord(obj) ? obj[key] : undefined;
}

// ─── Usage Extraction (type-guarded) ─────────────────────────────

/** Raw token usage from provider responses (just the counts).
 * Used by extractXXXUsage functions. For full metadata with cost/model/provider,
 * see LLMUsageMetadata (surfaced via onUsage callback).
 */
export interface RawTokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Real token usage metadata extracted from LLM provider responses.
 * Surfaced via the CallLLMOptions.onUsage?: (usage: LLMUsageMetadata) => void callback.
 */
export interface LLMUsageMetadata extends RawTokenUsage {
  /** Estimated cost in USD based on token counts */
  costUsd: number;
  /** Model name used for the call */
  model: string;
  /** Provider name for the call */
  provider: string;
}

/** Extract token usage from an OpenAI-compatible response payload */
export function extractOpenAIUsage(payload: unknown): RawTokenUsage | undefined {
  const usage = getField(payload, 'usage');
  if (!isRecord(usage)) return undefined;
  const input = Number(usage.prompt_tokens ?? 0);
  const output = Number(usage.completion_tokens ?? 0);
  return (input > 0 || output > 0) ? { inputTokens: input, outputTokens: output } : undefined;
}

/** Extract token usage from a Claude/Anthropic response payload */
export function extractClaudeUsage(payload: unknown): RawTokenUsage | undefined {
  const usage = getField(payload, 'usage');
  if (!isRecord(usage)) return undefined;
  const input = Number(usage.input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  return (input > 0 || output > 0) ? { inputTokens: input, outputTokens: output } : undefined;
}

/** Extract token usage from a Gemini response payload */
export function extractGeminiUsage(payload: unknown): RawTokenUsage | undefined {
  const meta = getField(payload, 'usageMetadata');
  if (!isRecord(meta)) return undefined;
  const input = Number(meta.promptTokenCount ?? 0);
  const output = Number(meta.candidatesTokenCount ?? 0);
  return (input > 0 || output > 0) ? { inputTokens: input, outputTokens: output } : undefined;
}

/** Extract token usage from an Ollama response payload */
export function extractOllamaUsage(payload: unknown): RawTokenUsage | undefined {
  if (!isRecord(payload)) return undefined;
  const input = Number(payload.prompt_eval_count ?? 0);
  const output = Number(payload.eval_count ?? 0);
  return (input > 0 || output > 0) ? { inputTokens: input, outputTokens: output } : undefined;
}
