// Multi-provider LLM client - Grok, Claude, OpenAI, Gemini, Ollama
// Uses direct HTTP calls so package installs work without optional provider SDKs.
//
// Pipeline decomposition (v0.10.0 — Pass 6):
//   callLLM orchestrates 6 stages: enrich → route → budget → dispatch → usage → audit
//   Stages live in llm-pipeline.ts for testability. Provider functions remain here.
import { resolveProvider, loadConfig, type LLMProvider } from './config.js';
import { warnIfExpensive } from './token-estimator.js';
import { logger } from './logger.js';
import { LLMError } from './errors.js';
import {
  enrichPrompt,
  applyRouting,
  enforceBudget,
  dispatchWithRetry,
  handleUsage,
  persistAudit,
  type CallLLMOptions,
  type ProviderResponse,
} from './llm-pipeline.js';

// Re-export types for backward compatibility — definitions moved to llm-pipeline.ts
export type { CallLLMOptions, LLMUsageMetadata, ProviderResponse } from './llm-pipeline.js';
// Re-export error hierarchy for consumers
export { LLMError, BudgetError, DanteError, isRetryableError } from './errors.js';
export type { DanteErrorCode } from './errors.js';

import { MAX_LLM_RETRIES, LLM_RETRY_DELAYS_MS, DEFAULT_LLM_TIMEOUT_MS, DEFAULT_OLLAMA_TIMEOUT_MS } from './llm-config.js';

const MAX_RETRIES = MAX_LLM_RETRIES;
const RETRY_DELAYS_MS = [...LLM_RETRY_DELAYS_MS];
export const DEFAULT_LLM_REQUEST_TIMEOUT_MS = DEFAULT_LLM_TIMEOUT_MS;
export const DEFAULT_OLLAMA_REQUEST_TIMEOUT_MS = DEFAULT_OLLAMA_TIMEOUT_MS;

/** Module-level fetch override — null means use globalThis.fetch at call time (lazy resolution) */
let _llmFetch: typeof globalThis.fetch | null = null;

/** Set a custom fetch function for testing. Affects all LLM provider calls. */
export function setLLMFetch(fn: typeof globalThis.fetch): void { _llmFetch = fn; }

/** Reset the fetch function to use globalThis.fetch (lazy). */
export function resetLLMFetch(): void { _llmFetch = null; }

export interface ProbeResult {
  ok: boolean;
  provider: LLMProvider;
  model: string;
  message: string;
}

export const VERIFIED_LLM_PROVIDER_LABEL = 'verified live LLM provider';
const KNOWN_LLM_PROVIDERS = new Set<LLMProvider>(['grok', 'claude', 'openai', 'gemini', 'ollama']);

function assertKnownProvider(provider: string): void {
  if (KNOWN_LLM_PROVIDERS.has(provider as LLMProvider)) {
    return;
  }

  throw new LLMError(
    `Unknown provider: ${provider}. Use: grok, claude, openai, gemini, ollama`,
    'LLM_UNKNOWN_PROVIDER',
    provider as LLMProvider,
  );
}

// ─── Type Guards ───────────────────────────────────────────────

/** Runtime type guard: value is a non-null object (Record-like) */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Safely access a property on an unknown payload — replaces unsafe `as { ... }` casts */
function getField(obj: unknown, key: string): unknown {
  return isRecord(obj) ? obj[key] : undefined;
}

// ─── Helpers ───────────────────────────────────────────────────

