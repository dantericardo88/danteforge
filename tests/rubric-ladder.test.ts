// rubric-ladder.test.ts — parse the competitor-grounded score ladders into structured
// levels + surface the next-level criteria for the build goal.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseScoreLadder, nextLevel, nextLevelGoalSuffix } from '../src/core/rubric-ladder.js';

const LADDER = `
# Universe: Security
## OSS Leader
**Name**: OpenHands
## Score Ladder
| Score | Evidence required for Security |
| 5 | Basic guardrails exist; no runtime sandbox. |
| 6 | Input validation + secret redaction on common paths. |
| 8 | Central security middleware emits {runId, leaseId, risk} per action; tests cover injection. |
| 9 | OpenHands-grade action safety plus OpenSandbox egress rails; per-run sandbox keys. |
| 10 | Enterprise multi-tenant hardening: gVisor/Kata, signed access. |
## What practitioners say
some trailing prose that is not part of the table.
`;

describe('parseScoreLadder', () => {
  it('parses the markdown ladder into sorted rubric levels', () => {
    const r = parseScoreLadder(LADDER);
    assert.deepEqual(r.map(l => l.score), [5, 6, 8, 9, 10]);
    assert.match(r.find(l => l.score === 9)!.descriptor, /OpenSandbox egress rails/);
  });

  it('tolerates descriptors containing pipes (code/JSON) by joining trailing cells', () => {
    const r = parseScoreLadder(LADDER);
    assert.match(r.find(l => l.score === 8)!.descriptor, /\{runId, leaseId, risk\}/);
  });

  it('stops at the end of the table (ignores trailing prose)', () => {
    const r = parseScoreLadder(LADDER);
    assert.ok(!r.some(l => /trailing prose/.test(l.descriptor)));
  });

  it('returns [] when there is no Score Ladder (undefined-not-invented)', () => {
    assert.deepEqual(parseScoreLadder('# Universe\nno ladder here\n'), []);
  });
});

describe('nextLevel', () => {
  it('picks the lowest level strictly above the current score', () => {
    const r = parseScoreLadder(LADDER);
    assert.equal(nextLevel(r, 8)!.score, 9);
    assert.equal(nextLevel(r, 6)!.score, 8);   // skips the missing 7, finds the next defined level
    assert.equal(nextLevel(r, 10), null);      // nothing above the top
  });
});

describe('nextLevelGoalSuffix', () => {
  it('returns empty (no fabrication) for a dim with no universe ladder', async () => {
    const s = await nextLevelGoalSuffix(process.cwd(), '__no_such_dim__', 7);
    assert.equal(s, '');
  });
});
