// Matrix Kernel — Generic Shell Adapter (Phase 8 of PRD)
//
// Runs an arbitrary shell command in the lease's worktree. Stdout/stderr
// are surfaced as AgentRunEvents; the exit code becomes the run result.
import { spawn } from 'node:child_process';
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

interface ShellRunState {
  input: PreparedAgentRun;
  startedAt: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  filesChanged: string[];
  durationMs: number;
}

const RUN_STATE = new Map<string, ShellRunState>();

export interface GenericShellAdapterOptions {
  /** Command + args to run (e.g. ['npm', 'run', 'build']). */
  command: string[];
  /** Max runtime ms (default 60s). */
  timeoutMs?: number;
}

export class GenericShellAdapter implements AgentAdapter {
  readonly id = 'shell';
  readonly name = 'GenericShellAdapter';
  private command: string[];
  private timeoutMs: number;

  constructor(options: GenericShellAdapterOptions) {
    this.command = options.command;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async isAvailable(): Promise<boolean> {
    return this.command.length > 0;
  }

  async prepareRun(input: AgentRunInput): Promise<PreparedAgentRun> {
    return { ...input, prepared: true };
  }

  async startRun(input: PreparedAgentRun): Promise<AgentRunHandle> {
    const runId = `shellrun.${input.lease.id}.${Date.now()}`;
    const startedAt = new Date().toISOString();
    const cwd = input.cwd ?? input.lease.worktreePath;

    return new Promise<AgentRunHandle>((resolve) => {
      const child = spawn(this.command[0]!, this.command.slice(1), {
        cwd,
        env: { ...process.env, ...(input.env ?? {}) },
      });

      const state: ShellRunState = {
        input,
        startedAt,
        exitCode: null,
        stdout: '',
        stderr: '',
        filesChanged: [],
        durationMs: 0,
      };
      const startMs = Date.now();
      RUN_STATE.set(runId, state);

      const timer = setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* ignore */ }
      }, this.timeoutMs);

      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => { state.stdout += chunk; });
      child.stderr?.setEncoding('utf8');
      child.stderr?.on('data', (chunk: string) => { state.stderr += chunk; });

      child.on('close', (code) => {
        clearTimeout(timer);
        state.exitCode = code ?? 1;
        state.durationMs = Date.now() - startMs;
      });

      child.on('error', () => {
        clearTimeout(timer);
        state.exitCode = state.exitCode ?? 1;
        state.durationMs = Date.now() - startMs;
      });

      resolve({ runId, leaseId: input.lease.id, provider: 'shell', startedAt, pid: child.pid });
    });
  }

  async *streamEvents(handle: AgentRunHandle): AsyncIterable<AgentRunEvent> {
    const state = RUN_STATE.get(handle.runId);
    if (!state) return;
    yield {
      eventId: `${handle.runId}.start`,
      runId: handle.runId,
      ts: state.startedAt,
      kind: 'started',
      payload: { command: state.input.lease.requiredCommands },
    };
    // Drain until process exits
    while (state.exitCode === null) {
      await new Promise(r => setTimeout(r, 50));
    }
    yield {
      eventId: `${handle.runId}.complete`,
      runId: handle.runId,
      ts: new Date().toISOString(),
      kind: state.exitCode === 0 ? 'completed' : 'failed',
      payload: { exitCode: state.exitCode, stdoutTail: state.stdout.slice(-500) },
    };
  }

  async stopRun(handle: AgentRunHandle): Promise<void> {
    if (handle.pid) {
      try { process.kill(handle.pid, 'SIGTERM'); } catch { /* ignore */ }
    }
    RUN_STATE.delete(handle.runId);
  }

  async collectResult(handle: AgentRunHandle): Promise<AgentRunResult> {
    const state = RUN_STATE.get(handle.runId);
    if (!state) {
      throw new Error(`Run ${handle.runId} not found`);
    }
    while (state.exitCode === null) {
      await new Promise(r => setTimeout(r, 50));
    }
    return {
      runId: handle.runId,
      leaseId: handle.leaseId,
      status: state.exitCode === 0 ? 'completed' : 'failed',
      filesChanged: state.filesChanged,
      commandsExecuted: [{
        command: this.command.join(' '),
        exitCode: state.exitCode ?? 1,
        durationMs: state.durationMs,
      }],
      finalMessage: state.stdout.slice(-1000),
      errorReason: state.exitCode === 0 ? undefined : state.stderr.slice(-1000),
      startedAt: state.startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
