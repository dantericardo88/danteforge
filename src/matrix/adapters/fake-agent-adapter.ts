// Matrix Kernel — Fake Agent Adapter (Phase 8 of PRD)
//
// Scripted, deterministic agent for tests and the MVP golden flow. Produces
// synthetic file changes inside the worktree according to a FakeAgentScript.
// Never calls a real LLM.
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

export interface FakeFileWrite {
  /** Path relative to worktree root. */
  path: string;
  contents: string;
}

export interface FakeAgentScript {
  /** What this fake agent should do. */
  action:
    | 'success'                    // writes a clean file inside owned paths
    | 'forbidden-edit'             // writes a file at lease.forbiddenPaths[0]
    | 'stub-commit'                // writes a file with a TODO/throw-not-implemented
    | 'red-team-trigger'           // writes a file that smells fake (assertion-only test)
    | 'noop';                      // touches nothing
  /** Override the writes. If omitted, the action determines synthetic contents. */
  fileWrites?: FakeFileWrite[];
  /** Override the simulated runtime in ms. */
  durationMs?: number;
}

/** Module-level lookup keyed by run ID so streamEvents+collectResult can find scripts. */
const RUN_STATE = new Map<string, FakeRunState>();

interface FakeRunState {
  script: FakeAgentScript;
  input: PreparedAgentRun;
  startedAt: string;
  filesChanged: string[];
}

export class FakeAgentAdapter implements AgentAdapter {
  readonly id = 'fake';
  readonly name = 'FakeAgentAdapter';
  private script: FakeAgentScript;

  constructor(script: FakeAgentScript = { action: 'success' }) {
    this.script = script;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async prepareRun(input: AgentRunInput): Promise<PreparedAgentRun> {
    return { ...input, prepared: true };
  }

  async startRun(input: PreparedAgentRun): Promise<AgentRunHandle> {
    const runId = `fakerun.${input.lease.id}.${Date.now()}`;
    const startedAt = new Date().toISOString();
    RUN_STATE.set(runId, {
      script: this.script,
      input,
      startedAt,
      filesChanged: [],
    });
    // Perform the synthetic writes immediately for determinism
    const filesChanged = await performScript(this.script, input);
    RUN_STATE.get(runId)!.filesChanged = filesChanged;
    return { runId, leaseId: input.lease.id, provider: 'fake', startedAt };
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
    for (const f of state.filesChanged) {
      yield {
        eventId: `${handle.runId}.file.${f}`,
        runId: handle.runId,
        ts: new Date().toISOString(),
        kind: 'file_changed',
        payload: { path: f },
      };
    }
    yield {
      eventId: `${handle.runId}.complete`,
      runId: handle.runId,
      ts: new Date().toISOString(),
      kind: 'completed',
    };
  }

  async stopRun(handle: AgentRunHandle): Promise<void> {
    RUN_STATE.delete(handle.runId);
  }

  async collectResult(handle: AgentRunHandle): Promise<AgentRunResult> {
    const state = RUN_STATE.get(handle.runId);
    if (!state) {
      throw new Error(`Run ${handle.runId} not found`);
    }
    const completedAt = new Date().toISOString();
    return {
      runId: handle.runId,
      leaseId: handle.leaseId,
      status: 'completed',
      filesChanged: state.filesChanged,
      commandsExecuted: [],
      startedAt: state.startedAt,
      completedAt,
      finalMessage: `Fake agent ${state.script.action} completed`,
      provider: 'fake',
    };
  }
}

// ── Script executor ────────────────────────────────────────────────────────

async function performScript(
  script: FakeAgentScript,
  input: PreparedAgentRun,
): Promise<string[]> {
  const worktreeRoot = input.cwd ?? input.lease.worktreePath;
  const changed: string[] = [];

  if (script.fileWrites && script.fileWrites.length > 0) {
    for (const w of script.fileWrites) {
      const full = path.join(worktreeRoot, w.path);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, w.contents, 'utf8');
      changed.push(w.path);
    }
    return changed;
  }

  // Auto-generate file writes based on action
  switch (script.action) {
    case 'success': {
      const target = input.lease.allowedWritePaths[0] ?? 'README.md';
      const targetFile = stripGlobs(target);
      const full = path.join(worktreeRoot, targetFile);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, `// Implementation by ${input.lease.provider} for ${input.lease.workPacketId}\nexport const ok = true;\n`, 'utf8');
      changed.push(targetFile);
      break;
    }
    case 'forbidden-edit': {
      const target = input.lease.forbiddenPaths[0] ?? 'src/cli/index.ts';
      const targetFile = stripGlobs(target);
      const full = path.join(worktreeRoot, targetFile);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, `// FORBIDDEN EDIT attempted by ${input.lease.provider}\nexport const hijacked = true;\n`, 'utf8');
      changed.push(targetFile);
      break;
    }
    case 'stub-commit': {
      const target = input.lease.allowedWritePaths[0] ?? 'src/stub.ts';
      const targetFile = stripGlobs(target);
      const full = path.join(worktreeRoot, targetFile);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, `// TODO: implement\nexport function stub(): never {\n  throw new Error('not implemented');\n}\n`, 'utf8');
      changed.push(targetFile);
      break;
    }
    case 'red-team-trigger': {
      const target = input.lease.allowedWritePaths[0] ?? 'src/fake.ts';
      const targetFile = stripGlobs(target);
      const full = path.join(worktreeRoot, targetFile);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, `// Claims to implement feature but is a no-op\nexport function feature(): string {\n  return 'TODO';\n}\n`, 'utf8');
      changed.push(targetFile);
      break;
    }
    case 'noop':
      break;
  }
  return changed;
}

function stripGlobs(pathExpr: string): string {
  return pathExpr.replace(/\/\*\*$/, '/sample.ts').replace(/\/\*$/, '/sample.ts').replace(/\*\*$/, 'sample.ts');
}
