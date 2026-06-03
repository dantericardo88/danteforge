// write-verified-score.ts — THE single gate every `scores.self` write must pass through.
//
// Why this file exists (the structural guarantee):
// Before this, the doctrine "all self-score writes funnel through clampDimScore"
// was enforced only by convention — ~3 functions each wrote `dim.scores['self'] = …`
// after clamping, and nothing stopped a 4th from forgetting the clamp. A subtle
// inconsistency in any one of them is silent score inflation, the exact failure the
// whole integrity layer exists to prevent.
//
// `writeVerifiedScore` is now the ONLY function in the codebase permitted to assign
// `dim.scores['self']`. The companion grep-guard test (tests/score-write-gate.test.ts)
// fails the build if `scores.self =` appears in any other src file. So the invariant
// is no longer a doctrine — it is structurally impossible to bypass.
//
// What it guarantees on every write:
//   1. clamp — market-dim cap + per-dim ceiling (via the canonical clampDimScore)
//   2. backstop (opt-in) — a >5.0 write that can't prove its capability_test gate
//      is clamped to 5.0 (defense in depth; the merge path still runs the real gate)
//   3. provenance — one auditable ScoreProvenanceEntry recording who/why/before/after
//   4. coherence — gap_to_leader / leader / two-gaps / overall are recomputed in lockstep
//
// It is deliberately synchronous and cwd-free (the provenance trail lives in the
// matrix, persisted atomically by saveMatrix — same pattern as adversarialCalibrations)
// so the dozens of existing synchronous callers need no async ripple.

import type { CompeteMatrix, ScoreProvenanceEntry } from './compete-matrix.js';
import {
  clampDimScore,
  computeTwoGaps,
  computeOverallScore,
  MARKET_DIM_MAX_SCORE,
} from './compete-matrix-score.js';

const PROVENANCE_CAP = 200;

export interface ScoreProvenance {
  /** Who is writing this score: 'merge' | 'score-audit' | 'daemon-calibration' | 'ascend-orient' | … */
  agent: string;
  rationale?: string;
  evidence?: string[];
  /** Which gates the caller actually ran and passed before proposing this score. */
  gatesPassed?: { capability_test?: boolean; harden?: boolean };
  /** Optional sprint-history annotations (preserved for the updateDimensionScore path). */
  commit?: string;
  harvestSource?: string;
}

export interface WriteScoreOpts {
  /** Round the clamped score to one decimal (the adversarial-calibration path). */
  round1?: boolean;
  /** Skip appending a sprint_history record (probe / calibration writes). */
  skipHistory?: boolean;
  /** Skip the status transition (gap≤0→closed / not-started→in-progress). */
  skipStatus?: boolean;
  /**
   * Defense-in-depth: when true, a final score above the market cap (5.0) that
   * does NOT carry `gatesPassed.capability_test === true` is clamped to 5.0.
   * Off by default so existing gated paths (which clamp upstream) are unchanged.
   */
  gateBackstop?: boolean;
}

/**
 * Write `dim.scores['self']` for one dimension — the only sanctioned door.
 * Returns the final value actually written (post clamp + backstop).
 * Throws if the dimension is not in the matrix (callers that prefer a soft
 * miss should check `matrix.dimensions.find(...)` first).
 */
