// crusade-autonomy.ts — Phase H Slice 5.
//
// Six rules that turn the crusade from "loop until score >= target" into a
// substrate that knows when it's done, when it's stuck, and when it should
// stop and ask the operator. Each rule is a pure function over loaded state
// + matrix + outcome evidence. The crusade entry point applies them BEFORE
// each wave and AFTER each wave; if any rule fires, the wave halts and the
// terminal verdict is surfaced.
//
// Rules:
//   R1. halt-stuck-dim         — dim with N+ waves no new outcome passing
//   R2. refuse-on-dispensation — any outstanding dispensation pauses all autonomy
//   R3. refuse-new-dims        — refuse to add a new dim while existing dims < frontier
//   R4. halt-infinite-refinement — same outcome rewritten N+ times without passing
//   R5. report-end-state-explicitly — emit one of {frontier-reached, stuck, blocked}
//   R6. document-irreducible-human-loop — see docs/AUTONOMY-BOUNDARIES.md

import fs from 'node:fs/promises';
import path from 'node:path';
import type { DanteState } from '../../core/state.js';
import type { ProjectFrontierState, DimensionFrontierResult } from '../../core/frontier-state.js';

// ── Configurable thresholds ──────────────────────────────────────────────────

export const MAX_STUCK_WAVES = 3;
export const MAX_OUTCOME_REFINEMENTS = 3;

// ── The verdicts a rule can produce ──────────────────────────────────────────

export type AutonomyVerdict =
  | { kind: 'proceed' }
  | { kind: 'halt'; reason: string; rule: string; affectedDims?: string[] }
  | { kind: 'frontier-reached'; reason: string };

export interface AutonomyCheckInput {
  state: DanteState;
  frontier: ProjectFrontierState;
  /** When a wave is asking permission to add a new dim — the new dim's id. */
  newDimId?: string;
  /** Returns the operator-resolved or absent dispensation list. */
  cwd: string;
}

// ── Rule R1: halt-stuck-dim ──────────────────────────────────────────────────

export function checkHaltStuckDim(input: AutonomyCheckInput): AutonomyVerdict {
  const counts = input.state.wavesSinceProgress ?? {};
  const stuck = Object.entries(counts).filter(([_, n]) => n >= MAX_STUCK_WAVES).map(([id]) => id);
  if (stuck.length === 0) return { kind: 'proceed' };
  return {
    kind: 'halt',
    rule: 'R1.halt-stuck-dim',
    reason: `${stuck.length} dim(s) reached ${MAX_STUCK_WAVES}+ waves without a new passing outcome — halt for operator review`,
    affectedDims: stuck,
  };
}

// ── Rule R2: refuse-on-dispensation ──────────────────────────────────────────

export function checkRefuseOnDispensation(input: AutonomyCheckInput): AutonomyVerdict {
  if (input.frontier.terminal === 'blocked-by-dispensations') {
    return {
      kind: 'halt',
      rule: 'R2.refuse-on-dispensation',
      reason: `${input.frontier.blockingDispensations.length} active dispensation(s) pause autonomy globally — operator must clear them with \`danteforge dispensation clear <id>\``,
      affectedDims: input.frontier.perDimension
        .filter(d => d.status === 'blocked-by-dispensation')
        .map(d => d.dimensionId),
    };
  }
  return { kind: 'proceed' };
}

// ── Rule R3: refuse-new-dims ─────────────────────────────────────────────────

export function checkRefuseNewDims(input: AutonomyCheckInput): AutonomyVerdict {
  if (!input.newDimId) return { kind: 'proceed' };
  // Allow new dims only when every declared dim is at frontier (or no-outcomes-declared,
  // since pre-migration dims don't gate new additions).
  const declared = input.frontier.perDimension.filter(d => d.status !== 'no-outcomes-declared');
  const notAtFrontier = declared.filter(d => d.status !== 'at-frontier');
  if (notAtFrontier.length === 0) return { kind: 'proceed' };
  return {
    kind: 'halt',
    rule: 'R3.refuse-new-dims',
    reason: `Cannot add new dimension "${input.newDimId}" while ${notAtFrontier.length} declared dim(s) are not yet at frontier. Finish what's started before expanding the matrix.`,
    affectedDims: notAtFrontier.map(d => d.dimensionId),
  };
}

// ── Rule R4: halt-infinite-refinement ────────────────────────────────────────

