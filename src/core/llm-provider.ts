// LLM Provider Registry — lightweight adapter system
// Lets new providers be added in one file without touching llm.ts switch statements.
// Built-in providers (grok, claude, openai, gemini, ollama) are still handled
// directly in llm.ts for backward compatibility.
// Additional providers register here and are dispatched via the registry.

export interface LLMProviderAdapter {
  id: string;
  displayName: string;
  defaultModel: string;
  defaultBaseUrl: string;
  inputPricePer1M: number;
  outputPricePer1M: number;
  maxTokens: number;
  requiresApiKey: boolean;
  /** Call the provider and return the response text. */
  call(
    prompt: string,
    model: string,
    baseUrl: string,
    apiKey: string | undefined,
    timeoutMs: number,
  ): Promise<string>;
}

// ── Registry ──────────────────────────────────────────────────────────────────

const REGISTRY = new Map<string, LLMProviderAdapter>();

export function registerProvider(adapter: LLMProviderAdapter): void {
  REGISTRY.set(adapter.id, adapter);
}

export function getProvider(id: string): LLMProviderAdapter | undefined {
  return REGISTRY.get(id);
}

export function listProviders(): LLMProviderAdapter[] {
  return [...REGISTRY.values()];
}

export function isRegisteredProvider(id: string): boolean {
  return REGISTRY.has(id);
}

// ── OpenAI-compatible helper (shared by Together.ai, Groq, etc.) ──────────────

export async function callOpenAICompatibleAdapter(
  prompt: string,
  model: string,
  baseUrl: string,
  apiKey: string | undefined,
  timeoutMs: number,
  providerName: string,
): Promise<string> {
  if (!apiKey) {
    throw new Error(`No API key for ${providerName}. Run: danteforge config --set-key "${providerName.toLowerCase()}:<key>"`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`${providerName} HTTP ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const choices = data['choices'] as Array<{ message?: { content?: string } }> | undefined;
    const text = choices?.[0]?.message?.content ?? '';
    if (!text) throw new Error(`${providerName} returned empty response`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// ── Built-in additional provider registrations ────────────────────────────────

const togetherAdapter: LLMProviderAdapter = {
  id: 'together',
  displayName: 'Together.ai',
  defaultModel: 'meta-llama/Llama-3-70b-chat-hf',
  defaultBaseUrl: 'https://api.together.xyz/v1',
  inputPricePer1M: 0.60,
  outputPricePer1M: 0.60,
  maxTokens: 32768,
  requiresApiKey: true,
  call: (prompt, model, baseUrl, apiKey, timeoutMs) =>
    callOpenAICompatibleAdapter(prompt, model, baseUrl, apiKey, timeoutMs, 'Together.ai'),
};

const groqAdapter: LLMProviderAdapter = {
  id: 'groq',
  displayName: 'Groq',
  defaultModel: 'mixtral-8x7b-32768',
  defaultBaseUrl: 'https://api.groq.com/openai/v1',
  inputPricePer1M: 0.27,
  outputPricePer1M: 0.27,
  maxTokens: 32768,
  requiresApiKey: true,
  call: (prompt, model, baseUrl, apiKey, timeoutMs) =>
    callOpenAICompatibleAdapter(prompt, model, baseUrl, apiKey, timeoutMs, 'Groq'),
};

const mistralAdapter: LLMProviderAdapter = {
  id: 'mistral',
  displayName: 'Mistral AI',
  defaultModel: 'mistral-large-latest',
  defaultBaseUrl: 'https://api.mistral.ai/v1',
  inputPricePer1M: 2.00,
  outputPricePer1M: 6.00,
  maxTokens: 32768,
  requiresApiKey: true,
  call: (prompt, model, baseUrl, apiKey, timeoutMs) =>
    callOpenAICompatibleAdapter(prompt, model, baseUrl, apiKey, timeoutMs, 'Mistral AI'),
};

// Register on module load
registerProvider(togetherAdapter);
registerProvider(groqAdapter);
registerProvider(mistralAdapter);

export { togetherAdapter, groqAdapter, mistralAdapter };
