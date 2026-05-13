# /matrixdev — Operations Guide

This guide is for running `/matrixdev` at scale across projects, post-Battle-Station masterplan. It captures the operational knowledge that doesn't fit in the slash command body itself.

## Quick start (recommended invocation per project type)

| Project shape | Invocation |
|---|---|
| Tight repo, deliberate WIP, you commit often | `/matrixdev` |
| Frequent autonomous-run state in `.danteforge/` | `/matrixdev --auto-stash` |
| Large repo with many tests, want fast verify | `/matrixdev --scope-tests-to-diff` |
| First run on a project new to matrix-kernel | `/matrixdev --auto-stash --scope-tests-to-diff --auto-prune` |
| Single-lease debug session | `/matrixdev --serial` |

## The five flags and when to use them

### `--auto-stash`

Wraps the run in `git stash push --include-untracked` + `git stash pop`. Use when the working tree typically has autonomous-run accumulation (`.danteforge/state.yaml` updates, benchmark scratch dirs, etc.) that you don't want to commit but also can't permanently `.gitignore`.

**Restore policy:** the stash pop happens in Phase 6.5 (after the final report). If the pop has conflicts, the slash command body surfaces them and does NOT auto-resolve. Worst case the WIP lives on as a stash entry; `git stash list` surfaces it.

**Don't use when:** the dirty files are real work in progress you intend to commit. Use `--auto-stash` for noise, not for genuine WIP.

### `--scope-tests-to-diff`

Replaces `npm test` (full ~570-file suite, ~4 min) with a focused `npx tsx --test <selected-files>` (typically 15-30 files, ~30s). The selector finds:

1. Tests whose basename matches a changed source file (`src/core/foo.ts` → `tests/foo.test.ts`, `tests/foo-*.test.ts`).
2. Tests that explicitly import a changed source file (import-graph scan).
3. Always-run tests from `.danteforge/test-config.json` (`matrix-golden-flow`, `command-skill-coverage` by default).

**False-negative risk:** a regression in code unrelated to the lease's diff but caught by an integration test that doesn't import the changed file directly. Mitigation: add the integration test path to `alwaysRun`. The default includes the two known load-bearing tests; add project-specific ones as you discover them.

**Don't use when:** you're explicitly hunting for cross-cutting regressions (e.g., after a kernel refactor). Then full-suite is safer.

### `--auto-prune`

Sweeps stale worktrees under `.danteforge-worktrees/` whose leases are no longer active. Use when you've had many failed runs piling up directories.

### `--force-dirty`

Bypasses Phase 0 dirty-tree refusal. **Avoid.** Dirty trees contaminate the captured diff. Use only when you understand the contamination risk and have a specific reason — e.g., CI recovery from a prior crash.

### `--serial`

Disables parallel sub-agent dispatch. The host AI handles leases one at a time. Use when debugging a single lease end-to-end and the parallel-batch overhead obscures what's happening. Slow but legible.

## `.danteforge/test-config.json` schema

Per-project policy for verify-court. The file is force-added to git (the `.danteforge/` dir is otherwise gitignored).

```json
{
  "knownFlaky": [
    "regex-of-test-name-fragment",
    "another flaky case"
  ],
  "alwaysRun": [
    "tests/matrix-golden-flow.test.ts",
    "tests/command-skill-coverage.test.ts"
  ],
  "scopeToDiff": false
}
```

- **`knownFlaky`**: regex patterns matched against test names. Tests matching any pattern are skipped via Node's `--test-skip-pattern` when verify-court runs `npm test`. The skip is automatic; no per-test annotation needed.
- **`alwaysRun`**: test file paths that ALWAYS run when `scopeToDiff` is enabled, regardless of whether any source file they import has changed.
- **`scopeToDiff`**: default for the project. CLI flag `--scope-tests-to-diff` / `--no-scope-tests-to-diff` overrides per-invocation.

## Recovering a rejected lease

When merge-court rejects a lease for an unrelated test failure (the classic battle-station scenario), the lease's work is preserved on its own branch under `matrix/<dim>/<provider>-<short>`:

