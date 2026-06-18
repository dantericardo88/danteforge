import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LocalHmacSigner, getKernelSigner, setKernelSigner, resetKernelSigner, type KernelSigner } from '../src/core/kernel-signer.ts';
import { signedHarvestedSignal, verifyHarvestedSignalSignature } from '../src/core/harvested-signal-signer.ts';
import type { HarvestedSignal } from '../src/core/harvested-bar.ts';

const bench = (): HarvestedSignal => ({
  kind: 'benchmark', source: 'https://swebench.com', fetched_at: '2026-06-17T00:00:00Z',
  claim: 'top', suite: 'swe-bench-live', numeric: 0.46, verified_live: true,
});

test('LocalHmacSigner: deterministic sign; verify accepts valid, rejects tampered/empty/wrong-length', () => {
  const s = new LocalHmacSigner();
  const sig = s.sign('hello');
  assert.equal(s.sign('hello'), sig);
  assert.ok(s.verify('hello', sig));
  assert.ok(!s.verify('hello!', sig));       // content changed
  assert.ok(!s.verify('hello', ''));         // empty sig
  assert.ok(!s.verify('hello', sig + 'ab')); // wrong length (timingSafeEqual guard)
  assert.ok(!s.verify('hello', 'zz'));
});

test('default signer is the in-blast-radius local HMAC; provenance does not overclaim', () => {
  assert.equal(getKernelSigner().id, 'local-hmac'); // honest: until an external signer is installed, it is local
});

test('BEHAVIOR UNCHANGED: existing signatures still verify under the default seam (no regression)', () => {
  const signed = signedHarvestedSignal(bench());
  assert.ok(verifyHarvestedSignalSignature(signed)); // round-trips exactly as before the seam
  assert.ok(!verifyHarvestedSignalSignature({ ...signed, verified_live: false, numeric: 9.9 }));
});

test('CH-045: an EXTERNAL signer genuinely swaps the trust root (the seam routes through it)', () => {
  // a fake "remote/HSM" signer that does NOT touch the kernel secret — the point of CH-045
  let signsByExternal = 0;
  const external: KernelSigner = {
    id: 'fake-hsm',
    sign: (c) => { signsByExternal++; return `hsm:${Buffer.from(c).length}`; },
    verify: (c, sig) => sig === `hsm:${Buffer.from(c).length}`,
  };
  try {
    setKernelSigner(external);
    assert.equal(getKernelSigner().id, 'fake-hsm');
    const signed = signedHarvestedSignal(bench());        // routes through the external signer
    assert.ok(signed.sig!.startsWith('hsm:'), 'signature came from the external authority, not the local HMAC');
    assert.ok(signsByExternal > 0, 'the kernel secret was NOT used — the trust root moved out of the optimizer');
    assert.ok(verifyHarvestedSignalSignature(signed));    // verify also routes through it
  } finally {
    resetKernelSigner();
  }
  assert.equal(getKernelSigner().id, 'local-hmac'); // reset restores the default
});
