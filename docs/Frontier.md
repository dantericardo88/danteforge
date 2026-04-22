PRD: DanteForge Frontier Gap Engine

Summary

Add a first-class DanteForge workflow that turns vague “improve the project” work into a repeatable frontier-closing loop:

Claim -> Skeptic Objection -> Gap Type -> Required Proof -> Re-score
The goal is to make DanteForge optimize for true power instead of feature sprawl or score vanity.

Problem

DanteForge can already help plan, build, verify, and score work. What it does not yet enforce is the most important meta-question:

“What is the highest-leverage skeptic objection still standing?”

Without that, projects drift into:

building features before closing real gaps
conflating capability with proof
over-scoring internal progress
inventing novelty before reaching the frontier
losing focus on the smallest hard proof that changes minds
Goal

Create a new DanteForge evaluation mode that:

identifies the strongest remaining skeptical objections
classifies each objection by gap type
proposes the smallest hard proof needed to close it
updates scores only when proof justifies it
tells the team when to stop chasing parity and start inventing
Non-Goals

Replacing the whole existing matrix/scoring system
Generating fluffy strategy docs
Rewarding speculative future potential
Adding more benchmark theater without real proof
Core User Stories

As a founder, I want DanteForge to tell me the real frontier gaps left in my project so I stop wasting time on low-leverage work.
As an engineer, I want every proposed improvement tied to a skeptical objection and proof artifact so I know exactly what to build.
As a reviewer, I want score changes to require explicit evidence and reasoning so matrix inflation becomes harder.
As a team, we want to know when a dimension is no longer a catch-up problem and has become a creativity problem.
Key Concepts

1. Claim
A short statement of what the system is asserting about a dimension.

Examples:

“DanteAgents supports long-horizon unsupervised task execution.”
“DanteAgents has real cross-session persistence.”
“DanteAgents is frontier-level on auditability.”
2. Skeptic Objection
The strongest smart-person criticism still standing.

Examples:

“This only works in mocked tests.”
“This is implemented, but not proven under real conditions.”
“This works technically, but not in a user-trustworthy way.”
3. Gap Type
Exactly one primary type:

capability
proof
reliability
productization
4. Required Proof
The smallest hard artifact that would make a skeptic meaningfully update.

Examples:

non-mocked integration test
live benchmark against real API/server
repeated end-to-end run with artifacts
real user completion evidence
CI proof across platforms
5. Re-score Rule
A dimension score only changes when the required proof exists and survives review.

Feature Requirements

A. New workflow command
Add a native DanteForge command like:

/frontier-gap
Optional variants:

/frontier-gap
/frontier-gap D12
/frontier-gap --project
/frontier-gap --matrix .danteforge/competitive-truth-matrix.json
B. Gap analysis output format
For each dimension, DanteForge should emit:

Dimension:
Current claim:
Current score:
Strongest skeptic objection:
Gap type:
Why this objection still stands:
Smallest proof to close it:
What score that proof would justify:
What still remains after that:
Status: catch-up | near-frontier | frontier-complete | creativity frontier
C. Frontier status model
Every dimension gets one status:

catch-up: obvious gap still exists
near-frontier: mostly there, but skeptic objection still valid
frontier-complete: parity gap effectively closed
creativity-frontier: no obvious parity gap left; next gains come from originality
D. Hard score gate
No score increase unless DanteForge can point to:

a concrete artifact
a test, benchmark, code path, or external proof
a short rationale for why that proof changes the score
E. Objection prioritization
DanteForge should rank gaps by:

leverage on overall score or flagship workflow
severity of skeptic objection
closability in near-term work
dependence ordering
F. Flagship workflow mode
Allow a project to define 1-3 flagship workflows.
DanteForge should answer:

Which skeptic objections most threaten the flagship workflow?
Which dimensions block “undeniable power” in the demo?
G. Raise-readiness mode
Support a synthesis question:

Is the project blocked by capability gaps, proof gaps, reliability gaps, or productization gaps?
This should produce a founder-facing answer:

build more
validate more
harden more
package story and raise
CLI / UX Behavior

Command: /frontier-gap
Output:

top 5 highest-leverage skeptic objections
grouped by gap type
recommended next proofs
projected score deltas
“do not work on” list for low-leverage items
Command: /frontier-gap D12
Output:

current claim
best competitor standard
current proof
strongest remaining objection
exact next proof to build
honest score ceiling after that proof
Command: /frontier-gap --raise-ready
Output:

whether project is raise-ready
what skeptic objections would kill conviction in an investor meeting
what to fix in the next 3-7 days
Data Model

Suggested structure per dimension:

{
  "id": "D12",
  "name": "Screen understanding and vision",
  "claim": "Real cloud vision path exists with consent and cost controls",
  "score": 5,
  "strongestSkepticObjection": "Live vision is optional and not continuously proven in CI or flagship workflows",
  "gapType": "proof",
  "requiredProof": "Non-skipped live API integration in CI plus one flagship end-to-end workflow using real vision",
  "proofArtifacts": [
    "packages/vision-eye/tests/cloud-api-integration.test.ts"
  ],
  "nextJustifiedScore": 6,
  "status": "catch-up"
}
Success Metrics

Score changes become harder to inflate.
Work items become more concrete and evidence-linked.
Fewer low-leverage “nice to have” tasks get prioritized.
Teams can clearly tell whether they need:
more capability
more proof
more reliability
more productization
Founder can answer, at any moment:
“What is the highest-leverage skeptic objection still standing?”
Acceptance Criteria

Running /frontier-gap on an existing matrix produces a ranked list of skeptic objections.
Every objection is assigned exactly one primary gap type.
Every recommended next step includes a required proof artifact.
Score updates are accompanied by a justification referencing concrete evidence.
The system can mark a dimension as creativity-frontier only when no major skeptic-worthy parity gap remains.
The output is concise enough to drive work directly, not just read like analysis.
Example Output

Top Skeptic Objections

1. D12 Screen understanding
Objection: Vision exists, but live usage is optional and not central to flagship workflows.
Type: proof
Next proof: non-skipped CI live vision test + one end-to-end workflow artifact
Score if closed: 6

2. D1 Long-horizon autonomy
Objection: Current proof is mocked orchestration, not real long-duration unsupervised execution.
Type: proof
Next proof: real 30+ minute task with artifact chain and failure handling
Score if closed: 7

3. D7 Desktop control
Objection: Rollback plumbing is real, but real OS-level control remains under-proven.
Type: capability
Next proof: non-mocked desktop automation workflow on supported OS
Score if closed: 7
Implementation Notes

Use existing DanteForge assets where possible:

current truth matrix
benchmark artifacts
verification outputs
test results
sprint notes
Prefer deterministic structured output over poetic analysis.
This should feel like a ruthless reviewer, not a motivational coach.

One-Sentence Product Definition

DanteForge Frontier Gap Engine is a scoring-and-planning layer that identifies the strongest remaining skeptic objection for each dimension, classifies the real gap, prescribes the smallest hard proof to close it, and only then justifies a re-score.

If you want, I can turn this into a repo-ready spec file next, in the exact format DanteForge already uses.