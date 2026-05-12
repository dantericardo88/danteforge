// Matrix Kernel — ClaudeCodeAdapter (now a thin wrapper over LLMAgentAdapter)
//
// All real logic lives in llm-agent-adapter.ts (Phase 13b refactor). This
// file preserves the public ClaudeCodeAdapter class name + re-exports the
// shared helpers + types so existing imports keep working unchanged.
import {
  LLMAgentAdapter,
  type LLMAgentAdapterOptions,
} from './llm-agent-adapter.js';

export type ClaudeCodeAdapterOptions = Omit<LLMAgentAdapterOptions, 'provider' | 'providerLabel'>;

export class ClaudeCodeAdapter extends LLMAgentAdapter {
  constructor(options: ClaudeCodeAdapterOptions) {
    super({ ...options, provider: 'claude', providerLabel: 'claude' });
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
