// LLM pipeline stages — extracted from callLLM for testability and single-responsibility
import { checkContextRot, truncateContext } from '../harvested/gsd/hooks/context-rot.js';
import { injectContext } from './context-injector.js';
import { logger } from './logger.js';
import { recordMemory } from './memory-engine.js';
import { BudgetError, LLMError, isRetryableError } from './errors.js';
import { shouldAllowRequest, recordSuccess, recordFailure, computeBackoffDelay } from './circuit-breaker.js';
import { cachedLoadState, cachedSaveState } from './state-cache.js';
import type { LLMProvider } from './config.js';

export interface CallLLMOptions {
  enrichContext?: boolean;
  recordMemory?: boolean;
  cwd?: string;
  /** Task signature for routing decisions (v0.9.0 — 3-tier model routing) */
  taskSignature?: import('./task-router.js').TaskSignature;
  /** Budget fence for per-agent cost caps (v0.9.0 — budget fences) */
  budgetFence?: { agentRole: string; maxBudgetUsd: number; currentSpendUsd: number; isExceeded: boolean; warningThresholdPercent: number };
  /** Callback for real token usage data from provider responses (v0.9.0 hardening) */
  onUsage?: (usage: LLMUsageMetadata) => void;
  /** Injected fetch function for testing — replaces globalThis.fetch in all provider calls */
  _fetch?: typeof globalThis.fetch;
  /** Injected sleep function for retry-path tests — avoids real backoff waits */
  _sleep?: (ms: number) => Promise<void>;
  /** Injected retry delays for tests — overrides the default/provider backoff sequence */
  _retryDelays?: number[];
}

/** Real token usage metadata extracted from LLM provider responses */
export interface LLMUsageMetadata {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  model: string;
  provider: LLMProvider;
}

/** Internal type for provider call results — text + optional usage data */
export interface ProviderResponse {
  text: string;
  usage?: { inputTokens: number; outputTokens: number };
}

