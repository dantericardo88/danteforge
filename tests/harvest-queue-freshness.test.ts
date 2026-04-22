import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isRepoStale,
  computeFreshnessDays,
  type HarvestRepo,
} from '../src/core/harvest-queue.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeRepo(overrides: Partial<HarvestRepo> = {}): HarvestRepo {
  return {
    url: 'https://github.com/example/repo',
    slug: 'repo',
    priority: 5,
    gapTargets: [],
    status: 'queued',
    addedAt: new Date().toISOString(),
    patternsExtracted: 0,
    patternsAdopted: 0,
    ...overrides,
  };
}

/** Return an ISO timestamp for `daysAgo` days in the past. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Return an ISO timestamp for `hoursAgo` hours in the past. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

// ── isRepoStale tests ─────────────────────────────────────────────────────────

describe('harvest-queue-freshness', () => {
  describe('isRepoStale', () => {
    it('T1: isRepoStale with no lastHarvestedAt → returns true', () => {
      const repo = makeRepo({ lastHarvestedAt: undefined });

      assert.equal(isRepoStale(repo), true);
    });

    it('T2: isRepoStale with lastHarvestedAt 1 hour ago → returns false (within default 90 days)', () => {
      const repo = makeRepo({ lastHarvestedAt: hoursAgo(1) });

      assert.equal(isRepoStale(repo), false);
    });

    it('T3: isRepoStale with lastHarvestedAt 100 days ago → returns true (> 90 days)', () => {
      const repo = makeRepo({ lastHarvestedAt: daysAgo(100) });

      assert.equal(isRepoStale(repo), true);
    });

    it('T4: isRepoStale with staleAfterDays=7 and harvested 8 days ago → returns true', () => {
      const repo = makeRepo({
        lastHarvestedAt: daysAgo(8),
        staleAfterDays: 7,
      });

      assert.equal(isRepoStale(repo), true);
    });

    it('T5: isRepoStale with staleAfterDays=7 and harvested 6 days ago → returns false', () => {
      const repo = makeRepo({
        lastHarvestedAt: daysAgo(6),
        staleAfterDays: 7,
      });

      assert.equal(isRepoStale(repo), false);
    });
  });

  // ── computeFreshnessDays tests ──────────────────────────────────────────────

  describe('computeFreshnessDays', () => {
    it('T6: computeFreshnessDays with no lastHarvestedAt → returns undefined', () => {
      const repo = makeRepo({ lastHarvestedAt: undefined });

      const result = computeFreshnessDays(repo);

      assert.equal(result, undefined);
    });

    it('T7: computeFreshnessDays with lastHarvestedAt yesterday → returns approximately 1', () => {
      // Use 23 hours ago to avoid boundary issues; floor division means result is 0 for very recent
      // Use exactly 25 hours ago to guarantee floor gives 1
      const repo = makeRepo({ lastHarvestedAt: hoursAgo(25) });

      const result = computeFreshnessDays(repo);

      assert.ok(result !== undefined, 'result should not be undefined');
      assert.equal(result, 1, `Expected ~1 day for 25 hours ago, got: ${result}`);
    });
  });
});
