// Matrix Kernel — DanteCodeAdapter (Phase 13c, third real provider)
//
// A shell-spawned AgentAdapter for the local `dantecode` CLI binary. Writes a
// work packet + lease descriptor to a JSON file inside the worktree, invokes
//   dantecode run --input <in> --output <out>
// awaits exit, parses the output JSON (same ProposedEdit[] shape as the other
// adapters), validates against the lease, and applies edits to the worktree.
//
// Defense in depth (matches CodexAdapter / ClaudeCodeAdapter):
//   - Output validation against allowedWritePaths (refuses edits outside lease)
//   - File-content cap (200 LOC per file in input packet; 20 files max)
//   - Process timeout (default 5 min) to bound wall-clock cost
//   - DANTECODE_BIN env var gates default availability so tests can opt out
import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
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

// ── Edit schema (parsed from CLI output) ────────────────────────────────────

export interface ProposedEdit {
  path: string;
  action: 'write' | 'delete';
  contents?: string;
}

// ── Adapter state (per run) ─────────────────────────────────────────────────

interface DanteCodeRunState {
  startedAt: string;
  input: PreparedAgentRun;
  workPacket: WorkPacket;
  filesChanged: string[];
  status: AgentRunResult['status'];
  errorReason?: string;
  events: AgentRunEvent[];
  finalMessage?: string;
  startMs: number;
  endMs?: number;
  exitCode: number | null;
}

const RUN_STATE = new Map<string, DanteCodeRunState>();

