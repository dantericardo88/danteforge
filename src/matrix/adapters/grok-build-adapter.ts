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
import { withCliSlot } from '../../core/cli-semaphore.js';
import { killProcess } from './kill-process.js';
import { defaultRevertFile } from './revert-file.js';
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
  /** Max retries on transient 502/503 errors (default: 3). */
  maxGrokRetries?: number;
  _spawn?: GrokBuildSpawnFn;
  _isAvailable?: () => Promise<boolean>;
  _gitDiff?: (cwd: string) => Promise<string[]>;
  /** Snapshot before judge runs to distinguish builder's pre-existing changes from judge's writes. */
  _preJudgeDiff?: (cwd: string) => Promise<string[]>;
  _revertFile?: (cwd: string, file: string) => Promise<void>;
  /** Inject sleep for tests (default: real setTimeout). */
  _sleep?: (ms: number) => Promise<void>;
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
  capturedStderr: string;
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
      binaryUsed: binary, capturedOutput: '', capturedStderr: '',
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
    let cleanupGrokMcpSupport: (() => Promise<void>) | undefined;

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

      // --single/-p passes the prompt as a single-turn headless invocation and exits.
      // Previously the prompt was args[0], which Grok's CLI treated as a subcommand name.
      // Note: --effort maps to the reasoningEffort API parameter which the grok-build model
      // does not support (400 Bad Request). Omit it to use the model's default effort level.
      const grokArgs = judgeMode
        ? ['--single', prompt, '--permission-mode', 'plan', '--output-format', 'plain', '--cwd', normalizeCwd(worktreeRoot), '--no-memory']
        : ['--single', prompt, '--always-approve', '--cwd', normalizeCwd(worktreeRoot), '--no-memory'];

      const envSetup = await buildGrokSpawnEnv({ ...process.env, ...(state.input.env ?? {}) }, worktreeRoot);
      cleanupGrokMcpSupport = envSetup.cleanup;
      const env = envSetup.env;
      const spawnOpts: SpawnOptions = {
        cwd: normalizeCwd(worktreeRoot),
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      };
      const maxRetries = this.options.maxGrokRetries ?? 3;
      const sleepFn = this.options._sleep ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
      // For judge mode: snapshot worktree state BEFORE spawning to detect only new writes.
      // court-audit #13: judge tripwire uses judgeWriteDiff (keeps .danteforge/ visible), not defaultGitDiff.
      const judgeBaseGitDiff = this.options._gitDiff ?? judgeWriteDiff;
      const preJudgeDiffFn = this.options._preJudgeDiff ?? judgeBaseGitDiff;
      const preJudgeFiles = judgeMode ? new Set(await preJudgeDiffFn(worktreeRoot)) : new Set<string>();
      let exitCode = 1;
      let attempt = 0;
      let chunks: Buffer[] = [];

      while (attempt <= maxRetries) {
        chunks = [];
        const stderrChunks: Buffer[] = [];
        exitCode = await runChild(
          spawnFn, binary, grokArgs, spawnOpts,
          this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          chunks,
          false,
          stderrChunks,
        );
        const stdout = Buffer.concat(chunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        const rawForRetry = stderr || stdout;
        if (exitCode === 0 || !isTransientGrokError(rawForRetry, exitCode)) {
          state.capturedOutput = stdout;
          state.capturedStderr = stderr;
          break;
        }
        const retryAfterMs = parseRetryAfter(rawForRetry);
        attempt++;
        if (attempt > maxRetries) {
          state.capturedOutput = stdout || stderr;
          state.capturedStderr = stderr;
          break;
        }
        logger.warn(`[GrokBuildAdapter] transient error (attempt ${attempt}/${maxRetries}), retrying in ${retryAfterMs / 1000}s — exit=${exitCode}`);
        await sleepFn(retryAfterMs);
      }

      state.exitCode = exitCode;

      // Grok exits 255 on normal single-turn completion (not an error).
      // Any other non-zero exit is a genuine failure — in BUILD mode (bad work) AND in JUDGE mode.
      // court-audit #11: the old `&& !judgeMode` guard meant a killed/timed-out/crashed judge's PARTIAL
      // buffered stdout (which may end in "VERDICT: PASS") was trusted as a real verdict — the exact bug
      // codex/claude were patched against. A judge that did not exit cleanly produced NO verdict: discard
      // its output and report failed, so defaultRunJudge surfaces an honest UNCLEAR-unavailable abstention.
      const grokExitOk = exitCode === 0 || exitCode === 255;
      if (!grokExitOk) {
        const errSnippet = (state.capturedStderr || state.capturedOutput).trim().slice(0, 300) || '(no output)';
        logger.warn(`[GrokBuildAdapter] ${runId} ${judgeMode ? 'JUDGE ' : ''}exit=${exitCode} — ${errSnippet}`);
        state.status = 'failed';
        state.errorReason = judgeMode ? `judge_exit_${exitCode}: ${errSnippet}` : `grok_exit_${exitCode}`;
        if (judgeMode) { state.capturedOutput = ''; state.finalMessage = ''; }
        finalize(state, runId);
        return;
      }

      if (judgeMode) {
        // Explicit finalMessage so collectResult() doesn't fall through to "Grok ran; 0 files" fallback.
        state.finalMessage = state.capturedOutput.trim() || '(no judge output from grok)';
        // Post-run diff: only flag files NEW since pre-judge snapshot.
        const changedAfterJudge = (await judgeBaseGitDiff(worktreeRoot)).filter(f => !preJudgeFiles.has(f));
        if (changedAfterJudge.length > 0) {
          logger.warn(`[GrokBuildAdapter] judge ${runId} modified ${changedAfterJudge.length} file(s) — reverting; auto-FAIL verdict`);
          const revertFile = this.options._revertFile ?? defaultRevertFile;
          await Promise.allSettled(changedAfterJudge.map(f => revertFile(worktreeRoot, f)));
          // Judge wrote files despite read-only mode → bad-faith violation.
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
    } finally {
      await cleanupGrokMcpSupport?.().catch((err) => {
        logger.warn(`[GrokBuildAdapter] could not clean up Grok MCP override: ${String(err)}`);
      });
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
  // Consultation objectives (council-ask) already contain the full structured prompt —
  // return them as-is so the question reaches the model without being replaced by the
  // generic "code reviewer" template.
  const isConsultation = workPacket.dimensionId === 'council-consultation';
  if (isConsultation) return workPacket.objective;

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

/** 502/503 patterns that appear in grok.exe stderr when the proxy is overloaded. */
const TRANSIENT_PATTERNS = [
  /502\s*bad\s*gateway/i,
  /503\s*service\s*unavailable/i,
  /\b502\b/,
  /responses\s+API\s+error/i,
  /retry.?after/i,
  /gateway\s*error/i,
  /upstream\s*(connect|timeout)/i,
];

function isTransientGrokError(output: string, exitCode: number): boolean {
  if (exitCode === 0) return false;
  return TRANSIENT_PATTERNS.some(p => p.test(output));
}

/** Extract retry-after seconds from output (default: 60s). */
function parseRetryAfter(output: string): number {
  const m = /retry.?after[:\s]+(\d+)/i.exec(output);
  const seconds = m ? parseInt(m[1], 10) : 60;
  return Math.min(Math.max(seconds, 5), 300) * 1000;
}

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

// court-audit #13 (parity with gemini): the JUDGE read-only tripwire must SEE `.danteforge/` writes — a
// judge writing the score surface is the #1 thing to catch. defaultGitDiff hides `.danteforge/` (right for
// build mode, lease-enforced); judgeWriteDiff filters only genuine AI-tool sidecars, keeping kernel state visible.
const JUDGE_NOISE_DIRS = [
  '.danteforge-worktrees/', '.matrix-worktrees-test/',
  '.openhands/', '.claude/', '.cursor/', '.continue/', '.grok/', '.dantecode/', '.aider/',
];
async function judgeWriteDiff(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd, timeout: 10000 });
    return stdout.split('\n')
      .map(l => l.trim()).filter(l => l.length > 0)
      .map(l => l.slice(l.indexOf(' ')).trim())
      .filter(p => !JUDGE_NOISE_DIRS.some(prefix => p === prefix || p.startsWith(prefix)));
  } catch { return []; }
}


