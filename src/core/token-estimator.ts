// Token estimation, cost warnings, and auto-chunking for LLM API calls
import { logger } from './logger.js';
import type { LLMProvider } from './config.js';
import { getProvider as getRegistryProvider } from './llm-provider.js';

/**
 * Approximate context window limits per provider (in tokens).
 * These reflect the default models configured in config.ts.
 */
const BUILTIN_TOKEN_LIMITS: Record<string, number> = {
  grok: 131072,    // grok-3-mini
  claude: 200000,  // claude-sonnet-4
  openai: 128000,  // gpt-4o
  gemini: 1048576, // gemini-2.0-flash
  ollama: 8192,    // llama3 default context
};

// Keep exported alias for backward compatibility
export const TOKEN_LIMITS: Record<string, number> = BUILTIN_TOKEN_LIMITS;

function getTokenLimit(provider: LLMProvider): number {
  const builtin = BUILTIN_TOKEN_LIMITS[provider];
  if (builtin !== undefined) return builtin;
  // Check registry for extended providers
  const adapter = getRegistryProvider(provider);
  return adapter?.maxTokens ?? 8192;
}

/**
 * Rough per-token pricing in USD (input / output per 1M tokens).
 * These are ballpark figures for user awareness, not billing-accurate.
 */
const BUILTIN_PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  grok: { inputPer1M: 5.00, outputPer1M: 15.00 },
  claude: { inputPer1M: 3.00, outputPer1M: 15.00 },
  openai: { inputPer1M: 2.50, outputPer1M: 10.00 },
  gemini: { inputPer1M: 0.10, outputPer1M: 0.40 },
  ollama: { inputPer1M: 0, outputPer1M: 0 },  // local, free
};

function getPricing(provider: LLMProvider): { inputPer1M: number; outputPer1M: number } {
  const builtin = BUILTIN_PRICING[provider];
  if (builtin !== undefined) return builtin;
  const adapter = getRegistryProvider(provider);
  if (adapter) return { inputPer1M: adapter.inputPricePer1M, outputPer1M: adapter.outputPricePer1M };
  return { inputPer1M: 2.50, outputPer1M: 10.00 }; // default to OpenAI pricing
}

/**
 * Token estimation strategy.
 * - 'simple': ~4 chars/token (conservative, backward-compatible default)
 * - 'code-aware': ~2.5 chars/token for code, ~3.5 for prose (more accurate)
 */
export type TokenEstimationStrategy = 'simple' | 'code-aware';

/**
 * Heuristic: detect whether text is likely code or prose.
 * Code has a higher density of special characters ({, }, ;, =, <, >, etc.).
 */
export function isLikelyCode(text: string): boolean {
  if (text.length === 0) return false;
  const codeSignals = (text.match(/[{}();=<>[\]|&!~^+\-*/%]/g) || []).length;
  return (codeSignals / text.length) > 0.02;
}

/**
 * Estimate token count for a given text.
 * @param text The input text to estimate tokens for.
 * @param strategy Estimation strategy — 'simple' (4:1) or 'code-aware' (variable ratio).
 */
export function estimateTokens(text: string, strategy: TokenEstimationStrategy = 'simple'): number {
  if (strategy === 'simple') return Math.ceil(text.length / 4);
  const ratio = isLikelyCode(text) ? 2.5 : 3.5;
  return Math.ceil(text.length / ratio);
}

/**
 * Estimate the cost of a prompt based on token count and provider pricing.
 * Assumes output will be roughly 25% of input length (conservative guess).
 */
export function estimateCost(
  tokens: number,
  provider: LLMProvider
): { inputCost: number; outputCost: number; totalEstimate: number } {
  try {
    const pricing = getPricing(provider);
    const inputCost = (tokens / 1_000_000) * pricing.inputPer1M;
    // Assume output is ~25% of input tokens for cost estimation
    const estimatedOutputTokens = Math.ceil(tokens * 0.25);
    const outputCost = (estimatedOutputTokens / 1_000_000) * pricing.outputPer1M;
    const totalEstimate = inputCost + outputCost;
    return { inputCost, outputCost, totalEstimate };
  } catch (error) {
    throw new Error(`Cost estimation failed: ${error}`);
  }
}

const EXPENSIVE_THRESHOLD_USD = 0.05;
const EXPENSIVE_TOKEN_COUNT = 10_000;

/**
 * Warn when a prompt is likely to cost more than the threshold.
 */
export async function warnIfExpensive(text: string, provider: LLMProvider): Promise<void> {
  const tokens = estimateTokens(text);
  if (tokens < EXPENSIVE_TOKEN_COUNT) return;

  const { totalEstimate } = estimateCost(tokens, provider);
  if (totalEstimate > EXPENSIVE_THRESHOLD_USD) {
    logger.warn(
      `Large prompt detected: ~${tokens.toLocaleString()} tokens (~$${totalEstimate.toFixed(4)} for ${provider}). ` +
      'Consider --light mode or reducing context.'
    );
  }
}

/**
 * Split oversized text into chunks that fit within the provider's token limit.
 */
export function chunkForProvider(text: string, provider: LLMProvider): string[] {
  const limit = getTokenLimit(provider);
  const charsPerChunk = limit * 4; // ~4 chars per token
  if (text.length <= charsPerChunk) return [text];

  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    chunks.push(text.slice(offset, offset + charsPerChunk));
    offset += charsPerChunk;
  }
  return chunks;
}

// Backward-compat alias — some commands use chunkText (char-based)
export function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let offset = 0;
  while (offset < text.length) {
    chunks.push(text.slice(offset, offset + maxChars));
    offset += maxChars;
  }
  return chunks;
}

export function hardTokenCap(provider: LLMProvider): number {
  return Math.floor(getTokenLimit(provider) * 0.8);
}