function parseTimeoutMs(rawValue: string | undefined, fallbackMs: number): number {
  const value = rawValue?.trim();
  if (!value) return fallbackMs;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
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

function displayProvider(provider: LLMProvider): string {
  switch (provider) {
    case 'grok': return 'xAI Grok';
    case 'claude': return 'Anthropic Claude';
    case 'openai': return 'OpenAI';
    case 'gemini': return 'Google Gemini';
    case 'ollama': return 'Ollama';
  }
}

function normalizeBaseUrl(provider: LLMProvider, baseUrl?: string): string {
  if (baseUrl) return baseUrl.replace(/\/+$/, '');
  switch (provider) {
    case 'grok': return 'https://api.x.ai/v1';
    case 'openai': return 'https://api.openai.com/v1';
    case 'claude': return 'https://api.anthropic.com';
    case 'gemini': return 'https://generativelanguage.googleapis.com/v1beta';
    case 'ollama': return 'http://127.0.0.1:11434';
  }
}

function requireApiKey(provider: LLMProvider, apiKey: string | undefined): string {
  if (!apiKey) {
    throw new LLMError(
      `No API key configured for ${provider}. Run: danteforge config --set-key "${provider}:<key>"`,
      'CONFIG_MISSING_KEY',
      provider,
    );
  }
  return apiKey;
}

function normalizeProviderError(provider: LLMProvider, status: number, body: string): LLMError {
  const label = displayProvider(provider);
  const snippet = body.replace(/\s+/g, ' ').slice(0, 240).trim();

  if (status === 401 || status === 403) {
    return new LLMError(`${label} authentication failed (${status}). Check your API key and model access.`, 'LLM_AUTH_FAILED', provider, status);
  }
  if (status === 404) {
    return new LLMError(`${label} endpoint or model was not found (404). Check the configured base URL and model.`, 'MODEL_NOT_AVAILABLE', provider, status);
  }
  if (status === 408) {
    return new LLMError(`${label} request timed out (408).`, 'LLM_TIMEOUT', provider, status, true);
  }
  if (status === 429) {
    return new LLMError(`${label} rate limit exceeded (429). Retry later or lower request volume.`, 'LLM_RATE_LIMITED', provider, status, true);
  }
  if (status >= 500) {
    return new LLMError(`${label} is temporarily unavailable (${status}).`, 'LLM_UNAVAILABLE', provider, status, true);
  }
  return new LLMError(`${label} request failed (${status})${snippet ? `: ${snippet}` : ''}`, 'LLM_UNAVAILABLE', provider, status);
}

// ─── Provider JSON Fetching ─────────────────────────────────────

async function fetchProviderJson(
  provider: LLMProvider,
  url: string,
  init: RequestInit,
  timeoutMs = resolveProviderRequestTimeoutMs(provider),
  fetchFn?: typeof globalThis.fetch,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await (fetchFn ?? _llmFetch ?? globalThis.fetch)(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    const raw = await response.text();
    if (!response.ok) throw normalizeProviderError(provider, response.status, raw);

    if (!raw.trim()) return {};

    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw new LLMError(`${displayProvider(provider)} returned invalid JSON.`, 'LLM_INVALID_JSON', provider);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new LLMError(`${displayProvider(provider)} request timed out after ${timeoutMs}ms.`, 'LLM_TIMEOUT', provider, undefined, true);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Response Text Extraction (type-guarded) ─────────────────────

function extractOpenAICompatibleText(payload: unknown): string {
  const choices = getField(payload, 'choices');
  if (!Array.isArray(choices)) return '';
  const message = getField(choices[0], 'message');
  const content = getField(message, 'content');

  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content.map(part => String(getField(part, 'text') ?? '')).join('').trim();
  }
  return '';
}

function extractClaudeText(payload: unknown): string {
  const content = getField(payload, 'content');
  if (!Array.isArray(content)) return '';
  return content
    .filter(block => getField(block, 'type') === 'text' && typeof getField(block, 'text') === 'string')
    .map(block => getField(block, 'text') as string)
    .join('')
    .trim();
}

function extractGeminiText(payload: unknown): string {
  const candidates = getField(payload, 'candidates');
  if (!Array.isArray(candidates)) return '';
  return candidates
    .flatMap(candidate => {
      const parts = getField(getField(candidate, 'content'), 'parts');
      return Array.isArray(parts) ? parts : [];
    })
    .map(part => String(getField(part, 'text') ?? ''))
    .join('')
    .trim();
}

// ─── Model Resolution ───────────────────────────────────────────

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
      const data = getField(payload, 'data');
      if (!Array.isArray(data)) return [];
      return data.flatMap(model => {
        const id = getField(model, 'id');
        const name = getField(model, 'name');
        return [id, name].filter((v): v is string => typeof v === 'string');
      });
    }
    case 'gemini': {
      const models = getField(payload, 'models');
      if (!Array.isArray(models)) return [];
      return models.flatMap(model => {
        const name = getField(model, 'name');
        const displayName = getField(model, 'displayName');
        return [name, displayName].filter((v): v is string => typeof v === 'string');
      });
    }
    case 'ollama': {
      const models = getField(payload, 'models');
      if (!Array.isArray(models)) return [];
      return models.flatMap(model => {
        const modelField = getField(model, 'model');
        const name = getField(model, 'name');
        return [modelField, name].filter((v): v is string => typeof v === 'string');
      });
    }
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

  if (baseMatches.length === 1) return baseMatches[0]!;
  if (baseMatches.length > 1) {
    throw new LLMError(
      `Multiple Ollama models match "${configuredModel}": ${baseMatches.join(', ')}. Configure the exact Ollama model tag.`,
      'MODEL_NOT_AVAILABLE',
      'ollama',
    );
  }
  throw new LLMError(
    `Ollama model "${configuredModel}" is not available from the configured endpoint.`,
    'MODEL_NOT_AVAILABLE',
    'ollama',
  );
}

