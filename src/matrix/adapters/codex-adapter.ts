// Matrix Kernel — CodexAdapter (Phase 14d: subprocess CLI orchestration)
//
// Spawns the `codex` CLI as a subprocess inside the lease's worktree. Codex
// uses its own native tools to make changes directly in the worktree. After
// the subprocess exits, the adapter detects changes via `git status
// --porcelain` and validates against the lease's allowedWritePaths.
//
// Auth: uses the user's existing ChatGPT Plus/Pro subscription via the
// `codex` CLI's own auth (codex login). No OPENAI_API_KEY needed.
//
// For the API-backed equivalent (for CI / programmatic dispatch), see
// OpenAIAPIAdapter.
import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { logger } from '../../core/logger.js';
import { trackChild, untrackChild, killTree } from '../../core/process-tree.js';
import { withCliSlot } from '../../core/cli-semaphore.js';
import { killProcess } from './kill-process.js';
import { matchesAnyGlob } from '../util/glob.js';
import type {
  AgentAdapter,
  AgentRunInput,
  PreparedAgentRun,
} from './adapter-interface.js';
import { defaultRevertFile } from './revert-file.js';
import type { AgentLease } from '../types/lease.js';
import type { WorkPacket } from '../types/work-graph.js';
import type {
  AgentRunEvent,
  AgentRunHandle,
  AgentRunResult,
} from '../types/agent.js';

const execFileAsync = promisify(execFile);

