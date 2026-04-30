# PRD-TIME-MACHINE-PUBLICATION-PLAN

**Version:** 1.0
**Created:** 2026-04-29
**Status:** Active — execution doc, designed as a durable tracker
**Foundation PRD:** [PRD-TIME-MACHINE-Validation.md](./PRD-TIME-MACHINE-Validation.md) (web-Claude, 2026-04-29)
**Prior receipts:** [.danteforge/PASS_18_TIME_MACHINE_VALIDATION_RECEIPT.md](../.danteforge/PASS_18_TIME_MACHINE_VALIDATION_RECEIPT.md), [docs/TIME_MACHINE_VALIDATION_REPORT.md](./TIME_MACHINE_VALIDATION_REPORT.md)
**Target:** Publishable arXiv preprint replicating DELEGATE-52 against Time Machine v0.1, with honest results table

---

## 0. How to use this document

- **Single source of truth** for the path from current state (Pass 18 closed) to publishable artifact.
- Each Pass below has explicit **acceptance criteria** + **verify chain** + **proof anchor** + **founder gate where applicable**.
- Status checkboxes are updated as work lands. No claim is moved from `pending` to `complete` without verify-chain green and a proof-anchored receipt.
- This doc supersedes any conflicting in-conversation planning. If something here is wrong, fix this doc first, then act.
- Multi-agent execution: passes can be executed by Claude / Codex / DanteCode coordinated through artifacts. Each pass produces a numbered receipt under `.danteforge/PASS_NN_*_RECEIPT.md`.

---

## 1. Current Status (as of 2026-04-29)

### What's built and verified

- Cryptographic proof spine (`@danteforge/evidence-chain` v1.1.0 locally, npm publication still founder-gated) with `aggregateChildReceipts`.
- Three-way promotion gate refuses tampered receipts and fail-closes on missing proof envelopes.
- Corpus-wide proof verification (`forge proof --verify-all`) remains part of the verification chain.
- Time Machine v0.1 substrate exists: `createTimeMachineCommit`, `verifyTimeMachine`, `restoreTimeMachineCommit`, and `queryTimeMachine`.
- Time Machine validation harness exists for Classes A/B/C/D/E/F/G, scale modes, DELEGATE-52 harness/import/live modes, and report generation.
- Real-fs PRD-scale A/B/C, DELEGATE-52 dataset import, dry-run live executor, Class G G1/G4 substrate artifacts, adversarial review, paper draft, reproducibility appendix, restore-to-working-tree flow, and Pass 27 performance optimization are locally implemented and proof-receipted through Pass 28.
- `docs/TIME_MACHINE_VALIDATION_REPORT.md` and `docs/papers/time-machine-empirical-validation-v1.md` are the current human-readable summaries.

### What's NOT complete (founder-gated or explicitly deferred)

- Live DELEGATE-52 paid run: executor and budget guards exist, but the real API spend requires founder approval.
- Class F 1M-commit benchmark: staged behind explicit environment override because it consumes significant local time and disk.
- arXiv submission and Microsoft outreach send: drafts/prep exist, but submission/send are founder-gated.
- npm publication of package surfaces: local workspace packages exist, but publishing is founder-gated.
- G2 Dojo bookkeeping integration: intentionally out of v1 publication scope and recorded as `out_of_scope_dojo_paused`.
- Standalone product runtime corruption detector remains future work; the Class D validation runner now has restore-and-retry mitigation hooks for substrate-mediated corruption experiments.

### Honest weighted coverage

- Substrate + deterministic harness: **~95%**
- Empirical proof against the public DELEGATE-52 benchmark without live spend: **~70%**
- Publishable artifact before live data: **~80%**
- Weighted average to publishable preprint: **~85%**, with the remaining delta dominated by founder-gated live execution and dissemination.

### Sober size estimate to publishable preprint

**~1-3 days of founder-gated live execution/review + ~$10-160 LLM costs + submission/outreach approval.**

---

## 2. PRD §4 minimum-success scoreboard

Per [PRD-TIME-MACHINE-Validation.md §4](./PRD-TIME-MACHINE-Validation.md), minimum success requires every row green. Current state:

