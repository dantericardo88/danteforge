# DanteForge Operator Runbook

Operator-facing instructions for running DanteForge against a real project. Pair this with `CHANGELOG.md` (release history) and `SECURITY.md` (vulnerability reporting).

## Quick start

```bash
npm ci            # deterministic install
npm run build     # tsup → dist/index.js
node dist/index.js --help
```

The CLI surfaces 100+ subcommands. Three workflows cover most uses:

| You want to… | Run |
|---|---|
| See current competitive position | `node dist/index.js compete` |
| Verify substrate gates per dim | `node dist/index.js harden` |
| Get a frontier verdict (release gate) | `node dist/index.js frontier --require frontier-reached --json` |

## Daily-driver flow

### 1. Restore the project's matrix (when starting fresh or after a test pollutes it)

```bash
node scripts/restore-dogfood-matrix.mjs
```

This populates `.danteforge/compete/matrix.json` with 19 dimensions, each carrying real shell-command `capability_test` + `outcomes` + `declared_ceiling` fields.

### 2. Run outcomes against the current SHA

```bash
node dist/index.js outcomes --force-cold
```

Walks every dim that declares outcomes, runs each outcome's shell command, writes evidence to `.danteforge/outcome-evidence/<sha>-<dim>-<outcome>.json`. Each evidence write produces a Time Machine commit.

**Heavy outcomes:** the `testing/t_full` outcome runs the full test suite (~10-25 min). The script bumps the timeout to 25 min; if your suite is slower, edit `scripts/restore-dogfood-matrix.mjs:testing.outcomes[].timeout_ms`.

### 3. Check frontier state

```bash
node dist/index.js frontier --json
```

Returns one of four terminal states:

- `frontier-reached` — every eligible dim at frontier (release-ready)
- `progressing` — outcomes running; substrate making forward progress
- `stuck-on-dims` — ≥1 dim halted after N stuck waves (operator review needed)
- `blocked-by-dispensations` — operator-approved exceptions pause autonomy

Exit code: 0 only for `frontier-reached` unless you pass `--require <state>`.

### 4. Operator overrides via dispensation

When a dim genuinely cannot reach its declared ceiling — and you want autonomy to continue working on OTHER dims — open a dispensation:

```bash
node dist/index.js dispensation create <dim> "<reason>" --ttl 7d
```

The TTL prevents the "dispensation graveyard" (forgotten exceptions silently pausing autonomy forever). Without `--ttl`, the operator must explicitly clear:

```bash
node dist/index.js dispensation list
node dist/index.js dispensation clear <id>
```

## Research mode (Phase O+P, mocked-agent default)

When a dim plateaus (≥3 consecutive stuck waves) AND project composite ≥7.5, research mode becomes available:

```bash
node dist/index.js research start <dim>            # may refuse with criteria
node dist/index.js research start <dim> --force    # operator override (audit-logged)
```

The substrate spawns the 10-role agent council (benchmark-designer first/alone, parallel council, hybrid-synthesizer last), collects outputs, runs deterministic synthesis, and produces a verdict in `.danteforge/research/<wave-id>/synthesis-recommendation.md`:

- **PROMOTE** → run `node dist/index.js research resolve <wave-id>` to land the proposal
- **CONFLICT** → write your decision to `.danteforge/research/<wave-id>/operator-resolution.md`, then `research resolve <wave-id>`
- **CAP** → substrate marks dim architecturally capped; excluded from future research

**Default uses mock agents.** Real Claude-Code-CLI agent dispatch is wired via the `_runAgent` injection seam in `src/matrix/research/wave-coordinator.ts`. To enable real runs, replace the default mock with a `spawnHeadlessAgent` invocation that reads the role's prompt from `prompts/research/<role-id>.md` and dispatches against an isolated worktree. This consumes operator LLM quota; be deliberate about when to enable it.

## Search primitive (Phase L)

```bash
node dist/index.js search find "TODO"                         # regex
node dist/index.js search symbol createSearchEngine           # declaration lookup
node dist/index.js search imports loadMatrix                  # production importers
node dist/index.js search orphans                             # wraps orphan-audit
node dist/index.js search benchmark                           # native vs ripgrep
```

