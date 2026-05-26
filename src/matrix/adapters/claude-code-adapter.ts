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

// ── Child process abstraction (injectable for tests) ─────────────────────────

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
  /** When true, runs as a read-only reviewer: stdout is captured as finalMessage. */
  judgeMode?: boolean;
  /** Injection seam: override subprocess spawn. */
  _spawn?: ClaudeSpawnFn;
  /** Injection seam: override availability probe. */
  _isAvailable?: () => Promise<boolean>;
  /** Injection seam: override `git status --porcelain` for tests. */
  _gitDiff?: (cwd: string) => Promise<string[]>;
  /** Injection seam: snapshot before judge runs (default: same as _gitDiff). Used to
   *  distinguish pre-existing builder changes from new writes by the judge. */
  _preJudgeDiff?: (cwd: string) => Promise<string[]>;
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

// Judge mode must be structurally read-only — no edit/write/bash tools.
// Prompting "do not edit" is insufficient; the tool allowlist enforces it.
const JUDGE_ALLOWED_TOOLS = ['Read', 'Glob', 'Grep'];

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
  capturedOutput: string;
  startMs: number;
  endMs?: number;
  exitCode: number | null;
  binaryUsed: string;
}

const RUN_STATE = new Map<string, ClaudeRunState>();

// ── Spawn helpers (extracted for testability + readability) ────────────────

/**
 * Build the argument list for the `claude` CLI invocation given the
 * options and a pre-built prompt string.
 */
function buildClaudeArgs(prompt: string, allowedTools: string[], skipPermissions: boolean): string[] {
  const args = ['-p', prompt, '--allowedTools', allowedTools.join(' ')];
  if (skipPermissions) args.push('--dangerously-skip-permissions');
  return args;
}

/**
 * Resolve the final [cmd, args] pair to pass to the spawn function.
 * On Windows, `.cmd` shims require wrapping via `cmd.exe /c`.
 */
