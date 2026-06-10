// derived-score-demote.test.ts — the "derived-stuck-0" regression (fleet-wide).
//
// computeDerivedScoreWithBreakdown used to EXCLUDE outcomes whose declared tier
// exceeded their quality cap (classifyOutcomeKind). When ALL of a dim's outcomes
// were over-declared (e.g. passing T5 outcomes that are really test-runners),
// exclusion annihilated the dim to derived 0.0 even though every receipt passed
// — the operator's outcome_verification dim read 0.0 with 4/4 green.
//
// The fix DEMOTES instead: each over-declared outcome is re-bucketed into the
// highest tier whose TIER_SCORE_CAPS value fits under its quality maxScore
// (a T5-declared test-runner becomes T4). The honesty invariant is preserved:
// a test-runner still NEVER unlocks T5/8.0 — it now earns at most T4/7.0
// instead of 0. These tests also pin the evidence-rescore.mjs mirror in
// lockstep (same regexes, same demotion machinery) and the legacy-path
// market-dim clamp that the early return used to bypass.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeDerivedScore,
  computeDerivedScoreWithBreakdown,
  type DimensionForScoring,
} from '../src/core/derived-score.js';
import { TIER_SCORE_CAPS } from '../src/matrix/types/capability-test.js';
import { MARKET_DIM_MAX_SCORE } from '../src/core/market-dims.js';
import {
  makeEvidenceKey,
  type Outcome,
  type OutcomeEvidence,
  type OutcomeEvidenceEntry,
} from '../src/matrix/types/outcome.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOutcome(id: string, tier: Outcome['tier'], command: string, kind: Outcome['kind'] = 'shell'): Outcome {
  return { id, tier, description: `outcome ${id}`, command, kind } as Outcome;
}

function makeEntry(outcomeId: string, tier: Outcome['tier'], passed: boolean): OutcomeEvidenceEntry {
  return {
    dimensionId: 'test', outcomeId, tier, gitSha: 'abc',
    passed, exitCode: passed ? 0 : 1, durationMs: 5000,
    stdoutTail: 'ok', stderrTail: '', ranAt: new Date().toISOString(), evidencePath: '/x',
  };
}

function makeEvidenceMap(dimId: string, entries: OutcomeEvidenceEntry[]): OutcomeEvidence {
  const map: OutcomeEvidence = new Map();
  for (const e of entries) map.set(makeEvidenceKey(dimId, e.outcomeId), { ...e, dimensionId: dimId });
  return map;
}

// ── Regression 1: all-over-declared dim derives exactly 7.0, not 0.0 ─────────