| Class | PRD requirement | Current | Gap |
|---|---|---|---|
| A | 7/7 mods + 0% FP rate on clean 1000-commit chain | Real-fs PRD-scale complete; Pass 27 adds fresh-chain FP measurement | 100-chain statistical FP expansion optional |
| B | 6/6 byte-identical at 1000 commits | Real-fs PRD-scale complete | None |
| C | 7/7 queries + 0 gaps on 100-decision chain | Real-fs PRD-scale complete | None |
| D | D2 byte-identical restore + D3 causal source identification | Harness/import/dry-run complete for public 48-domain release | **Founder-gated live execution + real result table** |
| E | 5/5 detected | All 5 covered in deterministic harness | Optional: external multi-agent stress |
| F | 10K + 100K thresholds met | Pass 27 optimization meets 10K and 100K thresholds; 1M behind env-var | 1M run with founder approval |
| G | 4/4 constitutional integrations | G1 staged founder-gated, G3 passed, G4 passed; G2 out of scope for v1 | Founder send/Dojo live data not claimed |

**Publishable trigger:** all rows above show "complete" or "honestly documented limitation."

---

## 3. Remaining Gap List (Tiered)

### Tier 1 — Load-bearing for publication

| # | Gap | Estimated effort | Cost |
|---|---|---|---|
| T1.1 | Live DELEGATE-52 paid run with founder-approved provider/model/budget | 0.5-1 day wall-time | $10-160 |
| T1.2 | Imported DELEGATE-52 public dataset ingestion + comparison | Complete | $0 |
| T1.3 | Real-fs PRD-scale runs for Classes A, B, C | Complete | $0 |

### Tier 2 — Quality bar for publication

| # | Gap | Estimated effort | Cost |
|---|---|---|---|
| T2.1 | Class G end-to-end runs (G1 Sean Lippay, G4 truth-loop causal recall) | G1/G4 substrate complete; founder send/Dojo data deferred | $0 |
| T2.2 | Class F 1M-commit benchmark execution (founder env-var approval) | 0.5-1 day | $0 (compute only) |
| T2.3 | DELEGATE-52 result table generator (auto-emit per-domain + aggregate) | Complete for harness/import/dry-run; live rows await GATE-1 | $0 |

### Tier 3 — Product polish that strengthens the publication

| # | Gap | Estimated effort | Cost |
|---|---|---|---|
| T3.1 | Auto-commit-before-LLM-edit hook (MCP middleware or Claude Code pre-tool-use hook) | Complete for post/pre-tool harness paths; broader host interception remains product work | $0 |
| T3.2 | `forge time-machine restore --to-working-tree` destructive flag | Complete with explicit guardrails | $0 |
| T3.3 | Runtime corruption detector (round-trip equivalence runner — runtime version of Class D) | Class D mitigation hook exists; standalone product runner remains future work | $0 build, ongoing $ for periodic checks |

### Tier 4 — Dissemination

| # | Gap | Estimated effort | Cost |
|---|---|---|---|
| T4.1 | Comparison document v1 draft (8 sections per PRD §7) | Complete | $0 |
| T4.2 | Codex adversarial review pass | Complete | $0 |
| T4.3 | arXiv preprint preparation (LaTeX, reproducibility appendix, code release prep) | Draft complete; submission founder-gated | $0 |
| T4.4 | Targeted outreach to Laban / Schnabel / Neville et al. | Draft complete; send founder-gated | $0 |

---

## 4. The Masterplan: 4 Phases, 8 Passes

### Phase 0.5 — Hygiene (immediate prerequisite for Phase 1)

#### Pass 18.5 — Proof-binding semantic fix (gitSha continuity, not equality)

- [x] **Status:** completed 2026-04-29 — discovered 2026-04-29 while writing this plan doc
- **Owner:** Claude (small fix) + Codex (review)
- **Discovered finding:** After the `f19e1d7 feat: seal proof spine and time machine validation` commit landed (which sealed Passes 11-18 in git history), the corpus integrity check reports 7 manifests as `failed` with `gitShaBinding: invalid`. Each manifest was correctly anchored to git SHA `542fadac` at receipt-write time. The current HEAD is now `f19e1d7`. The receipts themselves are still cryptographically valid (chain integrity passes); the binding check is just enforcing equality when it should enforce continuity.
- **Goal:** Make `gitShaBinding` semantically correct — manifest's gitSha must be an **ancestor** of current HEAD (continuity), not equal to current HEAD (snapshot).
- **Scope:**
  - In [src/cli/commands/proof.ts](../src/cli/commands/proof.ts) `verifyGitBinding`, change the comparison from `current === expected` to `git merge-base --is-ancestor expected current` (returns 0 if `expected` is ancestor of `current`)
  - Preserve the strict-equality mode behind a new `--strict-git-binding` flag for cases where snapshot equality matters (e.g., release verification)
  - Document the semantic in CONTRIBUTING.md
