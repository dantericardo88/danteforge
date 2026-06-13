// wave-replay.ts — read the WaveLedger and compute where a campaign RESUMES (depth_doctrine CH-022).
//
// The WaveLedger (wave-ledger.ts) records every wave across the loops + exposes lastSuccessfulWave().
// This turns that durable history into a RESUME PLAN: for a given run, find the last SUCCESSFUL wave and
// the wave index a resumed campaign should pick up from — instead of blindly restarting at wave 0. This
// is the read/plan half of the bar's "resumable state graph"; loop auto-re-entry from the plan is the
// next increment (CH-022). Pure + fully testable; the `danteforge wave` CLI surfaces it (the observable
// artifact — a campaign's durable state is now queryable, not a black box).

import { readWaveLedger, reconcileReceipts, type WaveReceipt } from './wave-ledger.js';

export interface ReplayPlan {
  runId: string;
  /** The loop that owns this run (first receipt's loopName), or null when the run is unknown. */
  loopName: string | null;
  /** Distinct waves recorded for this run. */
  totalWaves: number;
  completedWaves: number;
  failedWaves: number;
  runningWaves: number;
  /** The last COMPLETED wave (highest waveIndex), or null when none completed. */
  lastSuccessful: WaveReceipt | null;
  /** The waveIndex a resumed campaign should start AT (lastSuccessful.waveIndex + 1, or 0 if none). */
  resumeFromIndex: number;
  /** Waves recorded but NOT completed: running = crashed mid-wave, failed = ran but failed. */
  pending: WaveReceipt[];
  /** True when every recorded wave completed — nothing to resume. */
  alreadyComplete: boolean;
  /** True when the run has no receipts at all (unknown run id). */
  unknown: boolean;
  reason: string;
}

/**
 * Compute the resume plan for one run from the ledger rows. Pure. The resume index is the wave AFTER
 * the last successful one — so a campaign that crashed during wave K (with K-1 completed) resumes at K,
 * never at 0. A run with no completed wave resumes at 0 (genuine cold start); an all-completed run has
 * nothing to resume.
 */
export function planReplay(rows: WaveReceipt[], runId: string): ReplayPlan {
  const mine = reconcileReceipts(rows).filter(r => r.runId === runId);
  if (mine.length === 0) {
    return {
      runId, loopName: null, totalWaves: 0, completedWaves: 0, failedWaves: 0, runningWaves: 0,
      lastSuccessful: null, resumeFromIndex: 0, pending: [], alreadyComplete: false, unknown: true,
      reason: `No waves recorded for run "${runId}".`,
    };
  }
  const loopName = mine[0]!.loopName;
  const completed = mine.filter(r => r.status === 'completed');
  const failed = mine.filter(r => r.status === 'failed');
  const running = mine.filter(r => r.status === 'running');
  // Last successful = highest waveIndex among completed (tie → latest completedAt).
  const lastSuccessful = completed.length === 0
    ? null
    : completed.slice().sort((a, b) =>
        a.waveIndex - b.waveIndex || (a.completedAt ?? '').localeCompare(b.completedAt ?? ''))[completed.length - 1]!;
  const resumeFromIndex = lastSuccessful ? lastSuccessful.waveIndex + 1 : 0;
  const pending = [...running, ...failed].sort((a, b) => a.waveIndex - b.waveIndex);
  const alreadyComplete = pending.length === 0 && completed.length > 0;
  const reason = alreadyComplete
    ? `All ${completed.length} wave(s) completed — nothing to resume.`
    : lastSuccessful
      ? `Resume "${loopName}" from wave ${resumeFromIndex} — last successful was wave ${lastSuccessful.waveIndex} (${lastSuccessful.dimensionId ?? 'n/a'}, score→${lastSuccessful.scoreAfter ?? '?'}); ${pending.length} not completed.`
      : `No wave completed yet — a resume restarts from wave 0; ${pending.length} not completed.`;
  return {
    runId, loopName, totalWaves: mine.length, completedWaves: completed.length, failedWaves: failed.length,
    runningWaves: running.length, lastSuccessful, resumeFromIndex, pending, alreadyComplete, unknown: false, reason,
  };
}

export async function loadReplayPlan(cwd: string, runId: string): Promise<ReplayPlan> {
  return planReplay(await readWaveLedger(cwd), runId);
}

export interface RunSummary {
  runId: string;
  loopName: string;
  totalWaves: number;
  completedWaves: number;
  lastStatus: string;
  lastActivityAt: string;
}

/** Summarize every distinct run in the ledger, newest activity first — for `danteforge wave list`. Pure. */
export function summarizeRuns(rows: WaveReceipt[]): RunSummary[] {
  const reconciled = reconcileReceipts(rows);
  const byRun = new Map<string, WaveReceipt[]>();
  for (const r of reconciled) {
    const a = byRun.get(r.runId) ?? [];
    a.push(r);
    byRun.set(r.runId, a);
  }
  const out: RunSummary[] = [];
  for (const [runId, waves] of byRun) {
    const sorted = waves.slice().sort((a, b) => (a.completedAt ?? a.startedAt).localeCompare(b.completedAt ?? b.startedAt));
    const last = sorted[sorted.length - 1]!;
    out.push({
      runId, loopName: last.loopName, totalWaves: waves.length,
      completedWaves: waves.filter(w => w.status === 'completed').length,
      lastStatus: last.status, lastActivityAt: last.completedAt ?? last.startedAt,
    });
  }
  return out.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}