Default engine is the `MinimalNativeEngine` (uses existing `buildSymbolGraph` for TS-symbol-aware lookups). Falls back to `RipgrepFallback` when the operator passes `--engine ripgrep`. Phase L.3 BM25 reranks multi-term queries by relevance.

## Honest rescore (skeptic regrade)

```bash
node dist/index.js honest-rescore --regrade --json
```

Re-runs the harden gate against every dim with a fresh search index. The matrix is NOT modified — produces `.danteforge/compete/matrix.honest.json` + `.matrix.honest.diff.md` for operator review.

## Time Machine audit chain

Every score-changing or state-changing event produces a Time Machine commit:

```bash
ls .danteforge/time-machine/commits/ | wc -l   # commit count
```

Labels include:
- `outcome-evidence/<dim>/<outcome>/<tier>/<pass|fail>` — every outcome execution
- `harden-verdict/<dim>/<allowed|blocked-by-X>` — every harden gate decision
- `dispensation-created/<dim>/<id>` + `dispensation-cleared/<dim>/<id>` — autonomy-pause events
- `frontier-transition/<from>-><to>` — terminal-state changes
- `matrix merge before/after` — every score-write reconciliation
- `probe-evidence/<tier>/<runner>/<pass|fail>` — cold-build probes
- `honest-rescore/reported=X.XX->honest=Y.YY` — regrade events

## Common failure modes

| Symptom | Probable cause | Fix |
|---|---|---|
| `Missing .danteforge/compete/matrix.json` | Matrix wiped by test fixture | `node scripts/restore-dogfood-matrix.mjs` |
| `Matrix merge already in progress: ...merge.lock` | Crashed process left a lock | `rm .danteforge/score-proposals/merge.lock` |
| `npm test` timeout under outcomes runner | Suite exceeds outcome budget | Bump `timeout_ms` in `scripts/restore-dogfood-matrix.mjs` |
| Frontier shows `stuck-on-dims` | A dim has been pushed 3 waves without progress | `research start <stuck-dim>` (will refuse if criteria fail) |
| Harden gate clamps a score unexpectedly | A check is failing | Run `harden --dim <id> --json` to see which checks |

## Recovering from a broken state

The substrate's failure mode is conservative: if anything ambiguous happens, refuse rather than silently work around it. The escape hatches:

1. **Stale matrix.json** → re-run the restore script
2. **Stale merge lock** → manual delete (after verifying no real merge in progress)
3. **All dims showing derived=0 unexpectedly** → SHA-based eviction kicked in after a commit; run `outcomes --force-cold` to re-build evidence
4. **Research mode keeps refusing** → check activation criteria via `research history <dim>`; often dim has unresolved CONFLICT
5. **Honest rescore reports massive clamps** → matrix has been inflated; this is the substrate doing its job, not a bug

## Security incident response

See `SECURITY.md` for vulnerability disclosure procedure. Operator-facing security commands:

```bash
node dist/index.js security-scan                # surface secrets, eval(), exec()
npm audit --audit-level=high --omit=dev         # runtime-dep audit
node dist/index.js harden --dim security        # security dim's harden gate
```

## CI integration

```yaml
# Example .github/workflows/frontier-gate.yml
- run: npm ci && npm run build
- run: node dist/index.js frontier --require frontier-reached --json
```

Exit code 1 if not at frontier. Pair with `outcomes --force-cold` upstream if you want CI to also generate fresh evidence.

## Architecture pointers (when something goes wrong)

| Concern | File |
|---|---|
| Why was this score allowed/clamped? | `src/core/matrix-development-engine.ts:mergeScoreProposals` |
| Why did frontier return X? | `src/core/frontier-state.ts:computeProjectFrontierState` |
| Why did the harden gate trip? | `src/matrix/engines/hardener.ts` (6 check implementations) |
| Why does outcomes show derived=0? | `src/core/derived-score.ts` — likely SHA-based eviction |
| Why did research refuse to start? | `src/matrix/research/mode-selector.ts:isResearchActivated` — 7 criteria |
| What's in this Time Machine commit? | `cat .danteforge/time-machine/commits/<tm-id>.json` |

## Build + release

```bash
npm run verify       # typecheck + lint + tests
npm run build        # tsup → dist/index.js (single ESM bundle)
```

Release branch convention: `release/vX.Y.Z`. PR title: `release: vX.Y.Z`. The substrate's own `release:check` script gates publishability.
