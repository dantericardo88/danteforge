// frontier-review-court.ts — the automated 9.0 review gate (M1 keystone).
//
// The deterministic gates prove EXECUTION, PROVENANCE, and WIRING (session-record, input_source,
// validate, harden, CIP). They cannot prove SEMANTIC competitor-parity: does the real-user-path
// artifact actually demonstrate the capability that matches/beats the named competitor, or is it a
// prepared fixture? This court answers that — an independent, anonymous, K-of-M council of judges
// that did NOT build the evidence. Its PASS is what lets a dim reach 9.0 autonomously and honestly;
// without it the builder would self-certify, which is the inflation the whole substrate prevents.
//
// Composed from existing primitives: parseVerdict (council-verdict-parser) and computeConsensus
// (council-consensus). `runJudge` is injected — tests mock it; the CLI/orchestrator wire it to the
// real council adapters.

import type { CouncilMemberId } from '../engines/council-scheduler.js';
import { parseVerdict } from '../engines/council-verdict-parser.js';
import { computeConsensus, type WeightedVote } from '../engines/council-consensus.js';
import type { FrontierSpec } from '../../core/frontier-spec.js';

export interface FrontierReviewInput {
  dimId: string;
  frontierSpec: FrontierSpec;
  evidence: {
    runCommand: string;
    requiredCallsite: string;
    artifactPath: string;
    /** A snippet of the produced artifact's content, for the judges to inspect. */
    artifactExcerpt?: string;
    /** The validate receipts that backed the score. */
    receipts: Array<{ sessionId: string; passed: boolean; tier: string }>;
  };
}

export interface FrontierJudgeRecord {
  judgeId: CouncilMemberId;
  verdict: 'PASS' | 'FAIL' | 'UNCLEAR';
  ceiling: boolean;
  reason: string;
}

export interface FrontierReviewResult {
  verdict: 'VALIDATED' | 'REJECTED';
  vote: { pass: number; fail: number; unclear: number; total: number; crossMember: number; summary: string };
  /** How many judges flagged this as an honest ceiling (genuinely can't reach the frontier now). */
  ceilingSignal: number;
  dissent: string[];
  judges: FrontierJudgeRecord[];
}

// No builder member exists for evidence review, so every judge is independent (cross-member).
const NO_BUILDER = '__orchestrator__' as unknown as CouncilMemberId;

export function buildFrontierJudgePrompt(input: FrontierReviewInput): string {
  const lt = input.frontierSpec.leader_target;
  const e = input.evidence;
  const receipts = e.receipts.map(r => `  - session ${r.sessionId}: ${r.passed ? 'PASS' : 'FAIL'} (${r.tier})`).join('\n');
  return [
    `You are an INDEPENDENT frontier reviewer in an anonymous council. You did NOT build this — audit`,
    `whether the evidence genuinely proves competitive-frontier parity. Judge HARSHLY; default to FAIL`,
    `if uncertain.`,
    ``,
    `DIMENSION: ${input.dimId}`,
    `Reaching 9.0 means matching or beating: ${lt.competitor} (their score ${lt.score})`,
    `Their specific capability: ${lt.observed_capability}`,
    lt.category_delta ? `Claimed beyond-parity delta: ${lt.category_delta}` : ``,
    ``,
    `THE EVIDENCE (a real product run, per the frozen frontier_spec):`,
    `  run_command:       ${e.runCommand}`,
    `  required_callsite: ${e.requiredCallsite}`,
    `  artifact:          ${e.artifactPath}`,
    `  artifact excerpt:`,
    (e.artifactExcerpt ?? '(none provided)').split('\n').map(l => `    ${l}`).join('\n').slice(0, 3000),
    `  receipts:`,
    receipts || '  (none)',
    ``,
    (input.frontierSpec.real_user_path.realistic_inputs?.length ?? 0) >= 2
      ? `Declared realistic inputs (evidence should generalize across these, not be tied to one): ${input.frontierSpec.real_user_path.realistic_inputs!.join(' | ')}`
      : ``,
    ``,
    `Ask, skeptically:`,
    `  - Does this artifact GENUINELY demonstrate a capability that matches or beats ${lt.competitor}'s`,
    `    "${lt.observed_capability}" — would a real user of ${lt.competitor} agree, or is this narrower/weaker?`,
    `  - Is this a REAL run on a realistic input, or a prepared/toy fixture crafted only to pass the gate?`,
    `  - Is the EVIDENCE DESIGN sound — does the run_command actually exercise the claimed capability on`,
    `    realistic input, or is it narrowly rigged to the one scenario that passes?`,
    `  - Is ${lt.competitor} the RIGHT comparator and genuinely at the frontier for this dimension?`,
    `  - Is the bar too easy (a weak competitor, or a category_delta that isn't actually real)?`,
    ``,
    `Output EXACTLY:`,
    `VERDICT: PASS | FAIL`,
    `CONFIDENCE: HIGH | MEDIUM | LOW`,
    `CEILING: yes | no   (yes ONLY if this dimension genuinely cannot reach the frontier right now — an`,
    `         honest ceiling, e.g. a market cap, a real R&D gap, or an environment limit — NOT merely weak evidence)`,
    `REASON: <one paragraph: the specific evidence a user would recognize, or exactly why it falls short>`,
    `DISSENT: <reservations even on PASS, or none>`,
    ``,
    `PASS ONLY if the evidence is real AND genuinely matches/beats the named competitor.`,
  ].filter(l => l !== '').join('\n');
}

/**
 * Run the frontier-review court. `runJudge(judgeId, prompt)` returns the judge's raw text; the
 * caller supplies the real adapter wiring (or a mock in tests).
 */
export async function runFrontierReviewCourt(
  input: FrontierReviewInput,
  opts: {
    members: CouncilMemberId[];
    minJudges?: number;
    runJudge: (judgeId: CouncilMemberId, prompt: string) => Promise<string>;
  },
): Promise<FrontierReviewResult> {
  const prompt = buildFrontierJudgePrompt(input);
  const judges: FrontierJudgeRecord[] = [];
  const votes: WeightedVote[] = [];

  for (const member of opts.members) {
    let raw = '';
    try { raw = await opts.runJudge(member, prompt); } catch (err) { raw = `VERDICT: UNCLEAR\nREASON: judge error ${String(err)}`; }
    const v = parseVerdict(member, raw);
    const ceiling = /CEILING:\s*YES/i.test(raw);
    judges.push({ judgeId: member, verdict: v.verdict, ceiling, reason: v.reason });
    votes.push({
      judgeSlotId: `${member}-0`, judgeMemberId: member, builderMemberId: NO_BUILDER,
      verdict: v.verdict, weight: 1.0, confidence: v.confidence, reason: v.reason, dissentSummary: v.dissentSummary,
    });
  }

  const minJudges = opts.minJudges ?? Math.min(2, opts.members.length);
  const consensus = computeConsensus(votes, { minJudges, minPasses: minJudges });
  const pass = judges.filter(j => j.verdict === 'PASS').length;
  const fail = judges.filter(j => j.verdict === 'FAIL').length;
  const unclear = judges.filter(j => j.verdict === 'UNCLEAR').length;

  return {
    verdict: consensus.verdict === 'PASS' ? 'VALIDATED' : 'REJECTED',
    vote: {
      pass, fail, unclear, total: judges.length,
      crossMember: consensus.crossMemberJudges, summary: consensus.summary,
    },
    ceilingSignal: judges.filter(j => j.ceiling).length,
    dissent: consensus.dissentLog,
    judges,
  };
}
