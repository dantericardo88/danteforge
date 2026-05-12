// Matrix Kernel — Embedded Agent Adapter (mode-aware dispatch)
//
// When DanteForge runs *inside* a host AI (Claude Code, Codex, etc.), the
// host already has Edit/Write tools and a context window. Spawning a real
// subprocess adapter from inside the host would:
//   1. Double-bill the same Pro/Max subscription (parent + child sessions)
//   2. Duplicate the context the host already loaded
//   3. Add minutes of latency to a task the host could finish inline
//
// The embedded adapter writes a Work Instruction Packet to disk and returns
// status='awaiting_input' with the packet path. The slash command body then
// tells the host AI to read the packet and execute the lease directly
// using its own tools, then call `danteforge matrix-kernel embedded-complete
// <leaseId>` to record what changed.
//
// Compared to the fake adapter, this one does NOT write any code itself;
// it only writes the instruction packet. Compared to the real claude/codex
// adapters, it does NOT spawn a subprocess.

import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AgentAdapter,
  AgentRunInput,
  PreparedAgentRun,
} from './adapter-interface.js';
import type {
  AgentRunEvent,
  AgentRunHandle,
  AgentRunResult,
} from '../types/agent.js';
import type { AgentLease } from '../types/lease.js';

const EMBEDDED_DIR = '.danteforge/embedded-mode';

/** Shape of one Work Instruction Packet written to disk. */
export interface EmbeddedWorkInstruction {
  leaseId: string;
  workPacketId: string;
  packetTitle: string;
  objective: string;
  ownedPaths: string[];
  readOnlyPaths: string[];
  forbiddenPaths: string[];
  acceptanceCriteria: string[];
  worktreePath: string;
  hostAI: 'claude' | 'codex' | 'unknown';
  /** Human-readable instructions the host AI should follow. */
  instructions: string;
  createdAt: string;
}

export interface EmbeddedAdapterOptions {
  /** Work packet metadata so we can include scope in the instruction. */
  workPacket?: {
    id?: string;
    title?: string;
    objective?: string;
    acceptanceCriteria?: string[];
    paths?: {
      ownedPaths?: string[];
      readOnlyPaths?: string[];
      forbiddenPaths?: string[];
    };
  };
  hostAI?: 'claude' | 'codex' | 'unknown';
  /** Injection seam for tests: replaces fs.writeFile. */
  _writeFile?: (filePath: string, contents: string) => Promise<void>;
  /** Injection seam: clock for deterministic packet IDs in tests. */
  _now?: () => string;
}

interface EmbeddedRunState {
  packetPath: string;
  startedAt: string;
}

const RUN_STATE = new Map<string, EmbeddedRunState>();

export class EmbeddedAdapter implements AgentAdapter {
  readonly id = 'embedded';
  readonly name = 'EmbeddedAdapter';
  private opts: EmbeddedAdapterOptions;

