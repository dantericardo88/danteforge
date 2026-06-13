// wave-ledger.ts — the durable, append-only WAVE LEDGER (depth_doctrine rung-8 foundation).
//
// The depth_doctrine 9-row bar (frozen, competitor-grounded against LangGraph) asks for ONE shared
// cadence engine whose independent loops (autoforge, ascend, harden-crusade/matrixdev) emit IDENTICAL
// receipts, with state history, recovery from the last successful wave, and replay. A live council
// audit (2026-06-12, codex + claude-code reading the code) found DanteForge already owns the doctrine
// PRIMITIVE — a single deterministic breadth/depth guard (wave-alternation.getWaveGuard) genuinely
// shared by ≥3 loops — but GENUINELY LACKS the append-only ledger: today each loop emits a different
// artifact (autoforge→loop-result.json, harden-crusade→harden-report.json, ascend→its own), so
// "identical receipts across ≥3 loops" is false and the court REJECT was correct on the merits.
//
// This module is that ledger — the rail the rung-8→9 work rides on. It is deliberately NOT the full
// LangGraph state-graph + replay (that is the multi-session 9; see the follow-up challenge). It gives:
//   - ONE canonical WaveReceipt schema, byte-identical across every loop that emits it;
//   - startWave()/finishWave() appending JSONL to .danteforge/waves/wave-ledger.jsonl (state history);
//   - lastSuccessfulWave() — the anchor a future "recover from the last good wave" step needs;
//   - guard semantics (breadth ceiling 6 / depth uncapped, allowed actions) derived from the ONE
//     getWaveGuard source, so the loops cannot drift apart in what a wave-type means.

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withFileLock } from './sanitize-locks.js';
import { getWaveGuard, BREADTH_SCORE_CEILING, type WaveType } from './wave-alternation.js';

const WAVE_DIR_REL = path.join('.danteforge', 'waves');
const LEDGER_FILE = 'wave-ledger.jsonl';

export type WaveStatus = 'running' | 'completed' | 'failed';

/**
 * One wave of any loop, recorded identically regardless of which loop produced it. EVERY field is
 * always present (optional values are explicit null, never omitted) so two loops' receipts are
 * byte-comparable by schema — the property the depth_doctrine bar demands and the court checks.
 * `scoreCeiling: null` means uncapped (a depth wave); JSON cannot carry Infinity, so null is the
 * canonical "no ceiling".
 */
export interface WaveReceipt {
  waveId: string;
  /** The campaign/run that owns this wave (groups a loop's waves together). */
  runId: string;
  /** Which loop emitted it: 'autoforge' | 'ascend' | 'harden-crusade' | 'matrixdev' | … */
  loopName: string;
  waveIndex: number;
  waveType: WaveType;
  /** breadth → 6.0, depth → null (uncapped). Derived from getWaveGuard — single source, no drift. */
  scoreCeiling: number | null;
  /** What the guard permits this wave: breadth writes code, depth runs outcomes. */
  allowedActions: { newCode: boolean; outcomeRun: boolean };
  dimensionId: string | null;
  scoreBefore: number | null;
  scoreAfter: number | null;
  gitShaBefore: string | null;
  gitShaAfter: string | null;
  timeMachineCommitId: string | null;
  commandsRun: string[];
  outcomeEvidenceIds: string[];
  capabilityTestExit: number | null;
  cipVerdict: string | null;
  decision: string | null;
  status: WaveStatus;
  startedAt: string;
  completedAt: string | null;
}

function ledgerPath(cwd: string): string {
  return path.join(cwd, WAVE_DIR_REL, LEDGER_FILE);
}

/** Build a complete, schema-normalized receipt from a partial — every field defaulted so the row is
 *  byte-comparable to any other loop's row. Guard-derived fields come from getWaveGuard (one source). */
function normalizeReceipt(p: StartWaveInput & Partial<WaveReceipt> & { status: WaveStatus; startedAt: string }): WaveReceipt {
  const guard = getWaveGuard(p.waveIndex);
  const waveType: WaveType = p.waveType ?? guard.type;
  // Keep guard semantics keyed on the RECORDED waveType (not a re-derived index), so a loop that
  // already decided "this is a depth wave" gets depth ceilings/actions, and all loops agree.
  const isBreadth = waveType === 'breadth';
  return {
    waveId: p.waveId ?? `${p.loopName}-${p.runId}-w${p.waveIndex}-${randomUUID().slice(0, 8)}`,
    runId: p.runId,
    loopName: p.loopName,
    waveIndex: p.waveIndex,
    waveType,
    scoreCeiling: isBreadth ? BREADTH_SCORE_CEILING : null,
    allowedActions: { newCode: isBreadth, outcomeRun: !isBreadth },
    dimensionId: p.dimensionId ?? null,
    scoreBefore: p.scoreBefore ?? null,
    scoreAfter: p.scoreAfter ?? null,
    gitShaBefore: p.gitShaBefore ?? null,
    gitShaAfter: p.gitShaAfter ?? null,
    timeMachineCommitId: p.timeMachineCommitId ?? null,
    commandsRun: p.commandsRun ?? [],
    outcomeEvidenceIds: p.outcomeEvidenceIds ?? [],
    capabilityTestExit: p.capabilityTestExit ?? null,
    cipVerdict: p.cipVerdict ?? null,
    decision: p.decision ?? null,
    status: p.status,
    startedAt: p.startedAt,
    completedAt: p.completedAt ?? null,
  };
}

