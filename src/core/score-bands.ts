// score-bands.ts — the two-axis reframe (council 2026-06-22, unanimous answer to "8.0 reads like a failure
// when it is in fact 100% of what a build can prove").
//
// A single 0–10 score is being asked to carry TWO categories at once:
//   • the BUILD axis — engineering completeness: code works → wired into production → smoke-passes on real
//     input. This axis has a TERMINAL ceiling at 8.0. A dimension that reaches 8.0 has SUCCEEDED; the build is
//     DONE. It has not "fallen short of 10".
//   • the FRONTIER axis — external / competitive superiority: a dated, reproducible external benchmark receipt
//     or an independent court-validated win vs a named competitor. This band (8.5–10) is reachable ONLY with an
//     external anchor a build cannot manufacture — it is an operational/strategic commitment, not more code.
//
// This module NAMES the band so 8.0 surfaces as "BUILD-COMPLETE / production-grade", not "8/10". It deliberately
// does NOT touch TIER_SCORE_CAPS: relabel, never renumber — bumping the numbers would re-open the exact
// self-certification hole the derived-score + receipt-ceiling lattice exists to close (a code-only artifact
// would print "10"). See [[project_build_ceiling_vs_external_anchor]].

// THREE axes (council 2026-06-23, operator's frontier-definition fix): the FRONTIER splits into two genuinely
// different achievements that we were wrongly conflating. The ENGINEERING frontier (8.5–9.0) is the best version
// of the project ITSELF — validated by real external DEMAND (Reddit/X/GitHub feature requests) that the artifact
// demonstrably satisfies, court-confirmed. It is AUTONOMOUSLY reachable (harvest demand → build → prove
// satisfaction). The COMPETITIVE frontier (9.5–10) is beating named competitors — needs an external benchmark or
// a competitor-parity court win; consciously funded, not autonomous. Demand validates "is it WANTED + satisfied",
// NOT "does it beat Kiro" — keeping them separate is what makes the engineering frontier reachable without
// reopening a self-certification hole.
export type ScoreAxis = 'build' | 'engineering' | 'competitive';

export interface ScoreBand {
  axis: ScoreAxis;
  /** Short band name shown next to the number. */
  label: string;
  /** One-line operator-facing meaning. */
  meaning: string;
  /** True only at the build ceiling (8.0) — the build's own terminal "done". */
  isBuildTerminal: boolean;
  /** What unlocks the next band (the honest next step), if any. */
  nextAnchor?: string;
}

/** The terminal ceiling of the BUILD axis. A build that reaches this has succeeded. */
export const BUILD_CEILING = 8.0;

/**
 * Classify a derived score into its two-axis band. Thresholds mirror TIER_SCORE_CAPS exactly
 * (T4=7.0, T5=8.0, T6=8.5, T7=9.0, T8=9.5) — this is a labeling overlay, not a re-scoring.
 */