async function buildGrokSpawnEnv(
  baseEnv: NodeJS.ProcessEnv,
  worktreeRoot: string,
): Promise<{ env: NodeJS.ProcessEnv; cleanup?: () => Promise<void> }> {
  const env = { ...baseEnv };
  const support = await ensureDanteforgeCommandShim(worktreeRoot).catch((err) => {
    logger.warn(`[GrokBuildAdapter] could not prepare danteforge MCP shim: ${String(err)}`);
    return undefined;
  });
  if (!support) return { env };
  const pathKey = Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH';
  const currentPath = env[pathKey] ?? '';
  env[pathKey] = currentPath ? `${support.shimDir}${path.delimiter}${currentPath}` : support.shimDir;
  return { env, cleanup: support.cleanup };
}

async function ensureDanteforgeCommandShim(
  worktreeRoot: string,
): Promise<{ shimDir: string; cleanup?: () => Promise<void> } | undefined> {
  const root = await findDanteforgeRoot(worktreeRoot);
  if (!root) return undefined;
  const invocation = await resolveDanteforgeInvocation(root);
  if (!invocation) return undefined;
  const cleanup = await writeGrokMcpOverride(worktreeRoot, invocation);
  const shimDir = path.join(os.tmpdir(), 'danteforge-grok-mcp-shims', Buffer.from(root).toString('hex').slice(0, 48));
  await fs.mkdir(shimDir, { recursive: true });
  if (process.platform === 'win32') {
    const shimPath = path.join(shimDir, 'danteforge.cmd');
    const args = invocation.kind === 'dist'
      ? `"${invocation.entry}" %*`
      : `"${invocation.tsx}" "${invocation.entry}" %*`;
    await fs.writeFile(shimPath, `@echo off\r\nnode ${args}\r\n`, 'utf8');
    const posixShimPath = path.join(shimDir, 'danteforge');
    const posixArgs = invocation.kind === 'dist'
      ? `${shQuote(invocation.entry)} "$@"`
      : `${shQuote(invocation.tsx)} ${shQuote(invocation.entry)} "$@"`;
    await fs.writeFile(posixShimPath, `#!/usr/bin/env sh\nexec node ${posixArgs}\n`, { encoding: 'utf8', mode: 0o755 });
    await fs.chmod(posixShimPath, 0o755).catch(() => undefined);
  } else {
    const shimPath = path.join(shimDir, 'danteforge');
    const args = invocation.kind === 'dist'
      ? `${shQuote(invocation.entry)} "$@"`
      : `${shQuote(invocation.tsx)} ${shQuote(invocation.entry)} "$@"`;
    await fs.writeFile(shimPath, `#!/usr/bin/env sh\nexec node ${args}\n`, { encoding: 'utf8', mode: 0o755 });
    await fs.chmod(shimPath, 0o755).catch(() => undefined);
  }
  return { shimDir, cleanup };
}

