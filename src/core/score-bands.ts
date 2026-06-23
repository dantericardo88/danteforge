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

export type ScoreAxis = 'build' | 'frontier';

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
      axis: 'frontier', label: 'FRONTIER · sustained', isBuildTerminal: false,
      meaning: 'Repeated, fresh external superiority — approaching human-curated, best-in-class excellence (10).',
    };
  }
  if (score >= 9.0) {
    return {
      axis: 'frontier', label: 'FRONTIER · court-validated', isBuildTerminal: false,
      nextAnchor: 'repeat the win on a fresh, dated external benchmark to sustain it',
      meaning: 'Independently court-validated as best-in-class vs a named competitor.',
    };
  }
  if (score >= 8.5) {
    return {
      axis: 'frontier', label: 'FRONTIER · externally anchored', isBuildTerminal: false,
      nextAnchor: 'court-validate the superiority claim against the named competitor',
      meaning: 'A dated, reproducible external benchmark receipt vs a named competitor exists (this is how real frontier tools evidence a 9 — not live telemetry).',
    };
  }
  if (score >= BUILD_CEILING) {
    return {
      axis: 'build', label: 'BUILD-COMPLETE', isBuildTerminal: true,
      nextAnchor: 'obtain a dated external benchmark receipt OR a court-validated win — an external anchor, not more code',
      meaning: 'Production-grade: wired into a real production path AND smoke-passing on real input. The build has SUCCEEDED — this is its terminal "done". 9+ is the FRONTIER overlay, reachable only with an external anchor a build cannot manufacture.',
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
  const axisTag = b.axis === 'build' ? 'BUILD' : 'FRONTIER';
  const terminal = b.isBuildTerminal
    ? ' — build SUCCEEDED (terminal); 9+ needs an external anchor, not more code'
    : '';
  return `${score.toFixed(1)} · ${b.label} [${axisTag} axis]${terminal}`;
}
