---
name: harden-crusade
description: "Crusade-like loop using Karpathy-style autoresearch per dim + the 7-check harden gate. Drives every dim to target (default 9.0) or its natural ceiling. No Ollama-OSS dependency."
contract_version: "danteforge.workflow/v1"
stages: [autoresearch, harden, classify, repeat]
execution_mode: freeform
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: not-required
verification_required: true
---

# /harden-crusade — Autoresearch-Driven Frontier Crusade

When the user invokes `/harden-crusade`, run a crusade-like autonomous loop where each dim is driven by `autoresearch` (Karpathy pattern) instead of `inferno`. Every cycle's score is verified by the deterministic 7-check harden gate before being accepted.

## Why this command exists

`/crusade` uses `inferno` as its primary driver and falls back to `autoresearch` only when a dim stalls. Inferno's OSS-harvest sub-step depends on local Ollama LLM calls, which time out frequently. This command flips the order: **autoresearch is primary from cycle 1**, and the harden gate caps any score the substrate cannot defend.

## Default invocation

```bash
danteforge harden-crusade --parallel 4 --loop --target 9 --time 30
```

## What happens

```
Pass 1: pick 4 weakest dims (where score < target AND ceiling cap >= target)
  Each dim, up to 6 cycles:
    1. danteforge autoresearch --metric <dim> --time 30m --allow-dirty
    2. Re-score the dim
    3. Run 7-check harden gate in-process for that dim
    4. FRONTIER_REACHED  if score >= target AND gate clean
    5. AT_CEILING        if gate caps below target (legitimate)
    6. GATE_BLOCKED      if Δ < 0.05 after 2 autoresearch runs
    7. MAX_CYCLES        if cycle == 6 without reaching target

Pass 2: re-read matrix → re-rank → pick next 4 → repeat
...until ALL_DONE (every eligible dim FRONTIER_REACHED or AT_CEILING)
       or PARTIAL (some dims GATE_BLOCKED / MAX_CYCLES / FAILED)
```

## Flags

| Flag | Default | Effect |
|------|---------|--------|
| `--goal "..."` | "Push every dim toward its honest ceiling" | Mission passed to each autoresearch wave |
| `--parallel <n>` | 4 | Dimensions pushed simultaneously |
| `--target <n>` | 9 | Score target per dim |
| `--max-dim-cycles <n>` | 6 | Per-dim cycle cap (lower than /crusade because autoresearch cycles are slower) |
| `--time <m>` | 30 | Autoresearch time budget per cycle (minutes) |
| `--loop` | false | Outer loop: re-rank + re-run up to 10 passes |
| `--json` | false | Machine-readable result |
| `--cwd <path>` | (cwd) | Project directory |

## Stopping conditions

| Verdict | Meaning |
|---------|---------|
| `FRONTIER_REACHED` | Score ≥ target AND harden gate clean |
| `AT_CEILING` | Harden capped below target (legitimate ceiling, e.g. T3=6.0) |
| `GATE_BLOCKED` | No progress (Δ < 0.05) after 2 autoresearch runs |
| `MAX_CYCLES` | Ran 6 cycles without reaching target |
| `FAILED` | Unhandled error in dim loop |

`ALL_DONE` = every eligible dim is FRONTIER_REACHED or AT_CEILING.

## Eligibility filter

Dims are EXCLUDED from the push only when their score has already reached their numeric `ceiling` (i.e., `score >= d.ceiling`). A dim with `ceiling=4` and `score=0` is still eligible — it hasn't hit its ceiling yet, and the harden gate will classify it `AT_CEILING` when it does. The `declared_ceiling` tier string (T0–T6) is informational only; the 7-check harden gate is the true arbiter of what score the substrate can defend.

## Honored autonomy rules

Mirrors `/crusade` for the structural defenses:
- **Regrade cadence** — blocks if `wavesSinceLastRegrade > 3` (run `danteforge honest-rescore --regrade` first)
- **R1 halt-stuck-dim** — already-stuck dim halts the pass
- **R2 refuse-on-dispensation** — active dispensation blocks (TTL-aware after f272f46)
- **R3 refuse-new-dims** — adding a new dim while old ones aren't at frontier
- **R4 halt-infinite-refinement**
- **R5 report-end-state**
- **R6 document-irreducible-human-loop**

## When to choose /harden-crusade vs /crusade

| Use case | Best command |
|---|---|
| Standard frontier push, Ollama working | `/crusade` |
| Ollama unreliable / OSS-harvest timeouts | **`/harden-crusade`** |
| Want autoresearch to drive every cycle | **`/harden-crusade`** |
| Want gate verification on every cycle (not just stall) | **`/harden-crusade`** |
| Need CI/smoke run with deterministic timing | **`/harden-crusade`** |

## Output

- `HARDEN_CRUSADE_REPORT.md` — per-dim verdict, scores, cycles, reasons
- Per-dim harden receipts under `.danteforge/harden-receipts/<sha>-<dim>.json`
- Score caps applied via `mergeScoreProposals` (single-writer chokepoint)
- Time Machine causal commits for each harden verdict
