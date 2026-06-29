// supervisor-state.ts — durable campaign state for the auto-reengage Supervisor. Persisted to
// `.danteforge/supervisor-state.json` so a crash, a laptop sleep, or a reboot can RESUME the campaign
// instead of losing it — the gap the audit found (only autoforge had any resume, and it was manual).
//
// Mirrors the proven autoforge-checkpoint.ts save/load shape: best-effort writes that never throw and
// never block the loop, injectable fs for tests. The state also carries a STOP sentinel so an operator's
// `danteforge supervise --stop` is seen by a running supervisor on its next iteration.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';
import type { Posture } from './loop-exit-classifier.js';

export const SUPERVISOR_STATE_FILE = '.danteforge/supervisor-state.json';

export interface SupervisorEscalation {
  at: string;
  reason: string;
}

export interface SupervisorState {
  savedAt: string;
  goal: string;
  target: number;
  engine: string;
  posture: Posture;
  campaignStartedAt: string;
  /** Total inner-engine runs launched this campaign. */
  restarts: number;
  /** Consecutive restarts with no measured grounding progress (drives backoff + circuit breaker). */
  staleRestarts: number;
  /** Last measured grounding ratio (0..1), or null if unmeasured. */
  lastGrounding: number | null;
  lastExitReason: string;
  /** Epoch-ms the supervisor is sleeping until (provider-outage reset), or null. */
  nextResumeAtMs: number | null;
  status: 'running' | 'paused' | 'stopped';
  /** Operator stop request — a running supervisor honors this on its next loop turn. */
  stopRequested: boolean;
  /** A pause that awaits the OPERATOR. The keepalive must NOT auto-resume it; only a foreground operator
   *  re-run clears it. Without this, the keepalive relaunches and silently un-pauses a paused campaign. */
  pauseSticky: boolean;
  escalations: SupervisorEscalation[];
}

/** A fresh campaign state. Pure given the timestamp. */
export function freshSupervisorState(
  init: Pick<SupervisorState, 'goal' | 'target' | 'engine' | 'posture'>,
  nowIso: string,
): SupervisorState {
  return {
    savedAt: nowIso,
    goal: init.goal,
    target: init.target,
    engine: init.engine,
    posture: init.posture,
    campaignStartedAt: nowIso,
    restarts: 0,
    staleRestarts: 0,
    lastGrounding: null,
    lastExitReason: '',
    nextResumeAtMs: null,
    status: 'running',
    stopRequested: false,
    pauseSticky: false,
    escalations: [],
  };
}

type WriteFn = (p: string, d: string) => Promise<void>;
type ReadFn = (p: string) => Promise<string>;

/** Persist supervisor state. Best-effort — never throws, never blocks the loop. */
export async function saveSupervisorState(
  state: SupervisorState,
  cwd: string = process.cwd(),
  _write?: WriteFn,
): Promise<void> {
  const write = _write ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, d, 'utf8');
  });
  try {
    await write(path.join(cwd, SUPERVISOR_STATE_FILE), JSON.stringify(state, null, 2));
  } catch {
    // best-effort
  }
}

/** Load supervisor state, or null if absent/malformed. */
export async function loadSupervisorState(
  cwd: string = process.cwd(),
  _read?: ReadFn,
): Promise<SupervisorState | null> {
  const read = _read ?? ((p: string) => fs.readFile(p, 'utf8'));
  try {
    const raw = await read(path.join(cwd, SUPERVISOR_STATE_FILE));
    return JSON.parse(raw) as SupervisorState;
  } catch {
    return null;
  }
}

/** Set the operator stop sentinel on persisted state (used by `supervise --stop`). No-op if no campaign. */
export async function requestSupervisorStop(cwd: string = process.cwd()): Promise<boolean> {
  const state = await loadSupervisorState(cwd);
  if (!state) return false;
  state.stopRequested = true;
  state.savedAt = new Date().toISOString();
  await saveSupervisorState(state, cwd);
  logger.info('[supervise] stop requested — the running supervisor will halt on its next turn.');
  return true;
}
