// harvested-signal-signer.ts — CH-030: make a harvested signal's TRUST claims forgery-resistant.
//
// harvested-bar.ts's posture gate trusts two fields on a HarvestedSignal: `verified_live` (a benchmark
// number was re-fetched and matched) and `ratified_by` (a human approved a subjective bar). Without a
// signature, an agent could simply WRITE those true and clear the gate. This signs a signal with an
// HMAC over its full factual content (the same out-of-repo kernel secret + pattern as CH-025's
// outcome-evidence-signer, so there is one signing authority), committing to verified_live + ratified_by:
// flipping either without re-signing (which needs the secret) invalidates the signature.
//
// Enforcement is gated behind DANTEFORGE_REQUIRE_SIGNED_EVIDENCE (the SAME switch as CH-025) so the
// posture gate's signature requirement flips on in lockstep with outcome-evidence enforcement, not
// before. Same single-machine caveat as CH-025: an agent with FS read CAN read the secret; the signature
// still raises forgery from a one-field edit to "read a non-obvious secret + compute an HMAC", and blocks
// committed / cross-machine forgeries — the seam a hardware/remote signer slots into.

import { createHmac } from 'node:crypto';
import { kernelSecret } from './frontier-spec.js';
import type { HarvestedSignal } from './harvested-bar.js';

/** `sig` cannot sign over itself; everything else is factual content the signature commits to. */
const UNSIGNED_FIELDS = new Set(['sig']);

/** Deterministic serialization of a signal's factual content (sorted keys, `sig` dropped). */
function canonicalContent(sig: HarvestedSignal): string {
  const s = sig as unknown as Record<string, unknown>;
  const obj: Record<string, unknown> = {};
  for (const k of Object.keys(s).filter(k => !UNSIGNED_FIELDS.has(k)).sort()) obj[k] = s[k];
  return JSON.stringify(obj);
}

/** HMAC-SHA256 over the signal's factual content, keyed by the kernel secret. */
export function signHarvestedSignal(signal: HarvestedSignal): string {
  return createHmac('sha256', kernelSecret()).update(canonicalContent(signal)).digest('hex');
}

/** Return a copy of the signal carrying a fresh signature over its current content. */
export function signedHarvestedSignal(signal: HarvestedSignal): HarvestedSignal {
  return { ...signal, sig: signHarvestedSignal(signal) };
}

/** True iff the signal carries a present signature that matches its current content. */
export function verifyHarvestedSignalSignature(signal: HarvestedSignal): boolean {
  const sig = signal.sig;
  if (typeof sig !== 'string' || sig.length === 0) return false;
  return sig === signHarvestedSignal(signal);
}