  constructor(opts: EmbeddedAdapterOptions = {}) {
    this.opts = opts;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async prepareRun(input: AgentRunInput): Promise<PreparedAgentRun> {
    return { ...input, prepared: true };
  }

  async startRun(input: PreparedAgentRun): Promise<AgentRunHandle> {
    const now = this.opts._now ?? (() => new Date().toISOString());
    const startedAt = now();
    const runId = `embeddedrun.${input.lease.id}.${Date.now()}`;
    const cwd = projectRootFromWorktree(input.lease, input.cwd);
    const packetPath = await writeInstructionPacket(input.lease, this.opts, cwd, startedAt);

    RUN_STATE.set(runId, { packetPath, startedAt });

    return {
      runId,
      leaseId: input.lease.id,
      provider: 'embedded',
      startedAt,
    };
  }

  async *streamEvents(handle: AgentRunHandle): AsyncIterable<AgentRunEvent> {
    const state = RUN_STATE.get(handle.runId);
    if (!state) return;
    yield {
      eventId: `${handle.runId}.start`,
      runId: handle.runId,
      ts: state.startedAt,
      kind: 'started',
    };
    yield {
      eventId: `${handle.runId}.awaiting`,
      runId: handle.runId,
      ts: new Date().toISOString(),
      kind: 'progress',
      payload: { packetPath: state.packetPath, message: 'Awaiting host AI to execute the instruction packet and call embedded-complete.' },
    };
  }

  async stopRun(handle: AgentRunHandle): Promise<void> {
    RUN_STATE.delete(handle.runId);
  }

  async collectResult(handle: AgentRunHandle): Promise<AgentRunResult> {
    const state = RUN_STATE.get(handle.runId);
    if (!state) {
      throw new Error(`Embedded run ${handle.runId} not found`);
    }
    const now = new Date().toISOString();
    // `awaiting_input` is the canonical signal that the kernel handed control
    // off to a human/host. The slash command body tells the host to call
    // embedded-complete after editing.
    return {
      runId: handle.runId,
      leaseId: handle.leaseId,
      status: 'awaiting_input',
      filesChanged: [],
      commandsExecuted: [],
      startedAt: state.startedAt,
      completedAt: now,
      finalMessage: `Embedded instruction packet written: ${state.packetPath}. Awaiting host to execute and call \`danteforge matrix-kernel embedded-complete ${handle.leaseId}\`.`,
      provider: 'embedded',
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Worktree paths look like `<projectRoot>/.danteforge-worktrees/<leaseId>` or
 * `<projectRoot>/.danteforge/worktrees/<leaseId>`. The instruction packet
 * must live next to the original project (so the host AI can find it without
 * navigating into the worktree). We trim the known segments to recover the
 * project root; if neither matches, fall back to two levels up which works
 * for both layouts.
 *
 * NOTE: the `fallback` parameter is intentionally unused — the runAdapter
 * caller passes `cwd: lease.worktreePath`, so trusting that as the project
 * root would write packets *inside* the worktree (wrong). Always derive
 * from the lease.worktreePath structure.
 */
function projectRootFromWorktree(lease: AgentLease, _fallback?: string): string {
  void _fallback;
  const wt = lease.worktreePath;
  const markers = [
    `${path.sep}.danteforge-worktrees${path.sep}`,
    `${path.sep}.danteforge${path.sep}worktrees${path.sep}`,
  ];
  for (const m of markers) {
    const idx = wt.lastIndexOf(m);
    if (idx > 0) return wt.slice(0, idx);
  }
  // Unknown layout — assume `<root>/<leaseDir>` and walk up one.
  return path.dirname(wt);
}

async function writeInstructionPacket(
  lease: AgentLease,
  opts: EmbeddedAdapterOptions,
  cwd: string,
  createdAt: string,
): Promise<string> {
  const writeFile = opts._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
  const dir = path.join(cwd, EMBEDDED_DIR, lease.id);
  await fs.mkdir(dir, { recursive: true });

  const packet: EmbeddedWorkInstruction = {
    leaseId: lease.id,
    workPacketId: lease.workPacketId,
    packetTitle: opts.workPacket?.title ?? lease.workPacketId,
    objective: opts.workPacket?.objective ?? 'See work-packet for full objective.',
    ownedPaths: opts.workPacket?.paths?.ownedPaths ?? lease.allowedWritePaths,
    readOnlyPaths: opts.workPacket?.paths?.readOnlyPaths ?? lease.allowedReadPaths,
    forbiddenPaths: opts.workPacket?.paths?.forbiddenPaths ?? lease.forbiddenPaths,
    acceptanceCriteria: opts.workPacket?.acceptanceCriteria ?? [],
    worktreePath: lease.worktreePath,
    hostAI: opts.hostAI ?? 'unknown',
    instructions: buildInstructions(lease),
    createdAt,
  };

  const jsonPath = path.join(dir, 'work-instruction.json');
  const mdPath = path.join(dir, 'work-instruction.md');
  await writeFile(jsonPath, JSON.stringify(packet, null, 2));
  await writeFile(mdPath, renderInstructionMarkdown(packet));
  return mdPath;
}

function buildInstructions(lease: AgentLease): string {
  return [
    `You are the host AI executing lease \`${lease.id}\` for work packet \`${lease.workPacketId}\`.`,
    '',
    'Steps:',
    '1. Read the full work-instruction.json next to this file for machine-readable scope.',
    '2. Make the changes inline using your own Edit/Write tools.',
    '3. STAY within `ownedPaths`. Never touch `forbiddenPaths`.',
    '4. Run any required local checks (typecheck/tests) yourself before reporting completion.',
    `5. When done, run: \`danteforge matrix-kernel embedded-complete ${lease.id}\``,
    '   That command captures your diff and feeds it back into the kernel so verify-court can review.',
    '',
    'Do NOT spawn another Claude Code / Codex subprocess. The kernel chose embedded mode precisely to avoid that.',
  ].join('\n');
}

function renderInstructionMarkdown(p: EmbeddedWorkInstruction): string {
  const lines: string[] = [
    `# Work Instruction — \`${p.leaseId}\``,
    '',
    `**Packet:** ${p.packetTitle}`,
    `**Worktree:** \`${p.worktreePath}\``,
    `**Host AI:** ${p.hostAI}`,
    `**Created:** ${p.createdAt}`,
    '',
    '## Objective',
    '',
    p.objective,
    '',
    '## Scope',
    '',
    `**Owned paths (you may edit these):**`,
    ...p.ownedPaths.map(x => `- \`${x}\``),
    '',
    `**Read-only paths:**`,
    ...(p.readOnlyPaths.length === 0 ? ['_(none)_'] : p.readOnlyPaths.map(x => `- \`${x}\``)),
    '',
    `**Forbidden paths (do NOT touch):**`,
    ...(p.forbiddenPaths.length === 0 ? ['_(none)_'] : p.forbiddenPaths.map(x => `- \`${x}\``)),
    '',
    '## Acceptance Criteria',
    '',
    ...(p.acceptanceCriteria.length === 0 ? ['_(none specified)_'] : p.acceptanceCriteria.map(x => `- ${x}`)),
    '',
    '## Instructions',
    '',
    p.instructions,
    '',
  ];
  return lines.join('\n');
}