```bash
# Inspect what's recoverable
git log --oneline <current-branch>..<lease-branch>
git diff --stat <current-branch> <lease-branch>

# Commit any uncommitted files in the lease worktree first
cd .danteforge-worktrees/<lease-id>
git add -A && git commit -m "feat(<dim>): salvaged from rejected lease <lease-id>"
cd <main-repo>

# Squash-merge into your working branch with a clear receipt commit
git merge --squash <lease-branch>
git commit -m "feat(<dim>): <descriptive subject>

Salvaged from lease <lease-id> after merge-court rejection.
Rejection cause: <unrelated test|conflict|etc>.
The lease's own work is intact and validated."
```

After recovery, address the rejection cause:
- Test flake → add to `.danteforge/test-config.json` knownFlaky OR fix the test
- Genuine regression introduced elsewhere → fix in main first, then re-run /matrixdev
- Conflict on a forbidden path → revisit the work-packet's path scope

## Scaling to DanteCode-shape projects

DanteCode has 50 dimensions, 48 with active gaps, ~521 dirty files from prior autonomous runs. The reference invocation:

```bash
# From C:\Projects\DanteCode in a fresh Claude Code session
/matrixdev --auto-stash --scope-tests-to-diff --auto-prune
```

Pre-conditions to set up once:
1. Bootstrap matrix-kernel: `init`, `map-project`, `synthesize-dimensions`
2. Ship a `.danteforge/test-config.json` with project-specific knownFlaky + alwaysRun
3. Consider extending `.gitignore` to ignore truly transient autonomous-run state if you don't want it in commits

Then `/matrixdev` runs in waves. Each wave dispatches up to N concurrent sub-agents (default 4, override with `--max-parallel <n>`). After each wave's courts complete, re-invoke for the next wave until packets exhaust.

Time estimate: 1.5-3 hours of session-quota burn for a full 48-dimension push, depending on lease complexity. Pro/Max subscription is sufficient; no API spend.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Phase 0 refuses on dirty tree, no flag passed | Real WIP that needs to be committed | Commit or pass `--auto-stash` |
| Verify-court fails on an unrelated test | Flake or pre-broken test | Add to `knownFlaky` OR enable `--scope-tests-to-diff` |
| Merge-court rejects despite verify passing | Conflict at the lease's branch | Inspect the lease branch; squash-merge manually after fixing |
| Wave issues 0 packets | No dimensions have gap > 0 | Run `synthesize-dimensions`; check `compete-matrix.json` |
| Sub-agent returns "files modified: 0" | Lease's acceptance criteria not satisfiable | Honest report; review whether the work was a no-op or genuinely impossible |
| Multiple stale worktrees accumulating | Failed runs left state behind | `danteforge matrix-kernel prune --older-than 24` |
| `git stash pop` conflict in Phase 6.5 | Stashed WIP conflicts with lease changes | Resolve manually; `git stash list` keeps the entry |

## Where to look when something's off

- Live state: `danteforge matrix-kernel status` shows which graphs exist.
- Lease activity: `node -e "JSON.parse(require('fs').readFileSync('.danteforge/matrix/matrix.agent-runs.json','utf8')).runs.slice(-5).forEach(r => console.log(r.startedAt, r.leaseId, r.status, r.filesChanged.length))"`
- Inter-lease coordination: `danteforge matrix-kernel mailbox list`
- Final reports: `.danteforge/matrix/matrix.final-report.md`
- Court verdicts: `.danteforge/matrix/matrix.gate-reports.json`, `matrix.merge-decisions.json`

## When NOT to use `/matrixdev`

- For a single targeted fix where you know the file and the change. Use direct edits.
- For exploratory refactoring across many files at once. The matrix model assumes per-dimension scoped work; large cross-cutting changes don't fit.
- During an active `/sanitize` pass on the same codebase — the file-splitting can conflict with parallel lease edits.
- When you don't have a `compete-matrix.json` with realistic gaps. Run `danteforge assess` first to populate dimensions.

## Constitutional reminders

These come from the Matrix Kernel PRD §6 and aren't negotiable:

1. Agents propose. The kernel disposes.
2. No agent may merge.
3. No agent may work without a Work Packet.
4. No agent may edit without a Lease.
5. No Lease may be issued without conflict analysis.
6. No wave may run without safe parallelism calculation.
7. No branch may enter Merge Court without Verification Court.
8. No score may increase without evidence.
9. No protected path may be changed without explicit approval.
10. No duplicate subsystem may be created when an existing subsystem owns the responsibility.

Violations are rejected automatically; you don't need to police them manually.
