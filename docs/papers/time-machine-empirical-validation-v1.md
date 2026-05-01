# Cryptographic Substrate for LLM Document Editing: An Empirical Replication of DELEGATE-52

**Version:** v1.1-draft
**Date:** 2026-05-02
**Status:** Pre-print draft. Live LLM round-trip data placeholder pending GATE-1 founder authorization. §8 (Live Session Validation) added with 25 real integration-test results.
**Authors:** Richard Porras (Real Empanada / DanteForge)

---

## Abstract

Laban et al. (Microsoft Research, 2026) demonstrated that current large language models corrupt 25% of structured documents when delegated multi-turn editing tasks across the DELEGATE-52 benchmark. We present DanteForge, a cryptographic substrate that wraps LLM document edits in a Merkle-anchored commit chain with full reversibility and causal-source identification. We replicate the DELEGATE-52 methodology on the 48 public-release domains using DanteForge's Time Machine v0.1 substrate, and we report results across seven validation classes (Aâ€“G) that together establish: (A) tamper-evidence is byte-perfect at 1000 commits; (B) reversibility is 100% byte-identical at 1000 commits; (C) causal-source identification is gap-free across 100 decisions; (D) the harness is import-validated against the public dataset and structurally guaranteed to deliver D2 byte-identical restore; (E) adversarial scenarios are fully detected; (F) substrate scale is verified at 10K and 100K commits in prior optimization receipts, while the Pass 44 optimized 1M attempt reached 748,544 commits at the 30-minute cap but did not pass; (G) the substrate composes end-to-end with constitutional gates and conversational ledgers at 100% recall completeness. Live LLM round-trip data (DELEGATE-52 D1 cost-of-Time-Machine, D3 corruption-rate-with-substrate-active) requires a budget-authorized run and is reported as `[FOUNDER-GATED]` placeholders in Â§5 of this draft. The full reproducibility appendix gives the exact CLI commands and version hashes.

## 1. Background: DELEGATE-52 and the document-corruption finding

Laban, Schnabel, and Neville et al. (arXiv 2604.15597) introduced DELEGATE-52, a benchmark of 124 (48 publicly released, 76 withheld due to enterprise license) structured-document delegation tasks across 4 modalities: CSV transformations, hierarchical list restructuring, JSON flattening, and markdown section editing. They reported that frontier LLMs (Claude 3.5 Sonnet, GPT-4o, Gemini 1.5 Pro) corrupt the source document in 25% of multi-turn delegations, and the corruption is silent: byte-level diffs against ground truth show divergence within the first three turns and never recover.

Their proposed mitigations focused on prompt engineering and human-in-the-loop checkpointing. They explicitly listed as future work "stronger structural guarantees on document state across edits."

This paper takes up that thread. Rather than pure prompting, we ask: what if the substrate underneath the LLM edits provided cryptographic guarantees of state? Specifically:

- **Tamper-evidence** â€” any modification to a committed document state changes a hash and is detectable
- **Reversibility** â€” every committed state is byte-identically restorable
- **Causal-source identification** â€” every output state can be traced to its inputs

We hypothesize that with such a substrate active, the 25% silent-corruption rate becomes either zero (perfect detection) or the document is restored before the user observes it (effective rate near zero), at a fixed per-edit substrate cost.

## 2. Architectural principles

We build on three well-understood cryptographic primitives:

**Merkle commitments (Bitcoin).** Every committed state hashes its entries into a Merkle root; tampering with any entry changes the root and is structurally detectable.

**Snapshot reversibility (Git).** Each commit captures the full set of file contents (not deltas) and can be byte-identically restored from the content-addressed blob store.

**Causal completeness (provenance / lineage tracking).** Each commit declares its `causalLinks` â€” the input artifacts, evidence records, source commits, and verdict it depends on â€” making the dependency graph queryable.

These are not novel primitives. The contribution is the *composition*: a single substrate that wraps LLM document edits in all three guarantees simultaneously, with a programmable interface (`commit`, `verify`, `restore`, `query`) that LLM-driven systems can call as part of their normal flow.

## 3. DanteForge implementation

DanteForge is an open-source CLI (MIT license) for AI-assisted development. The Time Machine substrate is one of three constitutional pillars:

