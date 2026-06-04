// outcome-proposal — the propose-only gate for high-tier (T5+) outcomes. THE structural keystone of
// autonomous frontier advancement.
//
// The problem: reaching 7+ requires declaring OUTCOMES (the receipts a dimension must produce). But an
// agent that writes its own outcomes controls the goalposts, not just the score — it reward-hacks the
// definition of "done" (trivial-but-valid outcomes, tautological tests, gerrymandering). So:
//   1. Agents PROPOSE T5+ outcomes into a pending queue under .danteforge/proposed-outcomes/ — never
//      into matrix.json (which they can't commit anyway: it's the kernel-owned score surface).
//   2. An independent reviewer (the acceptance court, or a human) ACCEPTS — stamping the outcome with
//      who accepted it. Self-accept (acceptedBy === proposedBy) is refused.
//   3. ONLY a stamped outcome may be INSTALLED into a dim's live outcomes. installAcceptedOutcome is
//      the gate; a T5+ outcome with no valid stamp is refused, so it can never affect derived-score.
//
// Existing (pre-gate) outcomes are untouched: the gate fires at INSTALL of NEW outcomes, not
// retroactively on what's already in matrix.json.

import fs from 'fs/promises';
import path from 'path';
import type { CompeteMatrix } from './compete-matrix.js';
import { isHighTierOutcome, type Outcome, type OutcomeAcceptance } from '../matrix/types/outcome.js';

export interface ProposalFsDeps {
  mkdir: (p: string) => Promise<void>;
  writeFile: (p: string, c: string) => Promise<void>;
  readFile: (p: string) => Promise<string>;
  readdir: (p: string) => Promise<string[]>;
  rm: (p: string) => Promise<void>;
}

export function defaultProposalFsDeps(): ProposalFsDeps {
  return {
    mkdir: async (p) => { await fs.mkdir(p, { recursive: true }); },
    writeFile: (p, c) => fs.writeFile(p, c, 'utf8'),
    readFile: (p) => fs.readFile(p, 'utf8'),
    readdir: async (p) => { try { return await fs.readdir(p); } catch { return []; } },
    rm: (p) => fs.rm(p, { force: true }),
  };
}

/** A queued proposal: the candidate outcome plus who proposed it (for the no-self-accept rule). */
export interface OutcomeProposal {
  dimId: string;
  proposedBy: string;
  proposedAt: string;
  outcome: Outcome;
}

export interface AcceptResult {
  accepted: boolean;
  reason: string;
  /** The stamped outcome, ready for installAcceptedOutcome — present iff accepted. */
  outcome?: Outcome;
}

function proposalDir(cwd: string, dimId: string): string {
  return path.join(cwd, '.danteforge', 'proposed-outcomes', dimId);
}
function proposalPath(cwd: string, dimId: string, outcomeId: string): string {
  return path.join(proposalDir(cwd, dimId), `${outcomeId}.json`);
}

/** True iff the outcome carries a VALID independent-acceptance stamp (accepted by someone other than its proposer). */
export function isAccepted(outcome: Outcome): boolean {
  const a = outcome.acceptance;
  return !!a && !!a.acceptedBy && a.acceptedBy !== a.proposedBy;
}

/** Propose a T5+ outcome into the pending queue. Strips any acceptance the proposer tried to self-apply. */
export async function proposeOutcome(
  cwd: string, dimId: string, outcome: Outcome, proposedBy: string, deps: ProposalFsDeps = defaultProposalFsDeps(),
): Promise<void> {
  const clean: Outcome = { ...outcome };
  delete clean.acceptance; // a proposer can never stamp its own acceptance
  const proposal: OutcomeProposal = { dimId, proposedBy, proposedAt: new Date().toISOString(), outcome: clean };
  await deps.mkdir(proposalDir(cwd, dimId));
  await deps.writeFile(proposalPath(cwd, dimId, outcome.id), JSON.stringify(proposal, null, 2));
}

export async function listProposedOutcomes(cwd: string, dimId: string, deps: ProposalFsDeps = defaultProposalFsDeps()): Promise<OutcomeProposal[]> {
  const files = (await deps.readdir(proposalDir(cwd, dimId))).filter(f => f.endsWith('.json'));
  const out: OutcomeProposal[] = [];
  for (const f of files) {
    try { out.push(JSON.parse(await deps.readFile(path.join(proposalDir(cwd, dimId), f))) as OutcomeProposal); } catch { /* skip malformed */ }
  }
  return out;
}

/** Reject (delete) a pending proposal. */
export async function rejectProposedOutcome(cwd: string, dimId: string, outcomeId: string, deps: ProposalFsDeps = defaultProposalFsDeps()): Promise<void> {
  await deps.rm(proposalPath(cwd, dimId, outcomeId));
}

/**
 * Accept a pending proposal: stamp it with the reviewer's identity and remove it from the queue. The
 * reviewer must differ from the proposer (no self-accept). Returns the stamped outcome for the caller
 * (kernel) to install via installAcceptedOutcome. Does NOT touch matrix.json itself.
 */
export async function acceptProposedOutcome(
  cwd: string, dimId: string, outcomeId: string, acceptedBy: string, note: string | undefined,
  deps: ProposalFsDeps = defaultProposalFsDeps(),
): Promise<AcceptResult> {
  let proposal: OutcomeProposal;
  try { proposal = JSON.parse(await deps.readFile(proposalPath(cwd, dimId, outcomeId))) as OutcomeProposal; }
  catch { return { accepted: false, reason: `no pending proposal ${dimId}/${outcomeId}` }; }
  if (acceptedBy === proposal.proposedBy) {
    return { accepted: false, reason: `self-accept forbidden — ${acceptedBy} both proposed and tried to accept ${outcomeId}` };
  }
  const acceptance: OutcomeAcceptance = { acceptedBy, acceptedAt: new Date().toISOString(), proposedBy: proposal.proposedBy, ...(note ? { note } : {}) };
  const stamped: Outcome = { ...proposal.outcome, acceptance };
  await deps.rm(proposalPath(cwd, dimId, outcomeId));
  return { accepted: true, reason: `accepted by ${acceptedBy}`, outcome: stamped };
}

export interface InstallResult { installed: boolean; reason: string; }

/**
 * THE GATE. Install an outcome into a dimension's live outcomes — but refuse any T5+ outcome that
 * lacks a valid independent-acceptance stamp. Mutates the matrix (caller persists via the kernel
 * saveMatrix path). Replaces an existing outcome with the same id.
 */
export function installAcceptedOutcome(matrix: CompeteMatrix, dimId: string, outcome: Outcome): InstallResult {
  const dim = matrix.dimensions.find(d => d.id === dimId) as (typeof matrix.dimensions[number] & { outcomes?: Outcome[] }) | undefined;
  if (!dim) return { installed: false, reason: `dimension ${dimId} not found` };
  if (isHighTierOutcome(outcome.tier) && !isAccepted(outcome)) {
    return { installed: false, reason: `refused: ${outcome.tier} outcome ${outcome.id} has no independent acceptance stamp (propose → court/human accept first)` };
  }
  dim.outcomes = (dim.outcomes ?? []).filter(o => o.id !== outcome.id);
  dim.outcomes.push(outcome);
  return { installed: true, reason: `installed ${outcome.tier} outcome ${outcome.id}` };
}
