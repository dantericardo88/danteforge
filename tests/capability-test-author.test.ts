import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCandidateYardstick, authorYardstick, buildExaminerObjective, type YardstickCandidate, type AuthorContext } from '../src/matrix/engines/capability-test-author.js';

const WIRED = new Set(['memory_inject']);
const REAL: YardstickCandidate = { dimId: 'dim011', command: 'cargo test -p dante-endpoint --lib memory_inject', callsite: 'src/endpoint/src/memory_inject.rs' };
const ctx = (over: Partial<Parameters<typeof evaluateCandidateYardstick>[1]> = {}) => ({
  cwd: '/x', wired: WIRED, hasLadder: true,
  run: async () => ({ exitCode: 1 }), // RED by default (fails on HEAD)
  ...over,
});

describe('evaluateCandidateYardstick — the authored-yardstick honesty gate', () => {
  test('ACCEPTS a real wired test that is grounded AND red (fails on HEAD)', async () => {
    const r = await evaluateCandidateYardstick(REAL, ctx());
    assert.equal(r.accepted, true, r.reasons.join('; '));
    assert.equal(r.redGate, 'RED');
    assert.equal(r.auditVerdict, 'REAL_TEST');
  });

  test('REJECTS a candidate that already PASSES on HEAD (green stub — measures nothing to build)', async () => {
    const r = await evaluateCandidateYardstick(REAL, ctx({ run: async () => ({ exitCode: 0 }) }));
    assert.equal(r.accepted, false);
    assert.equal(r.redGate, 'GREEN');
    assert.ok(r.reasons.some(x => /red:/.test(x)));
  });

  test('REJECTS a self-fulfilling stub (no wired production callsite) even if it is red', async () => {
    const stub: YardstickCandidate = { dimId: 'd', command: 'python scripts/dante.py test x', callsite: '' };
    const r = await evaluateCandidateYardstick(stub, ctx());
    assert.equal(r.accepted, false);
    assert.ok(r.reasons.some(x => /integrity:/.test(x)));
  });

  test('REJECTS an ungrounded candidate (no competitor Score Ladder) — the bar must be researched, not self-set', async () => {
    const r = await evaluateCandidateYardstick(REAL, ctx({ hasLadder: false }));
    assert.equal(r.accepted, false);
    assert.ok(r.reasons.some(x => /grounded:/.test(x)));
  });

  test('REJECTS when the candidate cannot be run (inconclusive is not acceptance)', async () => {
    const r = await evaluateCandidateYardstick(REAL, ctx({ run: async () => { throw new Error('boom'); } }));
    assert.equal(r.accepted, false);
    assert.equal(r.redGate, 'ERROR');
  });
});

describe('authorYardstick — autonomous examiner → gate → install/revert (no human)', () => {
  function authorCtx(over: Partial<AuthorContext> = {}): AuthorContext {
    return {
      cwd: '/x', wired: WIRED, hasLadder: true,
      ladderBar: 'OpenHands-grade memory-injection detection across the live process table',
      targetModule: 'src/endpoint/src/memory_inject.rs',
      dispatch: async () => ({ ranOk: true }),
      readCandidate: async () => REAL,
      revert: async () => {},
      run: async () => ({ exitCode: 1 }), // examiner produced a RED test
      ...over,
    };
  }

  test('installs a real RED ladder-grounded yardstick the examiner authored', async () => {
    const r = await authorYardstick('dim011', authorCtx());
    assert.equal(r.installed, true, r.reason);
    assert.equal(r.acceptance?.redGate, 'RED');
  });

  test('REVERTS when the examiner produces a GREEN stub (cannot grade itself an easy exam)', async () => {
    let reverted = false;
    const r = await authorYardstick('dim011', authorCtx({ run: async () => ({ exitCode: 0 }), revert: async () => { reverted = true; } }));
    assert.equal(r.installed, false);
    assert.equal(reverted, true, 'a rejected candidate must be reverted');
  });

  test('refuses to author when there is no Score Ladder (examiner cannot self-set the bar)', async () => {
    let dispatched = false;
    const r = await authorYardstick('d', authorCtx({ hasLadder: false, dispatch: async () => { dispatched = true; return { ranOk: true }; } }));
    assert.equal(r.installed, false);
    assert.equal(dispatched, false, 'must not even dispatch without a grounded bar');
  });

  test('the examiner objective forbids editing production + demands a RED, wired, ungrounded-rejecting test', () => {
    const obj = buildExaminerObjective('dim011', 'the bar', 'src/x.rs');
    assert.match(obj, /NOT[\s\S]*allowed to edit production code/);
    assert.match(obj, /FAIL on the current code/);
    assert.match(obj, /src\/x\.rs/);
  });
});