/** Result from dispatchWithRetry — includes the attempt index for audit logging */
export interface DispatchResult {
  response: ProviderResponse;
  modelUsed: string;
  attempt: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Stage 1: Enrich prompt with context injection + apply context rot truncation */
export async function enrichPrompt(prompt: string, options: Pick<CallLLMOptions, 'enrichContext' | 'cwd'>): Promise<string> {
  let enriched = options.enrichContext
    ? await injectContext(prompt, undefined, options.cwd)
    : prompt;

  const rotResult = checkContextRot(enriched.length);
  if (rotResult.shouldTruncate && rotResult.truncateTarget) {
    enriched = truncateContext(enriched, rotResult.truncateTarget);
  }
  return enriched;
}

/** Stage 2: Check task routing (3-tier) — informational only, best-effort */
export async function applyRouting(options: Pick<CallLLMOptions, 'taskSignature'>): Promise<void> {
  if (!options.taskSignature) return;
  try {
    const { routeTask } = await import('./task-router.js');
    const decision = routeTask(options.taskSignature);
    if (decision.tier === 'local') {
      logger.info(`[Router] Task routed to local tier: ${decision.reason}`);
    }
  } catch (err) {
    logger.verbose(`[best-effort] routing: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Stage 3: Enforce budget fence — throws BudgetError when exceeded, warns near threshold */
export function enforceBudget(options: Pick<CallLLMOptions, 'budgetFence'>): void {
  if (!options.budgetFence) return;
  const fence = options.budgetFence;
  if (fence.currentSpendUsd >= fence.maxBudgetUsd) {
    throw new BudgetError(
      `Budget fence exceeded for ${fence.agentRole}: $${fence.currentSpendUsd.toFixed(4)} of $${fence.maxBudgetUsd.toFixed(4)} max`,
      fence.agentRole,
      fence.currentSpendUsd,
      fence.maxBudgetUsd,
    );
  }
  const usagePercent = (fence.currentSpendUsd / fence.maxBudgetUsd) * 100;
  if (usagePercent >= fence.warningThresholdPercent) {
    logger.warn(`[Budget] ${fence.agentRole} at ${usagePercent.toFixed(0)}% of budget ($${fence.currentSpendUsd.toFixed(4)}/$${fence.maxBudgetUsd.toFixed(4)})`);
  }
}

/** Stage 4: Dispatch with retry + backoff — accepts a dispatcher callback for provider isolation.
 *  When `provider` is given, circuit breaker protects the call and exponential backoff is used. */
export async function dispatchWithRetry(
  dispatcher: () => Promise<{ response: ProviderResponse; modelUsed: string }>,
  config: { maxRetries: number; retryDelays: number[] },
  provider?: string,
  hooks?: {
    sleep?: (ms: number) => Promise<void>;
    providerDelay?: (attempt: number) => number;
  },
): Promise<DispatchResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    // Circuit breaker gate — reject immediately if provider circuit is open
    if (provider && !shouldAllowRequest(provider)) {
      throw new LLMError(
        `Circuit breaker OPEN for provider '${provider}' — too many consecutive failures`,
        'LLM_CIRCUIT_OPEN',
        provider as LLMProvider,
        undefined,
        false,
      );
    }
    try {
      const result = await dispatcher();
      if (provider) recordSuccess(provider);
      return { ...result, attempt };
    } catch (err) {
      if (provider) recordFailure(provider);
      lastError = err;
      if (attempt < config.maxRetries && isRetryableError(err)) {
        const delay = provider
          ? (hooks?.providerDelay?.(attempt) ?? computeBackoffDelay(attempt))
          : (config.retryDelays[attempt] ?? 1000);
        logger.warn(`LLM call failed (attempt ${attempt + 1}/${config.maxRetries + 1}): ${err instanceof Error ? err.message : String(err)} - retrying in ${delay}ms`);
        await (hooks?.sleep ?? sleep)(delay);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/** Stage 5: Record usage + update budget fence after successful dispatch */
export async function handleUsage(
  response: ProviderResponse,
  provider: LLMProvider,
  model: string,
  options: Pick<CallLLMOptions, 'onUsage' | 'budgetFence'>,
): Promise<LLMUsageMetadata | undefined> {
  if (!response.usage) return undefined;

  const { estimateCost } = await import('./token-estimator.js');
  const totalTokens = response.usage.inputTokens + response.usage.outputTokens;
  const costData = estimateCost(totalTokens, provider);
  const metadata: LLMUsageMetadata = {
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    costUsd: costData.totalEstimate,
    model,
    provider,
  };
  try { options.onUsage?.(metadata); } catch (err) {
    logger.verbose(`[best-effort] onUsage callback: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (options.budgetFence) {
    options.budgetFence.currentSpendUsd += costData.totalEstimate;
    if (options.budgetFence.currentSpendUsd >= options.budgetFence.maxBudgetUsd) {
      options.budgetFence.isExceeded = true;
    }
  }
  return metadata;
}

/** Stage 6: Persist audit log + memory entry */
export async function persistAudit(
  output: string,
  provider: LLMProvider,
  model: string,
  enrichedPromptLength: number,
  attempt: number,
  options: Pick<CallLLMOptions, 'recordMemory' | 'cwd'>,
): Promise<void> {
  const state = await cachedLoadState({ cwd: options.cwd });
  state.auditLog.push(`${new Date().toISOString()} | llm: ${provider}/${model} (${output.length} chars returned${attempt > 0 ? `, attempt ${attempt + 1}` : ''})`);
  await cachedSaveState(state, { cwd: options.cwd });

  if (options.recordMemory !== false) {
    await recordMemory({
      category: 'command',
      summary: `LLM call: ${provider}/${model}`,
      detail: `Prompt chars: ${enrichedPromptLength}. Response chars: ${output.length}.`,
      tags: ['llm', provider, model],
      relatedCommands: ['llm'],
    }, options.cwd);
  }
}