// Minimal subset of ChildProcess the adapter actually depends on. Lets tests
// stub spawn with plain event emitters that have stdout/stderr streams.
export interface DanteCodeChildLike {
  stdout?: NodeJS.ReadableStream | null;
  stderr?: NodeJS.ReadableStream | null;
  on(event: 'close', cb: (code: number | null) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
  on(event: string, cb: (...args: unknown[]) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
  pid?: number;
}

export type DanteCodeSpawnFn = (
  cmd: string,
  args: string[],
  opts: SpawnOptions,
) => DanteCodeChildLike;

// ── Options ─────────────────────────────────────────────────────────────────

export interface DanteCodeAdapterOptions {
  workPacket: WorkPacket;
  /** Binary name (defaults to env DANTECODE_BIN, else 'dantecode'). */
  binary?: string;
  /** Max wall-clock for the child process (default 5 min). */
  timeoutMs?: number;
  maxFilesInPrompt?: number;     // default 20
  maxLinesPerFile?: number;      // default 200
  /** Injection seam: override spawn (returns a ChildProcess-like). */
  _spawn?: DanteCodeSpawnFn;
  /** Injection seam: force isAvailable result. */
  _isAvailable?: () => Promise<boolean>;
  /** Injection seam: replaces fs read for tests. */
  _readFile?: (p: string) => Promise<string>;
  /** Injection seam: replaces fs write for tests. */
  _writeFile?: (p: string, c: string) => Promise<void>;
  /** Injection seam: replaces fs unlink for tests. */
  _removeFile?: (p: string) => Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_FILES = 20;
const DEFAULT_MAX_LINES = 200;
const INPUT_FILENAME = '.dantecode-input.json';
const OUTPUT_FILENAME = '.dantecode-output.json';

// ── Adapter implementation ─────────────────────────────────────────────────

export class DanteCodeAdapter implements AgentAdapter {
  readonly id = 'dantecode';
  readonly name = 'DanteCodeAdapter';
  private options: DanteCodeAdapterOptions;

  constructor(options: DanteCodeAdapterOptions) {
    this.options = options;
  }

  async isAvailable(): Promise<boolean> {
    if (this.options._isAvailable) return this.options._isAvailable();
    // Default heuristic: gated on env var presence. The full PATH probe lives
    // on the integration side; the kernel keeps this side-effect-free.
    return Boolean(process.env.DANTECODE_BIN);
  }

  async prepareRun(input: AgentRunInput): Promise<PreparedAgentRun> {
    return { ...input, prepared: true };
  }

  async startRun(input: PreparedAgentRun): Promise<AgentRunHandle> {
    const runId = `dantecoderun.${input.lease.id}.${Date.now()}`;
    const startedAt = new Date().toISOString();
    const state: DanteCodeRunState = {
      startedAt,
      input,
      workPacket: this.options.workPacket,
      filesChanged: [],
      status: 'running',
      events: [],
      startMs: Date.now(),
      exitCode: null,
    };
    RUN_STATE.set(runId, state);

    await this.executeRun(runId, state);

    return { runId, leaseId: input.lease.id, provider: 'dantecode', startedAt };
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
      commandsExecuted: state.exitCode === null ? [] : [{
        command: this.options.binary ?? process.env.DANTECODE_BIN ?? 'dantecode',
        exitCode: state.exitCode,
        durationMs: (state.endMs ?? Date.now()) - state.startMs,
      }],
      finalMessage: state.finalMessage,
      errorReason: state.errorReason,
      startedAt: state.startedAt,
      completedAt: new Date((state.endMs ?? Date.now())).toISOString(),
      provider: 'dantecode',
      events: [...state.events],
    };
  }

  // ── Inner execution ─────────────────────────────────────────────────────

  private async executeRun(runId: string, state: DanteCodeRunState): Promise<void> {
    const lease = state.input.lease;
    const worktreeRoot = state.input.cwd ?? lease.worktreePath;
    const readFile = this.options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
    const writeFile = this.options._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
    const removeFile = this.options._removeFile ?? ((p: string) => fs.unlink(p));

    state.events.push({
      eventId: `${runId}.start`, runId, ts: state.startedAt, kind: 'started',
      payload: { workPacketId: state.workPacket.id },
    });

    try {
      // 1. Gather context files to ship to the CLI.
      const contextFiles = await collectContextFiles(
        worktreeRoot, lease, readFile,
        this.options.maxFilesInPrompt ?? DEFAULT_MAX_FILES,
        this.options.maxLinesPerFile ?? DEFAULT_MAX_LINES,
      );

      // 2. Build the work-packet JSON the CLI consumes.
      const packetJson = buildPacketJson(state.workPacket, lease, contextFiles);
      const inputPath = path.join(worktreeRoot, INPUT_FILENAME);
      const outputPath = path.join(worktreeRoot, OUTPUT_FILENAME);
      await writeFile(inputPath, packetJson);

      // 3. Spawn the CLI and wait for exit.
      const binary = this.options.binary ?? process.env.DANTECODE_BIN ?? 'dantecode';
      const spawnFn: DanteCodeSpawnFn = this.options._spawn ?? ((c, a, o) => spawn(c, a, o));
      const exitCode = await runChild(spawnFn, binary,
        ['run', '--input', INPUT_FILENAME, '--output', OUTPUT_FILENAME],
        { cwd: worktreeRoot, env: { ...process.env, ...(state.input.env ?? {}) } },
        this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      state.exitCode = exitCode;
      if (exitCode !== 0) {
        state.status = 'failed';
        state.errorReason = `dantecode_cli_exit_${exitCode}`;
        finalize(state, runId);
        return;
      }

      // 4. Parse + validate output.
      let outputRaw: string;
      try {
        outputRaw = await readFile(outputPath);
      } catch (err) {
        state.status = 'failed';
        state.errorReason = `output_file_missing: ${String(err)}`;
        finalize(state, runId);
        return;
      }
      const edits = parseEdits(outputRaw);
      if (edits === null) {
        state.status = 'failed';
        state.errorReason = 'cli_returned_malformed_json';
        finalize(state, runId);
        return;
      }
      const validation = validateEditsAgainstLease(edits, lease);
      if (!validation.ok) {
        state.status = 'failed';
        state.errorReason = `edit_outside_lease: ${validation.violations.join('; ')}`;
        finalize(state, runId);
        return;
      }

      // 5. Apply edits to worktree.
      for (const edit of edits) {
        const fullPath = path.join(worktreeRoot, edit.path);
        if (edit.action === 'write') {
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await writeFile(fullPath, edit.contents ?? '');
        } else if (edit.action === 'delete') {
          try { await removeFile(fullPath); } catch { /* best-effort */ }
        }
        state.filesChanged.push(edit.path);
        state.events.push({
          eventId: `${runId}.file.${edit.path}`, runId, ts: now(), kind: 'file_changed',
          payload: { path: edit.path, action: edit.action },
        });
      }

      state.status = 'completed';
      state.finalMessage = `Applied ${edits.length} edit(s) within lease scope`;
      state.events.push({ eventId: `${runId}.complete`, runId, ts: now(), kind: 'completed' });
      state.endMs = Date.now();
    } catch (err) {
      state.status = 'failed';
      state.errorReason = String(err);
      finalize(state, runId);
      logger.warn(`[DanteCodeAdapter] ${runId} failed: ${state.errorReason}`);
    }
  }
}

// ── Helpers (exported for tests) ────────────────────────────────────────────

export interface ContextFile {
  relativePath: string;
  contents: string;
  truncated: boolean;
}

export async function collectContextFiles(
  worktreeRoot: string,
  lease: AgentLease,
  readFile: (p: string) => Promise<string>,
  maxFiles: number,
  maxLines: number,
): Promise<ContextFile[]> {
  const candidates: string[] = [];
  for (const ownedGlob of lease.allowedWritePaths) {
    candidates.push(...await expandPath(worktreeRoot, ownedGlob));
  }
  for (const readGlob of lease.allowedReadPaths) {
    candidates.push(...await expandPath(worktreeRoot, readGlob));
  }
  const unique = Array.from(new Set(candidates)).slice(0, maxFiles);
  const result: ContextFile[] = [];
  for (const rel of unique) {
    try {
      const raw = await readFile(path.join(worktreeRoot, rel));
      const lines = raw.split(/\r?\n/);
      const truncated = lines.length > maxLines;
      const trimmed = truncated ? lines.slice(0, maxLines).join('\n') + '\n// ... (truncated)' : raw;
      result.push({ relativePath: rel, contents: trimmed, truncated });
    } catch { /* skip unreadable */ }
  }
  return result;
}

async function expandPath(root: string, globOrPath: string): Promise<string[]> {
  if (!globOrPath.includes('*')) {
    const full = path.join(root, globOrPath);
    try { await fs.access(full); return [globOrPath]; } catch { return []; }
  }
  const base = globOrPath.split('*')[0]!.replace(/\/$/, '');
  const matches: string[] = [];
  await walkDir(path.join(root, base), '', matches, (rel) => matchesAnyGlob(path.join(base, rel), [globOrPath]));
  return matches.map(m => path.posix.join(base, m).replace(/\\/g, '/'));
}

async function walkDir(
  fullDir: string, rel: string, out: string[],
  predicate: (rel: string) => boolean,
): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try { entries = await fs.readdir(fullDir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walkDir(path.join(fullDir, entry.name), relPath, out, predicate);
    } else if (entry.isFile() && predicate(relPath)) {
      out.push(relPath);
    }
  }
}

export function buildPacketJson(
  workPacket: WorkPacket,
  lease: AgentLease,
  contextFiles: ContextFile[],
): string {
  return JSON.stringify({
    workPacket: {
      id: workPacket.id,
      dimensionId: workPacket.dimensionId,
      objective: workPacket.objective,
      acceptanceCriteria: workPacket.acceptanceCriteria,
      proofRequired: workPacket.proof.proofRequired,
    },
    lease: {
      id: lease.id,
      allowedWritePaths: lease.allowedWritePaths,
      allowedReadPaths: lease.allowedReadPaths,
      forbiddenPaths: lease.forbiddenPaths,
    },
    contextFiles,
    constraints: {
      maxFileLoc: 500,
      esmRelativeImports: true,
      noNewDependencies: true,
    },
  }, null, 2);
}

export function parseEdits(raw: string): ProposedEdit[] | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    // Accept either a raw array, or { edits: [...] } from the CLI.
    const list: unknown = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).edits))
        ? (parsed as Record<string, unknown>).edits
        : null;
    if (!Array.isArray(list)) return null;
    const edits: ProposedEdit[] = [];
    for (const item of list) {
      if (typeof item !== 'object' || item === null) return null;
      const o = item as Record<string, unknown>;
      if (typeof o.path !== 'string') return null;
      if (o.action !== 'write' && o.action !== 'delete') return null;
      if (o.action === 'write' && typeof o.contents !== 'string') return null;
      edits.push({ path: o.path, action: o.action, contents: o.contents as string | undefined });
    }
    return edits;
  } catch {
    return null;
  }
}

