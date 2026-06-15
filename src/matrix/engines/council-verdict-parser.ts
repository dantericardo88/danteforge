// Shared verdict parser for all council judge outputs.
// Single source of truth — imported by merge-court, debate, and revision.
// MemberVerdict is defined here and re-exported by council-merge-court.ts.
import type { CouncilMemberId } from './council-scheduler.js';

export interface MemberVerdict {
  judgeId: CouncilMemberId;
  verdict: 'PASS' | 'FAIL' | 'UNCLEAR';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  scoreSuggestion: number | null;
  reason: string;
  blockingConcerns: string[];
  dissentSummary: string;
  rawOutput: string;
}

/**
 * The judge's DECLARED verdict, parsed FAIL-CLOSED (CH grading-integrity #5 + court-audit #7).
 *
 * History: the original `includes('VERDICT: PASS')`-first read flipped reasoning FAILs to PASS (a judge
 * writing "I cannot reach VERDICT: PASS here … VERDICT: FAIL" parsed as PASS). #5 changed it to
 * last-declaration-wins. The court audit then found last-wins ALSO fails open: a genuine `VERDICT: FAIL`
 * followed by any trailing `VERDICT: PASS` — a format-reminder template, a fenced example, or a PASS
 * echoed from a builder-CONTROLLED artifact excerpt (court-audit #8) — parsed as PASS by position alone.
 *
 * Rule, in order: (1) FAIL DOMINATES — a single line-anchored `VERDICT: FAIL` anywhere ⇒ FAIL, so no
 * trailing/planted PASS can ever launder a real FAIL through a 9.0/merge gate; (2) otherwise the last
 * anchored PASS/UNCLEAR wins; (3) no anchored line ⇒ inline fallback, FAIL still dominant; (4) else
 * UNCLEAR. The conservative bias is intentional: a false UNCLEAR costs a re-attempt, a false PASS mints
 * a fake 9.0. Exported single source for both the frontier court and the merge court.
 */
export function declaredVerdict(rawOutput: string): 'PASS' | 'FAIL' | 'UNCLEAR' {
  const lineRe = /^\s*VERDICT:\s*(PASS|FAIL|UNCLEAR)\b/gim;
  const anchored: Array<'PASS' | 'FAIL' | 'UNCLEAR'> = [];
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(rawOutput)) !== null) anchored.push(m[1]!.toUpperCase() as 'PASS' | 'FAIL' | 'UNCLEAR');
  if (anchored.includes('FAIL')) return 'FAIL';            // FAIL dominates — fail closed
  if (anchored.length > 0) return anchored[anchored.length - 1]!; // PASS/UNCLEAR: last declaration wins
  // No line-anchored declaration → inline fallback (still FAIL-dominant), else UNCLEAR.
  const inline = [...rawOutput.matchAll(/VERDICT:\s*(PASS|FAIL|UNCLEAR)\b/gi)].map(x => x[1]!.toUpperCase() as 'PASS' | 'FAIL' | 'UNCLEAR');
  if (inline.includes('FAIL')) return 'FAIL';
  return inline.length > 0 ? inline[inline.length - 1]! : 'UNCLEAR';
}

export function parseVerdict(judgeId: CouncilMemberId, rawOutput: string): MemberVerdict {
  const up = rawOutput.toUpperCase();
  const verdict: 'PASS' | 'FAIL' | 'UNCLEAR' = declaredVerdict(rawOutput);

  const confidence: 'HIGH' | 'MEDIUM' | 'LOW' =
    up.includes('CONFIDENCE: HIGH') ? 'HIGH' :
    up.includes('CONFIDENCE: MEDIUM') ? 'MEDIUM' : 'LOW';

  const scoreMatch = rawOutput.match(/SCORE_SUGGESTION:\s*([\d.]+)/i);
  const scoreSuggestion = scoreMatch ? parseFloat(scoreMatch[1]!) : null;

  const reasonMatch = rawOutput.match(/REASON:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
  const reason = reasonMatch ? reasonMatch[1]!.trim().slice(0, 300) : rawOutput.slice(0, 200);

  const concernsMatch = rawOutput.match(/BLOCKING_CONCERNS:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
  const blockingConcerns = concernsMatch && concernsMatch[1]!.trim().toLowerCase() !== 'none'
    ? concernsMatch[1]!.trim().split('\n').map(l => l.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
    : [];

  const dissentMatch = rawOutput.match(/DISSENT:\s*(.+?)(?=\n[A-Z_]+:|$)/is);
  const dissentSummary = dissentMatch && dissentMatch[1]!.trim().toLowerCase() !== 'none'
    ? dissentMatch[1]!.trim().slice(0, 300)
    : '';

  return { judgeId, verdict, confidence, scoreSuggestion, reason, blockingConcerns, dissentSummary, rawOutput };
}
