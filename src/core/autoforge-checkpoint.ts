// autoforge-checkpoint.ts — Checkpoint/resume, stall detection, and print helpers.
// Split from autoforge-loop.ts to keep files under the 750-LOC hard cap.
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';
import type { AutoforgeLoopContext, AutoforgeLoopState } from './autoforge-loop.js';
import type { ScoreResult, ScoredArtifact } from './pdse.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

// ── Protected path gate ─────────────────────────────────────────────────────

export function printSummaryTable(scores: Record<ScoredArtifact, ScoreResult>): void {
  logger.info('\n┌────────────────┬───────┬──────────┐');
  logger.info('│ Artifact       │ Score │ Decision │');
  logger.info('├────────────────┼───────┼──────────┤');
  for (const [name, result] of Object.entries(scores)) {
    const paddedName = name.padEnd(14);
    const paddedScore = String(result.score).padStart(5);
    const paddedDecision = result.autoforgeDecision.padEnd(8);
    logger.info(`│ ${paddedName} │ ${paddedScore} │ ${paddedDecision} │`);
  }
  logger.info('└────────────────┴───────┴──────────┘');
}

// ── Stall detection ──────────────────────────────────────────────────────────

/**
 * Detect whether a score history has stalled.
 *
 * A stall occurs when the last `minCycles` scores have not improved by more
 * than `threshold` points in aggregate. Requires at least `minCycles` entries
 * to make a determination.
 *
 * @param history  Ordered array of scores (oldest first).
 * @param threshold  Minimum improvement required to avoid stall declaration (default: 0.1).
 * @param minCycles  Minimum number of history entries required (default: 3).
 * @returns true when the loop is stalled.
 */
export function detectStall(
  history: number[],
  threshold = 0.1,
  minCycles = 3,
): boolean {
  if (history.length < minCycles) return false;
  const window = history.slice(-minCycles);
  const first = window[0]!;
  const last = window[window.length - 1]!;
  return last - first < threshold;
}

// ── Pause file (used by resume command) ──────────────────────────

export const AUTOFORGE_PAUSE_FILE = '.danteforge/AUTOFORGE_PAUSED';

// ── Checkpoint/resume ─────────────────────────────────────────────────────────

export const AUTOFORGE_CHECKPOINT_FILE = '.danteforge/autoforge-checkpoint.json';
/** Checkpoints older than this (in milliseconds) are considered stale and ignored. */
export const CHECKPOINT_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Subset of AutoforgeLoopContext that is persisted to disk for resume. */
export interface AutoforgeCheckpoint {
  /** ISO timestamp when the checkpoint was written. */
  savedAt: string;
  cycleCount: number;
  goal: string;
  loopState: AutoforgeLoopState;
  retryCounters: Record<string, number>;
  blockedArtifacts: string[];
  recentScores: number[];
  /** Estimated phase (last PDSE overall %). Used as resume-start indicator. */
  lastOverall: number;
}

/**
 * Persist the current loop context to `.danteforge/autoforge-checkpoint.json`.
 *
 * Best-effort: never throws.
 *
 * @param ctx - Current loop context to snapshot.
 * @param cwd - Working directory (defaults to process.cwd()).
 * @param _fsWrite - Injected for testing.
 */
export async function saveCheckpoint(
  ctx: AutoforgeLoopContext,
  cwd: string = process.cwd(),
  _fsWrite?: (p: string, d: string) => Promise<void>,
): Promise<void> {
  const write = _fsWrite ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, d, 'utf8');
  });
  try {
    const checkpoint: AutoforgeCheckpoint = {
      savedAt: new Date().toISOString(),
      cycleCount: ctx.cycleCount,
      goal: ctx.goal,
      loopState: ctx.loopState,
      retryCounters: ctx.retryCounters,
      blockedArtifacts: ctx.blockedArtifacts,
      recentScores: ctx.recentScores,
      lastOverall: ctx.recentScores.length > 0
        ? (ctx.recentScores[ctx.recentScores.length - 1] ?? 0)
        : 0,
    };
    const filePath = path.join(cwd, AUTOFORGE_CHECKPOINT_FILE);
    await write(filePath, JSON.stringify(checkpoint, null, 2));
    logger.verbose(`[Autoforge] Checkpoint saved at cycle ${ctx.cycleCount}.`);
  } catch {
    // best-effort — checkpoint write never blocks the loop
  }
}

/**
 * Load a checkpoint from disk, returning null if:
 *   - No checkpoint file exists.
 *   - The checkpoint is older than `CHECKPOINT_MAX_AGE_MS` (4 hours).
 *   - The file is malformed.
 *
 * @param cwd - Working directory (defaults to process.cwd()).
 * @param _fsRead - Injected for testing.
 * @param _now - Injected clock for testing.
 */
export async function loadCheckpoint(
  cwd: string = process.cwd(),
  _fsRead?: (p: string) => Promise<string>,
  _now?: () => number,
): Promise<AutoforgeCheckpoint | null> {
  const read = _fsRead ?? ((p: string) => fs.readFile(p, 'utf8'));
  const now = _now ?? (() => Date.now());
  try {
    const filePath = path.join(cwd, AUTOFORGE_CHECKPOINT_FILE);
    const raw = await read(filePath);
    const checkpoint = JSON.parse(raw) as AutoforgeCheckpoint;
    const age = now() - new Date(checkpoint.savedAt).getTime();
    if (age > CHECKPOINT_MAX_AGE_MS) {
      logger.info(`[Autoforge] Checkpoint is ${Math.round(age / 60_000)}m old (max ${CHECKPOINT_MAX_AGE_MS / 60_000}m) — ignoring.`);
      return null;
    }
    logger.info(`[Autoforge] Resuming from checkpoint: cycle ${checkpoint.cycleCount}, overall ${checkpoint.lastOverall}%.`);
    return checkpoint;
  } catch {
    return null;
  }
}

export interface AutoforgePauseSnapshot {
  pausedAt: string;
  avgScore: number;
  cycleCount: number;
  goal: string;
  retryCounters: Record<string, number>;
  blockedArtifacts: string[];
}

