// Matrix Kernel — ClaudeCodeAdapter (Phase 14d: subprocess CLI orchestration)
//
// Spawns the `claude` CLI (Claude Code) as a subprocess inside the lease's
// worktree. Claude Code uses its OWN native tools (Read/Edit/Write/Bash)
// to make changes directly in the worktree. After the subprocess exits,
// the adapter:
//   1. Runs `git status --porcelain` to detect what changed
//   2. Validates every changed file against the lease's allowedWritePaths
//   3. Reverts (git checkout --) any file that violated the lease
//   4. Returns AgentRunResult with the surviving filesChanged
//
// IO model is DIFFERENT from DanteCodeAdapter:
//   - DanteCodeAdapter: write input JSON → spawn → read output JSON → apply
//   - ClaudeCodeAdapter: spawn → CLI edits files → observe via git diff
//
// This is more natural for Claude Code because it already has file-editing
// tools baked in. Forcing it to emit JSON would fight its grain.
//
// Auth: uses the user's existing Claude Pro/Max subscription via the
// `claude` CLI's own auth. No ANTHROPIC_API_KEY needed.
//
// For the API-backed equivalent (for CI / programmatic dispatch), see
// AnthropicAPIAdapter.
import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { matchesAnyGlob } from '../util/glob.js';
import type {
  AgentAdapter,
  AgentRunInput,
  PreparedAgentRun,
} from './adapter-interface.js';
import type { AgentLease } from '../types/lease.js';
import type { WorkPacket } from '../types/work-graph.js';
import type {
  AgentRunEvent,
  AgentRunHandle,
  AgentRunResult,
} from '../types/agent.js';

const execFileAsync = promisify(execFile);

// ── Child process abstraction (so tests can stub) ──────────────────────────

