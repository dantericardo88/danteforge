// outcome-evidence-signer.ts — CH-025: make a derived score a read-only projection of SIGNED receipts.
//
// The scorer reads OutcomeEvidenceEntry receipts off disk and derives the dimension score from them.
// Without a signature, anyone (a worker, a hand-edit) could author a passing receipt and forge the
// factual basis of a 9.0. This signs every receipt the runner writes with an HMAC over its factual
// content, keyed by the out-of-repo kernel secret (~/.danteforge/kernel-secret — the SAME secret the
// frontier-review court uses, so there is one signing authority). loadOutcomeEvidence verifies on
// read: a receipt whose signature does not match its content was edited after signing and is dropped.
//
// What it closes today (always on): a receipt carrying a sig that no longer matches its content is
// rejected — the naive "flip passed:false→true" / "bump the tier" edit. Full closure (reject any
// UNSIGNED receipt too) is gated behind DANTEFORGE_REQUIRE_SIGNED_EVIDENCE so the existing corpus can
// be migrated (scripts/sign-outcome-evidence.mjs) before enforcement flips — rejecting unsigned by
// default would collapse the live matrix's derived scores to 0.

import { createHmac } from 'node:crypto';
import { kernelSecret } from './frontier-spec.js';
import type { OutcomeEvidenceEntry } from '../matrix/types/outcome.js';

// Fields EXCLUDED from the signed content:
//  - `sig`          — cannot sign over itself.
//  - `evidencePath` — the absolute on-disk location (carries cwd); it is a pointer, not a factual
//                     claim, and signing it would make receipts non-portable across cwd/machine.
const UNSIGNED_FIELDS = new Set(['sig', 'evidencePath']);

/** Deterministic serialization of the receipt's factual content (sorted keys, excluded fields dropped). */
function canonicalContent(entry: OutcomeEvidenceEntry): string {
  const e = entry as unknown as Record<string, unknown>;
  const obj: Record<string, unknown> = {};
  for (const k of Object.keys(e).filter(k => !UNSIGNED_FIELDS.has(k)).sort()) obj[k] = e[k];
  return JSON.stringify(obj);
}

/** HMAC-SHA256 over the receipt's factual content, keyed by the kernel secret. */
export function signOutcomeEvidence(entry: OutcomeEvidenceEntry): string {
  return createHmac('sha256', kernelSecret()).update(canonicalContent(entry)).digest('hex');
}

/** True iff the receipt carries a present signature that matches its current content. */
export function verifyOutcomeEvidenceSignature(entry: OutcomeEvidenceEntry): boolean {
  const sig = (entry as { sig?: unknown }).sig;
  if (typeof sig !== 'string' || sig.length === 0) return false;
  return sig === signOutcomeEvidence(entry);
}
