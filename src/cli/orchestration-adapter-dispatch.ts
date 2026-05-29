// Orchestration adapter dispatch — wires matrix-kernel's AgentAdapters into
// the matrix-orchestration Phase A / Phase B runners.
//
// Without this, the orchestration runner falls through to
//   outcome: "skipped", rejectionReason: "no adapter wired"
// on every attempt, which is what the Phase B audit caught.
//
// This module provides a single function buildRunAdapter() that returns the
// `_runAdapter` seam expected by phase-a-runner.ts. The seam dispatches to
// the appropriate matrix-kernel adapter based on the orchestration's
// ProviderId, runs the adapter, and returns the AgentRunResult unchanged.
import type { AgentLease } from '../matrix/types/lease.js';
import type { AgentRunResult } from '../matrix/types/agent.js';
import type { WorkPacket } from '../matrix/types/work-graph.js';

type ProviderId = 'claude' | 'codex' | 'dantecode' | 'aider' | 'cursor' | 'ollama' | 'fake' | 'shell';

export interface RunAdapterArgs {
  providerId: ProviderId;
  lease: AgentLease;
  packet: WorkPacket;
}

/**
 * Returns a `_runAdapter` function compatible with Phase A's options.
 * The function instantiates the right matrix-kernel adapter for the
 * provider, dispatches, and returns AgentRunResult. Unknown providers
 * (aider, cursor, shell) are NOT YET WIRED — they fall back to a no-op
 * FakeAgentAdapter (action='noop') so the run completes rather than crashes,
 * but produces ZERO synthetic work. A no-op cannot mint a fake diff, so an
 * unsupported provider can never be counted as a passing autonomy receipt.
 * (Honesty invariant — see council review 2026-05-29: fake success must not
 * count as autonomy proof.) Wire real subprocess adapters in a future pass.
 */
export function buildRunAdapter(): (args: RunAdapterArgs) => Promise<AgentRunResult> {
  return async ({ providerId, lease, packet }) => {
    const { ClaudeCodeAdapter } = await import('../matrix/adapters/claude-code-adapter.js');
    const { CodexAdapter } = await import('../matrix/adapters/codex-adapter.js');
    const { DanteCodeAdapter } = await import('../matrix/adapters/dantecode-adapter.js');
    const { LLMAgentAdapter } = await import('../matrix/adapters/llm-agent-adapter.js');
    const { FakeAgentAdapter } = await import('../matrix/adapters/fake-agent-adapter.js');
    const { runAdapter } = await import('../matrix/adapters/adapter-interface.js');

    const adapter = (() => {
      switch (providerId) {
        case 'claude':    return new ClaudeCodeAdapter({ workPacket: packet });
        case 'codex':     return new CodexAdapter({ workPacket: packet });
        case 'dantecode': return new DanteCodeAdapter({ workPacket: packet });
        case 'ollama':    return new LLMAgentAdapter({ workPacket: packet, provider: 'ollama', providerLabel: 'ollama' });
        case 'fake':      return new FakeAgentAdapter({ action: 'success' }); // explicit test request only
        default: {
          // aider/cursor/shell — not yet wired as subprocess adapters. Use a
          // no-op (NOT success): the run completes rather than crashing, but
          // produces no synthetic diff, so it can never pass the courts as a
          // real autonomy receipt. Fake success here would be a credibility hole.
          void (async () => {
            const { logger } = await import('../core/logger.js');
            logger.warn(`[orchestration] Provider "${providerId}" is not wired as a real adapter — running as no-op (no work produced). This will NOT count as a passing autonomy receipt.`);
          })();
          return new FakeAgentAdapter({ action: 'noop' });
        }
      }
    })();

    return runAdapter(adapter, { lease, cwd: lease.worktreePath });
  };
}
