import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontierTrustLabel } from '../src/core/score-bands.js';
import { kernelSignerProvenance, setKernelSigner, resetKernelSigner, LocalHmacSigner, type KernelSigner } from '../src/core/kernel-signer.js';

test('frontierTrustLabel: BUILD scores (<8.5) carry no trust claim', () => {
  assert.equal(frontierTrustLabel(8.0, false), '');
  assert.equal(frontierTrustLabel(7.0, true), '');
});

test('frontierTrustLabel: a frontier 9 with a NON-external signer is SELF-SIGNED, not ground truth', () => {
  const l = frontierTrustLabel(9.0, false);
  assert.match(l, /SELF-SIGNED/);
  assert.match(l, /not proven ground truth|convergence/i);
});

test('frontierTrustLabel: a frontier 9 with an EXTERNAL signer is externally anchored', () => {
  assert.match(frontierTrustLabel(9.0, true), /externally anchored/);
});

test('kernelSignerProvenance: the default local-hmac signer is in-blast-radius (external=false)', () => {
  resetKernelSigner();
  const p = kernelSignerProvenance();
  assert.equal(p.id, 'local-hmac');
  assert.equal(p.external, false);
});

test('kernelSignerProvenance: an installed out-of-blast-radius signer reports external=true', () => {
  const ext = Object.create(new LocalHmacSigner());          // inherits sign/verify
  Object.defineProperty(ext, 'id', { value: 'hsm-vendor' }); // a non-local-hmac trust root
  setKernelSigner(ext as KernelSigner);
  assert.equal(kernelSignerProvenance().external, true);
  resetKernelSigner();                                        // teardown
});
