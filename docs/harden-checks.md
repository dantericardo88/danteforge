# Harden Checks — The Seven Substrate Gates

The harden gate fires automatically inside `mergeScoreProposals` for any
proposed score at or above **7.0**. Each check is a deterministic code
inspection — no LLM judgment in the gate. An agent can only pass them by
actually fixing the code.

Per-check score caps (the `min` across failed checks wins):

| Check                     | Cap when failed | Catches |
|---------------------------|-----------------|---------|
| `capability_test`         | (implicit 5.0)  | The dim's declared capability_test command exits non-zero. |
| `orphan-audit`            | 6.0             | capability_callsite is only imported by test/spec files. |
| `claim-auditor`           | 7.0             | Numeric/textual claims in docstrings don't match code reality. |
| `hardcoded-fallback`      | 6.5             | Illustrative-data literals (e.g. `return ['DIS','PFE']`) in non-test code. |
| `import-resolves`         | 4.0             | Try/catch imports silently swallow `ImportError` for a module that doesn't resolve on disk. |
| `functional-diff`         | 5.5             | Two distinct inputs produce byte-identical output (hardcoded behavior). |
| `primary-not-parallel`    | 5.5             | The declared callsite has fewer production importers than a parallel legacy implementation. |
| `recency-check`           | 7.0             | No production importer was modified on `main` within N days AND traces to a user-facing entry point. |

The first six are the inherited "Phase D" set. The seventh — **`recency-check`** —
is **Three Pillars Pillar 3**, completing the foundational gate.

---

## `orphan-audit` (Three Pillars Pillar 2)

**Detects.** A dimension whose `capability_callsite.symbol` is not imported
from any file outside the capability test itself.

Production imports are files **not** matching:
- `*.test.ts`, `*.test.js`, `*.test.mjs`, `*.test.cjs`
- `*.spec.ts`, `*.spec.js`, `*.spec.mjs`, `*.spec.cjs`
- `**/tests/**`, `**/__tests__/**`, `**/test-fixtures/**`
- `**/.danteforge/capability-tests/**`

**Remediation.** Wire the module into production code, not just tests. For
example, add a CLI subcommand, MCP tool, or call from an existing production
path. If the dim is intentionally test-only, set
`audit_exempt: 'test-only-by-design'` on the dim with an explicit reason.

**CLI surface.**
```
danteforge harden audit-orphans           # report only
danteforge harden audit-orphans --json    # machine-readable
```

---

## `recency-check` (Three Pillars Pillar 3)

**Detects.** A dimension whose `capability_callsite` has production importers,
but none of them have been modified on `main` within the last **30 days**
(default; configurable) AND traces to a user-facing entry point.

This catches the **replacement-not-supplement** pattern: a new module exists
and is even imported, but the importing code is dead — the live production
path still uses the legacy implementation.

**User-facing entry-point patterns** (default; configurable per project):
- `src/cli/**/*.ts` — CLI commands
- `src/api/**/*.ts` — API routes
- `src/mcp/**/*.ts` — MCP tool exports
- `bin/*` — executable scripts

Per-project override at `.danteforge/config/entry-points.json`:
```json
{
  "patterns": ["src/cli/**/*.ts", "src/api/**/*.ts", "src/mcp/**/*.ts", "bin/*"],
  "exclusions": ["src/cli/internal/**"],
  "thresholdDays": 30
}
```

**Two-hop trace.** An importer "traces to an entry point" if it matches an
entry-point pattern directly OR is itself imported by a file matching a
pattern. Full call-graph tracing is a Phase L follow-up.

**Remediation.**
- Modify a production importer recently (commit on `main`).
- Connect the importing file's call graph to a CLI command, API route, or
  MCP tool.
- Document an architectural cap: set `audit_exempt: 'recency-by-design'` on
  the dim with an explicit reason (e.g., "internal substrate primitive used
  only by other harden checks").

**CLI surface.**
```
danteforge harden audit-recency                          # report only
danteforge harden audit-recency --threshold-days 60      # widen window
danteforge harden audit-recency --json                   # machine-readable
```

---

## How the gate composes the seven checks

Inside `mergeScoreProposals`, when a proposal has `proposedScore ≥ 7.0`:

1. `runHardenGate` runs every applicable check in sequence.
2. Each failed check contributes its cap; the final cap is `min(...caps)`.
3. The proposal's effective score is `min(proposedScore, finalCap)`.
4. The verdict is written to `.danteforge/harden-receipts/<sha>-<dim>.json`.
5. A Time Machine commit records the verdict with causal links.

Skip semantics: a dim without a declared `capability_callsite` skips
`orphan-audit`, `primary-not-parallel`, and `recency-check` (they have nothing
to inspect). Other checks may apply based on the dim's `capability_test` and
related metadata.

---

## Pre-commit lint — symbol-level guard

A pre-commit hook at `hooks/pre-commit.mjs` blocks any commit that introduces
a direct `dim.scores.self = ...` write outside the two architecturally
permitted modules:
- `src/core/compete-matrix.ts` (the matrix API; owns the derived-score
  writeback inside `loadMatrix`)
- `src/cli/commands/honest-rescore.ts` (writes to a clone at
  `matrix.honest.json`, never to `matrix.json`)

All other score changes must flow through `writeScoreProposal →
mergeScoreProposals`, which runs the gate and emits Time Machine commits.
