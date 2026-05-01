# Pre-Flight Findings — Real Sonnet 4.6 vs DELEGATE-52 Substrate

**Date:** 2026-04-30
**Founder authorization:** $2 spend cap for pre-flight smoke test
**Model:** `claude-sonnet-4-6` via direct Anthropic API
**Domain source:** Microsoft DELEGATE-52 public release (`.danteforge/datasets/delegate52-public.jsonl`)
**Status:** preliminary; full GATE-1 (48 domains × 10 round-trips × 2 = 960 calls) remains unfired

This document reports what we learned by spending real money on real LLM calls. It updates the predictions in [preregistration.md](preregistration.md) and informs decisions about full GATE-1.

## TL;DR

- Substrate plumbing **works end-to-end** against the real Anthropic API.
- Real Sonnet 4.6 **does corrupt** real DELEGATE-52 documents (consistent with Microsoft's 25% baseline).
- Pass 36 oscillation detector + graceful degradation **fired correctly on real LLM behavior** — these were previously only validated against simulators.
- **Pre-registered D3 prediction is falsified.** We predicted 80–95% single-region clean attribution; on the documents tested, Sonnet's corruption was 100% multi-region (scattered changes, not local edits).
- Cost projection for full GATE-1 lands at **~$96** ($0.10/call × 960 calls), within the $80–160 envelope.

## Run-by-run

### Run A — single domain, no retries ($0.10)

Domain: `accounting` / `hack_club.ledger` (12,016 chars / ~12 KB)
Strategy: substrate-restore-retry, 0 retries (effectively passive observation)

| Metric | Value |
|---|---|
| Cost | $0.1029 |
| LLM calls | 2 (1 forward + 1 backward) |
| Total divergences observed | 1 |
| byteIdenticalAfterRoundTrips | false (substrate didn't restore; retries=0) |
| Causal-source identification | 0% (multi-region) |
| firstCorruptionRoundTrip | 0 |

**Finding:** Sonnet 4.6 corrupts a real Microsoft DELEGATE-52 document on a single round-trip. The first sample-of-1 raw corruption rate is 100%.

### Run B — single domain, 3 retries ($0.39)

Same domain, 3 retries.

| Metric | Value |
|---|---|
| Cost | $0.3901 |
| Total divergences observed | 4 (initial + 3 retries) |
| Total retries used | 3 |
| Mitigated divergences | 0 |
| Unmitigated divergences | 1 |
| **Oscillated divergences** | **1 ✓** (cycle detector fired) |
| **Gracefully degraded** | **1 ✓** (workspace restored to clean baseline) |
| byteIdenticalAfterRoundTrips | TRUE (because graceful degradation restored) |
| User-observed corruption | 100% |

**Finding:** Sonnet emitted the same corrupted output across retries (cycle detected). Substrate's Pass 36 oscillation detector aborted further retries early, saving budget. Graceful degradation restored the workspace to clean baseline. The user's data was protected even though the LLM couldn't converge on a correct round-trip.

This is the load-bearing real-data validation of Pass 36's defensive mechanisms.

### Run C — breadth substrate-restore-retry (in flight or pending)

3 domains × 1 retry × $0.90 cap. *(Results pending; will update this section once the run completes.)*

### Run D — breadth no-mitigation comparison (pending)

3 domains × no-mitigation × $0.60 cap. *(Pending after Run C.)*

## Pre-registration update (Pass 41 falsification log)

Per Pass 41's update policy: predictions are NOT modified post-hoc. Observations go in this section; the paper §7 absorbs the surprises.

| Pre-registered prediction | Observation (n=1 domain) | Verdict |
|---|---|---|
| **D3 = 80–95% single-region clean attribution** | **0% across 4 divergences** | **Falsified.** Sonnet's corruption is scattered. |
| D4-raw = 20–30% baseline corruption | 100% on this domain | Sample size too small; likely lands lower across full set |
| D4-user = 0–5% with mitigation | 100% on this sticky-corruption domain | Sample size too small; signals retries don't always recover |
| Cost envelope $10–160 | $0.10/call × 960 = $96 projected | ✓ on track |
| Substrate beats prompt-only by ≥ 50% | (pending Run D) | TBD |

## What this means for the paper

1. **§5.4.2 D3 row needs reframing.** "≥ 90% causal-source identification" as currently written is not survivable against this kind of LLM behavior. Two paths:
   - **Retire D3 from the paper's strong-claim table.** Mention diff-attribution as a substrate capability without claiming a specific identification rate.
   - **Reframe D3 as bounded multi-region attribution.** "Substrate identifies divergence existence and region count via Pass 39's `computeDiffLocations`; attribution is multi-region in real LLM data, not single-region." This preserves the diff-attribution work while honestly reflecting what real data shows.

2. **§6 implications softens but stays true.** From "substrate-level retries reduce user-observed corruption near 0%" → "**substrate guarantees the user never sees the LLM's corrupted output**, via either mitigated recovery (when retry budget converges) or graceful degradation (when it doesn't)." The data preservation is the contract; recovery is the bonus.

3. **§7 limitations gets a new entry.** "On 1 of 1 domains pre-flight tested, Sonnet 4.6 produced multi-region corruption that resisted retry-based recovery. The substrate's graceful degradation guarantee held; the user's data was preserved. This is a falsification of our pre-registered single-region D3 prediction. Full GATE-1 will produce the population statistic."

## Strategic implications

The pre-flight has materially shifted the paper's positioning:

- **Strong claim (substrate recovers most corruption via retries)** — weaker support post-data. Sample of 1 had 0 mitigated recoveries. Could improve with more domains; could not.
- **Strongest defensible claim (substrate preserves data integrity even when LLM can't recover)** — stronger support post-data. Pass 36 graceful degradation worked exactly as designed on real LLM behavior.

Recommended pivot: emphasize the **integrity-preservation** framing in §5.4.2 and §6. The substrate's contribution is "the user never sees corrupted state" — true regardless of whether the LLM converges. This is a different and stronger story than "the substrate makes retries work."

## Recommendation for full GATE-1

Pre-flight has reduced simulator-vs-reality risk. Full GATE-1 is now an **informed decision**, not a leap of faith:

- **Cost confirmed at ~$96** — within budget envelope
- **D3 prediction falsified** — full GATE-1 will quantify the population D3 distribution; we can pre-decide whether the paper's D3 row reframes or retires based on that
- **D4-user prediction at risk** — full GATE-1 measures the population
- **Substrate plumbing validated** — no plumbing surprises will derail the full run

Founder may now choose:
1. **Fire full GATE-1.** Cost ~$96. Wall ~4–6 hours. Produces the population statistics that turn this paper from "preliminary substrate work" into "empirical replication of DELEGATE-52 with substrate-level mitigation."
2. **Ship paper with reframed D3 + Pass 44 pre-flight data.** Smaller claim; faster timeline; weaker headline.
3. **Iterate on prompts/retry budget first.** If we want to maximize D4-user recovery, larger retry budgets or different prompt framing might be tested in additional pre-flights before GATE-1.

My honest read: **option 1 is now the right move.** Pre-flight has made the cost predictable and the failure modes mapped. Full GATE-1 produces the data the paper actually needs.

## What this does NOT establish

- D3 distribution across the full 48 domains (we have n=1 substrate-restore-retry, possibly n=4 by the time C+D land)
- Whether multi-region corruption is a Sonnet-specific or LLM-universal pattern (would need GPT/Gemini comparison)
- Whether longer retry budgets recover more divergences (we tested only N=3 retries on 1 domain)
- Whether different prompt framing reduces corruption (out of scope; we're testing substrate, not prompts)
