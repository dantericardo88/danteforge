# src/core/ Triage — domain modules (a dedicated, codemod-driven follow-up)

> **Status: PLANNED, not yet executed — deliberately.** `src/core/` has ~302 flat files. The council
> flagged that this makes the scoring invariant un-reviewable by one agent. Grouping into domain
> subdirectories is real hygiene — but the safe way to do it is its own focused pass, not a tail-end
> add-on. This doc is the plan + the evidence for why.

## Why not "just move them behind re-export shims"

A re-export shim (`src/core/foo.ts` → `export * from './scoring/foo.js'`) keeps every caller working,
but it **does not reduce the flat-file count** — `src/core/` now holds *both* the shim *and*
`scoring/foo.ts`. Shims are a migration aid, not the goal. The only move that actually shrinks the
flat surface is **relocate + rewrite every importer** (no shim).

## Why it must be its own pass (the churn evidence)

Importer counts for the scoring cluster alone (measured 2026-06-03):

| File | Importer files |
|---|---|
| `harsh-scorer.ts` | **74** |
| `derived-score.ts` | 10 |
| `compete-matrix-score.ts` | 6 (plus the `compete-matrix.ts` re-export barrel) |
| `write-verified-score.ts` | 3 |
| `harsh-scorer-*` sub-family | 1–3 each (mostly internal to `harsh-scorer.ts`) |

A no-shim move of `harsh-scorer.ts` rewrites **74 files**, many of them tests. Bundling that into a
trust-focused session risks the 443-green state for zero trust gain. It needs a codemod + a clean tree.

## The safe execution plan (next dedicated session)

1. **Pick one domain at a time** and move it whole, no shims:
   - `src/core/scoring/` — `compete-matrix-score.ts`, `write-verified-score.ts`, `derived-score.ts`,
     `harsh-scorer*.ts`, `adversarial-scorer-dim.ts`, `maturity-engine.ts`/`maturity-levels.ts`.
   - `src/core/frontier/` — `frontier-spec.ts`, `frontier-state.ts`, `ceiling-receipt.ts`,
     `evidence-novelty.ts`, `gap-report.ts`.
   - `src/core/orchestration/` — `ascend-engine.ts`, `ascend-frontier-engine.ts`,
     `ascend-frontier-parallel.ts`, `run-ledger.ts`, `goal-loop-engine.ts`.
   - `src/core/council/` — the council engines that live under `core/`.
2. **Codemod the imports**, don't hand-edit 74 files: a script that rewrites
   `from './<moved>.js'` / `from '../core/<moved>.js'` → the new subdir path across `src/` + `tests/`.
3. **Keep the `compete-matrix.ts` re-export barrel** as the public face of the scoring domain so
   external callers can import from one stable path (`./compete-matrix.js`) regardless of internal
   layout — this is a *barrel*, not a per-file shim, and it's already how scoring is consumed today.
4. **Typecheck is the safety net** after each domain: `npm run typecheck` catches every missed import;
   `npm run test:smoke` + `check:file-size` confirm no behavioural or size regression.
5. **One domain per commit.** Green between each. Never two domains in one move.

## Acceptance

- `src/core/` top-level file count drops by the size of each migrated domain (no shims left behind).
- `npm run typecheck` 0, `npm run test:smoke` green, `check:file-size` green after every domain.
- No import churn visible to external packages (the `compete-matrix.ts` barrel holds the public path).