function resolveConfiguredModelName(provider: LLMProvider, configuredModel: string, payload: unknown): string {
  const availableModels = dedupeModelNames(extractProviderModelNames(provider, payload));
  if (availableModels.length === 0) {
    throw new LLMError(
      `${displayProvider(provider)} model listing was reachable, but no models were returned.`,
      'MODEL_NOT_AVAILABLE',
      provider,
    );
  }
  if (provider === 'ollama') return resolveOllamaModelName(configuredModel, availableModels);
  const match = availableModels.find(candidate => modelMatches(configuredModel, candidate));
  if (!match) {
    throw new LLMError(
      `${displayProvider(provider)} model "${configuredModel}" is not available from the configured endpoint.`,
      'MODEL_NOT_AVAILABLE',
      provider,
    );
  }
  return match;
}

async function resolveOllamaCallableModel(configuredModel: string, baseUrl: string, fetchFn?: typeof globalThis.fetch): Promise<string> {
  const payload = await fetchProviderJson('ollama', `${baseUrl}/api/tags`, { method: 'GET' }, undefined, fetchFn);
  return resolveConfiguredModelName('ollama', configuredModel, payload);
}

async function resolveCallTarget(providerOverride?: LLMProvider) {
  const resolved = await resolveProvider();
  const provider = providerOverride ?? resolved.provider;
  const config = await loadConfig();
  const providerConfig = config.providers[provider];
  return {
    provider,
    model: providerConfig?.model ?? resolved.model,
    apiKey: providerConfig?.apiKey ?? resolved.apiKey,
    baseUrl: normalizeBaseUrl(provider, providerConfig?.baseUrl ?? resolved.baseUrl),
    ollamaModel: config.ollamaModel || resolved.model,
  };
}

// ─── Provider Dispatch ──────────────────────────────────────────

