// Matrix Kernel — GrokBuildAdapter (Phase 14f: subprocess CLI orchestration)
//
// Spawns `grok.exe` (Grok Build TUI) as a headless subprocess.
// Uses the user's Grok Build subscription — no xAI API key required.
//
// Build mode:  grok "<prompt>" --always-approve --effort <level> --cwd <dir>
// Judge mode:  grok "<prompt>" --permission-mode plan --cwd <dir>
//              (read-only: plan mode disables all write tools)
//
// Output capture: --output-format plain writes the agent's final message to
// stdout; we capture it in judge mode for verdict parsing.
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
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

// Default binary path — ~/.grok/bin/grok.exe (subscription-auth, no API key)
const DEFAULT_GROK_BIN = path.join(os.homedir(), '.grok', 'bin', 'grok.exe');

export interface GrokBuildChildLike {
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  on(event: 'close', cb: (code: number | null) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  on(event: string, cb: (...args: unknown[]) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
  pid?: number;
}

export type GrokBuildSpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => GrokBuildChildLike;

export interface GrokBuildAdapterOptions {
  workPacket: WorkPacket;
  binary?: string;
  timeoutMs?: number;
  /** Effort level for build tasks (default: high). */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** When true: read-only judge mode (--permission-mode plan). */
  judgeMode?: boolean;
  _spawn?: GrokBuildSpawnFn;
  _isAvailable?: () => Promise<boolean>;
  _gitDiff?: (cwd: string) => Promise<string[]>;
  _revertFile?: (cwd: string, file: string) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 12 * 60_000;

interface GrokRunState {
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
  capturedOutput: string;
}

const RUN_STATE = new Map<string, GrokRunState>();

export class GrokBuildAdapter implements AgentAdapter {
  readonly id = 'grok-build';
  readonly name = 'GrokBuildAdapter';
  private options: GrokBuildAdapterOptions;
  private _resolvedBinary?: string;

  constructor(options: GrokBuildAdapterOptions) {
    this.options = options;
  }

  async isAvailable(): Promise<boolean> {
    if (this.options._isAvailable) return this.options._isAvailable();
    const binary = this.options.binary ?? process.env.GROK_BIN ?? DEFAULT_GROK_BIN;
    try {
      await execFileAsync(binary, ['--version'], { timeout: 5000 });
      this._resolvedBinary = binary;
      return true;
    } catch {
      // Also try 'grok' on PATH as fallback
      try {
        await execFileAsync('grok', ['--version'], { timeout: 5000 });
        this._resolvedBinary = 'grok';
        return true;
      } catch { return false; }
    }
  }

  async prepareRun(input: AgentRunInput): Promise<PreparedAgentRun> {
    return { ...input, prepared: true };
  }

  async startRun(input: PreparedAgentRun): Promise<AgentRunHandle> {
    const runId = `grokproc.${input.lease.id}.${Date.now()}`;
    const startedAt = new Date().toISOString();
    const binary = this._resolvedBinary ?? DEFAULT_GROK_BIN;
    const state: GrokRunState = {
      startedAt, input,
      workPacket: this.options.workPacket,
      filesChanged: [], filesReverted: [],
      status: 'running', events: [],
      startMs: Date.now(), exitCode: null,
      binaryUsed: binary, capturedOutput: '',
    };
    RUN_STATE.set(runId, state);
    await this.executeRun(runId, state);
    return { runId, leaseId: input.lease.id, provider: 'grok-build', startedAt };
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
    const finalMessage = (state.capturedOutput.trim() || state.finalMessage)
      ?? (violationCount > 0
        ? `Grok ran; ${state.filesChanged.length} file(s) kept, ${violationCount} reverted (lease violation)`
        : `Grok ran; ${state.filesChanged.length} file(s) changed`);
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
      provider: 'grok-build',
      events: [...state.events],
    };
  }

  getCapturedOutput(runId: string): string {
    return RUN_STATE.get(runId)?.capturedOutput ?? '';
  }

  private async executeRun(runId: string, state: GrokRunState): Promise<void> {
    const lease = state.input.lease;
    const worktreeRoot = state.input.cwd ?? lease.worktreePath;
    const judgeMode = this.options.judgeMode ?? false;
    const effort = this.options.effort ?? 'high';

    state.events.push({
      eventId: `${runId}.start`, runId, ts: state.startedAt, kind: 'started',
      payload: { workPacketId: state.workPacket.id, provider: 'grok-build', judgeMode },
    });

    try {
      const prompt = judgeMode
        ? buildGrokJudgePrompt(state.workPacket, lease)
        : buildGrokPrompt(state.workPacket, lease);

      const spawnFn: GrokBuildSpawnFn = this.options._spawn ?? ((c, a, o) => spawn(c, a, o));
      const binary = state.binaryUsed;

      // Build mode: --always-approve (auto-accept all tool calls like write/edit/bash)
      // Judge mode: --permission-mode plan (read-only, no writes allowed)
      const grokArgs = judgeMode
        ? [prompt, '--permission-mode', 'plan', '--output-format', 'plain', '--cwd', normalizeCwd(worktreeRoot), '--no-memory']
        : [prompt, '--always-approve', '--effort', effort, '--cwd', normalizeCwd(worktreeRoot), '--no-memory', '--check'];

      const chunks: Buffer[] = [];
      const exitCode = await runChild(
        spawnFn, binary, grokArgs,
        {
          cwd: normalizeCwd(worktreeRoot),
          env: { ...process.env, ...(state.input.env ?? {}) },
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        chunks,
        judgeMode, // in judge mode, also capture stderr (Grok may route output there)
      );
      state.exitCode = exitCode;
      state.capturedOutput = Buffer.concat(chunks).toString('utf8');

      if (exitCode !== 0 && !judgeMode) {
        state.status = 'failed';
        state.errorReason = `grok_exit_${exitCode}`;
        finalize(state, runId);
        return;
      }

      if (judgeMode) {
        // Explicit finalMessage so collectResult() doesn't fall through to "Grok ran; 0 files" fallback.
        state.finalMessage = state.capturedOutput.trim() || '(no judge output from grok)';
        state.status = 'completed';
        state.events.push({ eventId: `${runId}.complete`, runId, ts: now(), kind: 'completed' });
        state.endMs = Date.now();
        return;
      }

      // Detect and enforce file changes via git diff (same pattern as Codex/Gemini adapters)
      const gitDiff = this.options._gitDiff ?? defaultGitDiff;
      const changedPaths = await gitDiff(worktreeRoot);

      const violations: string[] = [];
      const kept: string[] = [];
      const revertFile = this.options._revertFile ?? defaultRevertFile;

      for (const file of changedPaths) {
        const forbidden = matchesAnyGlob(file, lease.forbiddenPaths);
        const allowed = matchesAnyGlob(file, lease.allowedWritePaths);
        if (forbidden || !allowed) {
          violations.push(file);
          try { await revertFile(worktreeRoot, file); state.filesReverted.push(file); }
          catch (err) { logger.warn(`[GrokBuildAdapter] could not revert ${file}: ${String(err)}`); }
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
      logger.warn(`[GrokBuildAdapter] ${runId} failed: ${state.errorReason}`);
    }
  }
}

export function buildGrokPrompt(workPacket: WorkPacket, lease: AgentLease): string {
  return `You are a coding agent. Use your tools to implement the following task.

# Work Packet
- ID: ${workPacket.id}
- Dimension: ${workPacket.dimensionId}
- Objective: ${workPacket.objective}

# Acceptance Criteria
${workPacket.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

# Required Proof
${workPacket.proof.proofRequired.map(p => `- ${p}`).join('\n')}

# Paths (HARD constraints — enforced by the kernel post-run)
- You MAY write to: ${lease.allowedWritePaths.join(', ')}
- You MAY read but NOT write: ${lease.allowedReadPaths.join(', ')}
- You MUST NOT touch: ${lease.forbiddenPaths.join(', ')}

Implement all acceptance criteria. No stubs. No mocks in src/ files. Stop when done.`;
}

export function buildGrokJudgePrompt(workPacket: WorkPacket, _lease: AgentLease): string {
  // If the objective already contains a diff (diff-embedded mode), use it directly.
  // Otherwise fall back to asking Grok to read files (plan-mode).
  const hasDiff = workPacket.objective.includes('```diff') || workPacket.objective.includes('VERDICT:');
  if (hasDiff) return workPacket.objective;

  return `You are an independent code reviewer. Output only a structured verdict.

## Work Being Reviewed
- Dimension: ${workPacket.dimensionId}
- Objective: ${workPacket.objective}

## Criteria
${workPacket.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

Output your verdict in EXACTLY this format (all fields required):

VERDICT: PASS
CONFIDENCE: HIGH
REASON: <one paragraph>
SCORE_SUGGESTION: <number 0-10>
BLOCKING_ISSUES: none
BLOCKING_CONCERNS: none
DISSENT: none

or VERDICT: FAIL with BLOCKING_ISSUES as a bullet list.
Be harsh. Inflation is the enemy. Only PASS if the implementation is real and complete.`;
}

// ── Shared utilities ──────────────────────────────────────────────────────────

const KERNEL_STATE_DIRS = ['.danteforge/', '.danteforge-worktrees/', '.matrix-worktrees-test/'];

async function defaultGitDiff(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 10000 });
    return stdout.split('\n')
      .map(l => l.trim()).filter(l => l.length > 0)
      .map(l => l.slice(l.indexOf(' ')).trim())
      .filter(p => !KERNEL_STATE_DIRS.some(prefix => p === prefix || p.startsWith(prefix)));
  } catch { return []; }
}

async function defaultRevertFile(cwd: string, file: string): Promise<void> {
  await execFileAsync('git', ['checkout', '--', file], { cwd, timeout: 5000 }).catch(async () => {
    try { await fs.unlink(path.join(cwd, file)); } catch { /* best-effort */ }
  });
}

function normalizeCwd(p: string): string {
  return process.platform === 'win32' ? p.replace(/\\/g, '/') : p;
}

function runChild(
  spawnFn: GrokBuildSpawnFn,
  cmd: string,
  args: string[],
  opts: SpawnOptions,
  timeoutMs: number,
  captureChunks: Buffer[],
  captureStderr = false,
): Promise<number> {
  return new Promise<number>((resolve) => {
    const child: GrokBuildChildLike = spawnFn(cmd, args, opts);
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
    child.stdout?.on('data', (chunk: Buffer) => {
      captureChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (captureStderr) captureChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.on('close', (code) => settle((code ?? 1) as number));
    child.on('error', () => settle(1));
  });
}

function finalize(state: GrokRunState, runId: string): void {
  state.events.push({
    eventId: `${runId}.fail`, runId, ts: now(), kind: 'failed',
    payload: { reason: state.errorReason },
  });
  state.endMs = Date.now();
}

function now(): string { return new Date().toISOString(); }