export interface ClaudeChildLike {
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  on(event: 'close', cb: (code: number | null) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  on(event: string, cb: (...args: unknown[]) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
  pid?: number;
}

export type ClaudeSpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => ClaudeChildLike;

// ── Options ────────────────────────────────────────────────────────────────

export interface ClaudeCodeAdapterOptions {
  workPacket: WorkPacket;
  /** Binary name (defaults to env CLAUDE_BIN, else 'claude'). */
  binary?: string;
  /** Process timeout in ms (default 10 min). */
  timeoutMs?: number;
  /** Tools to pre-permit via --allowedTools. Defaults to a safe set. */
  allowedTools?: string[];
  /** Skip interactive permission prompts (recommended in sandboxed worktrees). */
  skipPermissions?: boolean;
  /** Injection seam: override subprocess spawn. */
  _spawn?: ClaudeSpawnFn;
  /** Injection seam: override availability probe. */
  _isAvailable?: () => Promise<boolean>;
  /** Injection seam: override `git status --porcelain` for tests. */
  _gitDiff?: (cwd: string) => Promise<string[]>;
  /** Injection seam: override `git checkout -- <file>` for tests. */
  _revertFile?: (cwd: string, file: string) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'MultiEdit',
  'Glob',
  'Grep',
  'Bash(npm:*)',
  'Bash(git:status)',
  'Bash(git:diff)',
  'Bash(node:*)',
];

// ── Adapter state (per run) ─────────────────────────────────────────────────

interface ClaudeRunState {
  startedAt: string;
  input: PreparedAgentRun;
  workPacket: WorkPacket;
  filesChanged: string[];
  filesReverted: string[];
  status: AgentRunResult['status'];
  errorReason?: string;
  events: AgentRunEvent[];
  finalMessage?: string;
  startMs: number;
  endMs?: number;
  exitCode: number | null;
  binaryUsed: string;
}

const RUN_STATE = new Map<string, ClaudeRunState>();

// ── Adapter implementation ─────────────────────────────────────────────────

export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude';
  readonly name = 'ClaudeCodeAdapter';
  private options: ClaudeCodeAdapterOptions;

  constructor(options: ClaudeCodeAdapterOptions) {
    this.options = options;
  }

  async isAvailable(): Promise<boolean> {
    if (this.options._isAvailable) return this.options._isAvailable();
    const candidates = candidateBinaries(this.options.binary ?? process.env.CLAUDE_BIN ?? 'claude');
    for (const candidate of candidates) {
      const needsShim = candidate.endsWith('.cmd') || candidate.endsWith('.bat');
      try {
        // Probe via cmd.exe /c <binary> --version when .cmd/.bat to avoid
        // the `shell: true` deprecation warning (DEP0190).
        if (needsShim && process.platform === 'win32') {
          await execFileAsync('cmd.exe', ['/c', candidate, '--version'], { timeout: 5000 });
        } else {
          await execFileAsync(candidate, ['--version'], { timeout: 5000 });
        }
        this._resolvedBinary = candidate;
        this._resolvedUsesShell = needsShim;
        return true;
      } catch { /* try next */ }
    }
    return false;
  }

  /** Memoized result of isAvailable() so startRun can spawn the same one. */
  private _resolvedBinary?: string;
  /** Whether the resolved binary requires shell:true to invoke (.cmd/.bat). */
  private _resolvedUsesShell = false;

  async prepareRun(input: AgentRunInput): Promise<PreparedAgentRun> {
    return { ...input, prepared: true };
  }

  async startRun(input: PreparedAgentRun): Promise<AgentRunHandle> {
    const runId = `claudeproc.${input.lease.id}.${Date.now()}`;
    const startedAt = new Date().toISOString();
    const binary = this._resolvedBinary ?? candidateBinaries(this.options.binary ?? process.env.CLAUDE_BIN ?? 'claude')[0]!;
    const state: ClaudeRunState = {
      startedAt,
      input,
      workPacket: this.options.workPacket,
      filesChanged: [],
      filesReverted: [],
      status: 'running',
      events: [],
      startMs: Date.now(),
      exitCode: null,
      binaryUsed: binary,
    };
    RUN_STATE.set(runId, state);

    await this.executeRun(runId, state);

    return { runId, leaseId: input.lease.id, provider: 'claude', startedAt };
  }

  async *streamEvents(handle: AgentRunHandle): AsyncIterable<AgentRunEvent> {
    const state = RUN_STATE.get(handle.runId);
    if (!state) return;
    for (const event of state.events) yield event;
  }

  async stopRun(handle: AgentRunHandle): Promise<void> {
    RUN_STATE.delete(handle.runId);
  }

  async collectResult(handle: AgentRunHandle): Promise<AgentRunResult> {
    const state = RUN_STATE.get(handle.runId);
    if (!state) throw new Error(`Run ${handle.runId} not found`);
    const violationCount = state.filesReverted.length;
    const finalMessage = state.finalMessage
      ?? (violationCount > 0
        ? `Claude Code ran; ${state.filesChanged.length} file(s) kept, ${violationCount} reverted (lease violation)`
        : `Claude Code ran; ${state.filesChanged.length} file(s) changed`);
    return {
      runId: handle.runId,
      leaseId: handle.leaseId,
      status: state.status,
      filesChanged: state.filesChanged,
      commandsExecuted: state.exitCode === null ? [] : [{
        command: state.binaryUsed,
        exitCode: state.exitCode,
        durationMs: (state.endMs ?? Date.now()) - state.startMs,
      }],
      finalMessage,
      errorReason: state.errorReason,
      startedAt: state.startedAt,
      completedAt: new Date((state.endMs ?? Date.now())).toISOString(),
      provider: 'claude',
      events: [...state.events],
    };
  }

  // ── Inner execution ───────────────────────────────────────────────────

  private async executeRun(runId: string, state: ClaudeRunState): Promise<void> {
    const lease = state.input.lease;
    const worktreeRoot = state.input.cwd ?? lease.worktreePath;

    state.events.push({
      eventId: `${runId}.start`, runId, ts: state.startedAt, kind: 'started',
      payload: { workPacketId: state.workPacket.id, provider: 'claude' },
    });

    try {
      const prompt = buildClaudeCodePrompt(state.workPacket, lease);

      const allowedTools = this.options.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
      const args = ['-p', prompt, '--allowedTools', allowedTools.join(' ')];
      if (this.options.skipPermissions !== false) {
        args.push('--dangerously-skip-permissions');
      }

      const spawnFn: ClaudeSpawnFn = this.options._spawn ?? ((c, a, o) => spawn(c, a, o));
      // On Windows, .cmd shims need cmd.exe wrapping to avoid arg mangling.
      const usesCmdShim = this._resolvedUsesShell && process.platform === 'win32';
      const [cmd, finalArgs] = usesCmdShim
        ? ['cmd.exe', ['/c', state.binaryUsed, ...args]] as const
        : [state.binaryUsed, args] as const;
      const exitCode = await runChild(spawnFn, cmd, [...finalArgs],
        {
          // Normalize backslash → forward-slash on Windows; backslash cwd
          // breaks node's spawn cmd.exe path resolution (see codex-adapter).
          cwd: normalizeCwd(worktreeRoot),
          env: { ...process.env, ...(state.input.env ?? {}) },
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      state.exitCode = exitCode;

      if (exitCode !== 0) {
        state.status = 'failed';
        state.errorReason = `claude_cli_exit_${exitCode}`;
        finalize(state, runId);
        return;
      }

      // Detect what claude actually changed via git status.
      const gitDiff = this.options._gitDiff ?? defaultGitDiff;
      const changedPaths = await gitDiff(worktreeRoot);

      // Validate against lease. Revert any violations.
      const violations: string[] = [];
      const kept: string[] = [];
      const revertFile = this.options._revertFile ?? defaultRevertFile;

      for (const file of changedPaths) {
        const forbidden = matchesAnyGlob(file, lease.forbiddenPaths);
        const allowed = matchesAnyGlob(file, lease.allowedWritePaths);
        if (forbidden || !allowed) {
          violations.push(file);
          try { await revertFile(worktreeRoot, file); state.filesReverted.push(file); }
          catch (err) { logger.warn(`[ClaudeCodeAdapter] could not revert ${file}: ${String(err)}`); }
        } else {
          kept.push(file);
          state.events.push({
            eventId: `${runId}.file.${file}`, runId, ts: now(), kind: 'file_changed',
            payload: { path: file, action: 'write' },
          });
        }
      }
      state.filesChanged = kept;

      if (violations.length > 0) {
        state.status = 'failed';
        state.errorReason = `edit_outside_lease: ${violations.join('; ')}`;
        finalize(state, runId);
        return;
      }

      state.status = 'completed';
      state.events.push({ eventId: `${runId}.complete`, runId, ts: now(), kind: 'completed' });
      state.endMs = Date.now();
    } catch (err) {
      state.status = 'failed';
      state.errorReason = String(err);
      finalize(state, runId);
      logger.warn(`[ClaudeCodeAdapter] ${runId} failed: ${state.errorReason}`);
    }
  }
}

// ── Prompt builder ─────────────────────────────────────────────────────────

export function buildClaudeCodePrompt(workPacket: WorkPacket, lease: AgentLease): string {
  return `You are a coding agent working on a Work Packet inside an isolated git worktree. Use your native tools (Read, Edit, Write) to make the changes — do NOT emit JSON.

# Work Packet
- ID: ${workPacket.id}
- Dimension: ${workPacket.dimensionId}
- Objective: ${workPacket.objective}

# Acceptance Criteria
${workPacket.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

# Required Proof
${workPacket.proof.proofRequired.map(p => `- ${p}`).join('\n')}

# Paths (HARD constraints)
- You MAY write to: ${lease.allowedWritePaths.join(', ')}
- You MAY read but NOT write: ${lease.allowedReadPaths.join(', ')}
- You MUST NOT touch: ${lease.forbiddenPaths.join(', ')}

If you write outside the allowed paths, your changes will be reverted and the run will be marked failed.

# Task
Make the file edits needed to satisfy the acceptance criteria. Verify with the required-proof commands if available. When done, stop — there is no JSON to emit; we will detect your changes via git status.

If no changes are needed, simply stop without editing anything.`;
}

// ── Git helpers ────────────────────────────────────────────────────────────

/** Paths matrix-kernel manages itself; never count them as "agent edits." */
const KERNEL_STATE_DIRS = ['.danteforge/', '.danteforge-worktrees/', '.matrix-worktrees-test/'];

async function defaultGitDiff(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 10000 });
    return stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => line.slice(line.indexOf(' ')).trim())
      .filter(p => !KERNEL_STATE_DIRS.some(prefix => p === prefix || p.startsWith(prefix)));
  } catch {
    return [];
  }
}