export function checkHaltInfiniteRefinement(input: AutonomyCheckInput): AutonomyVerdict {
  const counts = input.state.outcomeRefinementCounts ?? {};
  const offenders = Object.entries(counts)
    .filter(([_, n]) => n >= MAX_OUTCOME_REFINEMENTS)
    .map(([key]) => key);
  if (offenders.length === 0) return { kind: 'proceed' };
  return {
    kind: 'halt',
    rule: 'R4.halt-infinite-refinement',
    reason: `${offenders.length} outcome(s) rewritten ${MAX_OUTCOME_REFINEMENTS}+ times without passing. Either the outcome is wrong or the capability is genuinely hard — halt and surface.`,
    affectedDims: offenders.map(k => k.split('/')[0] ?? ''),
  };
}

// ── Rule R5: report-end-state ────────────────────────────────────────────────

export function checkReportEndState(input: AutonomyCheckInput): AutonomyVerdict {
  if (input.frontier.terminal === 'frontier-reached') {
    return {
      kind: 'frontier-reached',
      reason: input.frontier.summary,
    };
  }
  return { kind: 'proceed' };
}

// ── Aggregator: apply all rules, return the first halting verdict ────────────

export interface AutonomyResult {
  verdict: AutonomyVerdict;
  /** All verdicts in rule order (for diagnostics). */
  ruleResults: Array<{ rule: string; verdict: AutonomyVerdict }>;
}

export function applyAutonomyRules(input: AutonomyCheckInput): AutonomyResult {
  const rules: Array<{ name: string; check: (i: AutonomyCheckInput) => AutonomyVerdict }> = [
    { name: 'R2.refuse-on-dispensation', check: checkRefuseOnDispensation },
    { name: 'R1.halt-stuck-dim', check: checkHaltStuckDim },
    { name: 'R4.halt-infinite-refinement', check: checkHaltInfiniteRefinement },
    { name: 'R3.refuse-new-dims', check: checkRefuseNewDims },
    { name: 'R5.report-end-state', check: checkReportEndState },
  ];

  const ruleResults: AutonomyResult['ruleResults'] = [];
  for (const r of rules) {
    const v = r.check(input);
    ruleResults.push({ rule: r.name, verdict: v });
    if (v.kind === 'halt') return { verdict: v, ruleResults };
    if (v.kind === 'frontier-reached') return { verdict: v, ruleResults };
  }
  return { verdict: { kind: 'proceed' }, ruleResults };
}

// ── Helper: mark a dim as having made progress (reset its stuck counter) ─────

export function recordDimProgress(state: DanteState, dimId: string): DanteState {
  const counts = { ...(state.wavesSinceProgress ?? {}) };
  counts[dimId] = 0;
  return { ...state, wavesSinceProgress: counts };
}

// ── Helper: mark a dim as having NOT made progress (increment its counter) ───

export function recordDimNoProgress(state: DanteState, dimId: string): DanteState {
  const counts = { ...(state.wavesSinceProgress ?? {}) };
  counts[dimId] = (counts[dimId] ?? 0) + 1;
  return { ...state, wavesSinceProgress: counts };
}

// ── Helper: increment an outcome's refinement counter ────────────────────────

export function recordOutcomeRefinement(
  state: DanteState,
  dimId: string,
  outcomeId: string,
): DanteState {
  const key = `${dimId}/${outcomeId}`;
  const counts = { ...(state.outcomeRefinementCounts ?? {}) };
  counts[key] = (counts[key] ?? 0) + 1;
  return { ...state, outcomeRefinementCounts: counts };
}

// ── Helper: clear refinement counter on success ──────────────────────────────

export function clearOutcomeRefinement(
  state: DanteState,
  dimId: string,
  outcomeId: string,
): DanteState {
  const key = `${dimId}/${outcomeId}`;
  const counts = { ...(state.outcomeRefinementCounts ?? {}) };
  delete counts[key];
  return { ...state, outcomeRefinementCounts: counts };
}

// ── Pretty-print a verdict for the crusade report (R5) ───────────────────────

export function formatVerdict(verdict: AutonomyVerdict): string {
  if (verdict.kind === 'proceed') return 'proceed';
  if (verdict.kind === 'frontier-reached') return `frontier-reached: ${verdict.reason}`;
  const dims = verdict.affectedDims && verdict.affectedDims.length > 0
    ? ` [${verdict.affectedDims.join(', ')}]`
    : '';
  return `${verdict.rule}: ${verdict.reason}${dims}`;
}
