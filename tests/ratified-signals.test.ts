import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ratificationKey, isRatificationCandidate, ratifySignal, applyRatifications,
  loadRatifiedSignals, saveRatifiedSignal,
} from '../src/core/ratified-signals.ts';
import { verifyHarvestedSignalSignature } from '../src/core/harvested-signal-signer.ts';
import type { HarvestedSignal } from '../src/core/harvested-bar.ts';

const cap = (o: Partial<HarvestedSignal> = {}): HarvestedSignal => ({
  kind: 'capability', source: 'https://aider.chat/docs', fetched_at: '2026-06-17T00:00:00Z', claim: 'repo-aware edits', ...o,
});
const bench = (o: Partial<HarvestedSignal> = {}): HarvestedSignal => ({
  kind: 'benchmark', source: 'https://swebench.com', fetched_at: '2026-06-17T00:00:00Z', claim: 'top', suite: 'swe-bench-live', numeric: 0.46, verified_live: true, ...o,
});

test('isRatificationCandidate: subjective unratified = yes; benchmark = no; already-ratified = no', () => {
  assert.ok(isRatificationCandidate(cap()));
  assert.ok(isRatificationCandidate(cap({ kind: 'demand' })));
  assert.ok(!isRatificationCandidate(bench()));              // benchmarks auto-accept, never ratified
  assert.ok(!isRatificationCandidate(cap({ ratified_by: 'op' }))); // already ratified
});

test('ratifySignal stamps ratified_by + a VALID signature (commits to ratified_by); requires an operator', () => {
  const r = ratifySignal(cap(), 'richard');
  assert.equal(r.ratified_by, 'richard');
  assert.ok(verifyHarvestedSignalSignature(r));
  // flipping ratified_by after signing invalidates it — cannot self-vouch without re-signing (kernel secret)
  assert.ok(!verifyHarvestedSignalSignature({ ...r, ratified_by: 'someone-else' }));
  assert.throws(() => ratifySignal(cap(), '  '), /operator id required/);
});

test('applyRatifications replaces a matching signal with the SIGNED ratified version (gate then sees it)', () => {
  const fresh = [cap(), bench()]; // freshly harvested — capability has no ratified_by
  const store = [ratifySignal(cap(), 'richard')];
  const out = applyRatifications(fresh, store);
  assert.equal(out[0]!.ratified_by, 'richard', 'the capability bar is now ratified');
  assert.ok(verifyHarvestedSignalSignature(out[0]!));
  assert.equal(out[1]!.ratified_by, undefined, 'the benchmark is untouched (auto-accepts on its own)');
});

test('applyRatifications IGNORES a tampered/invalid ratification (never trusts forgery)', () => {
  const forged = { ...cap(), ratified_by: 'attacker', sig: 'deadbeef' }; // not a real signature
  const out = applyRatifications([cap()], [forged]);
  assert.equal(out[0]!.ratified_by, undefined, 'an unsigned/forged ratification does not take effect');
});

test('store round-trip: save a ratified signal, load it back, apply it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ratified-'));
  try {
    assert.deepEqual(await loadRatifiedSignals(dir), []); // none yet
    await saveRatifiedSignal(dir, ratifySignal(cap(), 'richard'));
    const loaded = await loadRatifiedSignals(dir);
    assert.equal(loaded.length, 1);
    assert.ok(verifyHarvestedSignalSignature(loaded[0]!));
    // saving the SAME identity replaces (append-only by identity, no dupes)
    await saveRatifiedSignal(dir, ratifySignal(cap({ claim: 'repo-aware edits' }), 'richard2'));
    assert.equal((await loadRatifiedSignals(dir)).length, 1);
    assert.equal((await loadRatifiedSignals(dir))[0]!.ratified_by, 'richard2');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('saveRatifiedSignal refuses an unratified/unsigned signal (store integrity)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ratified-'));
  try {
    await assert.rejects(() => saveRatifiedSignal(dir, cap()), /not ratified \+ validly signed/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
