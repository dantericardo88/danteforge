// llm-usage.ts — Token usage types and extraction helpers for LLM providers.
// Split from llm.ts to keep files under the 750-LOC hard cap.

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

export { extractOpenAIUsageLocal, extractClaudeUsageLocal, extractGeminiUsageLocal, extractOllamaUsageLocal };
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
