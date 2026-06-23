// attribution-gate.ts — deterministic ATTRIBUTION teeth for the engineering frontier.
//
// Council unanimous (Grok + Codex + Claude, 2026-06-23): a demand-grounded 9.0 was guarded only by a
// natural-language instruction to the court judges ("does this demand belong to this dimension?"). That is
// LLM goodwill, not structure — the main inflation risk, because it lets a third-party HOST bug (e.g.
// cline/cline#8797 "MCP hosts ignore server instructions") be laundered into a SERVER-side 9.0 on a dimension
// where DanteForge plays the server role. Partial satisfaction (addressed actor != artifact actor) is an
// 8.5 ceiling, never an autonomous 9.0.
//
// This module is the deterministic gate: classify WHO a demand is addressed to (from the demand text, so the
// builder cannot soften it), compare it to the artifact's actor role, and structurally cap the achievable
// score on mismatch. It generalizes — it catches the NEXT mis-mapped cluster, not just this one.

export type AddressedActor = 'host' | 'server' | 'cli' | 'library' | 'agent' | 'unknown';

/** A demand-grounded score cannot exceed this when the addressed actor != the artifact's actor role. */
export const ATTRIBUTION_MISMATCH_CEILING = 8.5;

// Actor vocabulary. Each demand text is scored per actor; the dominant one (with fault/obligation proximity
// weighting) is the addressed actor — the party that must CHANGE for the requester's need to be met.
const ACTOR_WORDS: Array<[Exclude<AddressedActor, 'unknown'>, RegExp]> = [
  ['host', /\b(hosts?|clients?|consumers?|callers?)\b/gi],
  ['server', /\b(servers?|providers?|backends?|endpoints?)\b/gi],
  ['cli', /\b(clis?|command[- ]?lines?|terminals?|shells?)\b/gi],
  ['library', /\b(library|libraries|sdks?|packages?|modules?|frameworks?)\b/gi],
  ['agent', /\b(agents?|assistants?|llms?)\b/gi],
];

// Words signalling that a nearby actor is the SUBJECT that must change (the one at fault / under obligation).
const FAULT = /\b(ignor\w*|break\w*|broken|fail\w*|should|must|cannot|can.?t|does\s?n.?t|do\s?n.?t|unstable|ephemeral|missing|need\w*|lack\w*|wrong)\b/i;

const FAULT_BONUS = 3;
const PROXIMITY = 40; // chars on each side of an actor word to scan for a fault/obligation word

/**
 * Classify WHO a demand is addressed to, deterministically, from its text. Returns 'unknown' when no actor is
 * clearly dominant (a true tie or no actor words) — unknowns are deferred to the court, never structurally capped.
 */
export function classifyAddressedActor(text: string | undefined | null): AddressedActor {
  if (!text) return 'unknown';
  const scores: Array<[Exclude<AddressedActor, 'unknown'>, number]> = [];
  for (const [actor, re] of ACTOR_WORDS) {
    re.lastIndex = 0;
    let s = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      s += 1;
      const start = Math.max(0, m.index - PROXIMITY);
      const around = text.slice(start, m.index + (m[0]?.length ?? 0) + PROXIMITY);
      if (FAULT.test(around)) s += FAULT_BONUS;
      if (m[0]?.length === 0) re.lastIndex++; // guard against zero-width loops
    }
    if (s > 0) scores.push([actor, s]);
  }
  if (scores.length === 0) return 'unknown';
  scores.sort((a, b) => b[1] - a[1]);
  if (scores.length > 1 && scores[0]![1] === scores[1]![1]) return 'unknown'; // true tie → conservative
  return scores[0]![0];
}

/**
 * Aligned when both actors are known and identical. An 'unknown' on either side aligns (no structural cap — the
 * court still judges it). A server artifact does NOT satisfy a host-addressed demand, and vice versa.
 */
export function attributionAligned(addressed: AddressedActor, artifact: AddressedActor): boolean {
  if (addressed === 'unknown' || artifact === 'unknown') return true;
  return addressed === artifact;
}

/**
 * The structural cap. On a known actor mismatch, the achievable score is hard-capped at 8.5 with a reason — the
 * demand is only PARTIALLY satisfied because the artifact plays a different role than the one the user addressed.
 */
export function attributionCeiling(
  addressed: AddressedActor,
  artifact: AddressedActor,
): { capped: boolean; ceiling: number; reason: string } {
  if (attributionAligned(addressed, artifact)) return { capped: false, ceiling: 9.0, reason: '' };
  return {
    capped: true,
    ceiling: ATTRIBUTION_MISMATCH_CEILING,
    reason: `partial — addressed actor (${addressed}) != artifact actor (${artifact}); demand filed against a different role than the artifact plays`,
  };
}
