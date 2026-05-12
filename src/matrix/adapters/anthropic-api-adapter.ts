// Matrix Kernel — AnthropicAPIAdapter (Phase 14d)
//
// API-backed agent: dials the Anthropic API directly via callLLM(provider='claude').
// Requires ANTHROPIC_API_KEY in env or providers.claude.apiKey in
// ~/.danteforge/config.yaml.
//
// For most users, prefer the subprocess ClaudeCodeAdapter (--adapter claude)
// which uses your existing Claude Pro/Max subscription via the `claude` CLI.
// This API adapter exists for CI environments or programmatic dispatch where
// the CLI isn't available.
import {
  LLMAgentAdapter,
  type LLMAgentAdapterOptions,
} from './llm-agent-adapter.js';

export type AnthropicAPIAdapterOptions = Omit<LLMAgentAdapterOptions, 'provider' | 'providerLabel'>;

export class AnthropicAPIAdapter extends LLMAgentAdapter {
  constructor(options: AnthropicAPIAdapterOptions) {
    super({ ...options, provider: 'claude', providerLabel: 'anthropic-api' });
  }
}