describe('demote-not-annihilate — the derived-stuck-0 regression', () => {
  // The operator's real shape: 4 passing T5-declared outcomes, all test-runners.
  const dim: DimensionForScoring = {
    id: 'outcome_verification',
    outcomes: [
      makeOutcome('o1', 'T5', 'npx tsx --test tests/a.test.ts'),
      makeOutcome('o2', 'T5', 'npx tsx --test tests/b.test.ts'),
      makeOutcome('o3', 'T5', 'npm run test -- --reporter tap', 'runtime-exec'),
      makeOutcome('o4', 'T5', 'cargo test -p core', 'runtime-exec'),
    ],
  };

  it('4/4 passing T5 test-runners derive exactly 7.0 (not 0.0, not 8.0)', () => {
    const evidence = makeEvidenceMap('outcome_verification', [
      makeEntry('o1', 'T5', true), makeEntry('o2', 'T5', true),
      makeEntry('o3', 'T5', true), makeEntry('o4', 'T5', true),
    ]);
    const score = computeDerivedScore(dim, evidence);
    assert.equal(score, TIER_SCORE_CAPS.T4, `4/4 passing test-runners must earn T4/7.0, got ${score}`);
    assert.notEqual(score, 0, 'must not be annihilated to 0.0');
    assert.ok(score < TIER_SCORE_CAPS.T5, 'a test-runner must still never unlock T5/8.0');
  });

  it('failing demoted outcomes earn nothing (demotion is not a free pass)', () => {
    const evidence = makeEvidenceMap('outcome_verification', [
      makeEntry('o1', 'T5', false), makeEntry('o2', 'T5', false),
      makeEntry('o3', 'T5', false), makeEntry('o4', 'T5', false),
    ]);
    assert.equal(computeDerivedScore(dim, evidence), 0, 'all-failing demoted outcomes derive 0');
  });

  it('partial passes earn partial credit within the demoted tier (monotonic)', () => {
    const half = makeEvidenceMap('outcome_verification', [
      makeEntry('o1', 'T5', true), makeEntry('o2', 'T5', true),
      makeEntry('o3', 'T5', false), makeEntry('o4', 'T5', false),
    ]);
    const all = makeEvidenceMap('outcome_verification', [
      makeEntry('o1', 'T5', true), makeEntry('o2', 'T5', true),
      makeEntry('o3', 'T5', true), makeEntry('o4', 'T5', true),
    ]);
    const sHalf = computeDerivedScore(dim, half);
    const sAll = computeDerivedScore(dim, all);
    assert.ok(sHalf > 0, 'partial passing earns partial credit');
    assert.ok(sHalf < sAll, 'more passes never lower the score');
    assert.equal(sAll, TIER_SCORE_CAPS.T4);
  });

  it('a T7-declared test-runner also demotes to T4 — only-test dims can never exceed 7.0', () => {
    const t7dim: DimensionForScoring = {
      id: 'test',
      outcomes: [makeOutcome('hi', 'T7', 'npx tsx --test tests/c.test.ts', 'runtime-exec')],
    };
    const evidence = makeEvidenceMap('test', [makeEntry('hi', 'T7', true)]);
    assert.equal(computeDerivedScore(t7dim, evidence), TIER_SCORE_CAPS.T4);
  });

  it('a genuine T5 product run is NOT demoted and still unlocks 8.0 alongside a demoted test', () => {
    const mixed: DimensionForScoring = {
      id: 'test',
      outcomes: [
        makeOutcome('runner', 'T5', 'npx tsx --test tests/a.test.ts'),
        makeOutcome('product', 'T5', 'node dist/index.js validate --all', 'runtime-exec'),
      ],
    };
    const evidence = makeEvidenceMap('test', [
      makeEntry('runner', 'T5', true), makeEntry('product', 'T5', true),
    ]);
    // runner → T4 bucket (passes), product stays T5 (passes) → T5 cap unlocked.
    assert.equal(computeDerivedScore(mixed, evidence), TIER_SCORE_CAPS.T5);
  });
});

// ── Regression 2: breakdown lists the demotions ───────────────────────────────

describe('breakdown surfaces demotions for validate/gap output', () => {
  it('each over-declared outcome appears as {outcomeId, from, to, reason}', () => {
    const dim: DimensionForScoring = {
      id: 'test',
      outcomes: [
        makeOutcome('runner', 'T5', 'npx tsx --test tests/a.test.ts'),
        makeOutcome('honest-t4', 'T4', 'npx tsx --test tests/b.test.ts'),
      ],
    };
    const evidence = makeEvidenceMap('test', [
      makeEntry('runner', 'T5', true), makeEntry('honest-t4', 'T4', true),
    ]);
    const breakdown = computeDerivedScoreWithBreakdown(dim, evidence);
    assert.equal(breakdown.demotions.length, 1, 'exactly the over-declared outcome is demoted');
    const d = breakdown.demotions[0]!;
    assert.equal(d.outcomeId, 'runner');
    assert.equal(d.from, 'T5');
    assert.equal(d.to, 'T4');
    assert.ok(d.reason.length > 0, 'demotion carries the classifier reason');
    // The honestly-declared T4 test-runner (cap == tier cap) is untouched.
    assert.ok(!breakdown.demotions.some(x => x.outcomeId === 'honest-t4'));
    assert.equal(breakdown.score, TIER_SCORE_CAPS.T4);
  });

  it('no demotions for a dim with correctly-declared outcomes', () => {
    const dim: DimensionForScoring = {
      id: 'test',
      outcomes: [makeOutcome('t2', 'T2', 'npx tsx --test tests/unit.test.ts')],
    };
    const evidence = makeEvidenceMap('test', [makeEntry('t2', 'T2', true)]);
    const breakdown = computeDerivedScoreWithBreakdown(dim, evidence);
    assert.deepEqual(breakdown.demotions, []);
    assert.equal(breakdown.score, TIER_SCORE_CAPS.T2);
  });
});

