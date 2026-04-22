import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  shrinkClaim,
  implausibilityCheck,
  estimatePriorMean,
  verifyBundle,
  type ImplausibilityThresholds,
  type QuarantineReason,
} from '../src/core/bundle-trust.js';
import type { SharedPatternBundle, SharedPatternStats } from '../src/cli/commands/share-patterns.js';
import type { PatternLibraryIndex } from '../src/core/global-pattern-library.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePattern(overrides: Partial<SharedPatternStats> = {}): SharedPatternStats {
  return {
    patternName: 'circuit-breaker',
    sourceRepo: 'https://github.com/example/repo',
    avgScoreDelta: 1.5,
    sampleCount: 5,
    verifyPassRate: 0.8,
    lastObservedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function makeBundle(patterns: SharedPatternStats[]): SharedPatternBundle {
  return {
    version: '1.0.0',
    exportedAt: '2026-04-01T00:00:00Z',
    sourceProjectHash: 'abc123',
    patterns,
    refusedPatternNames: [],
  };
}

function makeLibrary(entries: Array<{ patternName: string; avgRoi: number }>): PatternLibraryIndex {
  return {
    version: '1.0.0',
    updatedAt: '2026-04-01T00:00:00Z',
    entries: entries.map(e => ({
      patternName: e.patternName,
      avgRoi: e.avgRoi,
      adoptionCount: 1,
      lastUpdatedAt: '2026-04-01T00:00:00Z',
    })),
  };
}

const DEFAULT_THRESHOLDS: ImplausibilityThresholds = {
  maxDeltaTinyN: 3.5,
  minSamples: 1,
  minVerifyRate: 0.3,
};

// ── shrinkClaim ───────────────────────────────────────────────────────────────

describe('shrinkClaim', () => {
  it('T1: returns priorMean when sampleCount is 0', () => {
    assert.equal(shrinkClaim(5.0, 0, 0.8), 0.8);
  });

  it('T2: large sample count stays close to observed delta', () => {
    // n=100, k=5 → shrunk = (2.0×100 + 0.8×5) / 105 = (200+4)/105 = 1.943
    const result = shrinkClaim(2.0, 100, 0.8);
    assert.ok(result > 1.9, `expected > 1.9, got ${result}`);
    assert.ok(result < 2.0, `expected < 2.0, got ${result}`);
  });

  it('T3: small sample count pulled strongly toward prior', () => {
    // n=1, k=5 → shrunk = (4.0×1 + 0.8×5) / 6 = (4+4)/6 = 1.333
    const result = shrinkClaim(4.0, 1, 0.8);
    assert.ok(result < 2.0, `small-sample claim should be heavily shrunk; got ${result}`);
    assert.ok(result > 0.8, `should still be above prior; got ${result}`);
  });

  it('T4: symmetric shrinkage (observed below prior is also pulled up)', () => {
    // observed=0.2, prior=1.0, n=2, k=5 → (0.4+5)/7 = 5.4/7 = 0.771
    const result = shrinkClaim(0.2, 2, 1.0);
    assert.ok(result > 0.2, `should be pulled toward prior; got ${result}`);
    assert.ok(result < 1.0, `should not overshoot prior; got ${result}`);
  });

  it('T5: rounds to 3 decimal places', () => {
    const result = shrinkClaim(1.1234567, 3, 0.8);
    const decimals = (result.toString().split('.')[1] ?? '').length;
    assert.ok(decimals <= 3, `expected ≤ 3 decimal places, got ${decimals}`);
  });
});

// ── implausibilityCheck ───────────────────────────────────────────────────────

describe('implausibilityCheck', () => {
  it('T6: passes a well-formed pattern', () => {
    const result = implausibilityCheck(makePattern(), DEFAULT_THRESHOLDS);
    assert.equal(result, null);
  });

  it('T6b: quarantines zero-delta pattern', () => {
    const result = implausibilityCheck(makePattern({ avgScoreDelta: 0 }), DEFAULT_THRESHOLDS);
    assert.equal(result, 'zero-delta');
  });

  it('T6c: quarantines negative delta as zero-delta', () => {
    const result = implausibilityCheck(makePattern({ avgScoreDelta: -0.5 }), DEFAULT_THRESHOLDS);
    assert.equal(result, 'zero-delta');
  });

  it('T6d: quarantines tiny-sample pattern', () => {
    const thresholds = { ...DEFAULT_THRESHOLDS, minSamples: 3 };
    const result = implausibilityCheck(makePattern({ sampleCount: 2 }), thresholds);
    assert.equal(result, 'tiny-sample');
  });

  it('T6e: quarantines implausible-delta (high delta, tiny sample)', () => {
    // sampleCount < 3 and delta > 3.5
    const result = implausibilityCheck(
      makePattern({ avgScoreDelta: 4.0, sampleCount: 2 }),
      DEFAULT_THRESHOLDS,
    );
    assert.equal(result, 'implausible-delta');
  });

  it('T6f: quarantines low-verify-rate pattern', () => {
    const result = implausibilityCheck(
      makePattern({ verifyPassRate: 0.1 }),
      DEFAULT_THRESHOLDS,
    );
    assert.equal(result, 'low-verify-rate');
  });
});

// ── estimatePriorMean ─────────────────────────────────────────────────────────

describe('estimatePriorMean', () => {
  it('T7: returns 0.8 default for empty library', () => {
    const lib = makeLibrary([]);
    assert.equal(estimatePriorMean(lib), 0.8);
  });

  it('T8: returns average of library entries', () => {
    const lib = makeLibrary([
      { patternName: 'a', avgRoi: 1.0 },
      { patternName: 'b', avgRoi: 2.0 },
      { patternName: 'c', avgRoi: 3.0 },
    ]);
    assert.equal(estimatePriorMean(lib), 2.0);
  });
});

// ── verifyBundle ──────────────────────────────────────────────────────────────

describe('verifyBundle', () => {
  it('T9: approves well-formed patterns and applies shrinkage', () => {
    const bundle = makeBundle([
      makePattern({ avgScoreDelta: 3.0, sampleCount: 1 }), // will be shrunk
    ]);
    const lib = makeLibrary([{ patternName: 'x', avgRoi: 0.8 }]);

    const result = verifyBundle(bundle, lib);

    assert.equal(result.approved.length, 1);
    assert.equal(result.quarantined.length, 0);
    assert.ok(result.approved[0].avgScoreDelta < 3.0, 'delta should be shrunk');
    assert.equal(result.shrinkageApplied, 1);
    assert.equal(result.trustScore, 1.0);
  });

  it('T10: quarantines implausible pattern and reflects in trust score', () => {
    const bundle = makeBundle([
      makePattern({ avgScoreDelta: 5.0, sampleCount: 1 }), // implausible-delta
      makePattern({ patternName: 'good-pattern', avgScoreDelta: 1.0, sampleCount: 10 }),
    ]);
    const lib = makeLibrary([]);

    const result = verifyBundle(bundle, lib);

    assert.equal(result.quarantined.length, 1);
    assert.equal(result.quarantined[0].reason, 'implausible-delta');
    assert.equal(result.approved.length, 1);
    assert.equal(result.trustScore, 0.5); // 1/2
  });

  it('T10b: empty bundle returns trustScore of 1.0', () => {
    const result = verifyBundle(makeBundle([]), makeLibrary([]));
    assert.equal(result.trustScore, 1.0);
    assert.equal(result.approved.length, 0);
    assert.equal(result.quarantined.length, 0);
  });
});

// ── Mutation-killing boundary tests ──────────────────────────────────────────

describe('shrinkClaim + implausibilityCheck — mutation boundaries', () => {
  it('Tmut1: shrinkClaim formula exact — (obs×n + prior×k) / (n+k)', () => {
    // shrinkClaim(4.0, 2, 0.8, 5) = (4.0×2 + 0.8×5) / (2+5) = (8+4)/7 = 12/7 = 1.714
    // Kills: divisor `n+k` → `n-k` would give (8+4)/(-3) = -4.0
    // Kills: numerator swap `prior×n + obs×k` → (0.8×2 + 4.0×5)/7 = (1.6+20)/7 = 3.086
    const result = shrinkClaim(4.0, 2, 0.8, 5);
    assert.equal(result, 1.714, `expected 1.714, got ${result}`);
  });

  it('Tmut2: sampleCount < 3 boundary — 2 quarantines for high delta, 3 does not', () => {
    // Kills: `sampleCount < 3` mutated to `sampleCount <= 3` or `sampleCount < 2`
    const t = DEFAULT_THRESHOLDS;
    // sampleCount=2 with delta=3.6 (> maxDeltaTinyN=3.5): should quarantine
    const result2 = implausibilityCheck(
      makePattern({ sampleCount: 2, avgScoreDelta: 3.6 }), t,
    );
    assert.equal(result2, 'implausible-delta', 'sampleCount=2 with delta>3.5 must quarantine');

    // sampleCount=3 with delta=3.6: boundary — sampleCount is NOT < 3 so implausible-delta does NOT fire
    const result3 = implausibilityCheck(
      makePattern({ sampleCount: 3, avgScoreDelta: 3.6 }), t,
    );
    assert.notEqual(result3, 'implausible-delta',
      'sampleCount=3 with delta>3.5 must NOT trigger implausible-delta (3 is not < 3)');
  });

  it('Tmut3: priorStrength=10 vs 5 produces different shrunk delta', () => {
    // Kills: hardcoded priorStrength constant mutations
    // With n=2, observed=4.0, prior=0.8:
    //   k=5: (8+4)/7 = 1.714
    //   k=10: (8+8)/12 = 1.333
    const result5 = shrinkClaim(4.0, 2, 0.8, 5);
    const result10 = shrinkClaim(4.0, 2, 0.8, 10);
    assert.ok(result10 < result5,
      `higher priorStrength should pull more toward prior: k=10 (${result10}) < k=5 (${result5})`);
    assert.equal(result10, 1.333);
  });
});
