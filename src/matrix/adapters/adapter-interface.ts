// Matrix Kernel — Agent Adapter interface (Phase 8 of PRD §18)
//
// Defines the contract every agent provider implements. Used by the scheduler
// to dispatch work via Codex, Claude Code, DanteCode, Fake, Shell, etc.

import type { AgentLease } from '../types/lease.js';
import type {
  AgentRunEvent,
  AgentRunHandle,
  AgentRunResult,
} from '../types/agent.js';

export interface AgentRunInput {
  lease: AgentLease;
  /** Optional prompt or task description fed to the agent. */
  task?: string;
  /** Optional working-directory override. Defaults to lease.worktreePath. */
  cwd?: string;
  /** Environment variables to forward to the agent process. */
  env?: Record<string, string>;
}

export interface PreparedAgentRun extends AgentRunInput {
  prepared: true;
}

export interface AgentAdapter {
  /** Adapter identifier (e.g. "fake", "shell", "codex"). */
  readonly id: string;

  /** Human-readable name. */
  readonly name: string;

  isAvailable(): Promise<boolean>;

  prepareRun(input: AgentRunInput): Promise<PreparedAgentRun>;

  startRun(input: PreparedAgentRun): Promise<AgentRunHandle>;

  streamEvents(handle: AgentRunHandle): AsyncIterable<AgentRunEvent>;

  stopRun(handle: AgentRunHandle): Promise<void>;

  collectResult(handle: AgentRunHandle): Promise<AgentRunResult>;
}

/**
 * Run an adapter end-to-end: prepare → start → drain events → collect.
 * Convenience wrapper for callers that don't need to interleave event streams.
 */
export async function runAdapter(
  adapter: AgentAdapter,
  input: AgentRunInput,
): Promise<AgentRunResult> {
  if (!await adapter.isAvailable()) {
    throw new Error(`Adapter ${adapter.id} is not available`);
  }
  const prepared = await adapter.prepareRun(input);
  const handle = await adapter.startRun(prepared);
  for await (const _event of adapter.streamEvents(handle)) {
    void _event;
  }
  return adapter.collectResult(handle);
}
