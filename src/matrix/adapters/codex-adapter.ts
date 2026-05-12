// Matrix Kernel — CodexAdapter (now a thin wrapper over LLMAgentAdapter)
//
// In-process LLM-backed AgentAdapter routed to the OpenAI provider. All real
// logic lives in llm-agent-adapter.ts (Phase 13b refactor). This file
// preserves the public CodexAdapter class name + re-exports the shared
// helpers + types so existing tests/imports keep working unchanged.
import {
  LLMAgentAdapter,
  type LLMAgentAdapterOptions,
} from './llm-agent-adapter.js';

export type CodexAdapterOptions = Omit<LLMAgentAdapterOptions, 'provider' | 'providerLabel'>;

export class CodexAdapter extends LLMAgentAdapter {
  constructor(options: CodexAdapterOptions) {
    super({ ...options, provider: 'openai', providerLabel: 'codex' });
  }
}

// Re-export helpers + types so existing tests/imports continue to work.
export {
  parseEdits,
  validateEditsAgainstLease,
  buildCodingPrompt,
  collectContextFiles,
  type ProposedEdit,
  type ContextFile,
} from './llm-agent-adapter.js';
