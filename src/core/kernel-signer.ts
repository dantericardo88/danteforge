// kernel-signer.ts — CH-045: the SEAM where the autonomy trust root can move OUT of the optimizer's blast
// radius. This is the one engineering move that advances an IRREDUCIBLE wall rather than the backlog.
//
// THE PROBLEM (council, pillar II — the self-verification anchor): a system cannot be the final authority
// that its own verdict is untampered. Today the kernel secret (~/.danteforge/kernel-secret) is
// filesystem-readable IN-PROCESS, so an agent that can read kernelSecret() can forge any trust claim —
// verified_live, ratified_by, or a passing receipt. The "external" anchor sits INSIDE the system it is
// meant to anchor; forgery is merely raised from a one-field edit to read-secret+HMAC, not made impossible.
//
// THE SEAM: all kernel-secret signing is routed through a KernelSigner. The default LocalHmacSigner keeps
// today's exact behavior (HMAC-SHA256 over the FS secret). But a hardware signer (HSM/TEE), a remote
// attestation service, or a multi-party quorum — anything implementing this interface — can be installed via
// setKernelSigner(), and such a signer NEVER exposes the key to the optimizer's address space. The
// externality of the anchor is irreducible; the HUMANITY of it is not — you end up trusting an HSM vendor or
// a CA instead of yourself. Building the seam is the prerequisite; installing an external signer is the
// operator's trust-provider decision. Until an external signer is installed, pillar II is honest about its
// own limit: LocalHmacSigner.id === 'local-hmac' (in-blast-radius), so provenance never overclaims.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { kernelSecret } from './frontier-spec.js';

export interface KernelSigner {
  /** Short id of the signing authority (provenance: which root actually signed — e.g. 'local-hmac', 'hsm'). */
  readonly id: string;
  /** Sign content → hex signature. */
  sign(content: string): string;
  /** Verify content against a signature (constant-time). */
  verify(content: string, sig: string): boolean;
}

/** Default LOCAL signer: HMAC-SHA256 over the FS-readable kernel secret. This is the residue CH-045 names —
 *  in the optimizer's blast radius. Swap it (setKernelSigner) for an external signer to move the root out. */
export class LocalHmacSigner implements KernelSigner {
  readonly id = 'local-hmac';
  sign(content: string): string {
    return createHmac('sha256', kernelSecret()).update(content).digest('hex');
  }
  verify(content: string, sig: string): boolean {
    if (typeof sig !== 'string' || sig.length === 0) return false;
    const expected = this.sign(content);
    if (sig.length !== expected.length) return false; // timingSafeEqual requires equal length
    try { return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')); } catch { return false; }
  }
}

let active: KernelSigner = new LocalHmacSigner();

/** The active signing authority. Evidence signers (CH-025 / CH-030) route through this so the trust root is
 *  pluggable rather than hardcoded to the in-process secret. */
export function getKernelSigner(): KernelSigner { return active; }

/** The active signer's provenance. `external` is FALSE for the in-blast-radius LocalHmacSigner — so a
 *  court-validated frontier 9 signed by a non-external root is SELF-SIGNED (the scoring↔grading loop converging
 *  on itself, not proven ground truth). It becomes TRUE only once an out-of-blast-radius signer is installed via
 *  setKernelSigner (CH-045 — the operator's trust-provider decision). Provenance must never overclaim. */
export function kernelSignerProvenance(): { id: string; external: boolean } {
  return { id: active.id, external: active.id !== 'local-hmac' };
}

/** Install a different signing authority — the CH-045 slot-in point. An HSM / remote attester / quorum that
 *  holds the key outside the optimizer moves the trust root out of the blast radius. Also used by tests. */
export function setKernelSigner(signer: KernelSigner): void { active = signer; }

/** Reset to the local default (test teardown). */
export function resetKernelSigner(): void { active = new LocalHmacSigner(); }
