# Pre-Registration — DELEGATE-52 Substrate Replication Predictions

**Document version:** v1.0
**Locked at git SHA:** *(to be filled by founder before commit; commit this file BEFORE GATE-1 fires)*
**Author:** Richard Porras (Real Empanada / DanteForge)
**Companion paper:** [time-machine-empirical-validation-v1.md](time-machine-empirical-validation-v1.md)
**Companion appendix:** [reproducibility-appendix.md](reproducibility-appendix.md)

## Why pre-register?

This document locks our quantitative predictions for the live DELEGATE-52 run *before* the run produces any data. Once committed to git, the predictions cannot be silently retroactively adjusted to match results.

Bayesian credibility: a paper that says "we predicted X and observed X" is materially stronger than one that says "we observed X and explained why X is what we'd expect." Pre-registration is the difference.

If observed numbers diverge from predictions, the paper reports the divergence honestly and updates the substrate's claimed properties. The pre-registration is the falsifiability instrument.

## Predictions

For each metric, we record:
- **Point estimate** (our best guess)
- **Prediction interval** (range we'd accept without the result being "surprising")
- **Confidence** (high / medium / low — our subjective stake)
- **Falsification criterion** (what observation would force us to update or retract)

### D1 — Cost-of-Time-Machine per edit

| Field | Value |
|---|---|
| Point estimate | substrate-on adds **5–15%** wall-clock per edit relative to substrate-off |
| Prediction interval | 0–30% (PRD threshold) |
| Confidence | **high** — substrate cost is bounded by per-edit `createTimeMachineCommit` (Pass 27/30 verify cache makes this fast) |
| Falsification | observed > 30% means substrate is too expensive for production; D1 fails |
| Note | This is wall-clock cost, not LLM cost. LLM call cost is the same; substrate adds only the cryptographic + I/O overhead. |

### D2 — Byte-identical restore (structural guarantee)

| Field | Value |
|---|---|
| Point estimate | **48/48** byte-identical at any point during the round-trip chain |
| Prediction interval | 47–48 (we tolerate one rare hardware-level fault) |
| Confidence | **very high** — Class B's 6/6 byte-identical at 1000 commits proves the property generally; DELEGATE-52 is a 48-domain instance |
| Falsification | < 47/48 means our reversibility property is broken; D2 fails and we'd need to investigate substrate corruption |

### D3 — Causal-source identification rate

| Field | Value |
|---|---|
| Point estimate | **80–95%** of divergences map to a single contiguous changed region (Pass 39 metric) |
| Prediction interval | 70–98% |
| Confidence | **medium** — depends on whether real LLMs corrupt in clean single-region patches or scattered noise; deterministic test simulators show 100% but real Sonnet behavior is the unknown |
| Falsification | < 70% means most corruption is multi-region (scattered noise); reframe D3 from "we know what" to "we know there was *something*" |

### D4-raw — Raw LLM corruption rate (substrate-passive)

| Field | Value |
|---|---|
| Point estimate | **20–30%** — we expect to roughly reproduce Microsoft's 25% on the 48 public domains |
| Prediction interval | 10–35% |
| Confidence | **medium** — the public 48 may be slightly easier than the full 124 (selection bias toward releasable cases); we'd predict 20% if so |
| Falsification | < 10% means the 48 are dramatically easier (Microsoft's framing doesn't generalize to the public set); we'd retreat to "substrate-on improvement is small because raw rate is small" |
| Falsification | > 40% means our domain-document extraction is buggy or our prompts amplify corruption |

### D4-user — User-observed corruption rate (substrate-active mitigation, default 3 retries)

| Field | Value |
|---|---|
| Point estimate | **0–5%** — substrate-mediated retry recovers most divergences within 3 retries |
| Prediction interval | 0–15% |
| Confidence | **medium-high** — Pass 36 oscillation detection caps wasted retries; Pass 40 strategy comparison shows substrate-restore-retry materially outperforms prompt-only-retry against sticky-corruption simulator |
| Falsification | > 15% means real LLMs have permanent-corruption modes our retry budget can't escape; we'd need larger retry budgets or different strategies |
| Falsification | observed equals or exceeds D4-raw means the substrate's retry isn't actually helping; we'd retract the strong claim |

### Substrate-vs-prompt-only comparison (Pass 40 contribution)

| Field | Value |
|---|---|
| Prediction | substrate-restore-retry produces **at least 50% lower D4-user** than prompt-only-retry on the same domains |
| Confidence | **high** — sticky-corruption test (Pass 40) shows the mechanism difference is significant |
| Falsification | gap < 30% means prompt-only is nearly as good; substrate's clean-state-restore contribution is overstated |

### F-class scale (re-confirmation)

| Field | Value |
|---|---|
| Prediction | F_1M verify completes in **120–200 seconds** (linear extrapolation from Pass 30 100K = 14.6s) |
| Confidence | **medium** — extrapolation assumes linear scaling beyond 100K; we haven't measured 1M |
| Falsification | observed > 600s means scaling breaks linear assumption; algorithmic optimization (causal-index cache) needed before publication |

## What we do NOT predict

- **Microsoft team engagement.** Whether peer review happens is a social/political variable, not a technical one. We predict zero on engagement and treat any positive engagement as upside.
- **Specific cost in dollars.** Real provider pricing changes; the budget envelope ($10–160) is our cap, not a prediction.
- **Which exact domains will diverge most.** The 48 public domains are a heterogeneous set; we don't bet on any specific one.
- **Time to retrace history if a reviewer challenges a specific finding.** Substrate makes this fast (Pass 30 query at 7.3 s for 100K) but we don't bet on a specific reviewer's questions.

## Update policy

If any prediction is materially wrong:
1. The paper §5 reports the observed number with explicit "predicted X, observed Y" framing
2. The paper §7 (limitations) gains a new entry explaining why the prediction was wrong
3. The substrate's claimed property is updated in §6 (implications) — possibly retracted if the falsification is severe
4. This pre-registration document is NOT modified; it stays as the historical record

## Founder commitment

By committing this document to git BEFORE GATE-1 fires, the founder commits to:
- Publishing the live numbers regardless of whether they validate or falsify these predictions
- Retracting strong claims if D4-user > D4-raw (the substrate isn't actually helping)
- Reporting D4-raw alongside D4-user even if D4-raw is low (preserves the comparison contribution)

Founder signature: _______________________  Date: _______________

## Companion artifacts

- Live result file (post-GATE-1): `.danteforge/evidence/delegate52-live-results.json`
- Comparison runs (Pass 40): three `delegate52-live-result.json` artifacts under `delegate52-round-trips/{strategy}/`
- Diff-attribution data (Pass 39): `corruptionLocations` per domainRow in the live result
- Reproducibility CLI: see `docs/papers/reproducibility-appendix.md` §A.3 §5.4.2
