# Truth Loop Founder Closure Candidates

**Status:** founder_gated_pending
**Created:** 2026-04-30
**Purpose:** identify the representative Truth Loop runs and adjacent closure artifacts that should be founder-rated before DanteForge claims operational closure beyond local substrate validation.

This document does not mark the Truth Loop founder gate complete. It prepares the review set. The gate fires only after the founder reviews 5-10 representative outputs, records ratings, and confirms the substrate is useful in real work.

## Rating Contract

Each candidate needs the following evidence before rating:

- `run_id_or_artifact_id`: stable run, receipt, or document identifier.
- `git_sha`: repository SHA at generation time.
- `objective`: what the run was supposed to decide or prove.
- `inputs`: critiques, PRDs, datasets, repo state, or business artifacts used.
- `evidence_files`: machine-readable receipts, reports, logs, or Time Machine commits.
- `verdict`: supported claims, unsupported claims, contradictions, and next action.
- `founder_rating`: 0-10, entered by the founder.
- `founder_note`: short reason for the rating, especially if below 8.5.
- `gate_status`: `founder_gated_pending`, `accepted`, or `needs_rework`.

Passing threshold: average founder rating >= 8.5 across at least 5 rated candidates, with no critical candidate below 8.0 unless the rework is explicitly accepted.

## Candidate Set

| # | Candidate | Objective | Evidence to inspect | Founder question | Status |
|---|---|---|---|---|---|
| 1 | Time Machine Class F 1M compute closure | Decide whether the local substrate scales to the 1M benchmark envelope, or record an honest timeout/failure. | Pass 36 benchmark result or timeout marker; updated paper table; Pass 36 proof receipt. | "Does this give you enough evidence to trust the scale claim as stated?" | founder_gated_pending |
| 2 | DELEGATE-52 live blocked run | Confirm the system refuses paid/live claims without credentials, live flag, pinned model, and founder budget approval. | `delegate52-live-blocked.json`; publication PRD gate language; reproducibility appendix. | "Is the fail-closed behavior clear enough for future live execution?" | founder_gated_pending |
| 3 | Sean Lippay staged outreach workflow | Validate that a real founder-facing business workflow can be staged without falsely claiming the email was sent. | G1 substrate artifact, Time Machine commit, outreach draft, founder-gated status. | "Would you trust this as the pre-send review packet?" | founder_gated_pending |
| 4 | Article XIV / Article XV reconciliation | Decide whether constitutional updates are framed as ratified, proposed, or deferred with no stale claims. | `docs/Article-XIV-Reconciliation.md`; Forge v1.1 closure PRD; proof manifest. | "Does this represent your intent and boundaries accurately?" | founder_gated_pending |
| 5 | PRD-24 / PRD-25 retirement | Verify that retired plans are closed with rationale rather than silently forgotten. | retirement memos, relevant proof receipts, current PRD status table. | "Are these retirements correct, or should any plan return to active scope?" | founder_gated_pending |
| 6 | Scoring divergence audit | Confirm the canonical scoring/truth language separates built facts from score optimism. | `docs/SCORING-DIVERGENCE.md`; canonical score tests; harsh scorer receipts. | "Does the audit make the scoring status more trustworthy?" | founder_gated_pending |
| 7 | Sister-repo integration contract | Confirm DanteCode and DanteAgents have enough package/MCP docs to consume DanteForge without tribal knowledge. | `docs/SISTER_REPO_INTEGRATION.md`; package READMEs; MCP tool surface doc. | "Could the next repo build against this without another architecture reset?" | founder_gated_pending |
| 8 | Truth Loop causal recall / G4 ledger | Validate that conversational ledger recall preserves decisions, rejected claims, and next actions. | G4 report, causal query output, supporting evidence chain. | "Does this recover the decision history you would need in practice?" | founder_gated_pending |

## Review Procedure

1. Export the evidence packet for a candidate from `.danteforge/evidence` or the relevant report folder.
2. Read the human report first, then spot-check the machine-readable proof receipt.
3. Rate the candidate from 0-10 using the rubric below.
4. Record the rating and note in the candidate row or a follow-up ratings receipt.
5. Mark any candidate below 8.5 as `needs_rework` unless the founder explicitly accepts the limitation.

## Rubric

| Rating | Meaning |
|---|---|
| 9.0-10.0 | Operationally trustworthy; the output would change what we do next. |
| 8.5-8.9 | Good enough for closure, with minor wording or workflow improvements. |
| 7.0-8.4 | Useful but not closure-grade; needs targeted rework. |
| 5.0-6.9 | Partially useful; evidence or workflow shape is missing. |
| 0.0-4.9 | Not trusted; claim should not advance. |

## Gate Boundary

Prepared by agent: yes.

Founder gate fired: no.

Allowed claim after this artifact: "The founder-rating review set exists and is ready."

Forbidden claim before ratings: "Truth Loop is founder-validated at 8.5+."
