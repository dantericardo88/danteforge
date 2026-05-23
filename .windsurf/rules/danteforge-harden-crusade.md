---
name: harden-crusade
description: "Crusade-like loop using Karpathy-style autoresearch per dim + the 7-check harden gate. Drives every dim to target (default 9.0) or its natural ceiling. No Ollama-OSS dependency."
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
    0. Zero-evidence check: node scripts/evidence-rescore.mjs --dry-run | grep "evidence entries:"
       If 0 entries → run outcome commands directly, report bootstrap state, continue
    1. danteforge autoresearch --metric <dim> --time 30m --allow-dirty
    1b. danteforge outcomes --dim <dim> --force-cold  (refresh SHA-keyed evidence)
    1c. Outcome triage: for each failing outcome, classify as:
          GENUINE_GAP (reduces score) | OUTCOME_BUG (fix definition, no penalty) | BOOTSTRAP_DEP (run validate, no penalty)
    2. danteforge validate <dim> --force-cold   (write OutcomeEvidenceEntry receipts)
    3. node scripts/evidence-rescore.mjs        (compute evidence-derived score from receipts)
    4. Fix A gate: run capability_test command
          if exit ≠ 0 AND evidence-derived score > 5.0 → clamp to 5.0, verdict = CAPABILITY_TEST_BLOCKED
    5. Run 7-check harden gate in-process for that dim
    6. Emit Time Machine commit (MANDATORY before score write):
          createTimeMachineCommit({ gitSha, dimensionId, scoreBefore, scoreAfter,
            outcomesPassed, capabilityTestResult, agentLabel: 'harden-crusade' })
          If TM commit fails → PROVENANCE_MISSING, do NOT write score
    7. Write final score: min(evidence_derived, fix_a_cap, harden_gate_cap)
    8. FRONTIER_REACHED        if score >= target AND capability_test PASS AND gate clean
       AT_CEILING              if gate or Fix A caps below target (legitimate)
       CAPABILITY_TEST_BLOCKED if Fix A clamped to 5.0
       GATE_BLOCKED            if Δ < 0.05 after 2 autoresearch runs
       MAX_CYCLES              if cycle == 6 without reaching target
       PROVENANCE_MISSING      if Time Machine commit failed

Pass 2: re-read matrix → re-rank → pick next 4 → repeat
...until ALL_DONE (every eligible dim FRONTIER_REACHED or AT_CEILING)
       or PARTIAL (some dims GATE_BLOCKED / MAX_CYCLES / FAILED / CAPABILITY_TEST_BLOCKED)
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
| `FRONTIER_REACHED` | Score ≥ target AND `capability_test` PASS AND harden gate clean |
| `AT_CEILING` | Harden or Fix A capped below target (legitimate ceiling, e.g. T3=6.0) |
| `CAPABILITY_TEST_BLOCKED` | Fix A clamped to 5.0 — capability_test exits non-zero |
| `OUTCOME_BUGS_BLOCKING` | All failures are outcome definition bugs — fix outcomes, no score penalty |
| `BOOTSTRAP_DEP` | outcome-evidence/ empty — run `danteforge validate --all` first |
| `GATE_BLOCKED` | No progress (Δ < 0.05) after 2 autoresearch runs |
| `MAX_CYCLES` | Ran 6 cycles without reaching target |
| `PROVENANCE_MISSING` | Time Machine commit failed — score not written |
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

## Outcome triage report format

Every cycle emits a triage section before the verdict:

```
OUTCOME_BUGS (not scored as gaps — fix the outcome definition):
  [dim: mcp_integration] "mcp_plugin_manifest" — wrong path: checks .claude/plugin.json, actual .claude-plugin/plugin.json

BOOTSTRAP_DEPS (run danteforge validate, not new code):
  [dim: depth_doctrine] "evidence_receipts" — checks outcome-evidence/ dir produced by validate itself

GENUINE_GAPS (scored, appear in priority ranking):
  [dim: maintainability] capability_test FAIL — hardener.ts 904 LOC > 750 LOC limit → clamped to 5.0
```

## Scoring doctrine reference

All 13 rules from `src/core/scoring-doctrine.ts` apply. Key rules:
- **Rule 9**: Zero-evidence fallback — if evidence-rescore finds 0 entries, run outcomes manually
- **Rule 10**: Fix A — capability_test failure caps at 5.0, overrides all outcome evidence
- **Rule 11**: Triage outcome failures before scoring — never penalize for definition bugs
- **Rule 12**: Bootstrapping deps flagged separately, not scored as gaps
- **Rule 13**: Time Machine commit MANDATORY before every score write

## Output

- `HARDEN_CRUSADE_REPORT.md` — per-dim verdict, scores, cycles, triage sections, reasons
- Per-dim harden receipts under `.danteforge/harden-receipts/<sha>-<dim>.json`
- Evidence receipts in `.danteforge/outcome-evidence/<dim>-<sha>.json`
- Score caps applied via `mergeScoreProposals` (single-writer chokepoint)
- Time Machine causal commits for each cycle: `.danteforge/time-machine/<sha>.json`