export function scoreBand(score: number): ScoreBand {
  if (score >= 9.5) {
    return {
      axis: 'competitive', label: 'COMPETITIVE FRONTIER · sustained', isBuildTerminal: false,
      meaning: 'Repeated, fresh COMPETITIVE superiority vs the field — a dated benchmark win + competitor-parity court, sustained. Consciously funded; not autonomously reachable. The honest "we beat the field" claim.',
    };
  }
  if (score >= 9.0) {
    return {
      axis: 'engineering', label: 'ENGINEERING FRONTIER · demand-satisfied', isBuildTerminal: false,
      nextAnchor: 'beat a named competitor on a dated external benchmark → COMPETITIVE FRONTIER (9.5+), a separately-funded achievement',
      meaning: 'The artifact demonstrably SATISFIES a frozen, signed cluster of real external DEMAND (GitHub/Reddit/X feature requests), independently court-confirmed — the best version of what real users actually want. Autonomously reachable; this is the engineering/technological frontier, NOT a claim of beating competitors.',
    };
  }
  if (score >= 8.5) {
    return {
      axis: 'engineering', label: 'ENGINEERING FRONTIER · demand-anchored', isBuildTerminal: false,
      nextAnchor: 'prove the artifact SATISFIES the demand via the demand-satisfaction court → demand-satisfied (9.0)',
      meaning: 'A frozen, signed cluster of real external DEMAND (re-fetchable issue URLs + reaction counts — the count IS external truth) is bound to this dim as the bar. Demand proves the target is genuinely WANTED; the next step proves the artifact clears it.',
    };
  }
  if (score >= BUILD_CEILING) {
    return {
      axis: 'build', label: 'BUILD-COMPLETE', isBuildTerminal: true,
      nextAnchor: 'anchor a frozen, signed cluster of real external demand → ENGINEERING FRONTIER (8.5) — the autonomously-reachable frontier (harvest what users want, then satisfy it)',
      meaning: 'Production-grade: wired into a real production path AND smoke-passing on real input. The build has SUCCEEDED — this is its terminal "done". The ENGINEERING frontier (8.5–9.0) is the next, autonomously-reachable step: bind real harvested demand and prove the artifact satisfies it.',
    };
  }
  if (score >= 7.0) {
    return {
      axis: 'build', label: 'WIRED', isBuildTerminal: false,
      nextAnchor: 'a smoke run on real input → BUILD-COMPLETE (8.0)',
      meaning: 'Invoked from a real production code path — no longer an orphan.',
    };
  }
  if (score >= 5.0) {
    return {
      axis: 'build', label: 'MODULE', isBuildTerminal: false,
      nextAnchor: 'wire it into a production callsite → WIRED (7.0)',
      meaning: 'Code exists and unit tests pass.',
    };
  }
  if (score > 0) {
    return {
      axis: 'build', label: 'SKETCH', isBuildTerminal: false,
      nextAnchor: 'a real module with passing unit tests → MODULE (5.0)',
      meaning: 'Early scaffolding.',
    };
  }
  return { axis: 'build', label: 'UNSCORED', isBuildTerminal: false, meaning: 'No evidence on disk yet.' };
}

/**
 * A one-line operator-facing headline that stops 8.0 from reading as a failure.
 * e.g. "8.0 · BUILD-COMPLETE [BUILD axis] — build SUCCEEDED; 9+ needs an external anchor, not more code".
 */
export function scoreBandHeadline(score: number): string {
  const b = scoreBand(score);
  const axisTag = b.axis === 'build' ? 'BUILD' : b.axis === 'engineering' ? 'ENGINEERING' : 'COMPETITIVE';
  const terminal = b.isBuildTerminal
    ? ' — build SUCCEEDED (terminal); the ENGINEERING frontier (8.5–9.0, demand-satisfied) is the next autonomous step'
    : '';
  return `${score.toFixed(1)} · ${b.label} [${axisTag} axis]${terminal}`;
}

/**
 * The TRUST label for a FRONTIER-band score (≥8.5), given whether the active kernel signer is external.
 * The council's central honesty: a court-validated frontier 9 is only as grounded as its trust root. With an
 * in-blast-radius signer (local-hmac), the scoring↔grading loop converges on ITSELF — self-signed, not proven
 * ground truth. An out-of-blast-radius signer (CH-045) is what turns convergence into correctness. Pure: the
 * caller passes `signerExternal` (from kernelSignerProvenance) so this module stays dependency-free.
 */
export function frontierTrustLabel(score: number, signerExternal: boolean): string {
  if (score < 8.5) return ''; // BUILD axis — not a trust-anchored frontier claim
  return signerExternal
    ? 'externally anchored (out-of-blast-radius trust root)'
    : 'SELF-SIGNED (local-hmac, in-blast-radius) — convergence, NOT proven ground truth; install an external signer (CH-045) to anchor it';
}