async function writeGrokMcpOverride(
  worktreeRoot: string,
  invocation: { kind: 'dist'; entry: string } | { kind: 'src'; entry: string; tsx: string },
): Promise<(() => Promise<void>) | undefined> {
  const stat = await fs.stat(worktreeRoot).catch(() => undefined);
  if (!stat?.isDirectory()) return undefined;
  const grokDir = path.join(worktreeRoot, '.grok');
  const configPath = path.join(grokDir, 'config.toml');
  const prior = await fs.readFile(configPath, 'utf8').catch(() => undefined);
  const priorDirExists = await fs.stat(grokDir).then(s => s.isDirectory()).catch(() => false);
  const next = replaceTomlSection(prior, 'mcp_servers.danteforge', buildDanteforgeMcpToml(invocation));
  await fs.mkdir(grokDir, { recursive: true });
  await fs.writeFile(configPath, next, 'utf8');
  return async () => {
    if (prior === undefined) {
      await fs.rm(configPath, { force: true });
      if (!priorDirExists) await fs.rmdir(grokDir).catch(() => undefined);
      return;
    }
    await fs.writeFile(configPath, prior, 'utf8');
  };
}

function buildDanteforgeMcpToml(
  invocation: { kind: 'dist'; entry: string } | { kind: 'src'; entry: string; tsx: string },
): string {
  const args = invocation.kind === 'dist'
    ? [invocation.entry, 'mcp-server']
    : [invocation.tsx, invocation.entry, 'mcp-server'];
  return [
    '[mcp_servers.danteforge]',
    'command = "node"',
    `args = [${args.map(tomlQuote).join(', ')}]`,
    'enabled = true',
    'startup_timeout_sec = 30',
    '',
  ].join('\n');
}

