import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRungEvidence, checkLadderGroundedness } from '../src/core/ladder-groundedness.ts';

test('parseRungEvidence extracts the confidence tag + cited URLs', () => {
  assert.deepEqual(parseRungEvidence('[EXTRACTED] Aider does X (https://aider.chat/docs)'), {
    confidence: 'EXTRACTED', citations: ['https://aider.chat/docs'],
  });
  assert.equal(parseRungEvidence('INFERRED (0.8): likely from the imports').confidence, 'INFERRED');
  assert.equal(parseRungEvidence('AMBIGUOUS: not sure').confidence, 'AMBIGUOUS');
  assert.equal(parseRungEvidence('just some prose with no tag').confidence, 'UNTAGGED');
});

test('checkLadderGroundedness ignores rungs at/below the threshold (floors / table stakes)', () => {
  const r = checkLadderGroundedness([{ score: 5, descriptor: 'untagged prose' }, { score: 7, descriptor: 'also untagged' }], { threshold: 7 });
  assert.ok(r.ok, r.issues.join('; '));
});

test('checkLadderGroundedness fails UNTAGGED and AMBIGUOUS rungs above the threshold', () => {
  const r = checkLadderGroundedness([
    { score: 8, descriptor: 'does great things' },                 // untagged
    { score: 9, descriptor: 'AMBIGUOUS: maybe supports plugins' }, // ambiguous
  ], { threshold: 7 });
  assert.ok(!r.ok);
  assert.equal(r.issues.length, 2);
  assert.match(r.issues[0]!, /UNGROUNDED/);
  assert.match(r.issues[1]!, /AMBIGUOUS/);
});

test('checkLadderGroundedness requires a citation for EXTRACTED / INFERRED above the threshold', () => {
  const noCite = checkLadderGroundedness([{ score: 8, descriptor: 'EXTRACTED: aider resolves 46% of swe-bench' }], { threshold: 7 });
  assert.ok(!noCite.ok);
  assert.match(noCite.issues[0]!, /cites no URL/);

  const inferredNoCite = checkLadderGroundedness([{ score: 8, descriptor: 'INFERRED: probably has rate limiting' }], { threshold: 7 });
  assert.ok(!inferredNoCite.ok);
});

test('checkLadderGroundedness passes EXTRACTED rungs with a cited source', () => {
  const r = checkLadderGroundedness([
    { score: 8, descriptor: 'EXTRACTED: top open agent resolves 46% (https://swebench.com/leaderboard)' },
    { score: 9, descriptor: 'EXTRACTED: beyond-parity X per https://github.com/x/issues/1' },
  ], { threshold: 7 });
  assert.ok(r.ok, r.issues.join('; '));
});

test('an empty ladder passes (the missing-ladder gate is separate)', () => {
  assert.ok(checkLadderGroundedness([], { threshold: 7 }).ok);
});
