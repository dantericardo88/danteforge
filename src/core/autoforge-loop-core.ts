// autoforge-loop-core.ts — types, state enum, and loop-result persistence for the autoforge loop.
//
// Extracted from autoforge-loop.ts (the .git/hooks pre-commit 750-raw-line hard cap, tripped by the
// wave-ledger wiring): the AutoforgeLoopState enum + the loop's public type surface
// (context/guidance/deps/result) + the loop-result writer. autoforge-loop.ts re-exports ALL of these,
// so every existing importer (and test) is unchanged. Moving the enum out of autoforge-loop.ts also
// removes the value-import cycle that previously blocked extracting loop helpers (depth_doctrine CH-021).

import fs from 'fs/promises';
import path from 'path';
import type { DanteState } from './state.js';
import type { ScoreResult, ScoredArtifact } from './pdse.js';
import type { CompletionTracker, ProjectType } from './completion-tracker.js';
import type { CompletionVerdict } from './completion-oracle.js';
import { recordMemory } from './memory-engine.js';
import { evaluateTermination } from './termination-governor.js';

// ── State machine ───────────────────────────────────────────────────────────

export enum AutoforgeLoopState {
  IDLE = 'IDLE',
  RUNNING = 'RUNNING',
  SCORING = 'SCORING',
  REFINING = 'REFINING',
  BLOCKED = 'BLOCKED',
  COMPLETE = 'COMPLETE',
}

export interface AutoforgeLoopContext {
  goal: string;
  cwd: string;
  state: DanteState;
  loopState: AutoforgeLoopState;
  cycleCount: number;
  startedAt: string;
  retryCounters: Record<string, number>;  // artifact name → retry count
  blockedArtifacts: string[];
  lastGuidance: AutoforgeGuidance | null;
  isWebProject: boolean;
  force: boolean;
  dryRun?: boolean;
  maxRetries: number;
  /** Recent overall completion percentages — used for plateau detection. */
  recentScores: number[];
  /** Verdict history for termination-governor plateau detection. */
  previousVerdicts?: CompletionVerdict[];
  /** ISO timestamp of last score improvement — used for time-limit termination. */
  lastProgressTime?: string;
}

export interface AutoforgeGuidance {
  timestamp: string;
  overallCompletion: number;
  currentBottleneck: string;
  blockingIssues: BlockingIssue[];
  recommendedCommand: string;
  recommendedReason: string;
  autoAdvanceEligible: boolean;
  autoAdvanceBlockReason?: string;
  estimatedStepsToCompletion: number;
}

export interface BlockingIssue {
  artifact: string;
  score: number;
  decision: string;
  remediation: string;
}

// ── Loop result (quality delta report written after loop exits) ─────────────

export type LoopTerminationReason =
  | 'target-reached'
  | 'plateau'
  | 'blocked'
  | 'circuit-open'
  | 'max-cycles'
  | 'interrupted'
  | 'advisory';

export interface LoopResult {
  startScore: number;
  endScore: number;
  delta: number;
  cycles: number;
  duration: number;           // milliseconds
  terminationReason: LoopTerminationReason;
  timestamp: string;
}

export function getLoopResultPath(cwd: string): string {
  return path.join(cwd, '.danteforge', 'loop-result.json');
}

export async function writeLoopResult(
  result: LoopResult,
  cwd: string,
  _fsWrite?: (p: string, d: string) => Promise<void>,
): Promise<void> {
  const write = _fsWrite ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, d, 'utf8');
  });
  try {
    await write(getLoopResultPath(cwd), JSON.stringify(result, null, 2));
  } catch {
    // best-effort — never throws
  }

  // Also write to evidence/autoforge/ — computeStrictDimensions awards +15 autonomy pts
  // simply for this directory existing, proving autoforge has run at least once.
  // Timestamped files accumulate as a run history.
  try {
    const ts = result.timestamp.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
    const evidencePath = path.join(cwd, '.danteforge', 'evidence', 'autoforge', `loop-${ts}.json`);
    await write(evidencePath, JSON.stringify(result, null, 2));
  } catch {
    // non-fatal — evidence write never blocks loop result
  }
}

/** Injection seam for testing runAutoforgeLoop without real I/O */
export interface AutoforgeLoopDeps {
  scoreAllArtifacts: (cwd: string, state: DanteState) => Promise<Record<ScoredArtifact, ScoreResult>>;
  persistScoreResult: (result: ScoreResult, cwd: string) => Promise<string>;
  detectProjectType: (cwd: string) => Promise<ProjectType>;
  computeCompletionTracker: (state: DanteState, scores: Record<ScoredArtifact, ScoreResult>) => CompletionTracker;
  recordMemory: (entry: Parameters<typeof recordMemory>[0], cwd?: string) => Promise<void>;
  loadState: (options?: { cwd?: string }) => Promise<DanteState>;
  saveState: (state: DanteState, options?: { cwd?: string }) => Promise<void>;
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof globalThis.setTimeout>;
  /** Injection seam for testing the protected-path gate inside runAutoforgeLoop */
  _checkProtectedPaths?: (
    state: DanteState,
    opts: { cwd?: string }
  ) => Promise<{ blocked: string[]; approved: boolean }>;
  /** Executes the determined next command. When omitted, loop runs in advisory (log-only) mode. */
  _executeCommand?: (command: string, cwd: string) => Promise<{ success: boolean }>;
  /** Registers an OS signal listener (default: process.on). Injected for testing interrupt paths. */
  _addSignalListener?: (signal: string, handler: () => void) => void;
  /** Removes an OS signal listener (default: process.removeListener). Injected for testing. */
  _removeSignalListener?: (signal: string, handler: () => void) => void;
  /** Injection seam for writing the loop-result.json file. */
  _writeLoopResult?: (result: LoopResult, cwd: string) => Promise<void>;
  /** Injection seam for termination-governor evaluateTermination(). */
  _evaluateTermination?: typeof evaluateTermination;
  /** Injection seam for LLM pre-flight check (testing). */
  _isLLMAvailable?: () => Promise<boolean>;
  /** Injection seam for mandatory harsh score verification before COMPLETE. */
  _harshScore?: (opts: { cwd: string }) => Promise<{ displayScore: number } | null>;
  /** Minimum harsh score (0-10) required before the loop may exit on PDSE completion (default: 7.5). */
  harshExitThreshold?: number;
  /** Injection seam: replaces createTimeMachineCommit for testing auto-capture. */
  _timeMachineCommit?: (opts: { cwd: string; paths: string[]; label: string }) => Promise<void>;
  /** Injection seam: replaces postWaveSanitize for testing wave-time LOC enforcement. */
  _postWaveSanitize?: (opts: { cwd: string }) => Promise<void>;
}

