import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  fingerprintHash, isNovelAttempt, recordAttempt, loadAttemptLedger,
  type AttemptFingerprint, type AttemptRecord,
} from '../src/core/evidence-novelty.js';

function fp(over: Partial<AttemptFingerprint> = {}): AttemptFingerprint {
  return { dimId: 'planning', command: 'node dist/index.js plan', artifactPath: 'out/plan.md', gitSha: 'abc123', ...over };
}

describe('evidence-novelty — anti-manufacture ledger', () => {
  test('identical fingerprints hash equal; any field change differs', () => {
    assert.equal(fingerprintHash(fp()), fingerprintHash(fp()));
    assert.notEqual(fingerprintHash(fp()), fingerprintHash(fp({ gitSha: 'def456' })));
    assert.notEqual(fingerprintHash(fp()), fingerprintHash(fp({ command: 'node dist/index.js plan --v2' })));
    assert.notEqual(fingerprintHash(fp()), fingerprintHash(fp({ artifactPath: 'out/other.md' })));
  });

  test('a brand-new attempt is novel', () => {
    assert.equal(isNovelAttempt([], fp()), true);
  });

  test('re-submitting the SAME (command, artifact, SHA) is NOT novel — cannot create progress', () => {
    const prior: AttemptRecord[] = [{ ...fp(), hash: fingerprintHash(fp()), outcome: 'rejected', recordedAt: 't0' }];
    assert.equal(isNovelAttempt(prior, fp()), false, 'identical retry is blocked');
  });

  test('changing the code (new SHA) makes the retry novel — real work counts', () => {
    const prior: AttemptRecord[] = [{ ...fp(), hash: fingerprintHash(fp()), outcome: 'rejected', recordedAt: 't0' }];
    assert.equal(isNovelAttempt(prior, fp({ gitSha: 'NEWSHA' })), true);
  });

  test('a different dim with the same command is independent', () => {
    const prior: AttemptRecord[] = [{ ...fp(), hash: fingerprintHash(fp()), outcome: 'rejected', recordedAt: 't0' }];
    assert.equal(isNovelAttempt(prior, fp({ dimId: 'performance' })), true);
  });

  test('recordAttempt round-trips through the ledger (seamed io)', async () => {
    let stored = '';
    const io = {
      _read: async () => stored || '[]',
      _write: async (_p: string, c: string) => { stored = c; },
    };
    await recordAttempt('/tmp/fake', fp(), 'rejected', 't1', io);
    const ledger = await loadAttemptLedger('/tmp/fake', io._read);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0]!.outcome, 'rejected');
    assert.equal(ledger[0]!.hash, fingerprintHash(fp()));
    // After recording, the same fingerprint is no longer novel.
    assert.equal(isNovelAttempt(ledger, fp()), false);
  });
});
