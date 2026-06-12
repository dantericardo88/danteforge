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

/**
 * The builder leash (self-challenge CH-006, cycle economics): every BUILD-mode adapter was
 * constructed without timeoutMs and fell to the 10-minute default — inside 60-minute
 * orchestration phases, judged against frontier-grade bars. Ten-minute builds structurally
 * cannot produce court-passing capability; most of each cycle's cost was overhead around a
 * sliver of real building. ONE source for the build leash (judge mode stays on the snappy
 * default): 30 minutes, overridable via DANTEFORGE_BUILDER_TIMEOUT_MS (floor 60s).
 */
export function builderTimeoutMs(): number {
  const env = Number.parseInt(process.env['DANTEFORGE_BUILDER_TIMEOUT_MS'] ?? '', 10);
  if (Number.isFinite(env) && env >= 60_000) return env;
  return 30 * 60_000;
}

/** The last few meaningful stderr lines, for failure reasons. CLI tools put the REAL cause on
 *  stderr (run 3l: codex's "usage limit, try again at 8:45 PM" was silently drained while its
 *  stdout carried only cleanup-taskkill noise that masqueraded as an answer). */
export function stderrTail(chunks: Buffer[], maxChars = 300): string {
  return Buffer.concat(chunks).toString('utf8').trim()
    .split(/\r?\n/).map(l => l.trim()).filter(Boolean).slice(-3).join(' | ').slice(0, maxChars);
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
