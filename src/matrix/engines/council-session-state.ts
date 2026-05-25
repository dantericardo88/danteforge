// Matrix Kernel — CouncilSessionState
//
// Persists council --parallel run state after each phase transition so a
// crashed or interrupted run can be resumed with `council --parallel --resume <runId>`.
//
// Phase sequence (LangGraph-inspired stateful node graph):
//   schedule → build → file_claim → anonymous_review → debate →
//   chairman_synthesis → merge → validate
//
// State is written to .danteforge/COUNCIL_SESSION_<runId>.json after each
// phase. On resume, the engine reloads state and skips completed phases.
import path from 'node:path';
import fs from 'node:fs/promises';

export type CouncilPhase =
  | 'schedule'
  | 'build'
  | 'file_claim'
  | 'anonymous_review'
  | 'debate'
  | 'chairman_synthesis'
  | 'merge'
  | 'validate';

export interface CouncilMergeRecord {
  memberId: string;
  consensus: 'PASS' | 'FAIL' | 'SPLIT';
  merged: boolean;
  changedFiles: string[];
  dissentLog: string[];
}

export interface CouncilSessionState {
  runId: string;
  goal: string;
  round: number;
  maxRounds: number;
  phase: CouncilPhase;
  memberIds: string[];
  scheduledDimIds: string[];
  convergence: { converged: number; stuck: number; inProgress: number; stuckDims: { dimensionId: string }[] };
  memberHealth: Record<string, 'active' | 'quota_exhausted' | 'degraded'>;
  mergeResults: CouncilMergeRecord[];
  totalMerged: number;
  lastUpdated: string;
}

export function makeSessionId(): string {
  return `cs.${Date.now()}.${Math.random().toString(36).slice(2, 6)}`;
}

function sessionPath(cwd: string, runId: string): string {
  return path.join(cwd, '.danteforge', `COUNCIL_SESSION_${runId}.json`);
}

export async function writeSessionState(
  cwd: string,
  state: CouncilSessionState,
): Promise<void> {
  const p = sessionPath(cwd, state.runId);
  await fs.mkdir(path.dirname(p), { recursive: true }).catch(() => { /* ignore */ });
  await fs.writeFile(p, JSON.stringify({ ...state, lastUpdated: new Date().toISOString() }, null, 2), 'utf8')
    .catch(() => { /* best-effort — never crash the council run on checkpoint failure */ });
}

export async function loadSessionState(
  cwd: string,
  runId: string,
): Promise<CouncilSessionState | null> {
  try {
    const raw = await fs.readFile(sessionPath(cwd, runId), 'utf8');
    return JSON.parse(raw) as CouncilSessionState;
  } catch {
    return null;
  }
}

export function makeInitialState(
  runId: string,
  goal: string,
  memberIds: string[],
  maxRounds: number,
): CouncilSessionState {
  return {
    runId,
    goal,
    round: 0,
    maxRounds,
    phase: 'schedule',
    memberIds,
    scheduledDimIds: [],
    convergence: { converged: 0, stuck: 0, inProgress: 0, stuckDims: [] },
    memberHealth: Object.fromEntries(memberIds.map(id => [id, 'active'])),
    mergeResults: [],
    totalMerged: 0,
    lastUpdated: new Date().toISOString(),
  };
}

/** List all saved session state files in .danteforge/, newest first. */
export async function listSessions(cwd: string): Promise<{ runId: string; path: string; lastUpdated: string }[]> {
  const dir = path.join(cwd, '.danteforge');
  try {
    const files = await fs.readdir(dir);
    const sessions = files
      .filter(f => f.startsWith('COUNCIL_SESSION_') && f.endsWith('.json'))
      .map(f => ({
        runId: f.replace('COUNCIL_SESSION_', '').replace('.json', ''),
        path: path.join(dir, f),
        lastUpdated: '',
      }));
    await Promise.all(sessions.map(async s => {
      try {
        const stat = await fs.stat(s.path);
        s.lastUpdated = stat.mtime.toISOString();
      } catch { /* ignore */ }
    }));
    return sessions.sort((a, b) => b.lastUpdated.localeCompare(a.lastUpdated));
  } catch {
    return [];
  }
}
