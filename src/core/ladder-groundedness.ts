// ladder-groundedness.ts — Phase 2.3: the yardstick's rungs must be GROUNDED, not LLM prose.
//
// A Score Ladder rung above the grounding threshold defines "what a >7 looks like" for a dimension. Today
// it's free-form text validated only by "≥2 source links exist somewhere in the file" (checkSourcesTable).
// That lets an agent soften the bar into prose. This module checks that each high rung carries an explicit
// evidence-quality tag (EXTRACTED / INFERRED / AMBIGUOUS — the confidence-tagging doctrine) and, for the
// strongest claims, a cited source — so the bar traces to harvested external facts, not invention.
//
// Pure + additive: it reads the rungs `parseScoreLadder` already produces ({score, descriptor}); it does
// NOT change that function's type (no ripple to its many consumers). The universe verifier calls it, gated
// behind DANTEFORGE_GROUNDING_GATE so existing flows are unaffected until grounding is turned on.

export type RungConfidence = 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS' | 'UNTAGGED';

export interface RungEvidence {
  confidence: RungConfidence;
  citations: string[];
}

/** Parse the evidence-quality tag + any cited URLs out of a rung descriptor. The tag is the first of
 *  EXTRACTED/INFERRED/AMBIGUOUS that appears; absence is UNTAGGED. */
export function parseRungEvidence(descriptor: string): RungEvidence {
  const m = /\b(EXTRACTED|INFERRED|AMBIGUOUS)\b/.exec(descriptor);
  const confidence = (m?.[1] as RungConfidence | undefined) ?? 'UNTAGGED';
  const citations = [...descriptor.matchAll(/https?:\/\/[^\s)\]]+/g)].map(x => x[0]);
  return { confidence, citations };
}

export interface GroundednessOptions {
  /** Only rungs strictly above this score must be grounded (≤ it are floors / table stakes). */
  threshold?: number;
}

export interface GroundednessResult {
  ok: boolean;
  issues: string[];
}

/**
 * Check that every ladder rung above the threshold is grounded in cited external evidence:
 *  - UNTAGGED  → fail (a >threshold rung must declare its evidence quality)
 *  - AMBIGUOUS → fail (uncertain claims can't define the frontier bar; cite or demote)
 *  - EXTRACTED → must carry ≥1 cited URL (an extracted fact needs its source)
 *  - INFERRED  → allowed (a reasoned deduction), but flagged as a warning-grade issue if uncited
 * Returns ok=true when no rung above the threshold is ungrounded. Empty ladders pass (a separate
 * missing-ladder gate handles "no ladder at all").
 */
export function checkLadderGroundedness(
  rungs: Array<{ score: number; descriptor: string }>,
  opts: GroundednessOptions = {},
): GroundednessResult {
  const threshold = opts.threshold ?? 7.0;
  const issues: string[] = [];
  for (const r of rungs) {
    if (r.score <= threshold) continue;
    const ev = parseRungEvidence(r.descriptor);
    if (ev.confidence === 'UNTAGGED') {
      issues.push(`Score ${r.score} rung is UNGROUNDED — no evidence-quality tag. A >${threshold} rung must mark its claim EXTRACTED (cited fact), INFERRED (reasoned), or AMBIGUOUS (research needed).`);
    } else if (ev.confidence === 'AMBIGUOUS') {
      issues.push(`Score ${r.score} rung is AMBIGUOUS — an uncertain claim cannot define the frontier bar. Provide EXTRACTED evidence (a cited competitor capability or demand signal) or demote the rung.`);
    } else if (ev.confidence === 'EXTRACTED' && ev.citations.length === 0) {
      issues.push(`Score ${r.score} rung is tagged EXTRACTED but cites no URL — an extracted fact must link its source.`);
    } else if (ev.confidence === 'INFERRED' && ev.citations.length === 0) {
      issues.push(`Score ${r.score} rung is INFERRED with no cited basis — link the code/docs it was inferred from, or mark it AMBIGUOUS.`);
    }
  }
  return { ok: issues.length === 0, issues };
}