export function writeVerifiedScore(
  matrix: CompeteMatrix,
  dimensionId: string,
  rawScore: number,
  provenance: ScoreProvenance,
  opts: WriteScoreOpts = {},
): number {
  const dim = matrix.dimensions.find(d => d.id === dimensionId);
  if (!dim) throw new Error(`Dimension "${dimensionId}" not found in matrix`);

  const before = dim.scores['self'] ?? 0;

  let clamped = clampDimScore(dimensionId, rawScore, dim.ceiling);
  if (opts.round1) clamped = Math.round(clamped * 10) / 10;
  if (opts.gateBackstop && clamped > MARKET_DIM_MAX_SCORE && provenance.gatesPassed?.capability_test !== true) {
    clamped = MARKET_DIM_MAX_SCORE;
  }

  // The one assignment the grep-guard whitelists this file for.
  dim.scores['self'] = clamped;

  // Recompute gap/leader/two-gaps in lockstep so the matrix never holds a
  // self-score that disagrees with its derived gap fields.
  const competitorEntries = Object.entries(dim.scores).filter(([k]) => k !== 'self');
  const maxEntry = competitorEntries.reduce(
    (best, [k, v]) => (v > best[1] ? [k, v] : best),
    ['', 0] as [string, number],
  );
  dim.gap_to_leader = Math.max(0, maxEntry[1] - clamped);
  if (maxEntry[0]) dim.leader = maxEntry[0];

  const twoGaps = computeTwoGaps(dim, matrix.competitors_closed_source ?? [], matrix.competitors_oss ?? []);
  dim.gap_to_closed_source_leader = twoGaps.gap_to_closed_source_leader;
  dim.closed_source_leader = twoGaps.closed_source_leader;
  dim.gap_to_oss_leader = twoGaps.gap_to_oss_leader;
  dim.oss_leader = twoGaps.oss_leader;

  // Append the audit trail (always — every legitimate write is recorded).
  const entry: ScoreProvenanceEntry = {
    dimensionId,
    agent: provenance.agent,
    before,
    after: clamped,
    rawScore,
    date: new Date().toISOString(),
    ...(provenance.rationale ? { rationale: provenance.rationale } : {}),
    ...(provenance.evidence ? { evidence: provenance.evidence } : {}),
    ...(provenance.gatesPassed ? { gatesPassed: provenance.gatesPassed } : {}),
  };
  matrix.scoreProvenance ??= [];
  matrix.scoreProvenance.push(entry);
  if (matrix.scoreProvenance.length > PROVENANCE_CAP) {
    matrix.scoreProvenance.splice(0, matrix.scoreProvenance.length - PROVENANCE_CAP);
  }

  // Sprint history (human-facing score timeline) — opt-out for probes/calibration.
  if (!opts.skipHistory && clamped !== before) {
    const record = {
      dimensionId,
      before,
      after: clamped,
      date: new Date().toISOString().slice(0, 10),
      ...(provenance.commit ? { commit: provenance.commit } : {}),
      ...(provenance.harvestSource ? { harvestSource: provenance.harvestSource } : {}),
    };
    if (!dim.sprint_history) dim.sprint_history = [];
    dim.sprint_history.push(record);
    if (dim.sprint_history.length > 20) dim.sprint_history.splice(0, dim.sprint_history.length - 20);
  }

  // Status transition — opt-out for paths that manage status themselves.
  if (!opts.skipStatus) {
    if (dim.gap_to_leader <= 0) {
      dim.status = 'closed';
    } else if (dim.status === 'not-started') {
      dim.status = 'in-progress';
    }
  }

  matrix.lastUpdated = new Date().toISOString();
  matrix.overallSelfScore = computeOverallScore(matrix);
  return clamped;
}

export interface ProvenanceViolation { dimId: string; before: number; after: number; }

/**
 * Persistence-time backstop (closes the grep-guard's blind spot).
 *
 * The grep-guard proves no src *code* writes `scores.self` outside this gate — but it cannot see an
 * alias, `Object.assign`, a dynamic-key write, or a hand-edit of matrix.json on disk. This verifier
 * runs at the saveMatrix boundary: for every dimension whose `scores.self` CHANGED versus the
 * previously-persisted matrix, it requires a matching provenance entry (same dim, same final value)
 * produced by `writeVerifiedScore`. A change with no provenance is exactly the inflation the gate
 * exists to stop, surfacing as a violation. Returns [] when every change is accounted for.
 *
 * `prev` is the last on-disk matrix (null on first write → nothing to compare, returns []).
 */
export function assertScoreProvenance(
  prev: CompeteMatrix | null,
  next: CompeteMatrix,
  epsilon = 1e-9,
): ProvenanceViolation[] {
  if (!prev) return [];
  const prevSelf = new Map(prev.dimensions.map(d => [d.id, d.scores['self'] ?? 0]));
  const provenance = next.scoreProvenance ?? [];
  const violations: ProvenanceViolation[] = [];
  for (const dim of next.dimensions) {
    if (!prevSelf.has(dim.id)) continue;                 // newly-added dim — no prior value to guard
    const before = prevSelf.get(dim.id)!;
    const after = dim.scores['self'] ?? 0;
    if (Math.abs(after - before) <= epsilon) continue;   // unchanged — nothing to verify
    const accounted = provenance.some(p => p.dimensionId === dim.id && Math.abs(p.after - after) <= epsilon);
    if (!accounted) violations.push({ dimId: dim.id, before, after });
  }
  return violations;
}
