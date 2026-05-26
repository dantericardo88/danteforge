// Matrix Kernel — AntигравитацияAdapter / GeminiCLIAdapter (Phase 14e)
//
// Spawns the Antigravity CLI (`agy`) as a subprocess in the lease's worktree.
// Antigravity replaced the old `gemini` CLI — binary is `agy` or
// `C:\Users\<user>\AppData\Local\agy\bin\agy.exe` on Windows.
//
// Headless non-interactive mode uses --print (agy's -p flag).
// Build mode:  agy --print "<prompt>" --dangerously-skip-permissions
// Judge mode:  agy --print "<prompt>"  (no skip — read-only by intent + post-run diff assert)
//
// Auth: uses the user's existing Google account via agy's own auth.
// No API key needed.
import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { killProcess } from './kill-process.js';
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

export interface GeminiChildLike {
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  on(event: 'close', cb: (code: number | null) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  on(event: string, cb: (...args: unknown[]) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
  pid?: number;
}

export type GeminiSpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => GeminiChildLike;

export interface GeminiCLIAdapterOptions {
  workPacket: WorkPacket;
  binary?: string;
  timeoutMs?: number;
  /** When true, runs in --approval-mode plan (read-only judge mode). */
  judgeMode?: boolean;
  _spawn?: GeminiSpawnFn;
  _isAvailable?: () => Promise<boolean>;
  _gitDiff?: (cwd: string) => Promise<string[]>;
  /** Snapshot before judge runs to distinguish builder's pre-existing changes from judge's writes. */
  _preJudgeDiff?: (cwd: string) => Promise<string[]>;
  _revertFile?: (cwd: string, file: string) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

interface GeminiRunState {
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
  /** Captured stdout for judge-mode verdicts. */
  capturedOutput: string;
}

const RUN_STATE = new Map<string, GeminiRunState>();

export class GeminiCLIAdapter implements AgentAdapter {
  readonly id = 'gemini-cli';
  readonly name = 'GeminiCLIAdapter';
  private options: GeminiCLIAdapterOptions;
  private _resolvedBinary?: string;
  private _resolvedUsesShell = false;

  constructor(options: GeminiCLIAdapterOptions) {
    this.options = options;
  }

  async isAvailable(): Promise<boolean> {
    if (this.options._isAvailable) return this.options._isAvailable();
    // Antigravity (agy) replaces the old gemini CLI.
    // Resolution order: explicit binary override → AGY_BIN env → default agy path → 'agy' on PATH.
    const explicit = this.options.binary ?? process.env.AGY_BIN ?? process.env.GEMINI_BIN;
    const winDefault = process.platform === 'win32'
      ? path.join(process.env['LOCALAPPDATA'] ?? '', 'agy', 'bin', 'agy.exe')
      : null;

    const candidates: string[] = [];
    if (explicit) candidates.push(...candidateBinaries(explicit));
    if (winDefault) candidates.push(winDefault);
    candidates.push(...candidateBinaries('agy'));
    candidates.push(...candidateBinaries('gemini')); // legacy fallback

    for (const candidate of candidates) {
      if (await this._probeCandidate(candidate)) return true;
    }
    return false;
  }

  private async _probeCandidate(candidate: string): Promise<boolean> {
    const isCmdShim = candidate.endsWith('.cmd') || candidate.endsWith('.bat');
    const isPs1 = candidate.endsWith('.ps1');
    // On Windows, extensionless paths (bash scripts for unix) can't be executed directly.
    if (process.platform === 'win32' && !isCmdShim && !isPs1 && !candidate.endsWith('.exe') && path.extname(candidate) === '') {
      return false;
    }
    try {
      // Use --help rather than --version: Gemini CLI doesn't have --version.
      // Treat any non-ENOENT exit as "available" — binary ran, just returned non-zero.
      if (isCmdShim && process.platform === 'win32') {
        await execFileAsync('cmd.exe', ['/c', candidate, '--help'], { timeout: 5000 });
      } else if (isPs1) {
        await execFileAsync('powershell.exe', ['-NonInteractive', '-File', candidate, '--help'], { timeout: 5000 });
      } else {
        await execFileAsync(candidate, ['--help'], { timeout: 5000 });
      }
      this._resolvedBinary = candidate;
      this._resolvedUsesShell = isCmdShim;
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // ENOENT = binary missing; any other error = ran but failed → still available.
      if (code !== 'ENOENT') {
        this._resolvedBinary = candidate;
        this._resolvedUsesShell = isCmdShim;
        return true;
      }
      return false;
    }
  }

  async prepareRun(input: AgentRunInput): Promise<PreparedAgentRun> {
    return { ...input, prepared: true };
  }

  async startRun(input: PreparedAgentRun): Promise<AgentRunHandle> {
    const runId = `geminiproc.${input.lease.id}.${Date.now()}`;
    const startedAt = new Date().toISOString();
    const binary = this._resolvedBinary
      ?? candidateBinaries(this.options.binary ?? process.env.GEMINI_BIN ?? 'gemini')[0]!;
    const state: GeminiRunState = {
      startedAt, input,
      workPacket: this.options.workPacket,
      filesChanged: [], filesReverted: [],
      status: 'running', events: [],
      startMs: Date.now(), exitCode: null,
      binaryUsed: binary, capturedOutput: '',
    };
    RUN_STATE.set(runId, state);
    await this.executeRun(runId, state);
    return { runId, leaseId: input.lease.id, provider: 'gemini-cli', startedAt };
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
        ? `Gemini CLI ran; ${state.filesChanged.length} file(s) kept, ${violationCount} reverted (lease violation)`
        : `Gemini CLI ran; ${state.filesChanged.length} file(s) changed`);
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
      provider: 'gemini-cli',
      events: [...state.events],
    };
  }

  /** Exposed for council judge-mode: the raw stdout from the subprocess. */
  getCapturedOutput(runId: string): string {
    return RUN_STATE.get(runId)?.capturedOutput ?? '';
  }

  private async executeRun(runId: string, state: GeminiRunState): Promise<void> {
    const lease = state.input.lease;
    const worktreeRoot = state.input.cwd ?? lease.worktreePath;
    const judgeMode = this.options.judgeMode ?? false;

    state.events.push({
      eventId: `${runId}.start`, runId, ts: state.startedAt, kind: 'started',
      payload: { workPacketId: state.workPacket.id, provider: 'gemini-cli', judgeMode },
    });

    try {
      const prompt = judgeMode
        ? buildGeminiJudgePrompt(state.workPacket, lease)
        : buildGeminiPrompt(state.workPacket, lease);

      const spawnFn: GeminiSpawnFn = this.options._spawn ?? ((c, a, o) => spawn(c, a, o));
      const binary = state.binaryUsed;
      const isPs1 = binary.endsWith('.ps1');
      const isCmdShim = this._resolvedUsesShell && process.platform === 'win32';

      // agy (Antigravity) args: --print for non-interactive mode.
      // Build mode adds --dangerously-skip-permissions (auto-approve tool calls).
      // Judge mode omits it — read-only by intent; post-run diff assert verifies.
      const geminiArgs = judgeMode
        ? ['--print', prompt]
        : ['--print', prompt, '--dangerously-skip-permissions'];

      let cmd: string;
      let args: string[];
      if (isPs1 && process.platform === 'win32') {
        cmd = 'powershell.exe';
        args = ['-NonInteractive', '-File', binary, ...geminiArgs];
      } else if (isCmdShim && process.platform === 'win32') {
        cmd = 'cmd.exe';
        args = ['/c', binary, ...geminiArgs];
      } else {
        cmd = binary;
        args = geminiArgs;
      }

      // For judge mode: snapshot worktree state BEFORE spawning to detect only new writes.
      const geminiGitDiff = this.options._gitDiff ?? defaultGitDiff;
      const preJudgeDiffFn = this.options._preJudgeDiff ?? geminiGitDiff;
      const preJudgeFiles = judgeMode ? new Set(await preJudgeDiffFn(worktreeRoot)) : new Set<string>();
      const chunks: Buffer[] = [];
      const exitCode = await runChild(
        spawnFn, cmd, args,
        {
          cwd: normalizeCwd(worktreeRoot),
          env: { ...process.env, ...(state.input.env ?? {}) },
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        chunks,
      );
      state.exitCode = exitCode;
      state.capturedOutput = Buffer.concat(chunks).toString('utf8');

      if (exitCode !== 0 && !judgeMode) {
        state.status = 'failed';
        state.errorReason = `gemini_cli_exit_${exitCode}`;
        finalize(state, runId);
        return;
      }

      // In judge mode, non-zero exit is non-fatal (judge may have nothing to write).
      if (judgeMode) {
        state.finalMessage = state.capturedOutput.trim() || '(no judge output from gemini)';
        // Post-run diff: only flag files NEW since pre-judge snapshot.
        const changedAfterJudge = (await geminiGitDiff(worktreeRoot)).filter(f => !preJudgeFiles.has(f));
        if (changedAfterJudge.length > 0) {
          logger.warn(`[GeminiCLIAdapter] judge ${runId} modified ${changedAfterJudge.length} file(s) — reverting; auto-FAIL verdict`);
          const revertFile = this.options._revertFile ?? defaultRevertFile;
          await Promise.allSettled(changedAfterJudge.map(f => revertFile(worktreeRoot, f)));
          // Judge wrote files in read-only judge mode → bad-faith violation.
          // Emit explicit FAIL (not void) so the verdict counts toward quorum.
          state.errorReason = `judge_wrote_files: ${changedAfterJudge.join(', ')}`;
          state.capturedOutput = '';
          state.finalMessage = `VERDICT: FAIL\nCONFIDENCE: HIGH\nREASON: Judge modified worktree files during review (${changedAfterJudge.join(', ')}) — bad-faith violation. Automatic FAIL to preserve quorum integrity.`;
          state.status = 'failed';
          finalize(state, runId);
          return;
        }
        state.status = 'completed';
        state.events.push({ eventId: `${runId}.complete`, runId, ts: now(), kind: 'completed' });
        state.endMs = Date.now();
        return;
      }

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
          catch (err) { logger.warn(`[GeminiCLIAdapter] could not revert ${file}: ${String(err)}`); }
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
      logger.warn(`[GeminiCLIAdapter] ${runId} failed: ${state.errorReason}`);
    }
  }
}

export function buildGeminiPrompt(workPacket: WorkPacket, lease: AgentLease): string {
  return `You are a coding agent working on a task in a git worktree. Use your native tools to make the changes needed.

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

Make the file edits needed to satisfy the acceptance criteria. Stop when done.`;
}

export function buildGeminiJudgePrompt(workPacket: WorkPacket, lease: AgentLease): string {
  return `You are a code reviewer. Read the current state of the codebase and render a verdict on whether the work meets the criteria below. Do NOT make any file changes.

# Work Being Reviewed
- Dimension: ${workPacket.dimensionId}
- Objective: ${workPacket.objective}

# Criteria to Evaluate
${workPacket.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

# Proof Requirements
${workPacket.proof.proofRequired.map(p => `- ${p}`).join('\n')}

# Your Task
Read the relevant source files and tests. Then output your verdict in this exact format:

VERDICT: PASS or FAIL
CONFIDENCE: HIGH / MEDIUM / LOW
REASON: <one paragraph>
SCORE_SUGGESTION: <number 0-10>
BLOCKING_ISSUES: <bullet list, or "none">

Be honest and harsh. A passing score requires real evidence, not aspirational code.`;
}

// ── Shared utilities (mirrors codex-adapter.ts) ───────────────────────────────

const KERNEL_STATE_DIRS = [
  '.danteforge/', '.danteforge-worktrees/', '.matrix-worktrees-test/',
  // AI tool workspace sidecars — created automatically during judge sessions, not real edits
  '.openhands/', '.claude/', '.cursor/', '.continue/', '.grok/', '.dantecode/', '.aider/',
];

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

function candidateBinaries(binary: string): string[] {
  if (binary.endsWith('.cmd') || binary.endsWith('.exe') || binary.endsWith('.bat') || binary.endsWith('.ps1')) {
    return [binary];
  }
  if (process.platform === 'win32') return [binary, `${binary}.cmd`, `${binary}.ps1`, `${binary}.exe`];
  return [binary];
}

function runChild(
  spawnFn: GeminiSpawnFn,
  cmd: string,
  args: string[],
  opts: SpawnOptions,
  timeoutMs: number,
  captureChunks?: Buffer[],
): Promise<number> {
  return new Promise<number>((resolve) => {
    const child: GeminiChildLike = spawnFn(cmd, args, opts);
    let settled = false;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => {
      killProcess(child);
      settle(124);
    }, timeoutMs);
    if (captureChunks) {
      child.stdout?.on('data', (chunk: Buffer) => { captureChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
    } else {
      child.stdout?.on('data', () => { /* drain */ });
    }
    child.stderr?.on('data', () => { /* drain */ });
    child.on('close', (code) => settle((code ?? 1) as number));
    child.on('error', () => settle(1));
  });
}

function finalize(state: GeminiRunState, runId: string): void {
  state.events.push({
    eventId: `${runId}.fail`, runId, ts: now(), kind: 'failed',
    payload: { reason: state.errorReason },
  });
  state.endMs = Date.now();
}

function now(): string { return new Date().toISOString(); }
