import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  runCouncilGapReview, type CouncilLens, type LensReview, type CouncilGap,
} from '../src/core/council-gap-review.js';
import { runCouncilGapLoop } from '../src/core/council-gap-loop.js';

function gap(lens: string, blocking: boolean, title = `${lens}-gap`): CouncilGap {
  return { lens, title, problem: `${lens} problem`, evidence: `${lens} evidence`, opportunity: `${lens} opportunity`, blocking };
}
const satisfied = (lens: CouncilLens): LensReview => ({ lens: lens.id, satisfied: true, gaps: [] });
const blocked = (lens: CouncilLens): LensReview => ({ lens: lens.id, satisfied: false, gaps: [gap(lens.id, true)] });

describe('council-gap-review — multi-lens adversarial gate', () => {
  test('READY when every lens is satisfied', async () => {
    const v = await runCouncilGapReview({ review: async (l) => satisfied(l) });
    assert.equal(v.verdict, 'READY');
    assert.equal(v.blockingGaps.length, 0);
  });

  test('NOT_READY when any lens reports a blocking gap', async () => {
    const v = await runCouncilGapReview({ review: async (l) => (l.id === 'scoring-honesty' ? blocked(l) : satisfied(l)) });
    assert.equal(v.verdict, 'NOT_READY');
    assert.equal(v.blockingGaps.length, 1);
    assert.equal(v.blockingGaps[0]!.lens, 'scoring-honesty');
  });

  test('fail-closed: a reviewer that THROWS becomes a blocking gap (no ready-by-silence)', async () => {
    const v = await runCouncilGapReview({ review: async (l) => { if (l.id === 'runtime-reliability') throw new Error('reviewer died'); return satisfied(l); } });
    assert.equal(v.verdict, 'NOT_READY');
    assert.ok(v.blockingGaps.some((g) => g.lens === 'runtime-reliability'));
  });

  test('a satisfied lens with only NON-blocking gaps stays READY', async () => {
    const v = await runCouncilGapReview({
      review: async (l) => ({ lens: l.id, satisfied: true, gaps: [gap(l.id, false)] }),
    });
    assert.equal(v.verdict, 'READY');
    assert.ok(v.gaps.length > 0, 'non-blocking gaps are still surfaced as follow-ups');
  });

  test('dedups identical gaps across lenses', async () => {
    const dup = gap('shared', true, 'same-title');
    const v = await runCouncilGapReview({
      review: async (l) => ({ lens: l.id, satisfied: false, gaps: [dup] }),
    });
    assert.equal(v.gaps.length, 1, 'identical (title,problem) gaps collapse to one');
  });
});

describe('council-gap-loop — review → record → fix → re-review until READY', () => {
  test('clears after fixes flip the panel to READY; records gaps + calls fix', async () => {
    let round = 0;
    const recorded: CouncilGap[] = [];
    const fixedRounds: number[] = [];
    const res = await runCouncilGapLoop({
      review: async (l) => (round >= 2 ? satisfied(l) : blocked(l)),
      fix: async (gaps, r) => { fixedRounds.push(r); round++; },
      recordGap: async (g) => { recorded.push(g); return `CH-${recorded.length}`; },
    }, { maxRounds: 5 });
    assert.equal(res.cleared, true);
    assert.equal(res.rounds, 3, 'rounds 1+2 NOT_READY, round 3 READY');
    assert.deepEqual(fixedRounds, [1, 2], 'fix ran on each un-cleared round');
    assert.ok(recorded.length >= 1, 'blocking gaps were recorded to the ledger');
  });

  test('stops un-cleared after maxRounds (never loops forever), gaps tracked', async () => {
    const recorded: string[] = [];
    const res = await runCouncilGapLoop({
      review: async (l) => blocked(l),
      fix: async () => {},
      recordGap: async (g) => { recorded.push(g.title); return `CH-${recorded.length}`; },
    }, { maxRounds: 3 });
    assert.equal(res.cleared, false);
    assert.equal(res.rounds, 3);
    assert.equal(res.finalVerdict.verdict, 'NOT_READY');
    assert.ok(res.recordedGapIds.length >= 1);
  });

  test('READY on round 1 records nothing and never calls fix', async () => {
    let fixCalls = 0;
    const res = await runCouncilGapLoop({
      review: async (l) => satisfied(l),
      fix: async () => { fixCalls++; },
      recordGap: async () => 'CH-X',
    });
    assert.equal(res.cleared, true);
    assert.equal(res.rounds, 1);
    assert.equal(fixCalls, 0);
    assert.equal(res.recordedGapIds.length, 0);
  });
});
