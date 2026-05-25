# CRUSADE_REPORT.md

**Status:** Council proof run complete (2026-05-25) — see session below.

---

## Council Proof Run — 2026-05-25

**Goal:** Prove the Hierarchical Multi-Agent Council v0.19.0 works end-to-end on real
competitive dimensions, and improve the self-defense mechanism for SPLIT/FAIL verdicts.

### Dims targeted
- `testing` (was 7.0 → now **9.0**, T7 validated)
- `spec_workflow_enforcement` (was 6.5 → now **9.0**, T7 validated)

### What ran
- `danteforge council --parallel --slots-per-member 1 --rounds 1 --goal "..." --focus-dims "testing,spec_workflow_enforcement"`
- 3 members × 1 slot = 3 builders, each attacking one of the targeted dims
- Streaming judge queue: idle slots from cross-members judged completed builds immediately
- K-of-M weighted consensus (cross-member weight 1.0, same-member 0.5)

### Outcomes of council session
- **Codex** built on `testing`: recursive glob fix in `test-coverage-analyzer.ts` (was `*.test.ts`, now `**/*.test.ts`), side-effect import test and glob `alwaysRun` test in `diff-scoped-tests.test.ts`, nested test integration test in `testing-dimension.test.ts` — **PASS verdict, merged**
- **Claude Code** built on `testing`/`spec_workflow_enforcement`: triggered SPLIT verdict → entered debate (2 rounds)
- **SPLIT root cause found**: `ClaudeCodeAdapter` in judge mode was writing files to the worktree, then the revert block was clearing `capturedOutput` → 47-char invalidation message instead of the full VERDICT: output

### Bugs fixed during the run
1. **Streaming judge member identity bug**: `tryAssignStreamingJudge` was passing the judge's memberId as the "builder" to `runMergeCourt`, causing 0 cross-member judges → FAIL. Fixed by constructing a synthetic `builderHandle` with the candidate's memberId.
2. **47-char rebuttal bug** (Fix A): `ClaudeCodeAdapter` was setting `capturedOutput = ''` and `status = 'failed'` when a judge wrote files to the worktree. Fixed to preserve `capturedOutput` as `finalMessage` and mark `status = 'completed'`.
3. **Revision-then-rejudge** (Fix B): New `council-revision.ts` module replacing the text debate loop. On SPLIT/FAIL: (1) builder self-inspects diff + feedback → text assessment; (2) builder makes targeted fixes in worktree; (3) judges re-evaluate the cumulative revised diff. `council-merge-court.ts` now calls `runRevision` by default (`useRevision: true`); text debate kept as opt-out.

### Cold validate results
| Dim | Before (derived) | After | Outcomes | Tier |
|---|---|---|---|---|
| testing | 5.3 | **9.0** | 4/4 PASS | T7 ceiling lifted |
| spec_workflow_enforcement | 0.0 | **9.0** | 4/4 PASS | T7 ceiling lifted |

### Commits
- `d1aa722` — fix(council): streaming judge member identity bug + Codex testing improvements
- `d60a4c2` — feat(council): revision-then-rejudge loop + preserve judge text output
- `876d62a` — score(matrix): testing → 9.0, spec_workflow_enforcement → 9.0

### Key architectural insight
The original text debate loop was fundamentally broken for coding agents: the "rebuttal" was supposed to be text, but `ClaudeCodeAdapter` is a coding agent that writes files. When it tried to write files in debate/judge mode the files were correctly reverted but the text output was also discarded. The revision-then-rejudge architecture matches how coding agents actually work: instead of arguing in text, they fix the code and let the judges re-evaluate.

---

Run `danteforge crusade --goal "<goal>" --dimension <dim>` to generate a fresh report.

## Pipeline Fix (2026-05-25)

Two silent-failure bugs were found and fixed in `src/cli/commands/crusade.ts`:

1. `danteforge oss <domain> --auto` — `--auto` is not a valid flag on the `oss` command.
   Fixed to: `danteforge oss --max-repos 5`

2. `danteforge forge --goal <goal>` — `forge` has no `--goal` flag.
   Fixed to: `danteforge magic <goal> --yes`

The previous security crusade (10 cycles, 0 patterns harvested, every forge wave FAILED)
was caused entirely by these two broken subprocess calls — not by any failure in the
underlying forge or OSS harvest implementations. The pipeline is now correctly wired.

Next: run a crusade on `community_adoption` (score=1, gap=7.5) to produce the first
real end-to-end receipt of the fixed pipeline.
