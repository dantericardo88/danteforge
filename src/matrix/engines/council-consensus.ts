// Matrix Kernel - CouncilConsensus
//
// N-of-M weighted voting aggregator for the Hierarchical Multi-Agent Council.
// Cross-member votes weight 1.0; same-member votes weight 0.5 (safety net only).
// Requires minJudges independent cross-member judges and at least one
// cross-member PASS for a PASS verdict.
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
  passVotes: number;
  requiredPassVotes: number;
  dissentLog: string[];
  summary: string;
  /** CH-010: a strict majority of judges abstained (UNCLEAR-dominant) — the panel could NOT decide.
   *  Distinct from a merits FAIL; callers treat it as "re-attempt / escalate", not a clean rejection. */
  abstained: boolean;
  /** The agreement/abstention metric: fraction of cast ballots that were UNCLEAR (0..1). */
  abstentionRate: number;
}

export interface ConsensusOptions {
  minJudges: number;
  passFraction?: number;
  /** Required number of PASS ballots among eligible judges. Enables explicit N-of-M voting. */
  minPasses?: number;
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
 *   INSUFFICIENT — fewer cross-member votes than minJudges
 *   PASS         — passVotes >= minPasses, weightedScore >= passFraction,
 *                  and at least 1 cross-member PASS
 *   FAIL         — weightedScore < passFraction or passVotes < minPasses
 *   SPLIT        — exact tie, treated conservatively by callers
 *
 * UNCLEAR votes contribute to totalWeight but not to either PASS or FAIL mass.
 */
export function computeConsensus(
  votes: WeightedVote[],
  opts: ConsensusOptions,
): ConsensusResult {
  const passFraction = opts.passFraction ?? 0.5;
  const requiredPassVotes = opts.minPasses ?? 1;

  const dissentLog = votes
    .filter(v => v.dissentSummary)
    .map(v => `[${v.judgeSlotId}] ${v.dissentSummary}`);

  let passWeight = 0;
  let failWeight = 0;
  let totalWeight = 0;
  let crossMemberJudges = 0;
  let passVotes = 0;
  let crossMemberPasses = 0;

  for (const v of votes) {
    const isCrossMember = v.judgeMemberId !== v.builderMemberId;
    if (isCrossMember) crossMemberJudges++;
    totalWeight += v.weight;
    if (v.verdict === 'PASS') {
      passVotes++;
      passWeight += v.weight;
      if (isCrossMember) crossMemberPasses++;
    } else if (v.verdict === 'FAIL') {
      failWeight += v.weight;
    }
  }

  const unclearCount = votes.filter(v => v.verdict === 'UNCLEAR').length;
  const abstentionRate = votes.length ? unclearCount / votes.length : 0;

  const minJudgesMet = crossMemberJudges >= opts.minJudges;
  if (!minJudgesMet) {
    return {
      verdict: 'INSUFFICIENT',
      weightedScore: 0,
      totalWeight,
      minJudgesMet: false,
      crossMemberJudges,
      passVotes: 0,
      requiredPassVotes,
      dissentLog,
      summary: `Insufficient cross-member judges: ${crossMemberJudges}/${opts.minJudges} required`,
      abstained: false,
      abstentionRate,
    };
  }

  const weightedScore = totalWeight > 0 ? passWeight / totalWeight : 0;

  // Guard: if a strict majority of judges abstained (UNCLEAR), treat as FAIL rather than
  // letting a single PASS vote produce a deceptively high weightedScore.
  // Exactly 50% abstention (e.g. 1 PASS + 1 UNCLEAR) is NOT a majority and still
  // allows the real votes to decide — this avoids blocking merges when one judge
  // is structurally unavailable (e.g. API 403 / connection failure).
  if (unclearCount * 2 > votes.length) {
    return {
      verdict: 'FAIL',
      weightedScore: 0,
      totalWeight,
      minJudgesMet: true,
      crossMemberJudges,
      passVotes,
      requiredPassVotes,
      dissentLog,
      summary: `UNCLEAR-dominant: ${unclearCount}/${votes.length} judges abstained — could not decide (re-attempt/escalate, NOT a merits rejection)`,
      abstained: true,
      abstentionRate,
    };
  }

  let verdict: ConsensusResult['verdict'];
  if (passVotes < requiredPassVotes) {
    verdict = 'FAIL';
  } else if (passWeight > failWeight && weightedScore >= passFraction && crossMemberPasses >= 1) {
    verdict = 'PASS';
  } else if (failWeight > passWeight) {
    verdict = 'FAIL';
  } else if (Math.abs(passWeight - failWeight) < 0.001) {
    verdict = 'SPLIT';
  } else {
    verdict = 'FAIL';
  }

  const summary = [
    `${verdict}: ${(weightedScore * 100).toFixed(0)}% weighted pass`,
    `(${votes.length} judge(s), ${crossMemberJudges} cross-member)`,
    `${passVotes}/${requiredPassVotes} PASS votes`,
  ].join(' ');

  return {
    verdict,
    weightedScore,
    totalWeight,
    minJudgesMet,
    crossMemberJudges,
    passVotes,
    requiredPassVotes,
    dissentLog,
    summary,
    abstained: false,
    abstentionRate,
  };
}
