// outcome-acceptance-court — decides whether a PROPOSED T5+ outcome may be accepted (Stage 3).
//
// The propose-only gate (outcome-proposal.ts) guarantees an agent can't self-install high-tier
// outcomes. This court is the independent reviewer that accepts them, with tier-appropriate rigor:
//   - structural: every proposal must pass validateOutcomeForTier (required_callsite, runtime kind…);
//   - T5/T6: accept once the dim's harden gate is clean (no orphan/recency/claim failures);
//   - T7/T8 (the 9.0 consensus claim): accept ONLY on a VALIDATED frontier-review verdict;
//   - independence: the court id must differ from the proposer (no self-accept — also enforced in
//     acceptProposedOutcome, checked here too so a rejection carries the real reason).
// Heavy gates are seamed; the policy is the tested surface. Accepting STAMPS the outcome (via
// acceptProposedOutcome) and dequeues it — the caller then installs it through installAcceptedOutcome.

import {
  loadProposal, listProposedOutcomes, acceptProposedOutcome,
  defaultProposalFsDeps, type ProposalFsDeps,
} from '../../core/outcome-proposal.js';
import { validateOutcomeForTier, type Outcome, type OutcomeValidationError } from '../types/outcome.js';
import type { CapabilityTier } from '../types/capability-test.js';

export type CourtVerdict = 'accepted' | 'rejected' | 'deferred';

export interface OutcomeReview {
  dimId: string;
  outcomeId: string;
  tier: CapabilityTier;
  verdict: CourtVerdict;
  reason: string;
  /** The stamped outcome, ready for installAcceptedOutcome — present iff accepted. */
  outcome?: Outcome;
}

export interface AcceptanceCourtDeps {
  /** The court's identity recorded as acceptedBy — must differ from the proposer. */
  courtId?: string;
  validate?: (o: Outcome) => OutcomeValidationError[];
  /** T5/T6 gate: does the dim's harden gate pass (no orphan/recency/claim failures)? */
  passesHardenGate?: (dimId: string, cwd: string) => Promise<boolean>;
  /** T7+ gate: did the independent frontier-review court return VALIDATED? */
  passesFrontierReview?: (dimId: string, cwd: string) => Promise<boolean>;
  fs?: ProposalFsDeps;
}

const CONSENSUS_TIERS = new Set<CapabilityTier>(['T7', 'T8']);

/** Review one pending proposal and accept/defer/reject it. */
export async function reviewProposedOutcome(cwd: string, dimId: string, outcomeId: string, deps: AcceptanceCourtDeps = {}): Promise<OutcomeReview> {
  const courtId = deps.courtId ?? 'outcome-acceptance-court';
  const fsDeps = deps.fs ?? defaultProposalFsDeps();
  const validate = deps.validate ?? ((o: Outcome) => validateOutcomeForTier(o));

  const proposal = await loadProposal(cwd, dimId, outcomeId, fsDeps);
  if (!proposal) return { dimId, outcomeId, tier: 'T5', verdict: 'rejected', reason: 'no pending proposal' };
  const o = proposal.outcome;
  const mk = (verdict: CourtVerdict, reason: string, outcome?: Outcome): OutcomeReview => ({ dimId, outcomeId, tier: o.tier, verdict, reason, outcome });

  if (courtId === proposal.proposedBy) return mk('rejected', 'court cannot also be the proposer (independence required)');

  const errs = validate(o);
  if (errs.length > 0) return mk('rejected', `structural: ${errs[0]!.reason}`);

  if (CONSENSUS_TIERS.has(o.tier)) {
    const ok = await (deps.passesFrontierReview ?? defaultFrontierReview)(dimId, cwd);
    if (!ok) return mk('deferred', `${o.tier} requires a VALIDATED frontier-review verdict before acceptance`);
  } else {
    const ok = await (deps.passesHardenGate ?? defaultHardenGate)(dimId, cwd);
    if (!ok) return mk('deferred', 'harden gate not clean for this dim — fix orphan/recency/claim findings first');
  }

  const r = await acceptProposedOutcome(cwd, dimId, outcomeId, courtId, `accepted by ${courtId}`, fsDeps);
  return r.accepted ? mk('accepted', r.reason, r.outcome) : mk('rejected', r.reason);
}

/** Review every pending proposal for a dimension. */
export async function reviewAllProposals(cwd: string, dimId: string, deps: AcceptanceCourtDeps = {}): Promise<OutcomeReview[]> {
  const proposals = await listProposedOutcomes(cwd, dimId, deps.fs ?? defaultProposalFsDeps());
  const out: OutcomeReview[] = [];
  for (const p of proposals) out.push(await reviewProposedOutcome(cwd, dimId, p.outcome.id, deps));
  return out;
}

// ── default (real) gate runners ──────────────────────────────────────────────

async function defaultHardenGate(dimId: string, cwd: string): Promise<boolean> {
  try {
    const { runHardenAll } = await import('../../cli/commands/harden.js');
    const report = await runHardenAll({ cwd, dim: dimId });
    return report.failedCount === 0;
  } catch { return false; }
}

async function defaultFrontierReview(dimId: string, cwd: string): Promise<boolean> {
  try {
    const { runFrontierReviewCli } = await import('../../cli/commands/frontier-review.js');
    const res = await runFrontierReviewCli({ dimId, cwd });
    return res.result.verdict === 'VALIDATED';
  } catch { return false; }
}
