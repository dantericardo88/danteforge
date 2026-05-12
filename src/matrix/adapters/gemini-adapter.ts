// Matrix Kernel — GeminiAdapter (Phase 13b)
//
// In-process LLM-backed AgentAdapter routed to the Google Gemini provider.
// Thin wrapper over LLMAgentAdapter — all real logic lives there.
import {
  LLMAgentAdapter,
  type LLMAgentAdapterOptions,
} from './llm-agent-adapter.js';

export type GeminiAdapterOptions = Omit<LLMAgentAdapterOptions, 'provider' | 'providerLabel'>;

export class GeminiAdapter extends LLMAgentAdapter {
  constructor(options: GeminiAdapterOptions) {
    super({ ...options, provider: 'gemini', providerLabel: 'gemini' });
  }
}
