// Token estimation, cost warnings, and auto-chunking for LLM API calls
import { logger } from './logger.js';
import type { LLMProvider } from './config.js';

/**
 * Approximate context window limits per provider (in tokens).
 * These reflect the default models configured in config.ts.
 */
export const TOKEN_LIMITS: Record<LLMProvider, number> = {
  grok: 131072,    // grok-3-mini
  claude: 200000,  // claude-sonnet-4
  openai: 128000,  // gpt-4o
  gemini: 1048576, // gemini-2.0-flash
  ollama: 8192,    // llama3 default context
};

/**
 * Rough per-token pricing in USD (input / output per 1M tokens).
 * These are ballpark figures for user awareness, not billing-accurate.
 */
const PRICING: Record<LLMProvider, { inputPer1M: number; outputPer1M: number }> = {
  grok: { inputPer1M: 5.00, outputPer1M: 15.00 },
  claude: { inputPer1M: 3.00, outputPer1M: 15.00 },
  openai: { inputPer1M: 2.50, outputPer1M: 10.00 },
  gemini: { inputPer1M: 0.10, outputPer1M: 0.40 },
  ollama: { inputPer1M: 0, outputPer1M: 0 },  // local, free
};

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
  const pricing = PRICING[provider];
  const inputCost = (tokens / 1_000_000) * pricing.inputPer1M;
  // Assume output is ~25% of input tokens for cost estimation
  const estimatedOutputTokens = Math.ceil(tokens * 0.25);
  const outputCost = (estimatedOutputTokens / 1_000_000) * pricing.outputPer1M;
  const totalEstimate = inputCost + outputCost;

  return {
    inputCost: Math.round(inputCost * 1_000_000) / 1_000_000,
    outputCost: Math.round(outputCost * 1_000_000) / 1_000_000,
    totalEstimate: Math.round(totalEstimate * 1_000_000) / 1_000_000,
  };
}

/**
 * Warn the user if estimated cost exceeds $0.01.
 * In non-interactive CLI mode we always proceed, but still log the warning.
 * Returns true if the call should proceed.
 */
export async function warnIfExpensive(
  text: string,
  provider: LLMProvider
): Promise<boolean> {
  const tokens = estimateTokens(text);
  const cost = estimateCost(tokens, provider);

  if (cost.totalEstimate > 0.01) {
    logger.warn(
      `Estimated cost for this call: ~$${cost.totalEstimate.toFixed(4)} ` +
      `(${tokens.toLocaleString()} tokens, ${provider}) — ` +
      `input: $${cost.inputCost.toFixed(4)}, output: $${cost.outputCost.toFixed(4)}`
    );
  }

  const limit = TOKEN_LIMITS[provider];
  if (tokens > limit) {
    logger.warn(
      `Input (~${tokens.toLocaleString()} tokens) exceeds ${provider} context limit ` +
      `(${limit.toLocaleString()} tokens). Consider chunking the input.`
    );
  }

  // Non-interactive CLI: always proceed
  return true;
}

/**
 * Split text into chunks that fit within a token limit.
 * Tries to split at paragraph boundaries (double newlines) first,
 * then falls back to single newlines, then hard-splits at the limit.
 */
export function chunkText(text: string, maxTokens: number = 100_000): string[] {
  const maxChars = maxTokens * 4; // inverse of estimateTokens

  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    // Try to find a paragraph boundary (double newline) within the limit
    let splitIndex = remaining.lastIndexOf('\n\n', maxChars);

    // If no paragraph boundary, try a single newline
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf('\n', maxChars);
    }

    // If no newline at all, hard-split at the character limit
    if (splitIndex <= 0) {
      splitIndex = maxChars;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).replace(/^\n+/, ''); // trim leading newlines from next chunk
  }

  if (chunks.length > 1) {
    logger.info(`Text split into ${chunks.length} chunks (max ${maxTokens.toLocaleString()} tokens each)`);
  }

  return chunks;
}
