import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { declaredVerdict, parseVerdict } from '../src/matrix/engines/council-verdict-parser.js';
import type { CouncilMemberId } from '../src/matrix/engines/council-scheduler.js';

describe('declaredVerdict — last-declaration-wins (grading-integrity #5)', () => {
  test('clean PASS / FAIL / UNCLEAR parse to themselves', () => {
    assert.equal(declaredVerdict('VERDICT: PASS\nREASON: real'), 'PASS');
    assert.equal(declaredVerdict('VERDICT: FAIL\nREASON: fixture'), 'FAIL');
    assert.equal(declaredVerdict('VERDICT: UNCLEAR\nREASON: cannot tell'), 'UNCLEAR');
  });

  test('a reasoning FAIL that QUOTES "VERDICT: PASS" earlier still parses as FAIL (the bug)', () => {
    const raw = [
      'Looking at the rubric, to earn VERDICT: PASS the artifact would need real multi-scenario proof.',
      'It does not. This is a prepared fixture.',
      'VERDICT: FAIL',
      'REASON: narrow toy input, not competitor parity',
    ].join('\n');
    assert.equal(declaredVerdict(raw), 'FAIL', 'the FINAL declaration wins, not the first PASS substring');
  });

  test('negated PASS in prose followed by a FAIL declaration → FAIL', () => {
    assert.equal(declaredVerdict('I cannot reach VERDICT: PASS here.\nVERDICT: FAIL'), 'FAIL');
  });

  test('no verdict line → UNCLEAR', () => {
    assert.equal(declaredVerdict('This is some commentary with no declaration.'), 'UNCLEAR');
  });

  test('parseVerdict uses the same last-declaration logic', () => {
    const raw = 'To say VERDICT: PASS I would need X.\nVERDICT: FAIL\nCONFIDENCE: HIGH\nREASON: missing X';
    const v = parseVerdict('codex' as CouncilMemberId, raw);
    assert.equal(v.verdict, 'FAIL');
    assert.equal(v.confidence, 'HIGH');
  });
});
