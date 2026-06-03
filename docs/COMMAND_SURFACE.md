# DanteForge Command Surface — the curated map (V2-by-subtraction)

> **Purpose.** DanteForge has accreted 200+ command files across 18 registrars. This document is the
> coherent map of what the tool *actually is*: the load-bearing **Core**, the **Experimental** edges,
> and the **consolidation candidates**. It is the "V2" surface — achieved by *labelling and curating*,
> not rewriting. The default `--help` already shows only the Core (via `VISIBLE_COMMANDS` in
> `src/cli/index.ts`); this doc explains the rest and drives future deprecations.
>
> **Convention.** `src/cli/command-tags.ts` provides `markExperimental` / `markDeprecated` /
> `applyCommandTags`, applied centrally in `index.ts`. Tagging is **non-destructive** — it annotates
> help text and hides; it never removes a command. Populate the maps from the *Candidates* sections
> below as each is confirmed safe.

---

## 1. Core — the coherent, load-bearing surface (keep, keep visible)

**The spec→build→verify pipeline** (CLAUDE.md workflow): `constitution`, `specify`, `clarify`,
`tech-decide`, `plan`, `tasks`, `design`, `forge`, `ux-refine`, `verify`, `synthesize`.

**The competitive / frontier engine** (the heart of the scoring system):
`compete`, `council`, `ascend-frontier`, `validate`, `gap`, `frontier-spec`, `frontier-review`,
`frontier-audit`, `session-record`, `harden`, `harden-crusade`, `migrate-outcomes`, `outcomes`.

**The Matrix Kernel** (closed-loop multi-agent control plane): `matrix-kernel` (+ subcommands).

**Intelligence & search:** `search` (+ subcommands), `oss` / `oss-loop`, `harvest`, `dossier`,
`lessons`, `maturity`, `status`.

**Top-level UX entry points** (the visible set): `go`, `plan`, `build`, `measure`, `compete`,
`harvest`, `autoforge`, `evidence`, `knowledge`, `ship`, `design`, `config`, `doctor`, `init`, `help`.

---

## 2. Experimental — works, but edge/forward-looking (hidden + `[experimental]`)

| Command | Why experimental | Status |
|---|---|---|
| `war-room` | VS Code War Room — **CLAUDE.md: "Phase 14 deferred"** | tagged `[experimental]` ✅ |

> Add here as confirmed: a command works but is not part of a documented workflow and has no
> committed consumer. Tag via `EXPERIMENTAL_COMMANDS` in `index.ts`.

---

## 3. The matrix-layer triple — INVESTIGATE-then-decide (do NOT tag/delete yet)

Three command families share the "matrix" concept. They are **not** simple duplicates — each is wired
to live code — so consolidation is a **dedicated migration**, not a curation tag.

| Family | Registrar | Backing engine | Verdict |
|---|---|---|---|
| `matrix` (status/claim/propose/merge/ascend) | `register-compete-cmds.ts` | `matrix-development-engine.ts` | **LOAD-BEARING.** `matrix merge` → `mergeScoreProposals` is the *canonical gated score-write path* (capability_test + harden gates → `updateDimensionScore` → the new `writeVerifiedScore`). Deprecating it would break the score pipeline. |
| `matrix-kernel` (init/map-project/work-packets/simulate/protect/…) | `register-matrix-commands.ts` + `register-matrix-execution-commands.ts` | `src/matrix/` (57 engines) | **ALIVE.** The newer closed-loop control plane. The `matrix-kernel` *parent* was deliberately named to avoid colliding with legacy `matrix` (CLAUDE.md). |
| `matrix-orchestrate` (read/discover/analyze/execute-phase-*/replay/…) | `register-matrix-orchestration-commands.ts` | `src/matrix-orchestration/` (16 files) | **ALIVE.** Imported by `index.ts` + `orchestration-adapter-dispatch.ts`. |

**Recommended consolidation (follow-up, not this pass):**
1. Rename the legacy `matrix` verbs under a clearer parent (e.g. `score claim|propose|merge`) so the
   word "matrix" means exactly one thing — the kernel. Keep the old names as **deprecated aliases**
   (`markDeprecated('matrix', 'score')`) for one release.
2. Decide whether `matrix-orchestrate` folds into `matrix-kernel` as a subcommand group, after
   documenting every `orchestration-adapter-dispatch` consumer.
3. Only then populate `DEPRECATED_COMMANDS`.

Until (1) lands, `DEPRECATED_COMMANDS` is intentionally empty — tagging a live score-path command
deprecated would be dishonest.

---

## 4. Deprecation candidates — needs per-command confirmation before tagging

The honest position: ~200 command files cannot all be confidently classified in one pass. A command
qualifies for `markDeprecated`/`markExperimental` only when **all** hold: (a) no test references it,
(b) no role in the documented workflow, (c) a superseding command exists or it's a one-off experiment.
Confirm individually, then add to the maps in `index.ts`. Do **not** bulk-hide — several "obvious"
candidates (`showcase`, `chart`) turned out to have tests and real consumers.

---

## 5. How to extend this safely

- **Found a dead command?** Confirm (a)+(b)+(c) above → add to `EXPERIMENTAL_COMMANDS` or
  `DEPRECATED_COMMANDS` in `index.ts` → it auto-hides + self-labels. Add a row here.
- **Never** delete a command file in the same pass as the tag — tag first, observe a release, remove
  later.
- The `tests/command-tags.test.ts` suite guards the helper's behaviour (hide + idempotent tag +
  ignore-unknown).
