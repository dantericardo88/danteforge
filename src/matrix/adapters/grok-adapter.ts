// Matrix Kernel — GrokAdapter (Phase 13b)
//
// In-process LLM-backed AgentAdapter routed to the xAI Grok provider.
// Thin wrapper over LLMAgentAdapter.
import {
  LLMAgentAdapter,
  type LLMAgentAdapterOptions,
} from './llm-agent-adapter.js';

export type GrokAdapterOptions = Omit<LLMAgentAdapterOptions, 'provider' | 'providerLabel'>;

export class GrokAdapter extends LLMAgentAdapter {
  constructor(options: GrokAdapterOptions) {
    super({ ...options, provider: 'grok', providerLabel: 'grok' });
  }
}