async function appendReceipt(cwd: string, receipt: WaveReceipt): Promise<void> {
  const file = ledgerPath(cwd);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Append-only JSONL under a file lock — concurrent loops (parallel mode) never interleave a line.
  await withFileLock(
    { cwd, filePath: path.relative(cwd, file), lockDir: path.join('.danteforge', 'locks') },
    async () => { await fs.appendFile(file, JSON.stringify(receipt) + '\n', 'utf8'); },
  );
}

export interface StartWaveInput {
  runId: string;
  loopName: string;
  waveIndex: number;
  /** Optional explicit type; defaults to getWaveGuard(waveIndex).type. */
  waveType?: WaveType;
  dimensionId?: string | null;
  scoreBefore?: number | null;
  gitShaBefore?: string | null;
  waveId?: string;
}

/**
 * Open a wave: append a 'running' receipt and return it (with its generated waveId). The loop runs
 * the wave, then calls finishWave with the same waveId. Best-effort callers should wrap in try/catch
 * — a ledger write must never break the loop it observes.
 */
export async function startWave(cwd: string, input: StartWaveInput): Promise<WaveReceipt> {
  const receipt = normalizeReceipt({ ...input, status: 'running', startedAt: new Date().toISOString() });
  await appendReceipt(cwd, receipt);
  return receipt;
}

export interface FinishWaveInput {
  status: 'completed' | 'failed';
  scoreAfter?: number | null;
  gitShaAfter?: string | null;
  timeMachineCommitId?: string | null;
  commandsRun?: string[];
  outcomeEvidenceIds?: string[];
  capabilityTestExit?: number | null;
  cipVerdict?: string | null;
  decision?: string | null;
}

/**
 * Close a wave: append a terminal receipt carrying the same identity as the open one plus the
 * outcome (scoreAfter, git/commit provenance, status). Append-only — the open 'running' row is left
 * in place; reconcile() collapses to the latest status per waveId. This is what makes the ledger a
 * durable HISTORY (every transition recorded) rather than a mutable snapshot.
 */
export async function finishWave(cwd: string, open: WaveReceipt, input: FinishWaveInput): Promise<WaveReceipt> {
  const receipt: WaveReceipt = {
    ...open,
    status: input.status,
    completedAt: new Date().toISOString(),
    scoreAfter: input.scoreAfter ?? open.scoreAfter,
    gitShaAfter: input.gitShaAfter ?? open.gitShaAfter,
    timeMachineCommitId: input.timeMachineCommitId ?? open.timeMachineCommitId,
    commandsRun: input.commandsRun ?? open.commandsRun,
    outcomeEvidenceIds: input.outcomeEvidenceIds ?? open.outcomeEvidenceIds,
    capabilityTestExit: input.capabilityTestExit ?? open.capabilityTestExit,
    cipVerdict: input.cipVerdict ?? open.cipVerdict,
    decision: input.decision ?? open.decision,
  };
  await appendReceipt(cwd, receipt);
  return receipt;
}

/** Read every receipt row (raw, in append order). Missing ledger → []. Corrupt lines are skipped. */
export async function readWaveLedger(cwd: string): Promise<WaveReceipt[]> {
  let raw: string;
  try { raw = await fs.readFile(ledgerPath(cwd), 'utf8'); } catch { return []; }
  const out: WaveReceipt[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t) as WaveReceipt); } catch { /* skip a torn line */ }
  }
  return out;
}

/** Collapse the append-only log to the LATEST receipt per waveId (terminal status wins over running). */
export function reconcileReceipts(rows: WaveReceipt[]): WaveReceipt[] {
  const latest = new Map<string, WaveReceipt>();
  for (const r of rows) latest.set(r.waveId, r); // append order → last write wins
  return [...latest.values()];
}

/**
 * The last COMPLETED wave — the anchor a future "recover from the last successful wave" step resumes
 * from. Optionally scoped to one loop. Null when no wave has completed. (Pure given the rows.)
 */
export function lastSuccessfulWave(rows: WaveReceipt[], loopName?: string): WaveReceipt | null {
  const done = reconcileReceipts(rows)
    .filter(r => r.status === 'completed' && (!loopName || r.loopName === loopName))
    .sort((a, b) => (a.completedAt ?? '').localeCompare(b.completedAt ?? ''));
  return done[done.length - 1] ?? null;
}
