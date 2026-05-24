---
name: harden
description: "Run the deterministic harden gate (7 substrate checks) — orphan-audit, recency-check, claim-auditor, hardcoded-fallback, import-resolves, functional-diff, primary-not-parallel. Cannot be gamed by LLM agents."
---
# /harden - The Seven Substrate Gates

When the user invokes `/harden`, run the deterministic harden gate against every dimension in the matrix. Each check is a static code inspection — no LLM judgment in the gate. An agent can only pass them by actually fixing the code.

## The seven checks

| Check                     | Cap when failed | Catches |
|---------------------------|-----------------|---------|
| `capability_test`         | **5.0 (FIX A — HARD)**  | The dim's declared capability_test command exits non-zero. Score clamped to 5.0 regardless of outcome evidence. |
| `orphan-audit`            | 6.0             | capability_callsite is only imported by test/spec files. |
| `claim-auditor`           | 7.0             | Numeric/textual claims in docstrings don't match code reality. |
| `hardcoded-fallback`      | 6.5             | Illustrative-data literals (e.g. `return ['DIS','PFE']`) in non-test code. |
| `import-resolves`         | 4.0             | Try/catch imports silently swallow `ImportError` for a module that doesn't resolve. |
| `functional-diff`         | 5.5             | Two distinct inputs produce byte-identical output (hardcoded behavior). |
| `primary-not-parallel`    | 5.5             | The declared callsite has fewer production importers than a legacy parallel implementation. |
| `recency-check`           | 7.0             | No production importer modified on `main` within 30 days AND traces to a user-facing entry point. |

### Fix A — capability_test gate (Rule 10, MANDATORY)

Fix A is the strongest cap in the system — it overrides all other evidence:

1. Run `<capability_test.command>` as a shell command
2. If exit code ≠ 0 AND the dimension's evidence-derived score > 5.0:
   - **Clamp score to 5.0, unconditionally**
   - Record: `{ outcome_derived: N, capped: 5.0, capability_test_command, capability_test_output, reason: "FIX_A" }`
   - The loop MUST NOT declare `FRONTIER_REACHED` on this dimension
   - Outcomes passing does NOT override a failing `capability_test`
3. If exit code = 0: record as PASS receipt, accept evidence-derived score

**Example**: `maintainability` — capability_test checks LOC limit. `hardener.ts` at 904 LOC fails. Even if all outcomes pass, the score is clamped to 5.0 until `hardener.ts` is split below 750 LOC.

### Outcome triage before scoring (Rule 11)

Before applying any score reduction, classify each failing outcome:

**(a) Genuine capability gap** — code or integration missing/broken → reduces score, appears in gap list

**(b) Outcome definition bug** — wrong file path, wrong keyword, wrong expectation in the check itself → flag in `OUTCOME_BUGS` section, no score penalty, fix the outcome definition

**(c) Bootstrapping dependency** — outcome checks for artifacts the scoring system itself produces (e.g., `outcome-evidence/` files) → flag in `BOOTSTRAP_DEPS`, score on all other outcomes, fix = run `danteforge validate`, not write new code

## Default flow (all dims, all checks)

```bash
danteforge harden
```

Runs every check on every dim above the 7.0 gate threshold. Reports per-dim verdict + writes to `.danteforge/harden-receipts/<sha>-<dim>.json`. Time Machine commit records causality.

## Targeted modes

| Subcommand | Purpose |
|---|---|
| `danteforge harden audit-orphans` | Three Pillars P2: list every dim whose capability_callsite is only imported by tests. Caps each at 6.0. Runs on ALL dims regardless of score threshold. |
| `danteforge harden audit-recency` | Three Pillars P3: list every dim whose production importer is stale OR untraceable to an entry point. Caps each at 7.0. |
| `danteforge harden migrate` | Infer `capability_callsite` per dim from `capability_test.command`. Dry-run by default; `--apply` writes to matrix.json. |
| `danteforge harden --check <id>` | Run ONE check across all dims (e.g. `--check orphan-audit`). |
| `danteforge harden --dim <id>` | Run all checks on ONE dim (e.g. `--dim security`). |
| `danteforge harden --gate` | CI mode — exit 1 if any dim ≥ 7.0 fails a check. |
| `danteforge harden --json` | Machine-readable output for any of the above. |

## Skip semantics

- A dim without a declared `capability_callsite` skips `orphan-audit`, `primary-not-parallel`, and `recency-check` (they have nothing to inspect).
- `audit_exempt: 'test-only-by-design'` skips orphan-audit with explicit reason.
- `audit_exempt: 'recency-by-design'` skips recency-check with explicit reason.

## When to run /harden

- Before declaring a dim "done" — proves the capability is actually wired, not just declared
- After a /crusade pass — caps any score the substrate cannot defend
- In CI via `--gate` — blocks merges where score ≥ 7.0 fails a check
- Standalone audits via `audit-orphans` / `audit-recency` whenever you want a snapshot

## Three Pillars provenance

The seven-check gate is the load-bearing structural defense from `docs/ThreePillars.md`:

- **Pillar 1**: single-writer reconciler (`mergeScoreProposals` chokepoint) + symbol-level pre-commit lint guard. Every score write flows through the gate.
- **Pillar 2**: `orphan-audit` is the 6th harden check (this command).
- **Pillar 3**: `recency-check` is the 7th harden check (this command).

Capability tests proving the audits fire:
```bash
bash .danteforge/capability-tests/orphan_audit.sh    # PASS expected
bash .danteforge/capability-tests/recency_check.sh   # PASS expected
```

## Output

- `.danteforge/harden-receipts/<sha>-<dim>.json` — per-dim verdict with all checks + caps
- `.danteforge/harden-report.json` — roll-up report with per-dim and overall verdict
- `OUTCOME_BUGS` section — outcome definition failures that were NOT scored as gaps
- `BOOTSTRAP_DEPS` section — outcomes requiring `danteforge validate` before they can pass
- Time Machine causal commit per verdict: `.danteforge/time-machine/<sha>.json`
  - Records: `gitSha`, `dimensionId`, `scoreBefore`, `scoreAfter`, `outcomesPassed`, `capabilityTestResult`, `agentLabel: "harden"`
  - **MANDATORY**: if Time Machine commit fails, score is NOT written
- Score caps applied to the matrix via the reconciler (single-writer guarantee)

Read `docs/harden-checks.md` for the full check spec including remediation steps.