async function dispatchToProvider(
  prompt: string,
  target: { provider: LLMProvider; model: string; apiKey: string | undefined; baseUrl: string; ollamaModel: string },
  fetchFn?: typeof globalThis.fetch,
): Promise<{ response: ProviderResponse; modelUsed: string }> {
  switch (target.provider) {
    case 'grok':
    case 'openai':
      return { response: await callOpenAICompatible(prompt, target.provider, target.apiKey, target.model, target.baseUrl, fetchFn), modelUsed: target.model };
    case 'claude':
      return { response: await callClaude(prompt, target.apiKey, target.model, target.baseUrl, fetchFn), modelUsed: target.model };
    case 'gemini':
      return { response: await callGemini(prompt, target.apiKey, target.model, target.baseUrl, fetchFn), modelUsed: target.model };
    case 'ollama': {
      const resolvedModel = await resolveOllamaCallableModel(target.ollamaModel, target.baseUrl, fetchFn);
      return { response: await callOllama(prompt, resolvedModel, target.baseUrl, fetchFn), modelUsed: resolvedModel };
    }
    default:
      throw new LLMError(`Unknown provider: ${target.provider}. Use: grok, claude, openai, gemini, ollama`, 'LLM_UNKNOWN_PROVIDER', target.provider);
  }
}

// ─── Main Entry Point ───────────────────────────────────────────

/**
 * Call the configured LLM provider with automatic retry for transient failures.
 * Orchestrates pipeline stages: enrich → route → budget → dispatch → usage → audit.
 */
export async function callLLM(
  prompt: string,
  providerOverride?: LLMProvider,
  options: CallLLMOptions = {},
): Promise<string> {
  const target = await resolveCallTarget(providerOverride);
  assertKnownProvider(String(target.provider));
  const enriched = await enrichPrompt(prompt, options);
  await applyRouting(options);
  enforceBudget(options);
  await warnIfExpensive(enriched, target.provider);
  logger.info(`LLM call: ${target.provider}/${target.model} (${enriched.length} chars)`);

  const fetchFn = options._fetch;
  const { response, modelUsed, attempt } = await dispatchWithRetry(
    () => dispatchToProvider(enriched, target, fetchFn),
    { maxRetries: MAX_RETRIES, retryDelays: options._retryDelays ?? RETRY_DELAYS_MS },
    target.provider,
    {
      sleep: options._sleep,
      providerDelay: options._retryDelays
        ? (retryAttempt) => options._retryDelays?.[retryAttempt] ?? RETRY_DELAYS_MS[retryAttempt] ?? 1000
        : undefined,
    },
  );

  await handleUsage(response, target.provider, modelUsed, options);
  await persistAudit(response.text, target.provider, modelUsed, enriched.length, attempt, options);
  return response.text;
}

// ─── Probe / Availability ───────────────────────────────────────

/** Check if the configured LLM has a usable live path. */
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
          headers: { Authorization: `Bearer ${key}` },
        });
        const resolvedModel = resolveConfiguredModelName(target.provider, target.model, payload);
        return { ok: true, provider: target.provider, model: resolvedModel, message: `${displayProvider(target.provider)} model "${resolvedModel}" is reachable.` };
      }
      case 'claude': {
        const key = requireApiKey('claude', target.apiKey);
        const payload = await fetchProviderJson('claude', `${target.baseUrl}/v1/models`, {
          method: 'GET',
          headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        });
        const resolvedModel = resolveConfiguredModelName('claude', target.model, payload);
        return { ok: true, provider: 'claude', model: resolvedModel, message: `Anthropic Claude model "${resolvedModel}" is reachable.` };
      }
      case 'gemini': {
        const key = requireApiKey('gemini', target.apiKey);
        const payload = await fetchProviderJson('gemini', `${target.baseUrl}/models?key=${encodeURIComponent(key)}`, { method: 'GET' });
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
    }
  } catch (err) {
    return { ok: false, provider: target.provider, model: target.model, message: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Provider Functions ─────────────────────────────────────────

async function callOpenAICompatible(
  prompt: string,
  provider: 'grok' | 'openai',
  apiKey: string | undefined,
  model: string,
  baseUrl: string,
  fetchFn?: typeof globalThis.fetch,
): Promise<ProviderResponse> {
  const key = requireApiKey(provider, apiKey);
  const payload = await fetchProviderJson(provider, `${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 4096 }),
  }, undefined, fetchFn);

  const text = extractOpenAICompatibleText(payload);
  if (!text) throw new LLMError(`${displayProvider(provider)} returned an empty response.`, 'LLM_EMPTY_RESPONSE', provider);
  return { text, usage: extractOpenAIUsage(payload) };
}

async function callClaude(
  prompt: string,
  apiKey: string | undefined,
  model: string,
  baseUrl: string,
  fetchFn?: typeof globalThis.fetch,
): Promise<ProviderResponse> {
  const key = requireApiKey('claude', apiKey);
  const payload = await fetchProviderJson('claude', `${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4096, messages: [{ role: 'user', content: prompt }] }),
  }, undefined, fetchFn);

  const text = extractClaudeText(payload);
  if (!text) throw new LLMError('Anthropic Claude returned an empty response.', 'LLM_EMPTY_RESPONSE', 'claude');
  return { text, usage: extractClaudeUsage(payload) };
}

