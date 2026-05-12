// Matrix Kernel — Generic LLM-backed agent adapter (Phase 13b)
//
// Shared implementation for any provider that callLLM supports. Subclasses
// (ClaudeCodeAdapter, CodexAdapter, GeminiAdapter, GrokAdapter) are thin
// wrappers that only specify provider + display label.
import fs from 'node:fs/promises';
import path from 'node:path';
import { callLLM } from '../../core/llm.js';
import type { LLMProvider } from '../../core/config.js';
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

// ── Edit schema (parsed from LLM response) ─────────────────────────────────

export interface ProposedEdit {
  path: string;
  action: 'write' | 'delete';
  contents?: string;
}

// ── Options ─────────────────────────────────────────────────────────────────

export interface LLMAgentAdapterOptions {
  /** Required: which LLM provider this adapter routes to. */
  provider: LLMProvider;
  /** Friendly identifier (e.g. 'claude', 'codex', 'gemini'). Falls back to provider. */
  providerLabel?: string;
  workPacket: WorkPacket;
  maxBudgetUsd?: number;         // default 5.0
  maxFilesInPrompt?: number;     // default 20
  maxLinesPerFile?: number;      // default 200
  /** Optional model override (e.g. 'gpt-4o', 'claude-sonnet-4-6'). */
  model?: string;
  /** Injection seam: replaces callLLM for tests. */
  _callLLM?: (prompt: string) => Promise<string>;
  /** Injection seam: replaces fs read for tests. */
  _readFile?: (p: string) => Promise<string>;
  /** Injection seam: replaces fs write for tests. */
  _writeFile?: (p: string, c: string) => Promise<void>;
  /** Injection seam: replaces fs unlink for tests. */
  _removeFile?: (p: string) => Promise<void>;
}

const DEFAULT_BUDGET_USD = 5.0;
const DEFAULT_MAX_FILES = 20;
const DEFAULT_MAX_LINES = 200;

// ── Adapter state ───────────────────────────────────────────────────────────

interface RunState {
  startedAt: string;
  input: PreparedAgentRun;
  workPacket: WorkPacket;
  filesChanged: string[];
  status: AgentRunResult['status'];
  errorReason?: string;
  tokensConsumed: number;
  events: AgentRunEvent[];
  finalMessage?: string;
  endMs?: number;
}

const RUN_STATE = new Map<string, RunState>();

// ── Adapter implementation ─────────────────────────────────────────────────

export class LLMAgentAdapter implements AgentAdapter {
  readonly id: string;
  readonly name: string;
  protected options: LLMAgentAdapterOptions;

  constructor(options: LLMAgentAdapterOptions) {
    this.options = options;
    this.id = options.providerLabel ?? options.provider;
    this.name = options.providerLabel
      ? `LLMAgentAdapter(${options.providerLabel})`
      : `LLMAgentAdapter(${options.provider})`;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async prepareRun(input: AgentRunInput): Promise<PreparedAgentRun> {
    return { ...input, prepared: true };
  }

  async startRun(input: PreparedAgentRun): Promise<AgentRunHandle> {
    const runId = `${this.id}run.${input.lease.id}.${Date.now()}`;
    const startedAt = new Date().toISOString();
    const state: RunState = {
      startedAt, input, workPacket: this.options.workPacket,
      filesChanged: [], status: 'running',
      tokensConsumed: 0, events: [],
    };
    RUN_STATE.set(runId, state);
    await this.executeRun(runId, state);
    return { runId, leaseId: input.lease.id, provider: this.id, startedAt };
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
      commandsExecuted: [],
      tokensConsumed: state.tokensConsumed,
      finalMessage: state.finalMessage,
      errorReason: state.errorReason,
      startedAt: state.startedAt,
      completedAt: new Date(state.endMs ?? Date.now()).toISOString(),
    };
  }

