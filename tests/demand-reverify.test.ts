import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyDemandLive, parseIssueUrl } from '../src/core/demand-reverify.js';
import type { HarvestedSignal } from '../src/core/harvested-bar.js';
import { verifyHarvestedSignalSignature } from '../src/core/harvested-signal-signer.js';

function demand(source = 'https://github.com/cline/cline/issues/8087'): HarvestedSignal {
  return { kind: 'demand', source, fetched_at: '2026-06-23T00:00:00Z', claim: 'users want stable server tool ids' };
}

test('verifyDemandLive: a CONFIRMED re-fetch stamps verified_live + a VALID fresh signature', async () => {
  const out = await verifyDemandLive(demand(), async () => ({ live: true, count: 12 }));
  assert.equal(out.verified_live, true);
  assert.ok(out.sig, 'signal is signed');
  assert.equal(verifyHarvestedSignalSignature(out), true, 'the fresh signature verifies');
});

test('verifyDemandLive: an UNCONFIRMED re-fetch leaves the bar blocked (no verified_live)', async () => {
  const out = await verifyDemandLive(demand(), async () => ({ live: false }));
  assert.notEqual(out.verified_live, true);
});

test('verifyDemandLive: non-demand signals pass through untouched', async () => {
  const bench: HarvestedSignal = { kind: 'benchmark', source: 'x', fetched_at: '2026-06-23T00:00:00Z', claim: 'y' };
  const out = await verifyDemandLive(bench, async () => ({ live: true }));
  assert.equal(out, bench);
});

test('verifyDemandLive cannot be self-asserted: the refetcher decides, not the signal', async () => {
  // even if the input already claims verified_live, a NEGATIVE re-fetch must not produce a signed verified_live
  const lying = { ...demand(), verified_live: true } as HarvestedSignal;
  const out = await verifyDemandLive(lying, async () => ({ live: false }));
  assert.equal(out.sig, undefined, 'no fresh signature is minted when the world does not confirm it');
});

test('parseIssueUrl handles GitHub HTML and API issue URLs', () => {
  assert.deepEqual(parseIssueUrl('https://github.com/cline/cline/issues/8087'), { owner: 'cline', repo: 'cline', number: '8087' });
  assert.deepEqual(parseIssueUrl('https://api.github.com/repos/o/r/issues/42'), { owner: 'o', repo: 'r', number: '42' });
  assert.equal(parseIssueUrl('not a url'), null);
});