async function callGemini(
  prompt: string,
  apiKey: string | undefined,
  model: string,
  baseUrl: string,
  fetchFn?: typeof globalThis.fetch,
): Promise<ProviderResponse> {
  const key = requireApiKey('gemini', apiKey);
  const payload = await fetchProviderJson(
    'gemini',
    `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 4096 },
      }),
    },
    undefined,
    fetchFn,
  );

  const text = extractGeminiText(payload);
  if (!text) throw new LLMError('Google Gemini returned an empty response.', 'LLM_EMPTY_RESPONSE', 'gemini');
  return { text, usage: extractGeminiUsage(payload) };
}

async function callOllama(prompt: string, model: string, baseUrl: string, fetchFn?: typeof globalThis.fetch): Promise<ProviderResponse> {
  const payload = await fetchProviderJson('ollama', `${baseUrl}/api/chat`, {
    method: 'POST',
    body: JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: prompt }] }),
  }, undefined, fetchFn);

  const message = getField(payload, 'message');
  const content = isRecord(message) ? String(message.content ?? '').trim() : '';
  if (!content) throw new LLMError('Ollama returned an empty response.', 'LLM_EMPTY_RESPONSE', 'ollama');
  return { text: content, usage: extractOllamaUsage(payload) };
}

// ─── Usage Extraction (type-guarded) ─────────────────────────────

/** Extract token usage from an OpenAI-compatible response payload */
export function extractOpenAIUsage(payload: unknown): { inputTokens: number; outputTokens: number } | undefined {
  const usage = getField(payload, 'usage');
  if (!isRecord(usage)) return undefined;
  const input = Number(usage.prompt_tokens ?? 0);
  const output = Number(usage.completion_tokens ?? 0);
  return (input > 0 || output > 0) ? { inputTokens: input, outputTokens: output } : undefined;
}

/** Extract token usage from a Claude/Anthropic response payload */
export function extractClaudeUsage(payload: unknown): { inputTokens: number; outputTokens: number } | undefined {
  const usage = getField(payload, 'usage');
  if (!isRecord(usage)) return undefined;
  const input = Number(usage.input_tokens ?? 0);
  const output = Number(usage.output_tokens ?? 0);
  return (input > 0 || output > 0) ? { inputTokens: input, outputTokens: output } : undefined;
}

/** Extract token usage from a Gemini response payload */
export function extractGeminiUsage(payload: unknown): { inputTokens: number; outputTokens: number } | undefined {
  const meta = getField(payload, 'usageMetadata');
  if (!isRecord(meta)) return undefined;
  const input = Number(meta.promptTokenCount ?? 0);
  const output = Number(meta.candidatesTokenCount ?? 0);
  return (input > 0 || output > 0) ? { inputTokens: input, outputTokens: output } : undefined;
}

/** Extract token usage from an Ollama response payload */
export function extractOllamaUsage(payload: unknown): { inputTokens: number; outputTokens: number } | undefined {
  if (!isRecord(payload)) return undefined;
  const input = Number(payload.prompt_eval_count ?? 0);
  const output = Number(payload.eval_count ?? 0);
  return (input > 0 || output > 0) ? { inputTokens: input, outputTokens: output } : undefined;
}
