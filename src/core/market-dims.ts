// market-dims.ts — THE canonical market-cap contract. One copy; every enforcement site imports it.
//
// Three meta-dimensions are bounded by EXTERNAL market signals (real adoption, enterprise
// contracts, real-world token spend) that internal evidence cannot certify — writing more code
// can never prove people use it. Their score is permanently capped at 5.0 until real external
// telemetry exists.
//
// History: this set used to live as six hand-copied literals (compete-matrix-score, derived-score,
// outcome-integrity, outcome-runner, ascend-frontier, capability-test-conductor) and they DRIFTED —
// token_economy was missing from the scoring-kernel copies, so it derived 7.0 against the documented
// permanent 5.0 cap. scripts/evidence-rescore.mjs mirrors this set in plain JS;
// tests/evidence-rescore-drift.test.ts pins the mirror to THIS file.
export const MARKET_CAPPED_DIMS: ReadonlySet<string> = new Set([
  'community_adoption',
  'enterprise_readiness',
  'token_economy',
]);

export const MARKET_DIM_MAX_SCORE = 5.0;