export interface CodexChildLike {
  stdin?: NodeJS.WritableStream | null;
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  on(event: 'close', cb: (code: number | null) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  on(event: string, cb: (...args: unknown[]) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
  pid?: number;
}

export type CodexSpawnFn = (cmd: string, args: string[], opts: SpawnOptions) => CodexChildLike;

export interface CodexAdapterOptions {
  workPacket: WorkPacket;
  binary?: string;
  timeoutMs?: number;
  /** When true, runs as a read-only reviewer: stdout is captured as finalMessage. */
  judgeMode?: boolean;
  _spawn?: CodexSpawnFn;
  _isAvailable?: () => Promise<boolean>;
  _gitDiff?: (cwd: string) => Promise<string[]>;
  /** Snapshot before judge runs to distinguish builder's pre-existing changes from judge's writes. */
  _preJudgeDiff?: (cwd: string) => Promise<string[]>;
  _revertFile?: (cwd: string, file: string) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

interface CodexRunState {
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

const RUN_STATE = new Map<string, CodexRunState>();

export class CodexAdapter implements AgentAdapter {
  readonly id = 'codex';
  readonly name = 'CodexAdapter';
  private options: CodexAdapterOptions;

  constructor(options: CodexAdapterOptions) {
    this.options = options;
  }

  async isAvailable(): Promise<boolean> {
    if (this.options._isAvailable) return this.options._isAvailable();
    const candidates = candidateBinaries(this.options.binary ?? process.env.CODEX_BIN ?? 'codex');
    for (const candidate of candidates) {
      const needsShim = candidate.endsWith('.cmd') || candidate.endsWith('.bat');
      try {
        // Probe via cmd.exe /c <binary> --version when .cmd/.bat to avoid
        // the `shell: true` deprecation warning (DEP0190) and the arg-
        // mangling that comes with it. Identical to the dispatch path.
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
  /** Whether the resolved binary requires shell:true to invoke (e.g. .cmd shims). */
  private _resolvedUsesShell = false;

  async prepareRun(input: AgentRunInput): Promise<PreparedAgentRun> {
    return { ...input, prepared: true };
  }

  async startRun(input: PreparedAgentRun): Promise<AgentRunHandle> {
    const runId = `codexproc.${input.lease.id}.${Date.now()}`;
    const startedAt = new Date().toISOString();
    const binary = this._resolvedBinary ?? candidateBinaries(this.options.binary ?? process.env.CODEX_BIN ?? 'codex')[0]!;
    const state: CodexRunState = {
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

    return { runId, leaseId: input.lease.id, provider: 'codex', startedAt };
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
        ? `Codex CLI ran; ${state.filesChanged.length} file(s) kept, ${violationCount} reverted (lease violation)`
        : `Codex CLI ran; ${state.filesChanged.length} file(s) changed`);
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
      provider: 'codex',
      events: [...state.events],
    };
  }

  private async executeRun(runId: string, state: CodexRunState): Promise<void> {
    const lease = state.input.lease;
    const worktreeRoot = state.input.cwd ?? lease.worktreePath;

    state.events.push({
      eventId: `${runId}.start`, runId, ts: state.startedAt, kind: 'started',
      payload: { workPacketId: state.workPacket.id, provider: 'codex' },
    });

    try {
      const spawnFn: CodexSpawnFn = this.options._spawn ?? ((c, a, o) => spawn(c, a, o));
      const usesCmdShim = this._resolvedUsesShell && process.platform === 'win32';

      // Judge mode: capture verdict via --output-last-message file (avoids TUI stdout),
      // with stdout-chunks as fallback so injection-seam tests still pass.
      if (this.options.judgeMode) {
        const judgePrompt = buildCodexJudgePrompt(state.workPacket, lease);
        const tmpFile = path.join(os.tmpdir(), `codex-judge-${Date.now()}.txt`);
        // Snapshot worktree state BEFORE judge runs — builder's pre-existing changes must
        // not trigger rogue detection (judge runs in the builder's dirty worktree).
        const judgeGitDiff = this.options._gitDiff ?? defaultGitDiff;
        const preJudgeDiff = this.options._preJudgeDiff ?? judgeGitDiff;
        const preJudgeFiles = new Set(await preJudgeDiff(worktreeRoot));
        // --sandbox read-only structurally prevents any file writes during judging.
        // Pipe prompt via stdin (-) to avoid cmd.exe argument mangling on Windows.
        const [jCmd, jArgs] = usesCmdShim
          ? ['cmd.exe', ['/c', state.binaryUsed, 'exec', '--ephemeral', '--sandbox', 'read-only', '--output-last-message', tmpFile, '-']] as const
          : [state.binaryUsed, ['exec', '--ephemeral', '--sandbox', 'read-only', '--output-last-message', tmpFile, '-']] as const;
        const chunks: Buffer[] = [];
        state.exitCode = await runChild(spawnFn, jCmd, [...jArgs], {
          cwd: normalizeCwd(worktreeRoot),
          env: { ...process.env, ...(state.input.env ?? {}) },
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        }, this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS, chunks, judgePrompt);
        // File output takes precedence; stdout fallback for test fake-procs.
        let fromFile = '';
        try {
          fromFile = (await fs.readFile(tmpFile, 'utf8')).trim();
          await fs.unlink(tmpFile).catch(() => { /* ignore */ });
        } catch { /* file not written — subprocess mocked or flag unsupported */ }
        state.capturedOutput = fromFile || Buffer.concat(chunks).toString('utf8');
        state.finalMessage = state.capturedOutput.trim() || '(no judge output)';
        // Post-run diff: only flag files that are NEW since the pre-judge snapshot.
        const changedAfterJudge = (await judgeGitDiff(worktreeRoot)).filter(f => !preJudgeFiles.has(f));
        if (changedAfterJudge.length > 0) {
          // The judge runs with --sandbox read-only — file writes are structurally impossible
          // for it, so post-snapshot changes are CONCURRENT shared-tree activity, never the
          // judge. See claude-code-adapter for the run-3i incident the old revert+FAIL caused.
          // Nothing is reverted; UNCLEAR can never satisfy a PASS quorum.
          logger.warn(`[CodexAdapter] judge ${runId}: tree changed during review (${changedAfterJudge.join(', ')}) — concurrent activity (judge is read-only by construction); verdict UNCLEAR, nothing reverted`);
          state.errorReason = `tree_changed_during_review: ${changedAfterJudge.join(', ')}`;
          state.capturedOutput = '';
          state.finalMessage = `VERDICT: UNCLEAR\nCONFIDENCE: LOW\nREASON: The worktree changed during review (${changedAfterJudge.join(', ')}) — concurrent campaign/operator activity contaminated the review environment. The judge is read-only by construction and cannot have written these files. No capability judgment is possible this round.`;
          state.status = 'completed';
          state.events.push({ eventId: `${runId}.complete`, runId, ts: now(), kind: 'completed' });
          state.endMs = Date.now();
          return;
        }
        state.status = 'completed';
        state.events.push({ eventId: `${runId}.complete`, runId, ts: now(), kind: 'completed' });
        state.endMs = Date.now();
        return;
      }

      const prompt = buildCodexPrompt(state.workPacket, lease);
      // Pipe prompt via stdin (-) to avoid cmd.exe argument mangling on Windows
      // with multi-line, special-char prompts. Forward-slash cwd avoids a node
      // spawn bug where backslash paths cause cmd.exe to appear unresolvable.
      const [cmd, args] = usesCmdShim
        ? ['cmd.exe', ['/c', state.binaryUsed, 'exec', '-']] as const
        : [state.binaryUsed, ['exec', '-']] as const;
      const exitCode = await runChild(spawnFn, cmd, [...args],
        {
          cwd: normalizeCwd(worktreeRoot),
          env: { ...process.env, ...(state.input.env ?? {}) },
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        undefined,
        prompt,
      );
      state.exitCode = exitCode;

      if (exitCode !== 0) {
        state.status = 'failed';
        state.errorReason = `codex_cli_exit_${exitCode}`;
        finalize(state, runId);
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
          catch (err) { logger.warn(`[CodexAdapter] could not revert ${file}: ${String(err)}`); }
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
      logger.warn(`[CodexAdapter] ${runId} failed: ${state.errorReason}`);
    }
  }
}

export function buildCodexJudgePrompt(workPacket: WorkPacket, lease: AgentLease): string {
  if (workPacket.dimensionId === 'council-consultation') return workPacket.objective;
  return `You are an independent code reviewer. READ ONLY — do NOT make any file changes.

# Work Being Reviewed
- Dimension: ${workPacket.dimensionId}
- Objective: ${workPacket.objective}

# Criteria to Verify
${workPacket.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

Read the relevant source files.

## Seam Audit (mandatory — check before issuing verdict)
Examine every test file referenced in outcome commands. Search for injection seam patterns:
  _cipCheck, _runPass, _runAutoforge, _runVerify, _now\\b, _discover, _loadMatrix, _runAdapter,
  Jest/Vitest module-mock calls, sinon.stub(, sinon.mock(
If any T5/T6/T7/T8 outcome command references a file containing these patterns, add to BLOCKING_ISSUES:
  [SEAM] <filename>:<pattern> — seamed evidence cannot support T5+ credit
A work packet that introduces seamed T5+ outcome commands MUST receive VERDICT: FAIL.

Output your verdict in EXACTLY this format:

VERDICT: PASS
CONFIDENCE: HIGH
REASON: <one paragraph>
SCORE_SUGGESTION: <number 0-10>
BLOCKING_ISSUES: none

or VERDICT: FAIL with BLOCKING_ISSUES as a bullet list.
Be harsh. Only PASS if the implementation is real and non-trivial.`;
}

export function buildCodexPrompt(workPacket: WorkPacket, lease: AgentLease): string {
  return `You are a coding agent working on a Work Packet inside an isolated git worktree. Use your native tools to make the changes — do NOT emit JSON.

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

# TREE SAFETY (ABSOLUTE — your worktree SHARES the main repository's git)
NEVER run: git clean, git reset --hard / --merge, git checkout -- ., git restore with broad
pathspecs, git stash, git switch/checkout to another branch, or any command that discards or
relocates work. Your worktree's git commands can reach the OPERATOR'S checkout — running git
clean / checkout from the wrong directory has destroyed live uncommitted operator work. Stay in
your worktree directory at all times; make changes ONLY with file edits; if your work feels
"dirty" or wrong, STOP and leave it — never wipe state to start over.

# Task
Make the file edits needed to satisfy the acceptance criteria. Stop when done. We will detect your changes via git status; no JSON output expected.`;
}

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


/** Forward-slash a Windows path. Workaround for a node spawn bug where a
 *  backslash cwd causes `cmd.exe` to be unresolvable (ENOENT on its own
 *  absolute path). Forward slashes work; same string, different bytes. */
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
  spawnFn: CodexSpawnFn,
  cmd: string,
  args: string[],
  opts: SpawnOptions,
  timeoutMs: number,
  captureChunks?: Buffer[],
  stdinData?: string,
): Promise<number> {
  // Fleet governor: shared CLI slot held for the child's lifetime (per-account limit).
  return withCliSlot(() => new Promise<number>((resolve) => {
    const child: CodexChildLike = spawnFn(cmd, args, opts);
    // Track the builder so a parent exit/interrupt tree-kills it — the fleet found builder
    // agents alive after a clean parent exit because adapter children were never registered.
    const pid = (child as { pid?: number }).pid;
    trackChild(pid);
    let settled = false;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      untrackChild(pid);
      resolve(code);
    };
    const timer = setTimeout(() => {
      // Tree-kill: the CLI spawns its own helpers; killing only the direct child orphans them.
      killTree(pid);
      killProcess(child);
      settle(124);
    }, timeoutMs);
    if (captureChunks) {
      child.stdout?.on('data', (chunk: Buffer) => captureChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    } else {
      child.stdout?.on('data', () => { /* drain */ });
    }
    child.stderr?.on('data', () => { /* drain */ });
    child.on('close', (code) => settle((code ?? 1) as number));
    child.on('error', () => settle(1));
    if (stdinData && child.stdin) {
      child.stdin.write(stdinData, () => child.stdin!.end());
    }
  }));
}

function finalize(state: CodexRunState, runId: string): void {
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
