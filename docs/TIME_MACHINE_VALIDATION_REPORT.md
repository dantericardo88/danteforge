# Time Machine Validation Report

Created: 2026-04-29
Status: Harness implemented, deterministic validation passing, live DELEGATE-52 replication not executed
Schema: `danteforge.time-machine.validation.v1`

## Executive Verdict

DanteForge now has the missing validation harness between the proof spine and the full Time Machine claim.

What is proven locally:

- Time Machine can generate PRD-scale Class A/B/C validation reports.
- Tamper scenarios A1-A7 are detected in the synthetic 1000-commit model.
- Clean-chain verification has a 100-run zero-false-positive baseline in the PRD-scale logical model.
- Restore scenarios B1-B6 are byte-identity checked in the PRD-scale logical model.
- Causal queries C1-C7 are represented and audited across a 100-decision model.
- Adversarial simulations E1-E5 fail closed or preserve divergence explicitly.
- Performance Class F has a smoke/benchmark harness with 10K, 100K, and optional 1M targets.
- Constitutional Class G records founder-gated scenarios honestly instead of fabricating outcomes.

What is not proven yet:

- DanteForge has not run live DELEGATE-52 replication.
- DanteForge has not validated withheld DELEGATE-52 environments.
- DanteForge has not produced a publishable paper-quality DELEGATE-52 result table.

Allowed claim:

> Time Machine validation harness and deterministic A/B/C/E/F/G evidence exist; DELEGATE-52 live replication is ready but not executed.

Forbidden claim:

> DanteForge has solved or published full DELEGATE-52 replication.

## Implemented Surfaces

- Core engine: `src/core/time-machine-validation.ts`
- CLI: `danteforge time-machine validate`
- Schema: `src/spine/schemas/time_machine_validation.schema.json`
- Tests: `tests/time-machine-validation.test.ts`, `tests/time-machine-validation-cli.test.ts`
- Validation outputs: `.danteforge/time-machine/validation/<runId>/report.json`, `report.md`, `results/*.json`, `artifacts/*`

## CLI Contract

```bash
danteforge time-machine validate --class A,B,C --scale prd --json
danteforge time-machine validate --class D --delegate52-mode harness --max-domains 2
danteforge time-machine validate --class F --scale smoke
```

Options:

- `--class A,B,C,D,E,F,G`: select validation classes.
- `--scale smoke|prd|benchmark`: choose quick, PRD, or benchmark scale.
- `--delegate52-mode harness|import|live`: default is harness.
- `--delegate52-dataset <path-or-url>`: read imported public DELEGATE-52 result JSON/JSONL.
- `--budget-usd <n>` and `--max-domains <n>`: live/import guardrails.
- `--json`: machine-readable report output.

Live mode is intentionally non-spending in v0.1. Without explicit future provider integration, it records `live_not_enabled` rather than pretending a live run happened.

## Validation Classes

| Class | Purpose | v0.1 Status |
| --- | --- | --- |
| A | 1000-commit tamper detection and clean-chain false-positive baseline | Implemented |
| B | 1000-commit restore/reversibility scenarios B1-B6 | Implemented |
| C | 100-decision causal query and completeness audit | Implemented |
| D | DELEGATE-52 harness/import/live adapter | Harness/import implemented; live not executed |
| E | Multi-agent adversarial scenarios E1-E5 | Implemented |
| F | Scale benchmark harness for 10K, 100K, optional 1M | Implemented with explicit cap/skip semantics |
| G | Constitutional integration scenarios | Implemented as honest staged/founder-gated checks |

## Verification Snapshot

Targeted verification run on 2026-04-29:

```bash
npx tsx --test tests/time-machine.test.ts tests/time-machine-cli.test.ts tests/time-machine-validation.test.ts tests/time-machine-validation-cli.test.ts
npm run typecheck
npx eslint src/core/time-machine.ts src/core/time-machine-validation.ts src/cli/commands/time-machine.ts tests/time-machine-validation.test.ts tests/time-machine-validation-cli.test.ts
```

Result:

- Time Machine tests: 13/13 passing.
- TypeScript: passing.
- ESLint on touched Time Machine validation files: passing.

## Pass 18 Validation Run

Command shape:

```bash
danteforge time-machine validate --class A,B,C,D,E,F,G --scale prd --delegate52-mode harness --max-domains 4
```

Output folder:

```text
.danteforge/time-machine/validation/pass-18/
```

Result:

- Overall report status: `partial`
- Passed classes: A, B, C, E
- Partial classes: D, F, G
- Failed classes: none
- Class F 10K benchmark: verify 10318ms, restore 5ms, query 3849ms, threshold passed
- Class F 100K benchmark: skipped behind `DANTEFORGE_TIME_MACHINE_VALIDATE_MAX_COMMITS`
- DELEGATE-52: harness only; no live replication executed

## Next Publication Gate

The publishable Time Machine claim requires either:

1. Imported DELEGATE-52 result artifacts with public dataset provenance, or
2. A live opt-in run with recorded provider/model/budget metadata and result table.

Until then, reports must preserve the status `harness_ready_not_live_validated` or `live_not_enabled`.
