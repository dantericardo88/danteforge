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
 * The judge's DECLARED verdict — the LAST line-anchored `VERDICT: X` declaration (CH grading-integrity
 * #5). The old `includes('VERDICT: PASS')`-first read flipped reasoning FAILs to PASS: a judge that
 * wrote "I cannot reach VERDICT: PASS here … VERDICT: FAIL" parsed as PASS because the PASS substring
 * appeared first. Reasoning models routinely echo rubric tokens, so first-substring-wins inflated every
 * council verdict path. We take the FINAL line-anchored declaration (the template's closing verdict
 * line); fall back to the last inline mention; else UNCLEAR. Exported single source for both parsers.
 */
export function declaredVerdict(rawOutput: string): 'PASS' | 'FAIL' | 'UNCLEAR' {
  const lineRe = /^\s*VERDICT:\s*(PASS|FAIL|UNCLEAR)\b/gim;
  let m: RegExpExecArray | null;
  let last: 'PASS' | 'FAIL' | 'UNCLEAR' | null = null;
  while ((m = lineRe.exec(rawOutput)) !== null) last = m[1]!.toUpperCase() as 'PASS' | 'FAIL' | 'UNCLEAR';
  if (last) return last;
  // No line-anchored declaration → last inline mention (still better than first-wins), else UNCLEAR.
  const inline = [...rawOutput.matchAll(/VERDICT:\s*(PASS|FAIL|UNCLEAR)\b/gi)];
  return inline.length > 0 ? inline[inline.length - 1]![1]!.toUpperCase() as 'PASS' | 'FAIL' | 'UNCLEAR' : 'UNCLEAR';
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
