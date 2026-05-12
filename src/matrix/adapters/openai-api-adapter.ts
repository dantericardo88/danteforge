// Matrix Kernel — OpenAIAPIAdapter (Phase 14d)
//
// API-backed agent: dials the OpenAI API directly via callLLM(provider='openai').
// Requires OPENAI_API_KEY in env or providers.openai.apiKey in
// ~/.danteforge/config.yaml.
//
// For most users, prefer the subprocess CodexAdapter (--adapter codex) which
// uses your existing ChatGPT Plus/Pro subscription via the `codex` CLI. This
// API adapter exists for CI environments or programmatic dispatch where the
// CLI isn't available.
import {
  LLMAgentAdapter,
  type LLMAgentAdapterOptions,
} from './llm-agent-adapter.js';

export type OpenAIAPIAdapterOptions = Omit<LLMAgentAdapterOptions, 'provider' | 'providerLabel'>;

export class OpenAIAPIAdapter extends LLMAgentAdapter {
  constructor(options: OpenAIAPIAdapterOptions) {
    super({ ...options, provider: 'openai', providerLabel: 'openai-api' });
  }
}
