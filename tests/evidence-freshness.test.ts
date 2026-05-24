// evidence-freshness.test.ts — tier-graded evidence decay.
//
// Cached outcome evidence is treated as a cache miss when older than its tier's
// freshness window. Combined with SHA-based eviction this gives the substrate
// two complementary invalidation signals:
//   1. SHA-based:  any commit invalidates evidence at the old SHA.
//   2. Tier-based: evidence beyond the tier's max age is re-executed even at
//                  the same SHA (long-lived branches, slow-moving repos).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIER_FRESHNESS_MS,
  isEvidenceStale,
  type CapabilityTier,
} from '../src/matrix/types/capability-test.js';

describe('TIER_FRESHNESS_MS', () => {
  it('declares a window for every tier', () => {
    const tiers: CapabilityTier[] = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
    for (const t of tiers) {
      assert.ok(TIER_FRESHNESS_MS[t] !== undefined, `tier ${t} should have a window`);
    }
  });

  it('windows decrease monotonically T1 → T6 (higher tier = stricter freshness)', () => {
    // T0 is indefinite — skip it.
    assert.ok(TIER_FRESHNESS_MS.T1 > TIER_FRESHNESS_MS.T2);
    assert.ok(TIER_FRESHNESS_MS.T2 > TIER_FRESHNESS_MS.T3);
    assert.ok(TIER_FRESHNESS_MS.T3 > TIER_FRESHNESS_MS.T4);
    assert.ok(TIER_FRESHNESS_MS.T4 > TIER_FRESHNESS_MS.T5);
    assert.ok(TIER_FRESHNESS_MS.T5 > TIER_FRESHNESS_MS.T6);
  });

  it('T0 is indefinite', () => {
    assert.equal(TIER_FRESHNESS_MS.T0, Number.POSITIVE_INFINITY);
  });

  it('T6 is 24 hours', () => {
    assert.equal(TIER_FRESHNESS_MS.T6, 24 * 60 * 60 * 1000);
  });
});

describe('isEvidenceStale', () => {
  const now = new Date('2026-05-18T12:00:00.000Z');

  it('returns false for evidence within the tier window', () => {
    const ranAt = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5d ago
    assert.equal(isEvidenceStale('T3', ranAt, now), false, '5d-old T3 evidence is fresh (window is 30d)');
  });

  it('returns true for evidence beyond the tier window', () => {
    const ranAt = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000).toISOString(); // 31d ago
    assert.equal(isEvidenceStale('T3', ranAt, now), true, '31d-old T3 evidence is stale (window is 30d)');
  });

  it('T6 evidence is stale after 24h', () => {
    const ranAt = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
    assert.equal(isEvidenceStale('T6', ranAt, now), true);
  });

  it('T6 evidence is fresh within 24h', () => {
    const ranAt = new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString(); // 23h ago
    assert.equal(isEvidenceStale('T6', ranAt, now), false);
  });

  it('T0 evidence is never stale', () => {
    const ranAt = new Date('2020-01-01T00:00:00.000Z').toISOString(); // years ago
    assert.equal(isEvidenceStale('T0', ranAt, now), false);
  });

  it('higher tiers are stricter — 10d-old evidence is fresh for T2 but stale for T5', () => {
    const ranAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 10d ago
    assert.equal(isEvidenceStale('T2', ranAt, now), false, '10d-old T2 evidence is fresh (window is 60d)');
    assert.equal(isEvidenceStale('T5', ranAt, now), true, '10d-old T5 evidence is stale (window is 7d)');
  });

  it('malformed timestamps are treated as fresh (let the cache handle it)', () => {
    assert.equal(isEvidenceStale('T3', 'not-a-date', now), false);
  });

  it('defaults to current time when now is omitted', () => {
    const justNow = new Date().toISOString();
    assert.equal(isEvidenceStale('T3', justNow), false);
  });
});

describe('isEvidenceStale boundary cases', () => {
  const now = new Date('2026-05-18T12:00:00.000Z');

  it('exactly at the window boundary is NOT stale', () => {
    const exactly30dAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(isEvidenceStale('T3', exactly30dAgo, now), false, 'boundary inclusive — exactly 30d-old T3 is still fresh');
  });

  it('one ms past the window IS stale', () => {
    const justPastBoundary = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000 - 1).toISOString();
    assert.equal(isEvidenceStale('T3', justPastBoundary, now), true);
  });
});
