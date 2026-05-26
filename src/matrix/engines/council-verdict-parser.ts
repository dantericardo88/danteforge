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

export function parseVerdict(judgeId: CouncilMemberId, rawOutput: string): MemberVerdict {
  const up = rawOutput.toUpperCase();
  const verdict: 'PASS' | 'FAIL' | 'UNCLEAR' =
    up.includes('VERDICT: PASS') ? 'PASS' :
    up.includes('VERDICT: FAIL') ? 'FAIL' : 'UNCLEAR';

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