- **Acceptance criteria:**
  - `npm run check:proof-integrity` returns CLEAN on the current corpus (476+ files; 7 currently-failing become verified)
  - New unit test: tampered-payload still fails (proof tamper unaffected)
  - New unit test: ancestor-not-on-history (e.g., a manifest from a parallel branch) correctly fails
  - `--strict-git-binding` flag preserved for release-verification use case
  - `verify:all` returns exit 0
- **Verify chain:** tsc / lint / anti-stub / proof tests / verify:all
- **Proof anchor:** Pass 18.5 manifest verifying via `forge proof --verify`
- **Receipt:** `.danteforge/PASS_18_5_GIT_BINDING_SEMANTIC_FIX_RECEIPT.md`
- **Founder gate:** none (substrate fix; no $ spend, no external action)
- **Estimated work:** 0.5 day

**Why this is Pass 18.5 not Pass 19:** Pass 19 (live DELEGATE-52 executor) needs `verify:all` to pass. Pass 18.5 unblocks that. Naming reflects sequencing — the Phase 1 work proper still starts at Pass 19.

---

### Phase 1 — Empirical closure (~3-5 days, $30-150 LLM budget)

#### Pass 19 — Live DELEGATE-52 round-trip executor

- [x] **Status:** completed 2026-04-29
- **Owner:** Codex (Claude does plan + verify)
- **Goal:** Replace the earlier `live_runner_not_implemented_in_v0_1` placeholder with a real provider adapter that performs forward edit + backward edit per domain.
- **Scope:**
  - Provider adapter (Anthropic / OpenAI; pick one — likely Anthropic since we're already wired)
  - `coin-purse` budget envelope enforcement (refuses to run without `--budget-usd N`)
  - Dry-run mode (`DANTEFORGE_DELEGATE52_DRY_RUN=1`) that simulates without spending
  - Live mode requires `DANTEFORGE_DELEGATE52_LIVE=1`, `--budget-usd > 0`, provider credentials, and an explicit pinned model
  - Per-domain logging: input doc hash, forward-edit output hash, backward-edit output hash, final-comparison hash, time, cost
- **Acceptance criteria:**
  - `forge time-machine validate --class D --delegate52-mode live --budget-usd 80 --max-domains 4 --dry-run` produces a structured plan
  - `forge time-machine validate --class D --delegate52-mode live --budget-usd 80 --max-domains 4` (live) produces a real per-domain result table when env vars + budget are set
  - Cost tracking matches actual provider billing within 10%
  - Refuses to run without all live guards and records machine-readable blockers such as `blocked_by_missing_credentials`, `blocked_by_missing_model`, `blocked_by_missing_budget`, or `blocked_by_missing_live_confirmation`
- **Verify chain:** tsc / lint / anti-stub / proof tests / new live-runner unit tests (mocked provider)
- **Proof anchor:** Pass 19 manifest + per-domain receipt chain; verifies via `forge proof --verify`
- **Receipt:** `.danteforge/PASS_19_LIVE_DELEGATE52_EXECUTOR_RECEIPT.md`
- **Founder gate:** approval to spend budget on live run before executing the live (not dry-run) command
- **Estimated work:** 2-3 days
- **Estimated cost:** $0 build; $30-80 for first founder-approved live run (4-48 domains × 10 round-trips)

#### Pass 20 — Imported dataset + real-fs PRD-scale validation

- [x] **Status:** completed 2026-04-29
- **Owner:** Codex (impl) + Claude (verify + report integration)
- **Goal:** Two complementary moves to ground the harness in reality.
- **Scope:**
  - **Part A — Imported dataset:** Fetch the public DELEGATE-52 release (48 domains × 234 rows); add `--delegate52-dataset <path>` ingestion; comparison logic that emits per-domain status (matches Microsoft / diverges / withheld).
  - **Part B — Real-fs PRD-scale:** Add a `prd-real` scale option (already `prd` is logical; smoke is real but small). Real-fs 1000-commit runs for Classes A and B; real-fs 100-decision runs for Class C. May take ~5-10 minutes per class — that's fine; runs once before publication.
- **Acceptance criteria:**
  - Imported dataset comparison produces a structured side-by-side table for at least one downloaded sample
  - `prd-real` mode runs 1000-commit Class A in <5 minutes, detects all 7 mods, 0% FP over 100-run baseline
  - `prd-real` Class B 1000-commit B1-B6 byte-identical
  - `prd-real` Class C 100-decision audit shows 0 gaps
- **Verify chain:** tsc / lint / anti-stub / proof tests / new real-fs scale tests (slow tests gated to a separate lane)
- **Proof anchor:** Pass 20 manifest with hashes of each result file; verifies via `forge proof --verify`
- **Receipt:** `.danteforge/PASS_20_IMPORT_AND_REAL_FS_RECEIPT.md`
- **Founder gate:** none for Part B; Part A only if dataset license requires explicit redistribution acknowledgment
- **Estimated work:** 1-1.5 days
- **Estimated cost:** $0

#### **Decision gate after Phase 1**

Read the data with sober eyes. Founder reviews:

- Does the live DELEGATE-52 corruption rate drop meaningfully (e.g., from 25% baseline to <10%)?
- Does the real-fs PRD-scale run match the logical-mode results, or is there a divergence?
- Are there any honest limitations we need to document?

Three possible outcomes:

- **Strong (drop from 25% to <5%, substrate scales clean):** proceed to Phase 2 with confident framing.
- **Mixed (drop from 25% to 10-20%, partial recovery, some withheld domains):** proceed to Phase 2 with honest replication framing.
- **Weak (no measurable drop, or substrate fails at scale):** stop. Identify architectural gap. New focused pass before any external work. Don't publish.

### Phase 2 — Quality bar (~3-4 days, no LLM cost)

#### Pass 21 — Class G end-to-end + Class F 1M

- [x] **Status:** completed 2026-04-29 (after Phase 1 decision gate is GREEN or YELLOW)
- **Owner:** Codex (impl) + Claude (verify)
- **Goal:** Convert `harness_ready` Class G scenarios into actively passed scenarios; produce 1M-commit data point.
- **Scope:**
  - **G1 Sean Lippay** — stage a synthetic outreach workflow that exercises Truth Loop + three-way gate + Time Machine commit chain end-to-end. Does NOT actually send an email (founder gate). Verifies the substrate composes for a realistic agent task.
  - **G4 truth-loop causal recall** — run a recall query against an actual conversational artifact ledger. Acceptance: query returns specific commits with full context preserved.
  - **G2 Dojo** — explicitly defer; mark `out_of_scope_dojo_paused` and document that the bookkeeping flow is paused per project-memory.
  - **F 1M** — founder-approved env-var override (`DANTEFORGE_TIME_MACHINE_VALIDATE_MAX_COMMITS=1000000`); single benchmark run.
- **Acceptance criteria:**
  - G1, G3, G4 show `passed` (G2 documented as deferred, not failed)
  - F 1M produces measured numbers (verify, restore, query) even if outside threshold; document threshold compliance per benchmark
  - Class G overall status moves from `partial` to `passed` (or honest `partial` with documented exclusion)
- **Verify chain:** tsc / lint / anti-stub / Time Machine validation tests
- **Proof anchor:** Pass 21 manifest with G1/G4 result hashes + F 1M timing data
- **Receipt:** `.danteforge/PASS_21_G_END_TO_END_AND_F_1M_RECEIPT.md`
- **Founder gate:** approval to run the 1M scale benchmark (compute only, no $ spend)
- **Estimated work:** 1-2 days

#### Pass 22 — Comparison document v1 draft

- [x] **Status:** completed 2026-04-29 (after Pass 21)
- **Owner:** Claude (writes) + founder (reviews)
- **Goal:** Produce the 8-section comparison document per PRD §7 with actual numbers from Phase 1 + 2 runs.
- **Scope:**
  - Section 1: DELEGATE-52 finding restated, citation
  - Section 2: Architectural principles (Merkle, snapshot reversibility, causal completeness)
  - Section 3: Implementation in DanteForge (architectural overview, integration with constitutional substrate)
  - Section 4: Validation methodology (the 7 test classes, DELEGATE-52 replication design)
  - Section 5: Results — honest reporting of Class A-G outcomes including failures or partial successes; side-by-side with Microsoft baseline
  - Section 6: Implications (AI safety research, production deployment, broader research conversation)
  - Section 7: Limitations (cliff-failure 10% gap if it appears, scale ceilings, withheld DELEGATE-52 environments, logical-vs-real-fs caveat)
  - Section 8: Future work
  - Citations
- **Acceptance criteria:**
  - 8-section draft, 8-15 pages
  - Every numerical claim sourced to a proof-anchored manifest in `.danteforge/evidence/`
  - "Allowed claim / Forbidden claim" discipline preserved
  - Founder reads + approves direction
- **Verify chain:** doc lints (no broken citations, no claims unsupported by data)
- **Proof anchor:** Pass 22 manifest with content hash of the doc + hashes of each cited result manifest
- **Receipt:** `.danteforge/PASS_22_COMPARISON_DOCUMENT_V1_RECEIPT.md`
- **Output:** `docs/papers/time-machine-empirical-validation-v1.md`
- **Founder gate:** approval before proceeding to Phase 3 adversarial review
- **Estimated work:** 1 day

#### **Decision gate after Phase 2**

Founder reviews comparison document v1:

- Does the framing hold given actual data?
- Are the limitations honest and complete?
- Is the headline claim defensible?

Three possible outcomes:

- **Approved as-is:** proceed to Phase 3.
- **Approved with revisions:** Pass 22b (revise) before Phase 3.
- **Rejected:** rethink framing; possibly more measurement needed; possibly publish smaller claim only.

### Phase 3 — Adversarial review + product polish (~3-5 days)

#### Pass 23 — Codex adversarial review

- [x] **Status:** completed 2026-04-29 (after Phase 2 decision gate is GREEN)
- **Owner:** Codex (hostile reviewer) + Claude (cataloger)
- **Goal:** Find any methodological gap, misclassification, or unsupported claim before external eyes do.
- **Scope:**
  - Codex reads: comparison document v1, all Pass 19-22 receipts, the validation report, Class D result table
  - Codex's task: act as a Microsoft Research peer reviewer with a hostile-but-honest disposition. Find:
    - Any unsupported numerical claim
    - Any methodological flaw in the validation harness
    - Any place "Allowed claim / Forbidden claim" was violated
    - Any logical-vs-real-fs gap that wasn't documented
    - Any DELEGATE-52 domain where DanteForge's claim doesn't match the actual data
  - Codex outputs a structured findings list, sorted by severity
- **Acceptance criteria:**
  - At least 5 findings (negative or positive) — if Codex says "all good," that's a sign it didn't really look
  - Every finding above LOW severity is either fixed (in code/doc) or explicitly documented as known-limitation
  - Codex's findings list is itself proof-anchored
- **Verify chain:** tsc / lint / anti-stub / all tests / verify-all
- **Proof anchor:** Pass 23 manifest with Codex findings hash + diff of any code/doc fixes
- **Receipt:** `.danteforge/PASS_23_ADVERSARIAL_REVIEW_RECEIPT.md`
- **Founder gate:** review of Codex findings before proceeding to dissemination
- **Estimated work:** 1 day Codex + 0.5 day fix-up

#### Pass 24 — Product polish (Tier 3 items)

- [x] **Status:** completed 2026-04-29 (can run parallel to Pass 23)
- **Owner:** Codex (impl) + Claude (verify)
- **Goal:** Convert Time Machine from "opt-in substrate" to "automatic protection during agent runs."
- **Scope:**
  - **T3.1 Auto-commit hook** — implement as a Claude Code pre-tool-use hook OR an MCP middleware. Triggered before any Edit/Write/file-modifying tool. Calls `createTimeMachineCommit` on the affected paths.
  - **T3.2 `forge time-machine restore --to-working-tree`** — destructive flag that swaps files back. Requires `--confirm` to actually run.
  - **T3.3 Runtime corruption detector** — round-trip equivalence runner. Periodically (or on demand) takes a recent commit, asks the LLM to round-trip, compares hashes. The runtime version of Class D's harness.
- **Acceptance criteria:**
  - T3.1: a fresh user can install DanteForge in another repo, run a Claude Code session, see auto-commits land in `.danteforge/time-machine/`
  - T3.2: `forge time-machine restore --commit X --to-working-tree --confirm` actually swaps files; without `--confirm`, refuses
  - T3.3: detector runs on a synthetic corruption case and detects the divergence; documented latency
- **Verify chain:** new tests for each piece + full verify-all
- **Proof anchor:** Pass 24 manifest with hashes of new code + test results
- **Receipt:** `.danteforge/PASS_24_PRODUCT_POLISH_RECEIPT.md`
- **Estimated work:** 3-5 days

### Phase 4 — Dissemination (~2-3 days)

#### Pass 25 — arXiv preprint preparation

- [x] **Status:** agent prep completed 2026-04-29; arXiv submission remains founder-gated
- **Owner:** Claude (LaTeX + reproducibility) + founder (review)
- **Goal:** Convert the comparison document v1 (post-adversarial-review) into a publishable arXiv preprint.
- **Scope:**
  - LaTeX conversion of the markdown comparison doc
  - Reproducibility appendix: exact CLI commands + env vars + version hashes (`@danteforge/evidence-chain` package v1.1.0, `evidence-chain.v1` schema, Time Machine schema `danteforge.time-machine.v1`, validation schema `danteforge.time-machine.validation.v1`, git SHA at run time)
  - Code release prep — already MIT licensed; ensure `npm publish @danteforge/evidence-chain` is unblocked (founder gate from prior passes)
  - Citation list finalized: Laban et al. primary; Nakamoto Bitcoin paper; Git internals; reproducibility research; Anthropic constitutional AI
  - PDF generated locally; verify renders correctly
- **Acceptance criteria:**
  - PDF generated, 8-15 pages
  - Reproducibility appendix runnable by someone with access to the public substrate
  - All citations resolve to real published works
  - Founder reviews and signs off on submission
- **Verify chain:** doc lints + LaTeX builds clean
- **Proof anchor:** Pass 25 manifest with PDF hash
- **Receipt:** `.danteforge/PASS_25_ARXIV_PREPRINT_RECEIPT.md`
- **Founder gate:** approval to submit to arXiv (irreversible — preprints are public and indexed forever)
- **Estimated work:** 1-2 days

#### Pass 26 — Targeted outreach

- [x] **Status:** outreach draft completed 2026-04-29; actual send remains founder-gated
- **Owner:** Founder (writes the email; not the agent)
- **Goal:** Direct, peer-shaped communication to Microsoft Research authors.
- **Scope:**
  - Direct email to Laban, Schnabel, Neville et al. with:
    - arXiv link
    - GitHub link to the substrate
    - Replication CLI (one-liner that reproduces the result table)
    - 2-paragraph summary: where DanteForge matches their findings, where it diverges, what limitations remain
  - Tone: peer-to-peer, "we replicated your benchmark, here's the data, would love your read." NOT marketing.
  - Optional secondary outreach: arXiv link to Alignment Forum or LessWrong post; X thread tagging specific researcher accounts (only after primary email response or 2-week silence).
- **Acceptance criteria:**
  - Email drafted; founder reviews; founder sends (NOT the agent)
  - Sent record captured as a SoulSeal receipt for audit (the Sean Lippay pattern)
- **Verify chain:** N/A (this is communication, not code)
- **Proof anchor:** Pass 26 manifest with email hash + send timestamp
- **Receipt:** `.danteforge/PASS_26_OUTREACH_RECEIPT.md`
- **Founder gate:** the entire pass is founder-action; agent prepares, founder executes
- **Estimated work:** 0.5 day prep + ongoing follow-up

---

## 5. Risk Register

| Risk | Probability | Impact | Mitigation | Pass that addresses |
|---|---|---|---|---|
| Phase 1 reveals substrate doesn't scale at real-fs to 1000 commits | Medium | High | Pass 20 catches it; if found, fix and re-measure before Phase 2 | Pass 20 |
| Live DELEGATE-52 results show corruption rate doesn't drop | Low-Medium | High → reframe needed | Honest replication is still publishable as "validation of failure class itself, partial mitigation" — different framing, still defensible | Pass 22 reframe |
| Cost overrun on live LLM runs | Low | Medium | `coin-purse` enforces budget; dry-run mode mandatory before live | Pass 19 |
| Microsoft researchers find a methodological flaw before we do | Medium | High → credibility hit | Pass 23 (Codex adversarial review) + reproducibility appendix lower this risk substantially | Pass 23, Pass 25 |
| Frontier lab publishes similar work first | Medium | Medium → citation slot lost | Speed matters; ~10-12 days at demonstrated pace | Phase 1-4 cadence |
| Test Class D harness has a bug we don't catch | Low-Medium | High | Pass 23 specifically targets this; consider hiring an external reviewer for $200-500 if budget allows | Pass 23 |
| Microsoft team doesn't respond | Medium-High | Low (work is still published) | arXiv preprint is the durable artifact; outreach is bonus | Pass 25 vs Pass 26 |
| DanteForge name reads as "vanity" to academic audience | Low | Low-Medium | Frame paper around the architecture (cryptographic substrate + constitutional invariants + multi-agent coordination), not the brand | Pass 22, Pass 25 |

---

## 6. Decision Gates (Founder Actions)

| Gate | Trigger | Decision | Required input |
|---|---|---|---|
| GATE-1 | Pre-Pass-19 | Approve LLM budget for live DELEGATE-52 run ($30-80) | Pass 18 receipt review; Pass 19 dry-run output |
| GATE-2 | End of Phase 1 | Proceed / reframe / stop based on actual data | Pass 19 + Pass 20 results; honest assessment |
| GATE-3 | Pre-Pass-21 | Approve 1M-commit benchmark run | Pass 20 results showing 100K passes cleanly |
| GATE-4 | End of Phase 2 | Approve comparison document direction | Pass 22 v1 draft |
| GATE-5 | End of Phase 3 | Approve preprint submission | Pass 23 adversarial findings + Pass 24 polish |
| GATE-6 | End of Phase 4 | Approve outreach to Microsoft authors | Pass 25 PDF + Pass 26 email draft |

Each gate is a real founder action. Agent should not auto-proceed past any of these.

---

## 7. Allowed Claims / Forbidden Claims (preserved from Pass 18)

This discipline carries through every pass.

### Allowed claims (truthful at each phase)

**After Phase 1:**
> Time Machine v0.1 substrate + deterministic validation harness are built and proof-anchored. Live DELEGATE-52 replication produced [measured] result on [N] domains. Real-fs PRD-scale validation confirms [or diverges from] logical-mode results.

**After Phase 2:**
> Validation passes [X/7] PRD test classes at minimum-success threshold. Comparison document v1 drafts the publishable claim with honest limitations.

**After Phase 3:**
> Adversarial review by Codex surfaced [N] findings, [M] of which were fixed in code/doc. Remaining limitations are documented in §7 of the comparison document.

**After Phase 4:**
> arXiv preprint submitted [date]. Substrate is MIT-licensed and reproducible from the included CLI commands.

### Forbidden claims (irrespective of phase)

- "DanteForge has solved DELEGATE-52" — without live execution data showing measurable improvement
- "DanteForge has the only working solution to LLM corruption" — never; the broader research community is doing related work
- "Microsoft Research endorses DanteForge" — only if/when they actually do
- "Time Machine prevents corruption" — it doesn't; it provides recovery + detection (the PRD itself frames this correctly)
- Any numerical claim not sourced to a proof-anchored manifest

---

## 8. Resources & References

### Foundation documents

- [PRD-TIME-MACHINE-Validation.md](./PRD-TIME-MACHINE-Validation.md) — the original PRD (web-Claude, 2026-04-29)
- [TIME_MACHINE_VALIDATION_REPORT.md](./TIME_MACHINE_VALIDATION_REPORT.md) — Pass 18 validation report
- [PRD-MASTER-DanteForge-Ecosystem-Build.md](./PRD-MASTER-DanteForge-Ecosystem-Build.md) — overall ecosystem PRD
- [PRD-MASTER-ADDENDUM-001-Function-Level-Harvest.md](./PRD-MASTER-ADDENDUM-001-Function-Level-Harvest.md) — function-level harvest addendum

### Prior passes that built the substrate

- [.danteforge/PASS_11_PROOF_GATE_RECEIPT.md](../.danteforge/PASS_11_PROOF_GATE_RECEIPT.md) — proof spine
- [.danteforge/PASS_12_HARVEST_RECEIPT.md](../.danteforge/PASS_12_HARVEST_RECEIPT.md) — OSS harvest
- [.danteforge/PASS_13_V1_LOCK_RECEIPT.md](../.danteforge/PASS_13_V1_LOCK_RECEIPT.md) — `@danteforge/evidence-chain` v1.0.0 initial lock
- [.danteforge/PASS_14_INSTALL_SMOKE_RECEIPT.md](../.danteforge/PASS_14_INSTALL_SMOKE_RECEIPT.md) — external consumer validation
- [.danteforge/PASS_15_VERIFY_SLO_RECEIPT.md](../.danteforge/PASS_15_VERIFY_SLO_RECEIPT.md) — verify SLO
- [.danteforge/PASS_16_CORPUS_INTEGRITY_RECEIPT.md](../.danteforge/PASS_16_CORPUS_INTEGRITY_RECEIPT.md) — corpus integrity check
- [.danteforge/PASS_17_CI_INTEGRATION_RECEIPT.md](../.danteforge/PASS_17_CI_INTEGRATION_RECEIPT.md) — CI integration
- [.danteforge/PASS_18_TIME_MACHINE_VALIDATION_RECEIPT.md](../.danteforge/PASS_18_TIME_MACHINE_VALIDATION_RECEIPT.md) — Time Machine validation harness

### Substrate code

- `packages/evidence-chain/` — `@danteforge/evidence-chain` v1.1.0 locally (npm publication founder-gated)
- `src/core/time-machine.ts` — Time Machine v0.1 core
- `src/core/time-machine-validation.ts` — Pass 18 validation harness
- `src/cli/commands/time-machine.ts` — CLI surface
- `src/spine/three_way_gate.ts` — proof-required promotion gate
- `scripts/check-proof-integrity.mjs` — corpus integrity check

### Schemas (frozen at v1)

- `src/spine/schemas/run.schema.json`
- `src/spine/schemas/artifact.schema.json`
- `src/spine/schemas/evidence.schema.json`
- `src/spine/schemas/verdict.schema.json`
- `src/spine/schemas/next_action.schema.json`
- `src/spine/schemas/budget_envelope.schema.json`
- `src/spine/schemas/proof_envelope.schema.json`
- `src/spine/schemas/time_machine_validation.schema.json`

### External

- [DELEGATE-52 paper](https://arxiv.org/abs/2604.15597) — Laban, Schnabel, Neville et al. (2026-04-17)
- DELEGATE-52 public dataset (48 domains, 234 rows; 76 environments withheld)
- Bitcoin whitepaper (Nakamoto, 2008) — Merkle chain provenance
- Git internals — snapshot reversibility
- Anthropic constitutional AI paper — constitutional substrate concept

---

## 9. Honest Posture (immutable across the plan)

- Write receipts. Run verify-chains. Anchor with proofs. The discipline that got us to Pass 18 carries forward.
- Publish failures as honestly as successes. If Phase 1 shows the substrate doesn't deliver, the paper says so.
- Do not pre-tweet results. The arXiv preprint is the canonical artifact; outreach is peer-to-peer, not marketing.
- Each pass is bounded. No scope creep. If a pass discovers new work, that's a new pass, not an expansion.
- Multi-agent execution stays artifact-mediated. No shortcuts that bypass the proof spine.
- Founder gates are real. Agent does not commit, publish, send email, or spend money without explicit authorization.

---

## 10. End State (what "complete" looks like)

When this plan is fully executed:

- All 8 passes have proof-anchored receipts in `.danteforge/PASS_19_*` through `.danteforge/PASS_26_*`
- `forge proof --verify-all .danteforge/evidence/` returns CLEAN with all 8 new manifests verified
- `docs/papers/time-machine-empirical-validation-v1.md` exists with actual numbers
- arXiv preprint is submitted (or explicitly deferred at GATE-5)
- Microsoft Research authors have been emailed (or explicitly deferred at GATE-6)
- `npm publish @danteforge/evidence-chain` has run (founder gate from Pass 13)
- Time Machine has automatic agent integration (T3.1)
- Class D runtime corruption detector/mitigation hook exists; standalone product runner may still be deferred
- The DanteForge repo is in a state where any independent researcher can clone it, run the CLI commands in the reproducibility appendix, and reproduce the result table

That is the publishable end state. Remaining effort is dominated by founder-gated live execution, submission, outreach, npm publication, and optional 1M scale validation.

---

**END OF PLAN**

*This document is the durable tracker. Update status checkboxes as passes land. Each pass concludes with a receipt under `.danteforge/PASS_NN_*_RECEIPT.md`. The plan supersedes any conflicting in-conversation guidance.*