async function defaultRevertFile(cwd: string, file: string): Promise<void> {
  await execFileAsync('git', ['checkout', '--', file], { cwd, timeout: 5000 }).catch(async () => {
    // File may be untracked (new file claude created). Just delete it.
    try { await fs.unlink(path.join(cwd, file)); } catch { /* best-effort */ }
  });
}

// ── Process plumbing ───────────────────────────────────────────────────────

/** Forward-slash a Windows path. Backslash cwd breaks node's spawn
 *  cmd.exe path resolution on Windows; forward slashes work. */
function normalizeCwd(p: string): string {
  return process.platform === 'win32' ? p.replace(/\\/g, '/') : p;
}

/** Returns a list of binary names to try in order.
 *
 * On Windows, npm-installed CLIs are exposed as `<name>.cmd` shims; node's
 * child_process can't auto-resolve those without `shell: true` or an explicit
 * extension. We probe both forms and use whichever works. On non-Windows we
 * just try the bare name. */
function candidateBinaries(binary: string): string[] {
  if (binary.endsWith('.cmd') || binary.endsWith('.exe') || binary.endsWith('.bat')) return [binary];
  if (process.platform === 'win32') return [binary, `${binary}.cmd`, `${binary}.exe`];
  return [binary];
}

function runChild(
  spawnFn: ClaudeSpawnFn,
  cmd: string,
  args: string[],
  opts: SpawnOptions,
  timeoutMs: number,
): Promise<number> {
  return new Promise<number>((resolve) => {
    const child: ClaudeChildLike = spawnFn(cmd, args, opts);
    let settled = false;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      settle(124);
    }, timeoutMs);
    // Drain stdout/stderr so OS pipe buffers don't fill and deadlock the
    // child. We don't need the content; git diff is the source of truth.
    child.stdout?.on('data', () => { /* drain */ });
    child.stderr?.on('data', () => { /* drain */ });
    child.on('close', (code) => settle((code ?? 1) as number));
    child.on('error', () => settle(1));
  });
}

function finalize(state: ClaudeRunState, runId: string): void {
  state.events.push({
    eventId: `${runId}.fail`, runId, ts: now(), kind: 'failed',
    payload: { reason: state.errorReason },
  });
  state.endMs = Date.now();
}

function now(): string {
  return new Date().toISOString();
}

export type { ChildProcess };