  private async executeRun(runId: string, state: RunState): Promise<void> {
    const lease = state.input.lease;
    const worktreeRoot = state.input.cwd ?? lease.worktreePath;
    const readFile = this.options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
    const writeFile = this.options._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
    const removeFile = this.options._removeFile ?? ((p: string) => fs.unlink(p));

    state.events.push({ eventId: `${runId}.start`, runId, ts: state.startedAt, kind: 'started', payload: { workPacketId: state.workPacket.id, provider: this.id } });

    try {
      const contextFiles = await collectContextFiles(
        worktreeRoot, lease, readFile,
        this.options.maxFilesInPrompt ?? DEFAULT_MAX_FILES,
        this.options.maxLinesPerFile ?? DEFAULT_MAX_LINES,
      );
      const { buildRolePromptBlock } = await import('../engines/agent-roles.js');
      const { buildMemoryPromptBlock } = await import('../engines/agent-memory.js');
      const roleBlock = buildRolePromptBlock(lease.agentRole);
      const memoryBlock = await buildMemoryPromptBlock(lease.agentRole, worktreeRoot);
      const prompt = buildCodingPrompt(state.workPacket, lease, contextFiles, roleBlock, memoryBlock);

      const llmCaller = this.options._callLLM ?? makeBudgetedCaller(
        this.options.provider, this.options.model,
        this.options.maxBudgetUsd ?? DEFAULT_BUDGET_USD,
        this.id,
        (tokens) => { state.tokensConsumed += tokens; },
      );
      const response = await llmCaller(prompt);

      const edits = parseEdits(response);
      if (edits === null) {
        state.status = 'failed';
        state.errorReason = 'llm_returned_malformed_json';
        state.events.push({ eventId: `${runId}.fail`, runId, ts: now(), kind: 'failed', payload: { reason: state.errorReason } });
        state.endMs = Date.now();
        return;
      }
      const validation = validateEditsAgainstLease(edits, lease);
      if (!validation.ok) {
        state.status = 'failed';
        state.errorReason = `edit_outside_lease: ${validation.violations.join('; ')}`;
        state.events.push({ eventId: `${runId}.fail`, runId, ts: now(), kind: 'failed', payload: { reason: state.errorReason } });
        state.endMs = Date.now();
        return;
      }

      for (const edit of edits) {
        const fullPath = path.join(worktreeRoot, edit.path);
        if (edit.action === 'write') {
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await writeFile(fullPath, edit.contents ?? '');
        } else if (edit.action === 'delete') {
          try { await removeFile(fullPath); } catch { /* best-effort */ }
        }
        state.filesChanged.push(edit.path);
        state.events.push({ eventId: `${runId}.file.${edit.path}`, runId, ts: now(), kind: 'file_changed', payload: { path: edit.path, action: edit.action } });
      }

      state.status = 'completed';
      state.finalMessage = `Applied ${edits.length} edit(s) within lease scope via ${this.id}`;
      state.events.push({ eventId: `${runId}.complete`, runId, ts: now(), kind: 'completed' });
      state.endMs = Date.now();
    } catch (err) {
      state.status = 'failed';
      state.errorReason = String(err);
      state.events.push({ eventId: `${runId}.fail`, runId, ts: now(), kind: 'failed', payload: { reason: state.errorReason } });
      state.endMs = Date.now();
      logger.warn(`[${this.name}] ${runId} failed: ${state.errorReason}`);
    }
  }
}

// ── Shared helpers (re-exported) ────────────────────────────────────────────

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

export function buildCodingPrompt(
  workPacket: WorkPacket,
  lease: AgentLease,
  contextFiles: ContextFile[],
  /** Optional pre-built role block (from buildRolePromptBlock). */
  roleBlock?: string,
  /** Optional pre-built memory block (from buildMemoryPromptBlock). */
  memoryBlock?: string,
): string {
  const filesBlock = contextFiles.length === 0
    ? '(no existing files in scope)'
    : contextFiles.map(f =>
      `## ${f.relativePath}${f.truncated ? ' (TRUNCATED)' : ''}\n\`\`\`\n${f.contents}\n\`\`\``,
    ).join('\n\n');

  const rolePrefix = roleBlock && roleBlock.length > 0 ? `${roleBlock}\n` : '';
  const memoryPrefix = memoryBlock && memoryBlock.length > 0 ? `${memoryBlock}\n` : '';

  return `${rolePrefix}${memoryPrefix}You are a coding agent working on a single Work Packet inside an isolated git worktree.

# Work Packet
- ID: ${workPacket.id}
- Dimension: ${workPacket.dimensionId}
- Objective: ${workPacket.objective}

# Acceptance Criteria
${workPacket.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

# Required Proof
${workPacket.proof.proofRequired.map(p => `- ${p}`).join('\n')}

# Paths
- You MAY write to: ${lease.allowedWritePaths.join(', ')}
- You MAY read but NOT write: ${lease.allowedReadPaths.join(', ')}
- You MUST NOT touch: ${lease.forbiddenPaths.join(', ')}

# Existing files in worktree
${filesBlock}

# Task
Produce file changes that satisfy the acceptance criteria. Return ONLY a JSON
array, no prose, no markdown fences. Each entry shape:
  { "path": "<owned-path>", "action": "write", "contents": "<full file body>" }
  { "path": "<owned-path>", "action": "delete" }

Constraints:
- Every "path" must be inside an owned path
- Never reference forbidden paths
- Keep file size under 500 LOC
- Include all necessary imports (.js extensions for relative ESM imports)
- Do not invent new dependencies
- Return [] if no changes are needed`;
}

export function parseEdits(raw: string): ProposedEdit[] | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/m, '').replace(/\s*```\s*$/m, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;
    const edits: ProposedEdit[] = [];
    for (const item of parsed) {
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

function makeBudgetedCaller(
  provider: LLMProvider,
  model: string | undefined,
  maxBudgetUsd: number,
  agentRole: string,
  onTokens: (tokens: number) => void,
): (prompt: string) => Promise<string> {
  return async (prompt: string) => {
    return callLLM(prompt, provider, {
      model,
      budgetFence: {
        agentRole,
        maxBudgetUsd,
        currentSpendUsd: 0,
        isExceeded: false,
        warningThresholdPercent: 80,
      },
      onUsage: (usage) => onTokens(usage.inputTokens + usage.outputTokens),
    });
  };
}

function now(): string {
  return new Date().toISOString();
}
