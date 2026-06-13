import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  writeCeilingReceipt, loadCeilingReceipt, loadAllCeilingReceipts,
  isCeilingActive, isDimComplete, shouldReopenForEngine, type CeilingReceipt,
} from '../src/core/ceiling-receipt.js';

function receipt(over: Partial<CeilingReceipt> = {}): CeilingReceipt {
  return {
    dimId: 'enterprise_readiness', cap: 5.0, cause: 'market-cap',
    detail: 'market dim — pre-release cannot reach 9', failedGates: ['market-cap'],
    recordedAt: '2026-06-03T00:00:00.000Z', ...over,
  };
}

describe('ceiling-receipt — honest-ceiling records', () => {
  test('write/load round-trip (seamed io)', async () => {
    const store = new Map<string, string>();
    const write = async (p: string, c: string) => { store.set(p, c); };
    const read = async (p: string) => { const v = store.get(p); if (v === undefined) throw new Error('nf'); return v; };
    await writeCeilingReceipt('/tmp/fake', receipt(), write);
    const loaded = await loadCeilingReceipt('/tmp/fake', 'enterprise_readiness', read);
    assert.equal(loaded?.cause, 'market-cap');
    assert.equal(loaded?.cap, 5.0);
  });

  test('isCeilingActive: permanent ceiling (no reviewAfter) is always active', () => {
    assert.equal(isCeilingActive(receipt(), '2030-01-01T00:00:00.000Z'), true);
  });

  test('isCeilingActive: env ceiling is active before reviewAfter, expired after', () => {
    const env = receipt({ cause: 'environment', reviewAfter: '2026-07-01T00:00:00.000Z' });
    assert.equal(isCeilingActive(env, '2026-06-15T00:00:00.000Z'), true, 'before reviewAfter → active');
    assert.equal(isCeilingActive(env, '2026-08-01T00:00:00.000Z'), false, 'after reviewAfter → re-attempt');
  });

  test('isDimComplete: at-frontier OR active ceiling counts as done; expired env ceiling does NOT', () => {
    const now = '2026-08-01T00:00:00.000Z';
    assert.equal(isDimComplete(true, null, now), true, 'frontier reached → done');
    assert.equal(isDimComplete(false, receipt(), now), true, 'market cap (permanent) → done');
    const expiredEnv = receipt({ cause: 'environment', reviewAfter: '2026-07-01T00:00:00.000Z' });
    assert.equal(isDimComplete(false, expiredEnv, now), false, 'expired env ceiling → re-attempt, not done');
    assert.equal(isDimComplete(false, null, now), false, 'no frontier, no ceiling → not done');
  });

  test('shouldReopenForEngine: engine-bound ceilings re-open on engine change; world/spec ceilings do not (CH-018)', () => {
    // generator-ceiling minted by engine ABC; current engine is XYZ → the generator changed → re-open.
    const gen = receipt({ cause: 'generator-ceiling', engineSha: 'ABC123' });
    assert.equal(shouldReopenForEngine(gen, 'XYZ789'), true, 'engine changed → re-open the generator ceiling');
    assert.equal(shouldReopenForEngine(gen, 'ABC123'), false, 'same engine → still in force');
    // build-failed + court-rejected are also engine-bound.
    assert.equal(shouldReopenForEngine(receipt({ cause: 'build-failed', engineSha: 'ABC123' }), 'XYZ789'), true);
    assert.equal(shouldReopenForEngine(receipt({ cause: 'court-rejected', engineSha: 'ABC123' }), 'XYZ789'), true);
    // market-cap / spec-incomplete / environment / r-and-d are about the WORLD or SPEC, not the engine.
    assert.equal(shouldReopenForEngine(receipt({ cause: 'market-cap', engineSha: 'ABC123' }), 'XYZ789'), false);
    assert.equal(shouldReopenForEngine(receipt({ cause: 'spec-incomplete', engineSha: 'ABC123' }), 'XYZ789'), false);
    assert.equal(shouldReopenForEngine(receipt({ cause: 'environment', engineSha: 'ABC123' }), 'XYZ789'), false);
    // Legacy receipts (no engineSha) or unknown current SHA → never re-open on absent provenance.
    assert.equal(shouldReopenForEngine(receipt({ cause: 'generator-ceiling' }), 'XYZ789'), false, 'no minting SHA → held');
    assert.equal(shouldReopenForEngine(gen, null), false, 'unknown current engine → held');
  });

  test('loadAll reads every receipt in the dir', async () => {
    const store = new Map<string, string>();
    const write = async (p: string, c: string) => { store.set(p, c); };
    await writeCeilingReceipt('/tmp/fake', receipt({ dimId: 'a' }), write);
    await writeCeilingReceipt('/tmp/fake', receipt({ dimId: 'b', cause: 'r-and-d-gap' }), write);
    const readdir = async () => ['a.json', 'b.json', 'notes.txt'];
    const read = async (p: string) => { const v = store.get(p); if (v === undefined) throw new Error('nf'); return v; };
    const all = await loadAllCeilingReceipts('/tmp/fake', readdir, read);
    assert.equal(all.length, 2);
    assert.deepEqual(all.map(r => r.dimId).sort(), ['a', 'b']);
  });
});