function replaceTomlSection(source: string | undefined, sectionName: string, replacement: string): string {
  source ??= '';
  const sectionHeader = `[${sectionName}]`;
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => line.trim() === sectionHeader);
  if (start === -1) return `${source.trimEnd()}${source.trim() ? '\n\n' : ''}${replacement}`;
  let end = start + 1;
  while (end < lines.length && !/^\s*\[[^\]]+\]\s*$/.test(lines[end]!)) end++;
  const updated = [...lines.slice(0, start), replacement.trimEnd(), ...lines.slice(end)];
  return `${updated.join('\n').trimEnd()}\n`;
}

function tomlQuote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function findDanteforgeRoot(start: string): Promise<string | undefined> {
  for (const candidate of uniquePaths([start, process.cwd(), path.resolve(start, '..'), path.resolve(start, '..', '..')])) {
    const found = await findUp(candidate, async (dir) =>
      await exists(path.join(dir, 'src', 'cli', 'index.ts')) || await exists(path.join(dir, 'dist', 'index.js')));
    if (found) return found;
  }
  return undefined;
}

async function resolveDanteforgeInvocation(root: string): Promise<
  | { kind: 'dist'; entry: string }
  | { kind: 'src'; entry: string; tsx: string }
  | undefined
> {
  const distEntry = path.join(root, 'dist', 'index.js');
  if (await exists(distEntry)) return { kind: 'dist', entry: distEntry };
  const srcEntry = path.join(root, 'src', 'cli', 'index.ts');
  if (!await exists(srcEntry)) return undefined;
  const tsx = await findNearestTsxCli(root);
  return tsx ? { kind: 'src', entry: srcEntry, tsx } : undefined;
}

async function findNearestTsxCli(root: string): Promise<string | undefined> {
  for (const candidate of uniquePaths([root, process.cwd(), path.resolve(root, '..'), path.resolve(root, '..', '..')])) {
    const found = await findUp(candidate, async (dir) => {
      const cli = path.join(dir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
      return await exists(cli) ? cli : false;
    });
    if (found) return path.join(found, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  }
  return undefined;
}

async function findUp(start: string, predicate: (dir: string) => Promise<boolean | string>): Promise<string | undefined> {
  let dir = path.resolve(start);
  while (true) {
    const matched = await predicate(dir);
    if (matched) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map(p => path.resolve(p)))];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
  stderrChunks?: Buffer[],
): Promise<number> {
  // Fleet governor: shared CLI slot held for the child's lifetime (per-account limit).
  return withCliSlot(() => new Promise<number>((resolve) => {
    const child: GrokBuildChildLike = spawnFn(cmd, args, opts);
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
    child.stdout?.on('data', (chunk: Buffer) => {
      captureChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (captureStderr) captureChunks.push(buf);
      stderrChunks?.push(buf);
    });
    child.on('close', (code) => settle((code ?? 1) as number));
    child.on('error', () => settle(1));
  }));
}

function finalize(state: GrokRunState, runId: string): void {
  state.events.push({
    eventId: `${runId}.fail`, runId, ts: now(), kind: 'failed',
    payload: { reason: state.errorReason },
  });
  state.endMs = Date.now();
}

function now(): string { return new Date().toISOString(); }
