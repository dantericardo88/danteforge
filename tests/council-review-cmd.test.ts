import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { councilReview } from '../src/cli/commands/council-review.js';
import type { CouncilLens, LensReview, CouncilGap } from '../src/core/council-gap-review.js';

describe('council-review command — verdict + ledger recording (injected reviewer)', () => {
  test('records blocking gaps to the ledger and exits non-zero on NOT_READY', async () => {
    const prevExit = process.exitCode;
    const recorded: CouncilGap[] = [];
    const review = async (l: CouncilLens): Promise<LensReview> => (
      l.id === 'scoring-honesty'
        ? { lens: l.id, satisfied: false, gaps: [{ lens: l.id, title: 'soft completion', problem: 'loop can finish without a receipt', evidence: 'autoforge-loop.ts', opportunity: 'gate on measured receipt', blocking: true }] }
        : { lens: l.id, satisfied: true, gaps: [] }
    );
    await councilReview({ json: true, _review: review, _recordGap: async (g) => { recorded.push(g); return `CH-${recorded.length}`; } });
    assert.equal(recorded.length, 1, 'the one blocking gap was recorded');
    assert.equal(recorded[0]!.title, 'soft completion');
    assert.equal(process.exitCode, 2, 'NOT_READY exits non-zero');
    process.exitCode = prevExit;
  });

  test('READY records nothing and leaves exit code clean', async () => {
    const prevExit = process.exitCode;
    let recordCalls = 0;
    await councilReview({ json: true, _review: async (l) => ({ lens: l.id, satisfied: true, gaps: [] }), _recordGap: async () => { recordCalls++; return 'X'; } });
    assert.equal(recordCalls, 0);
    process.exitCode = prevExit;
  });

  test('--loop runs review→fix→re-review until the council clears it', async () => {
    const prevExit = process.exitCode;
    let round = 0;
    const fixedRounds: number[] = [];
    await councilReview({
      json: true, loop: true, rounds: 5,
      _review: async (l) => (round >= 1
        ? { lens: l.id, satisfied: true, gaps: [] }
        : { lens: l.id, satisfied: false, gaps: [{ lens: l.id, title: 'g', problem: 'p', evidence: 'e', opportunity: 'o', blocking: true }] }),
      _fix: async (_g, r) => { fixedRounds.push(r); round++; },
      _recordGap: async () => 'CH-1',
    });
    assert.deepEqual(fixedRounds, [1], 'fixer ran once; round 2 was READY');
    process.exitCode = prevExit;
  });

  test('--loop exits non-zero when it cannot clear within --rounds', async () => {
    const prevExit = process.exitCode;
    await councilReview({
      json: true, loop: true, rounds: 2,
      _review: async (l) => ({ lens: l.id, satisfied: false, gaps: [{ lens: l.id, title: 'g', problem: 'p', evidence: 'e', opportunity: 'o', blocking: true }] }),
      _fix: async () => {},
      _recordGap: async () => 'CH-1',
    });
    assert.equal(process.exitCode, 2);
    process.exitCode = prevExit;
  });
});