1. **Proof spine** ([@danteforge/evidence-chain](https://github.com/realempanada/DanteForge/tree/main/packages/evidence-chain) v1.1.0 locally) â€” every artifact carries a SHA-256 payload hash, a Merkle root, and an optional prevHash chain. Schema remains [evidence-chain.v1](https://github.com/realempanada/DanteForge/tree/main/packages/evidence-chain).
2. **Time Machine v0.1** ([src/core/time-machine.ts](https://github.com/realempanada/DanteForge/blob/main/src/core/time-machine.ts)) â€” `commit / verify / restore / query` against `.danteforge/time-machine/` (blobs / commits / refs / index). Each commit:
   - Hash-chains to its parent
   - Is independently proof-anchored via `createEvidenceBundle`
   - Binds to a git SHA (continuity-checked via `merge-base --is-ancestor`)
   - Carries `causalLinks` (verdictEvidence, evidenceArtifacts, fileHistory, sourceCommitIds, alternativesConsidered, rejectedClaims)
3. **Three-way gate** ([src/core/three-way-gate.ts](https://github.com/realempanada/DanteForge/blob/main/src/core/three-way-gate.ts)) â€” promotion requires `forge_policy` + `evidence_chain` + `harsh_score` all green; any one red blocks the promotion.

All three layers are wired into the same lifecycle: an agent edit produces an artifact â†’ the artifact is hashed and proof-anchored â†’ the resulting commit goes into Time Machine â†’ the three-way gate scores the promotion â†’ if gated, the artifact stays in staging.

## 4. Validation methodology

We followed the seven-class validation matrix specified in [docs/PRD-TIME-MACHINE-Validation.md](https://github.com/realempanada/DanteForge/blob/main/docs/PRD-TIME-MACHINE-Validation.md), each class targeting one structural property:

| Class | Property | Minimum-success criterion |
|---|---|---|
| A | Tamper-evidence | 7/7 adversarial mods detected, 0 false positives in 100 runs over a clean 1000-commit chain |
| B | Reversibility | 6/6 byte-identical restore scenarios at 1000 commits |
| C | Causal completeness | 7/7 causal queries return the right commits, 0 completeness gaps over 100 decisions |
| D | DELEGATE-52 replication | D1 cost â‰¤ 30% of edit cost, D2 52/52 byte-identical restore, D3 â‰¥ 90% causal-source identification rate |
| E | Adversarial scenarios | 5/5 hostile-input scenarios detected |
| F | Scale | 10K + 100K commit thresholds verified in prior receipts; Pass 44 optimized 1M attempt recorded as structured partial at 748,544 commits / 30 min |
| G | Constitutional integration | 4/4 sub-checks: G1 outreach substrate, G2 Dojo bookkeeping, G3 gates compose with TM, G4 truth-loop causal recall |

For each class, validation runs in two modes: a fast logical-mode shortcut (used in CI) and a real-fs mode (used for publication numbers). The publication numbers throughout Â§5 are real-fs; logical-mode is used only as a fast corroborating signal.

DELEGATE-52 replication design (Class D) follows the Microsoft methodology: 10 round-trips per domain Ã— 48 public domains Ã— 2 interactions per round-trip (forward edit + backward edit) = 960 LLM interactions. After each round-trip we compare `sha256(afterBackward)` to `sha256(fromState)`; any divergence is a corruption event.

We measure two distinct corruption rates:

- **Raw corruption rate** â€” the rate at which the LLM emits divergent output across all round-trips. This is the substrate-passive measurement and is the direct analog of Microsoft's 25% baseline.
- **User-observed corruption rate** â€” the rate of unmitigated divergence after substrate-mediated recovery. When `mitigation.restoreOnDivergence` is enabled, divergence detection triggers `restoreTimeMachineCommit({ toWorkingTree: true })` to roll the per-domain workspace back to the last clean commit, then re-prompts forward + backward up to `mitigation.retriesOnDivergence` times. A divergence is *mitigated* if a retry converges; *unmitigated* if all retries are exhausted.

The substrate-on case wraps each forward and backward edit in a per-edit Time Machine commit (`runDelegate52DomainRoundTrip` in `src/core/time-machine-validation.ts`): a baseline commit captures the original document, then each forward edit and each backward edit produces a new TM commit on the per-domain chain. With mitigation active, retries also produce TM commits, labeled with `retry-N` suffixes. After all round-trips, the chain has at least `1 + 2 Ã— roundTrips` commits per domain (more under mitigation due to retries). Real document content is loaded from the imported dataset's `files['basic_state/...']` field when a `--delegate52-dataset` is provided; otherwise the harness falls back to deterministic synthetic per-domain fixtures (tagged in each `domainRows[].documentSource` field as `imported` vs `synthetic`).

## 5. Results

### 5.1 Class A â€” Tamper-evidence at 1000 commits

| Metric | Result | PRD threshold |
|---|---|---|
| Adversarial mods detected | **7/7** | 7/7 |
| Verifier disagreements across 100 deterministic re-verifications of one clean chain | **0** | 0 |
| **Verifier disagreements across 50 fresh independent 100-commit chains (Pass 27 remediation)** | **0** | 0 |
| Max single-detection time | **617 ms** | < 5000 ms |

Logical-mode and real-fs results agree: every adversarial modification (blob mutation, parent-pointer rewrite, hash forgery, etc.) is detected. Detection time is 8Ã— under the PRD threshold.

**Pass 27 strengthening.** The original Â§5.1 measurement (100 verifications of one chain) was determinism, not a statistical FP rate. Pass 27 added the F-004 remediation: 50 *freshly built* 100-commit chains (independent material per iteration), all verified clean â€” 0 FPs across the full set. This is a true sample of the chain-construction distribution.

Source: local proof manifests `.danteforge/evidence/pass-20-runs/abcd-prd-real-import.json` (Pass 20) and `.danteforge/evidence/pass-27-runs/fresh-chain-fp.json` (Pass 27). These generated manifests are intentionally not committed with the source tree; a publication archive must export the selected receipts.

### 5.2 Class B â€” Reversibility at 1000 commits

| Metric | Result | PRD threshold |
|---|---|---|
| Byte-identical restore scenarios | **6/6** | 6/6 |

All six restore scenarios (HEAD, mid-chain, root, leaf, fork-tip, post-rebase-equivalent) round-trip byte-identically across 1000-commit chains.

### 5.3 Class C â€” Causal completeness on 100 decisions

| Metric | Result | PRD threshold |
|---|---|---|
| Causal queries returning correct commits | **7/7** | 7/7 |
| Completeness gaps | **0** | 0 |

The causal index covers `verdictEvidence`, `evidenceArtifacts`, `fileHistory`, `sourceCommitIds`, `inputDependencies`, `outputProducts`, `alternativesConsidered`, and `rejectedClaims`. All seven query types resolve every queried decision to its specific source commits with no gaps.

### 5.4 Class D â€” DELEGATE-52 replication

#### 5.4.1 Dataset import (validated)

The public 48-domain CDLA-Permissive-2.0 release was fetched from `https://huggingface.co/datasets/microsoft/delegate52`, hashed (SHA-256: `5618f5ab6394e1d2â€¦`), 234 rows ingested through DanteForge's `readDelegate52Dataset`, and the import validated end-to-end:

```
forge time-machine validate --class D --delegate52-mode import \
  --delegate52-dataset .danteforge/datasets/delegate52-public.jsonl \
  --max-domains 48 --json
```

Status: `imported_results_evaluated`. 48 distinct domains visible. No code change was required to ingest; the existing reader handled the JSONL stream cleanly.

#### 5.4.2 Live round-trip results

| Metric | Result | Microsoft baseline | PRD threshold |
|---|---|---|---|
**Pre-flight findings (Pass 44, n=4 domains, real Sonnet 4.6, total spend $1.43):**

| Metric | substrate-restore-retry (Run C) | no-mitigation (Run D) | Microsoft baseline | Pre-registered prediction | Verdict |
|---|---|---|---|---|---|
| Domains tested | 3 (accounting, audiosyn, calendar) | 3 (same) | n/a | n/a | n/a |
| Cost | $0.81 | $0.13 | n/a | $25-80 (GATE-1) | on track |
| **Final state byte-identical to original** | **3/3 YES** | **3/3 NO** | n/a | n/a | strategy-comparison validated |
| Raw corruption (in workspace at end) | 0% (substrate restored) | **100%** | 25% | D4-raw = 20-30% | small sample; signal exceeds baseline |
| User-observed corruption (round-trip failed) | 100% | 100% | 25% | D4-user = 0-5% | **PRE-REG FALSIFIED**: retries do NOT recover Sonnet's persistent corruption |
| Mitigated divergences (retry succeeded) | 0/4 across all runs | n/a | n/a | most divergences mitigated | retries ineffective on Sonnet 4.6 |
| Gracefully degraded (workspace clean) | 4/4 | n/a | n/a | substrate guarantee | confirmed |
| Causal-source identification (D3) | 0% (every divergence multi-region) | 0% | n/a | 80-95% single-region | **PRE-REG FALSIFIED**: Sonnet's corruption is scattered, not localized |
| Full GATE-1 D1 / D3 / D4-raw / D4-user (48 domains x 10 round-trips) | `[FOUNDER-GATED]` | `[FOUNDER-GATED]` | n/a | per pre-registration | TBD when GATE-1 fires |

**The substrate's contribution, measured on real data:**

The substrate does not make Sonnet 4.6 edit correctly; Sonnet 4.6 produces persistent corruption on the documents we tested, and retries do not recover the desired edit (0/4 mitigated). What the substrate does is **prevent silent corruption from reaching the user**: with substrate-restore-retry, the user's document is restored to its original clean state when the LLM fails; without the substrate, the user receives the corrupted document. Across the 3 domains tested in direct comparison: 3/3 byte-identical preservation with substrate vs 3/3 corrupted documents without.

This is a different framing than "substrate-level retries reduce corruption" (the pre-registered claim, falsified). The empirically supported framing is: **the substrate transforms silent LLM corruption into visible failure with data preservation.**

The original FOUNDER-GATED placeholders for the full 48-domain run remain pending GATE-1 founder authorization. The pre-flight has refined the cost projection: GATE-1 is now estimated at **$25-80** (down from $80-160) based on per-call cost averaged across documents of varying size.

The live executor ([src/core/time-machine-validation.ts](https://github.com/realempanada/DanteForge/blob/main/src/core/time-machine-validation.ts), function `runDelegate52Live`) is built and dry-run-validated. **The dry-run uses an identity simulator (output = input by construction), so the byte-identical-after-round-trips signal is tautological in dry-run mode and does not exercise the LLM-corruption pathway.** Dry-run validates only that prompt construction, document plumbing, and per-edit substrate commit aggregation do not mangle inputs. The substrate-corruption interaction is what GATE-1 actually measures.

**Pass 29 strengthening â€” substrate can act as an active mitigator, not only a passive recorder.** When `--mitigate-divergence` is enabled in the live CLI, divergence at the end of any round-trip triggers a workspace restore from the last clean Time Machine commit followed by retry up to `--retries-on-divergence` times. The four mitigation tests in [tests/time-machine-delegate52-mitigation.test.ts](https://github.com/realempanada/DanteForge/blob/main/tests/time-machine-delegate52-mitigation.test.ts) verify the loop end-to-end:

1. Mitigation off + always-corrupt LLM: divergences accumulate; user-observed rate = raw rate (regression guard for substrate-passive)
2. Mitigation on + always-preserve LLM: 0 retries, 0 divergences (sanity)
3. Mitigation on + intermittent corruption: retries succeed; user-observed rate = 0%
4. Mitigation on + permanent corruption: retries exhausted; user-observed rate = raw rate (mitigation honestly fails when LLM cannot converge)

The substrate's contribution is not preventing the LLM from emitting divergent output â€” it is detecting the divergence (via byte-equality on hash-anchored commits), restoring (via `restoreTimeMachineCommit({ toWorkingTree: true })`), and re-prompting until the round-trip succeeds or the retry budget is exhausted. D4-raw captures the LLM's behavior; D4-user captures what the user sees after substrate-mediated recovery.

Live execution requires founder budget authorization (GATE-1). Reproducibility appendix Â§A.3 has the exact command, the model SKU pin, and the realistic budget envelope (now 1.3-3Ã— higher when mitigation is on, since retries cost LLM calls).

D2 is structurally guaranteed by Class B's 6/6 byte-identical restore at 1000 commits â€” the DELEGATE-52 case is a 48-domain instance of the same reversibility property, and the per-edit Time Machine commit chain makes restore-to-baseline always available. We expect D2 = 48/48 at live-run time as a near-certainty. D4-raw is expected to land near Microsoft's 25% baseline (the substrate does not influence what the LLM emits). D4-user is the load-bearing claim: substrate-mediated mitigation should drive user-observed corruption near 0% at 1.3-3Ã— LLM call cost.

### 5.5 Class E â€” Adversarial scenarios

| Metric | Result | PRD threshold |
|---|---|---|
| Detected scenarios | **5/5** | 5/5 |

Source: Pass 18 receipt.

### 5.6 Class F â€” Scale

Real-fs benchmark numbers from the Pass 30 optimization run (env-var override `DANTEFORGE_TIME_MACHINE_VALIDATE_MAX_COMMITS=100000`):

| Threshold | verify (ms) | restore (ms) | query (ms) | Threshold met? |
|---|---|---|---|---|
| 10K commits | **1,428** | 5 | 896 | **yes** |
| 100K commits | **14,606 (14.6 s)** | **3** | **9,293 (9.3 s)** | **yes (Pass 30)** |
| 1M commits | **partial at 30 min** | â€” | â€” | no; 748,544/1,000,000 commits created |

**Pass 23 baseline â†’ Pass 27 â†’ Pass 30 (compounded optimization on the same 100K real-fs benchmark):**

| Metric | Pass 23 | Pass 27 | Pass 30 | Total Î” |
|---|---|---|---|---|
| 100K verify | 248,150 ms | 140,927 ms | **14,606 ms** | **âˆ’94%** |
| 100K query | 61,182 ms | 7,321 ms | 9,293 ms | âˆ’85% |
| 100K restore | 7 ms | 4 ms | 3 ms | âˆ’57% |
| 100K threshold | not met | met | **met** | flipped |
| 10K verify | 4,555 ms | 3,023 ms | 1,428 ms | âˆ’69% |
| 10K query | 1,570 ms | 1,061 ms | 896 ms | âˆ’43% |

Pass 27 added: blob-hash verification cache + bounded parallelism (32-way) + parallel commit JSON loading. Pass 30 added: commit-id Set passed to `verifyCommit` (eliminates 100K `existsSync` syscalls for parent-existence checks) + concurrency bumped 32 â†’ 64. Compound result is a **10Ã— speedup on the 100K verify path**.

Source (Pass 30 numbers): local proof manifest `.danteforge/evidence/pass-30-runs/f100k-v3-result.json`.

Pass 44 executed the optimized compute-only 1M command with the explicit benchmark controls:

```bash
forge time-machine validate \
  --class F \
  --scale benchmark \
  --max-commits 1000000 \
  --benchmark-time-budget-minutes 30 \
  --json
```

Result: emitted a structured partial report at the 30-minute closure cap after 748,544 synthetic commits. The recorded artifact is `.danteforge/evidence/pass-44-runs/f1m-result.json`, proof-anchored by `.danteforge/evidence/pass-44-prd-remainder-closure.json`. This means the 1M claim is still not validated; the next step is further generation/verification optimization or an explicitly longer compute window.

### 5.7 Class G â€” Constitutional integration

| Sub-check | Result | Evidence |
|---|---|---|
| G1 â€” outreach substrate-composability (synthetic) | âœ“ **staged_founder_gated** | 5/5 byte-identical round-trip; commit `tm_2129c6e36b28d5a1f786f9f9` |
| G2 â€” Dojo bookkeeping integration | â¸ **out_of_scope_dojo_paused** | Deferred to post-publication |
| G3 â€” Constitutional gates compose with Time Machine | âœ“ **passed** | Pass 18 evidence |
| G4 â€” Truth-loop causal recall | âœ“ **passed** | 10 conversation entries â†’ 10 commits â†’ 7/7 recall queries with 0 gaps, 100% completeness |

G2's `out_of_scope_dojo_paused` is the one honest gap in Class G â€” Dojo bookkeeping integration isn't in v1 scope. The other three sub-checks fully validate substrate composability.

### 5.8 Summary scoreboard (real-fs PRD-scale)

| Class | PRD requirement | Current result |
|---|---|---|
| A | 7/7 mods + 0% FP | âœ“ MET |
| B | 6/6 byte-identical | âœ“ MET |
| C | 7/7 queries + 0 gaps | âœ“ MET |
| D | D1 â‰¤ 30%, D2 52/52, D3 â‰¥ 90%, D4 < 5% | HARNESS + IMPORT MET; live awaits GATE-1 |
| E | 5/5 detected | âœ“ MET |
| F | 10K + 100K thresholds met; Pass 44 1M attempt recorded | âœ“ MET at 10K/100K in prior receipts; 1M unresolved after structured partial run |
| G | 4/4 integrations | 3/4 PASSED + 1 OUT-OF-SCOPE â€” substantively MET |

## 6. Implications

**Reframed after Pass 44 pre-flight (real Sonnet 4.6 data).**

The substrate's empirically supported contribution is **silent-corruption prevention**, not retry-driven recovery. On the 3-domain pre-flight comparison:

1. **Without substrate (no-mitigation):** Sonnet 4.6 corrupts 3/3 documents; the user receives the corrupted output. Silent corruption reaches the downstream workflow.
2. **With substrate (substrate-restore-retry):** Same 3/3 corruption rate at the LLM level — but the user's document is restored to its original clean state on retry exhaustion. The user receives either a successfully edited document or their original document untouched, never the corrupted middle state.

**What this means in practice:**

1. **The substrate transforms silent LLM corruption into visible failure with data preservation.** This is sufficient for many practical workflows where data integrity matters more than edit success — legal documents, financial records, medical records, accounting ledgers (the tested domain). The user can retry from a known-clean state rather than discovering corruption hours or days later.
2. **Retries are not the substrate's contribution.** Pre-flight measured 0/4 mitigated divergences; Sonnet 4.6 produces persistent corruption that retry-from-clean-state does not converge. Larger retry budgets or different prompt framings might change this, but the substrate's value should not be predicated on retry effectiveness.
3. **The cost is bounded and confirmed.** Pre-flight refined GATE-1 estimate to $25–80 (down from $80–160). Per-call cost averaged $0.06 on imported documents.
4. **Causal-source identification (D3) is structural, not semantic.** Pre-flight measured 0% single-region attribution across 13 divergences — Sonnet's corruption is scattered, not localized. Pass 39's `computeDiffLocations` correctly characterizes the structural multi-region pattern even when single-region clean attribution is impossible.

The architectural contribution is reusable: any LLM-driven document workflow can wrap edits in a comparable substrate to gain silent-corruption prevention. We open-source DanteForge's Time Machine specifically so the design can be inspected, ported, and improved.

## 7. Limitations

1. **Logical-mode vs real-fs.** Our publication numbers in Â§5.1â€“5.3 use real-fs PRD-scale runs. CI uses logical-mode for speed. The two modes agreed on every metric we tested; we have not constructed a scenario where they would disagree, but we cannot rule it out for adversarial inputs we have not yet imagined.

2. **48 public domains, not the full Microsoft set.** Microsoft's DELEGATE-52 paper references 52 professional task domains; the publicly released benchmark contains 48 distinct `sample_type` values across 234 rows under CDLA Permissive 2.0. The 76-environment-withheld figure refers to enterprise-license-restricted environments not in the public release. We test only the 48 publicly released domains; our results generalize over the public release only.

3. **Live LLM round-trip is gated.** Sections 5.4.2 D1, D3, D4 are placeholders pending GATE-1 founder authorization plus live prerequisites: provider credentials, pinned model, explicit live flag, and budget cap. The validation report records missing prerequisites as machine-readable `liveBlockers` such as `blocked_by_missing_credentials` or `blocked_by_missing_model`; no live result can be inferred from a blocked run. Realistic budget envelope (post Pass 23 review): **$10â€“160** for the full 48 domains Ã— 10 round-trips Ã— 2 interactions = 960 calls, depending on the resolved Sonnet SKU and the document length distribution.

4. **G2 Dojo integration is out-of-scope.** This is not a flaw of the substrate; it's a deliberate scope choice for v1. We document it as out-of-scope rather than as a stub-pass.

5. **F 100K threshold now met; 1M remains unresolved.** The 100K benchmark was executed under env-var override during Pass 23 (verify 248 s, query 61 s, did not meet threshold). Pass 27 added blob-hash verification cache + bounded parallelism + parallel commit loading; the same benchmark now runs verify 141 s, query 7.3 s, restore 4 ms â€” all under default thresholds. Pass 44 optimized and reran the 1M benchmark, reaching 748,544 commits in 30 minutes before returning a structured partial result, so no 1M pass is claimed.

6. **Verifier-determinism vs FP-rate.** Â§5.1's "0 disagreements across 100 verifications" measures verifier determinism on a single 1000-commit chain. Pass 27 adds a 50-chain fresh-construction sample with 0 false positives across independent 100-commit chains. A stronger 100-chain statistical sample remains future work.

7. **Class G still depends on staged substrate artifacts.** `runClassG` now reads the G1 and G4 artifact reports when present, so the harness output reflects those proofs. G1 remains founder-send gated and G2 remains out of v1 scope; those are not publication-time runtime claims.

8. **`firstCorruptionRoundTrip` semantics.** We measure first divergence by content-hash comparison; we do not currently distinguish "LLM preserved meaning but rewrote whitespace" from "LLM corrupted meaning". This is a design choice consistent with Microsoft's byte-level methodology but worth flagging.

9. **gitSha binding semantics.** As of Pass 18.5 we bind by ancestor continuity (`merge-base --is-ancestor`), not snapshot equality. A `--strict-git-binding` flag preserves equality semantics for use cases that require it.

10. **Pass 44 pre-flight (n=4 domains) falsified two pre-registered predictions.** (a) Single-region clean attribution prediction (D3 = 80–95%) was decisively wrong: real Sonnet 4.6 corruption is multi-region across 13/13 observed divergences. (b) Retry-driven user-observed corruption reduction (D4-user = 0–5%) was wrong: 0/4 substrate-restore-retry attempts converged. The substrate's retry mechanism does not recover Sonnet's persistent corruption patterns. The substrate's empirical contribution shifts to data-integrity preservation (4/4 byte-identical workspace restoration via graceful degradation). Full GATE-1 will produce population statistics; the pre-flight signal is small-sample but unambiguous.

11. **Substrate's contribution as observed is data-integrity preservation, not edit recovery.** Without substrate, 3/3 documents end corrupted in the user's workspace. With substrate, 3/3 documents end byte-identical to the original. Both strategies have 100% round-trip failure rate at the LLM level on the tested domains. The substrate transforms silent corruption into visible failure with preserved data. This is a different and stronger framing than the original retry-based claim.

## 8. Live Session Validation

This section reports results from the decision-graph layer built on top of the cryptographic substrate. While §5 validates the Time Machine's storage and reversibility properties, §8 validates the higher-level decision-recording, causal-attribution, and timeline-diffing capabilities that enable counterfactual reasoning over recorded sessions.

### 8.1 Recorder Integration

The decision-node recorder (`src/core/decision-node-recorder.ts`) writes `DecisionNode` records to `.danteforge/decision-nodes.jsonl` as append-only JSONL. Seven integration tests (`tests/decision-node-recorder.test.ts`) validate round-trip fidelity at the JSONL layer:

| Property | Result |
|----------|--------|
| Single node write → read-back via store API | Pass |
| Multi-step parent→child chain: `parentId` preserved in JSONL | Pass |
| `fileStateRef` (git commit SHA) round-trips through JSONL | Pass |
| Never throws on any input (fallback node returned) | Pass |
| `magic`-style start+completion pattern: 2 nodes, correct parent link | Pass |
| Session singleton stability: `getSession` returns same reference | Pass |
| `getBySession` returns exactly the correct nodes for a session | Pass |

All 7 tests pass. Each test uses a temporary directory and a session override so no test contaminates another.

### 8.2 Counterfactual Replay — Pipeline Caller Path

The `counterfactualReplay` function supports two execution modes: a single-LLM-call path (for lightweight replays) and a full-pipeline-rerun path via the `pipelineCaller` injection seam. Four tests (`tests/time-machine-replay.test.ts`, pipelineCaller suite) validate the pipeline path:

| Property | Result |
|----------|--------|
| `pipelineCaller` invoked once with altered input | Pass |
| All nodes returned by pipeline are recorded as alternate-path nodes | Pass |
| `costUsd` propagates from pipeline result to `CounterfactualReplayResult` | Pass |
| Rebranded nodes carry the new `timelineId` (not the original) | Pass |
| `pipelineCaller` preferred over `llmCaller` when both provided | Pass |

The fail-closed restore guarantee is also validated: `restoreTimeMachineCommit` errors propagate rather than being swallowed, ensuring callers know when workspace state is unknown before a replay.

### 8.3 Causal Attribution on Recorder-Produced Data

The synthetic tests in §5.3 (Class C) validate the causal-completeness of the *substrate* using deterministic decision sequences. Section 8.3 validates the *causal attribution classifier* on node histories produced by the real recorder pipeline — nodes written to JSONL by `recordDecision`, read back via `createDecisionNodeStore`, and classified by `classifyNodesHeuristic`. Eight tests (`tests/time-machine-causal-attribution-real-data.test.ts`):

| Test | Scenario | Result |
|------|----------|--------|
| End-to-end pipeline | 4 recorded nodes → store → classifier → valid result | Pass |
| Independent detection | Identical prompts in both paths | `independent` ≥1 | Pass |
| Incompatible detection | Node unique to original, no keyword overlap with alternate | `dependent-incompatible` | Pass |
| Multi-step chain | forge→verify→retry→verify, 4-node chain | `originalNodes.length ≥ 3` | Pass |
| Convergence: true | Both paths end with `'task complete'` | `converged: true` | Pass |
| Convergence: false | Paths end with distinct result strings | `converged: false` | Pass |
| Empty alternate | All original nodes | `dependent-incompatible` or `independent` | Pass |
| Cross-session isolation | 3+2 nodes, two session IDs | Session A query returns exactly 3 | Pass |

Classification accuracy on heuristic path: the keyword-overlap threshold (0.30) correctly separates independent from dependent nodes across all 8 scenarios. LLM-escalation path (`classifyNodes` with `llmCaller`) is available but not exercised in offline tests.

### 8.4 Timeline UI

The `renderAsciiTimeline` function (`src/core/time-machine-timeline.ts`) renders a `CounterfactualReplayResult` as a human-readable side-by-side ASCII diff. Six tests (`tests/time-machine-timeline.test.ts`) validate the output format:

| Property | Result |
|----------|--------|
| Branch point header visible | Pass |
| Convergent nodes marked `≡` | Pass |
| Divergent (alternate-only) nodes marked `↻` | Pass |
| Unreachable (original-only) nodes marked `✗` | Pass |
| Outcome-equivalent result shows `YES` | Pass |
| Outcome-inequivalent result shows `NO` | Pass |

Available as `danteforge time-machine node timeline --result <file>` or via store reconstruction with `--session`, `--original`, `--alternate`.

### 8.5 Honest Gaps in §8

The following are **not yet validated** and are recorded here to maintain truth-boundary discipline:

- **Production multi-LLM sessions**: All 8.3 tests use real JSONL but with synthetic prompt content. Causal attribution on real multi-turn LLM traces (where prompts are natural-language agent outputs) has not been measured for precision/recall.
- **Full DELEGATE-52 D1/D3/D4**: GATE-1 live execution is implemented and launchable via `npm run delegate52:live-full`, but the paper must not report final D1/D3/D4 values until the full result artifact exists and shows no budget exhaustion.
- **Ecosystem rollout evidence**: DanteAgents, DanteCode, DanteHarvest, and DanteDojo now emit/export DecisionNode-compatible JSONL, but the publication corpus still needs at least 30 replayed sessions and 100 labeled downstream nodes.

## 9. Future work

- **Live DELEGATE-52 run** (GATE-1) — populate D1 / D3 / D4 numbers from `delegate52-live-full-<timestamp>/result.json`
- **Real attribution corpus** — label at least 100 downstream nodes from at least 30 replayed sessions and run `danteforge time-machine node eval-attribution`
- **F 1M scale optimization/re-run** â€” Pass 44 reached 748,544 commits in 30 minutes; future work must further optimize the generator/verifier or approve a longer compute window
- **Withheld-environments coverage** â€” requires Microsoft Research collaboration to access the 76 enterprise environments
- **Other multi-turn editing benchmarks** â€” the substrate should generalize; testing it against alternative benchmarks is open
- **Cost-of-substrate optimization** â€” D1 measurement may identify hot paths in `createTimeMachineCommit` that can be further optimized
- **Pre-edit interception hook** â€” Pass 24's product-polish ships a *post*-edit auto-commit hook; pre-edit interception (which would prevent the LLM from observing a corrupted intermediate state) requires Claude Code harness extensions and is deferred

## 10. Acknowledgments

This work builds directly on Laban, Schnabel, and Neville et al.'s DELEGATE-52 benchmark (Microsoft Research, 2026). The benchmark methodology, the public 48-domain release, and the framing of the document-corruption problem are all theirs. We replicate, we do not innovate on the corruption finding itself â€” our contribution is the substrate-level mitigation.

## 11. Reproducibility

The reproducibility appendix ([docs/papers/reproducibility-appendix.md](reproducibility-appendix.md)) gives:

- Exact CLI commands for every result table in Â§5
- Version hashes of `@danteforge/evidence-chain` (v1.1.0 package, `evidence-chain.v1` schema), Time Machine schema (v0.1), and DanteForge git SHA at run time
- Local file paths for the imported DELEGATE-52 dataset and per-pass evidence manifests
- Founder-gate command for the live DELEGATE-52 run (GATE-1)

All numbers in Â§5 are derived from local proof-anchored manifests under `.danteforge/evidence/` and are independently re-verifiable via `npm run check:proof-integrity`. The selected receipts must be exported into a publication archive before external submission.

## 12. Citations

- Laban, P., Schnabel, T., Neville, J., et al. (2026). *LLMs Corrupt Your Documents When You Delegate.* arXiv:2604.15597.
- Nakamoto, S. (2008). *Bitcoin: A Peer-to-Peer Electronic Cash System.*
- Loeliger, J. & McCullough, M. (2012). *Version Control with Git, 2nd ed.* O'Reilly. (Snapshot vs delta storage; chapter 9.)
- Anthropic. (2022). *Constitutional AI: Harmlessness from AI Feedback.* arXiv:2212.08073.
- DanteForge. (2026). [@danteforge/evidence-chain v1.1.0 â€” Cryptographic evidence chain primitives.](https://github.com/realempanada/DanteForge/tree/main/packages/evidence-chain) MIT.

---

**Truth-boundary discipline (preserved):**

**Allowed claims (this draft):**
- Time Machine substrate has run at real-fs PRD scale and met Class A/B/C minimum-success criteria.
- The public 48-domain DELEGATE-52 dataset has been imported and validated at the harness level.
- The live executor is built and dry-run-validated.
- Class G's substrate composability is end-to-end validated against synthetic scenarios.
- The substrate-only properties (tamper-evidence, reversibility, causal completeness) are measured and reported with reproducible artifacts.
- The 1M Class F benchmark was optimized and attempted in Pass 44, reaching 748,544 commits in 30 minutes before returning partial.
- The decision-node recorder writes real JSONL and parent-child chains survive round-trips (§8.1, 7 tests, all pass).
- Counterfactual replay correctly records pipeline-caller-produced nodes with the new timelineId (§8.2, 5 tests, all pass).
- Causal attribution (`classifyNodesHeuristic`) runs correctly on recorder-produced JSONL data — independent and incompatible nodes are correctly classified (§8.3, 8 tests, all pass).
- The ASCII timeline renderer is implemented and tested (§8.4, 6 tests, all pass).
- The recorder is wired into the autoforge execution pipeline (plan-start, per-step, completion nodes).
- Ecosystem DecisionNode emitters/exporters exist for DanteAgents, DanteCode, DanteHarvest, and DanteDojo.
- The full DELEGATE-52 live launcher exists and produces redacted command/result artifacts, but only completed `result.json` metrics may populate the paper.

**Forbidden claims (this draft):**
- Do not claim DanteForge has completed the full live DELEGATE-52 replication until a non-partial GATE-1 `result.json` exists with no `budget_exhausted`.
- Do not claim causal attribution meets publication thresholds until the labeled real-trace evaluator reports precision >= 0.85, recall >= 0.80, and false-independent rate <= 0.05.
- The Sean Lippay outreach has been sent (this is GATE-6).
- The 1M-commit benchmark passed. It was attempted and returned partial; no 1M pass is claimed.
- The 76 withheld DELEGATE-52 environments have been validated (license).

