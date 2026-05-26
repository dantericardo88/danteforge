// Matrix Kernel — CouncilConsensus
//
// K-of-M weighted voting aggregator for the Hierarchical Multi-Agent Council.
// Cross-member votes weight 1.0; same-member votes weight 0.5 (safety net only).
// Requires minJudges and at least 1 cross-member PASS for a PASS verdict.
import type { CouncilMemberId } from './council-scheduler.js';

export interface WeightedVote {
  judgeSlotId: string;
  judgeMemberId: CouncilMemberId;
  builderMemberId: CouncilMemberId;
  verdict: 'PASS' | 'FAIL' | 'UNCLEAR';
  weight: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  dissentSummary?: string;
}

export interface ConsensusResult {
  verdict: 'PASS' | 'FAIL' | 'INSUFFICIENT' | 'SPLIT';
  weightedScore: number;
  totalWeight: number;
  minJudgesMet: boolean;
  crossMemberJudges: number;
  dissentLog: string[];
  summary: string;
}

export interface ConsensusOptions {
  minJudges: number;
  passFraction?: number;
}

/**
 * Assign vote weight based on member independence.
 * Cross-member judge = 1.0 (independent perspective).
 * Same-member judge = 0.5 (structural conflict of interest, allowed as safety net only).
 */
export function assignVoteWeight(
  judgeMemberId: CouncilMemberId,
  builderMemberId: CouncilMemberId,
): number {
  return judgeMemberId === builderMemberId ? 0.5 : 1.0;
}

/**
 * Aggregate weighted votes into a consensus verdict.
 *
 * Verdict rules (in order):
 *   INSUFFICIENT — fewer votes than minJudges
 *   PASS         — weightedScore >= passFraction AND at least 1 cross-member PASS
 *   FAIL         — weightedScore < passFraction
 *   SPLIT        — exact tie → treated as FAIL (conservative)
 *
 * UNCLEAR votes contribute to totalWeight but not to either PASS or FAIL mass.
 */
export function computeConsensus(
  votes: WeightedVote[],
  opts: ConsensusOptions,
): ConsensusResult {
  const passFraction = opts.passFraction ?? 0.5;
  const minJudgesMet = votes.length >= opts.minJudges;

  const dissentLog = votes
    .filter(v => v.dissentSummary)
    .map(v => `[${v.judgeSlotId}] ${v.dissentSummary}`);

  if (!minJudgesMet) {
    return {
      verdict: 'INSUFFICIENT',
      weightedScore: 0,
      totalWeight: 0,
      minJudgesMet: false,
      crossMemberJudges: 0,
      dissentLog,
      summary: `Insufficient judges: ${votes.length}/${opts.minJudges} required`,
    };
  }

  let passWeight = 0;
  let failWeight = 0;
  let totalWeight = 0;
  let crossMemberJudges = 0;

  for (const v of votes) {
    totalWeight += v.weight;
    if (v.verdict === 'PASS') {
      passWeight += v.weight;
      if (v.judgeMemberId !== v.builderMemberId) crossMemberJudges++;
    } else if (v.verdict === 'FAIL') {
      failWeight += v.weight;
    }
    // UNCLEAR: counted in totalWeight but not pass/fail mass
  }

  const weightedScore = totalWeight > 0 ? passWeight / totalWeight : 0;

  // Guard: if a majority of judges abstained (UNCLEAR), treat as FAIL rather than
  // letting a single PASS vote produce a deceptively high weightedScore.
  const unclearCount = votes.filter(v => v.verdict === 'UNCLEAR').length;
  if (unclearCount * 2 >= votes.length) {
    return {
      verdict: 'FAIL',
      weightedScore: 0,
      totalWeight,
      minJudgesMet: true,
      crossMemberJudges,
      dissentLog,
      summary: `UNCLEAR-dominant: ${unclearCount}/${votes.length} judges abstained — treating as FAIL`,
    };
  }

  let verdict: ConsensusResult['verdict'];
  if (passWeight > failWeight && weightedScore >= passFraction && crossMemberJudges >= 1) {
    verdict = 'PASS';
  } else if (failWeight > passWeight) {
    verdict = 'FAIL';
  } else if (Math.abs(passWeight - failWeight) < 0.001) {
    verdict = 'SPLIT';
  } else {
    // Pass weight > fail but no cross-member PASS: treat as FAIL
    verdict = 'FAIL';
  }

  const summary = [
    `${verdict}: ${(weightedScore * 100).toFixed(0)}% weighted pass`,
    `(${votes.length} judge(s), ${crossMemberJudges} cross-member)`,
  ].join(' ');

  return { verdict, weightedScore, totalWeight, minJudgesMet, crossMemberJudges, dissentLog, summary };
}