export function validateEditsAgainstLease(
  edits: ProposedEdit[],
  lease: AgentLease,
): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  for (const edit of edits) {
    if (matchesAnyGlob(edit.path, lease.forbiddenPaths)) {
      violations.push(`${edit.path} is FORBIDDEN by lease`);
      continue;
    }
    if (!matchesAnyGlob(edit.path, lease.allowedWritePaths)) {
      violations.push(`${edit.path} is outside lease's allowed write paths`);
    }
  }
  return { ok: violations.length === 0, violations };
}

// ── Process plumbing ───────────────────────────────────────────────────────

function runChild(
  spawnFn: DanteCodeSpawnFn,
  cmd: string,
  args: string[],
  opts: SpawnOptions,
  timeoutMs: number,
): Promise<number> {
  return new Promise<number>((resolve) => {
    const child: DanteCodeChildLike = spawnFn(cmd, args, opts);
    let settled = false;
    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      settle(124); // standard "timeout" exit code
    }, timeoutMs);
    child.on('close', (code) => settle((code ?? 1) as number));
    child.on('error', () => settle(1));
  });
}

function finalize(state: DanteCodeRunState, runId: string): void {
  state.events.push({
    eventId: `${runId}.fail`, runId, ts: now(), kind: 'failed',
    payload: { reason: state.errorReason },
  });
  state.endMs = Date.now();
}

function now(): string {
  return new Date().toISOString();
}

// Re-exported for clarity at the package boundary.
export type { ChildProcess };