function resolveSpawnTarget(
  binaryUsed: string,
  args: string[],
  usesShell: boolean,
): [string, string[]] {
  if (usesShell && process.platform === 'win32') {
    return ['cmd.exe', ['/c', binaryUsed, ...args]];
  }
  return [binaryUsed, args];
}

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
      capturedOutput: '',
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
    return {
      runId: handle.runId,
      leaseId: handle.leaseId,
      status: state.status,
      filesChanged: state.filesChanged,
      commandsExecuted: buildCommandsExecuted(state),
      finalMessage: resolveFinalMessage(state),
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
      // Judge mode: pure-text output, read-only tools only.
      // --output-format text controls output format but does NOT disable tool use.
      // --allowedTools restricts Claude to read-only tools, making file writes structurally impossible.
      if (this.options.judgeMode) {
        const chunks: Buffer[] = [];
        const prompt = state.workPacket.objective.length > 50
          ? state.workPacket.objective
          : buildClaudeJudgePrompt(state.workPacket, lease);
        const judgeArgs = ['-p', prompt, '--output-format', 'text', '--allowedTools', 'Read,Glob,Grep'];
        const [jCmd, jFinalArgs] = resolveSpawnTarget(state.binaryUsed, judgeArgs, this._resolvedUsesShell);
        const spawnFn: ClaudeSpawnFn = this.options._spawn ?? ((c, a, o) => spawn(c, a, o));
        // Snapshot worktree state before judge runs to distinguish builder's pre-existing
        // changes from any new writes by the judge (judge runs in the builder's worktree).
        const gitDiff = this.options._gitDiff ?? defaultGitDiff;
        const preJudgeDiff = this.options._preJudgeDiff ?? gitDiff;
        const preJudgeFiles = new Set(await preJudgeDiff(worktreeRoot));
        state.exitCode = await runChild(spawnFn, jCmd, [...jFinalArgs], {
          cwd: normalizeCwd(worktreeRoot),
          env: { ...process.env, ...(state.input.env ?? {}) },
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        }, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS, chunks);
        state.capturedOutput = Buffer.concat(chunks).toString('utf8');
        // Post-run diff: only flag files that are NEW since the pre-judge snapshot.
        const changedAfterJudge = (await gitDiff(worktreeRoot)).filter(f => !preJudgeFiles.has(f));
        if (changedAfterJudge.length > 0) {
          logger.warn(`[ClaudeCodeAdapter] judge ${runId} modified ${changedAfterJudge.length} file(s) — reverting; auto-FAIL verdict`);
          const revertFile = this.options._revertFile ?? defaultRevertFile;
          await Promise.allSettled(changedAfterJudge.map(f => revertFile(worktreeRoot, f)));
          // Judge wrote files despite --allowedTools restriction → bad-faith violation.
          // Emit explicit FAIL (not void) so the verdict counts toward quorum.
          state.errorReason = `judge_wrote_files: ${changedAfterJudge.join(', ')}`;
          state.capturedOutput = '';
          state.finalMessage = `VERDICT: FAIL\nCONFIDENCE: HIGH\nREASON: Judge modified worktree files during review (${changedAfterJudge.join(', ')}) — bad-faith violation. Automatic FAIL to preserve quorum integrity.`;
          state.status = 'failed';
          finalize(state, runId);
          return;
        }
        state.finalMessage = state.capturedOutput.trim() || '(no judge output)';
        state.status = 'completed';
        state.events.push({ eventId: `${runId}.complete`, runId, ts: now(), kind: 'completed' });
        state.endMs = Date.now();
        return;
      }

      const exitCode = await this.spawnClaudeCli(state, worktreeRoot, lease);
      state.exitCode = exitCode;

      if (exitCode !== 0) {
        state.status = 'failed';
        state.errorReason = `claude_cli_exit_${exitCode}`;
        finalize(state, runId);
        return;
      }

      const changedPaths = await (this.options._gitDiff ?? defaultGitDiff)(worktreeRoot);
      const revertFile = this.options._revertFile ?? defaultRevertFile;
      const hadViolations = await this.applyLeaseValidation(
        runId, state, changedPaths, worktreeRoot, lease, revertFile,
      );

      if (hadViolations) {
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

  /**
   * Spawn the `claude` CLI subprocess and return its exit code.
   * Handles argument construction, Windows .cmd shim wrapping, and cwd normalization.
   */
  private async spawnClaudeCli(
    state: ClaudeRunState,
    worktreeRoot: string,
    lease: AgentLease,
  ): Promise<number> {
    const prompt = buildClaudeCodePrompt(state.workPacket, lease);
    const allowedTools = this.options.allowedTools ?? DEFAULT_ALLOWED_TOOLS;
    const skipPermissions = this.options.skipPermissions !== false;
    const args = buildClaudeArgs(prompt, allowedTools, skipPermissions);

    const [cmd, finalArgs] = resolveSpawnTarget(state.binaryUsed, args, this._resolvedUsesShell);
    const spawnFn: ClaudeSpawnFn = this.options._spawn ?? ((c, a, o) => spawn(c, a, o));

    return runChild(
      spawnFn,
      cmd,
      [...finalArgs],
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
  }

  /**
   * Validate each changed file against the lease's allowed/forbidden paths.
   * Reverts any file that violates the lease.
   * Returns true if violations were found (caller should finalize + return).
   */
  private async applyLeaseValidation(
    runId: string,
    state: ClaudeRunState,
    changedPaths: string[],
    worktreeRoot: string,
    lease: AgentLease,
    revertFile: (cwd: string, file: string) => Promise<void>,
  ): Promise<boolean> {
    const violations: string[] = [];
    const kept: string[] = [];

    for (const file of changedPaths) {
      const forbidden = matchesAnyGlob(file, lease.forbiddenPaths);
      const allowed = matchesAnyGlob(file, lease.allowedWritePaths);
      if (forbidden || !allowed) {
        violations.push(file);
        try {
          await revertFile(worktreeRoot, file);
          state.filesReverted.push(file);
        } catch (err) {
          logger.warn(`[ClaudeCodeAdapter] could not revert ${file}: ${String(err)}`);
        }
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
      return true;
    }
    return false;
  }
}

// ── Prompt builder ─────────────────────────────────────────────────────────

/**
 * Build the natural-language prompt that instructs Claude Code to fulfil a
 * work packet inside its isolated worktree. The prompt encodes hard path
 * constraints so the agent self-enforces the lease boundary.
 */
export function buildClaudeJudgePrompt(workPacket: WorkPacket, _lease: AgentLease): string {
  if (workPacket.dimensionId === 'council-consultation') return workPacket.objective;
  return `You are an independent code reviewer. READ ONLY — do NOT make any file changes.

# Work Being Reviewed
- Dimension: ${workPacket.dimensionId}
- Objective: ${workPacket.objective}

# Criteria to Verify
${workPacket.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

Read the relevant source files. Output your verdict in EXACTLY this format:

VERDICT: PASS
CONFIDENCE: HIGH
REASON: <one paragraph>
SCORE_SUGGESTION: <number 0-10>
BLOCKING_ISSUES: none

or VERDICT: FAIL with BLOCKING_ISSUES as a bullet list.
Be honest and harsh. Only PASS if the implementation is real and complete.`;
}

/**
 * Builds a self-contained judge prompt with the builder's diff embedded.
 * Used by council.ts sequential mode — judges receive the diff in the prompt
 * so they need zero tool use to produce a verdict.
 */
export function buildClaudeJudgeTextPrompt(goal: string, diff: string, changedFiles: string[]): string {
  return `You are an independent code reviewer evaluating a pull request.
Output ONLY a structured verdict — no file reads, no tool calls.

## Goal
${goal}

## Files Changed
${changedFiles.length > 0 ? changedFiles.map(f => `- ${f}`).join('\n') : '(none)'}

## Diff
\`\`\`diff
${diff.slice(0, 4000)}
\`\`\`

## Your Task
Review the diff above. Output your verdict in EXACTLY this format (all fields required):

VERDICT: PASS
CONFIDENCE: HIGH
REASON: <one paragraph — what the diff achieves and why it is correct>
SCORE_SUGGESTION: <number 0-10>
BLOCKING_ISSUES: none
BLOCKING_CONCERNS: none
DISSENT: none

or VERDICT: FAIL with BLOCKING_ISSUES as a bullet list.
Be harsh. Inflation is the enemy. Only PASS if the diff is real, complete, and non-trivial.`;
}

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
const KERNEL_STATE_DIRS = [
  '.danteforge/', '.danteforge-worktrees/', '.matrix-worktrees-test/',
  // AI tool workspace sidecars — created automatically during judge sessions, not real edits
  '.openhands/', '.claude/', '.cursor/', '.continue/', '.grok/', '.dantecode/', '.aider/',
];

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
  captureChunks?: Buffer[],
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
      killProcess(child);
      settle(124);
    }, timeoutMs);
    if (captureChunks) {
      child.stdout?.on('data', (chunk: Buffer) => captureChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    } else {
      // Drain so OS pipe buffers don't deadlock the child; git diff is truth.
      child.stdout?.on('data', () => { /* drain */ });
    }
    child.stderr?.on('data', () => { /* drain */ });
    child.on('close', (code) => settle((code ?? 1) as number));
    child.on('error', () => settle(1));
  });
}

/** Build the human-readable completion message for a run. */
function resolveFinalMessage(state: ClaudeRunState): string {
  if (state.capturedOutput.trim()) return state.capturedOutput.trim();
  if (state.finalMessage) return state.finalMessage;
  const violationCount = state.filesReverted.length;
  if (violationCount > 0) {
    return `Claude Code ran; ${state.filesChanged.length} file(s) kept, ${violationCount} reverted (lease violation)`;
  }
  return `Claude Code ran; ${state.filesChanged.length} file(s) changed`;
}

/** Build the commands-executed log entry from run state. */
function buildCommandsExecuted(
  state: ClaudeRunState,
): AgentRunResult['commandsExecuted'] {
  if (state.exitCode === null) return [];
  return [{
    command: state.binaryUsed,
    exitCode: state.exitCode,
    durationMs: (state.endMs ?? Date.now()) - state.startMs,
  }];
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