// ── Regression 3: legacy-path market dim is clamped ───────────────────────────

describe('legacy fallback respects the market-dim cap (the early-return hole)', () => {
  it('token_economy with no outcomes and self=8.65 returns 5.0, not 8.65', () => {
    const dim: DimensionForScoring = { id: 'token_economy', scores: { self: 8.65 } };
    const breakdown = computeDerivedScoreWithBreakdown(dim, new Map());
    assert.equal(breakdown.usedLegacyFallback, true);
    assert.ok(breakdown.score <= MARKET_DIM_MAX_SCORE,
      `legacy market dim must be capped at ${MARKET_DIM_MAX_SCORE}, got ${breakdown.score}`);
    assert.equal(breakdown.score, MARKET_DIM_MAX_SCORE);
    assert.equal(breakdown.legacyScoreUsed, MARKET_DIM_MAX_SCORE, 'reported legacy score matches the clamped value');
  });

  it('community_adoption legacy_score above the cap is clamped; below-cap passes through', () => {
    assert.equal(computeDerivedScore({ id: 'community_adoption', legacy_score: 9.0 }, new Map()), MARKET_DIM_MAX_SCORE);
    assert.equal(computeDerivedScore({ id: 'community_adoption', legacy_score: 3.5 }, new Map()), 3.5);
  });

  it('non-market dims keep the raw legacy score (no over-clamping)', () => {
    assert.equal(computeDerivedScore({ id: 'planning_quality', legacy_score: 8.0 }, new Map()), 8.0);
  });
});

// ── Lockstep: evidence-rescore.mjs mirrors the demotion machinery ─────────────
// The drift test (evidence-rescore-drift.test.ts) pins the numeric constants;
// these pins cover the NEW shared demotion surface so the plain-JS mirror cannot
// quietly diverge from the canonical classifier.

describe('evidence-rescore.mjs demotion mirror stays in lockstep', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const read = (rel: string) => fs.readFileSync(path.join(repoRoot, rel), 'utf8');
  const mjs = read('scripts/evidence-rescore.mjs');
  const quality = read('src/matrix/engines/outcome-quality.ts');

  function extractRegexLiteral(src: string, name: string): string {
    const m = src.match(new RegExp(`const ${name} = (\\/[\\s\\S]+?\\/);`));
    assert.ok(m, `could not locate ${name} regex literal`);
    return m![1]!;
  }

  it('TEST_RUNNER_RE is byte-identical to outcome-quality.ts', () => {
    assert.equal(extractRegexLiteral(mjs, 'TEST_RUNNER_RE'), extractRegexLiteral(quality, 'TEST_RUNNER_RE'),
      'evidence-rescore.mjs TEST_RUNNER_RE drifted from outcome-quality.ts');
  });

  it('STRUCTURAL_READ_RE and REAL_EXECUTION_RE are byte-identical to outcome-quality.ts', () => {
    assert.equal(extractRegexLiteral(mjs, 'STRUCTURAL_READ_RE'), extractRegexLiteral(quality, 'STRUCTURAL_READ_RE'));
    assert.equal(extractRegexLiteral(mjs, 'REAL_EXECUTION_RE'), extractRegexLiteral(quality, 'REAL_EXECUTION_RE'));
  });

  it('the mjs mirror carries the demotion machinery (not the old exclusion)', () => {
    assert.ok(/highestTierWithinCap/.test(mjs), 'mjs must demote via highestTierWithinCap');
    assert.ok(/demotions\.push\(\{\s*outcomeId/.test(mjs), 'mjs must record demotions');
    assert.ok(/MARKET_DIMS\.has\(dim\.id\)\s*&&\s*legacy\s*>\s*MARKET_DIM_CAP/.test(mjs),
      'mjs legacy path must clamp market dims (the early-return hole)');
  });
});
