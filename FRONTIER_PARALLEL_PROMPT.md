# Parallel Frontier Push — portable prompt (any Dante project)

> Copy everything below the line into a fresh Claude/agent session in the target project's VS Code window.
> It drives **that** project to the frontier (9.0) using DanteForge's parallel multi-agent council:
> **two council members each own a DIFFERENT dimension and spin up 4 sub-agents (the standard) to build it,
> while the third judges (builder-never-judges).** Project-agnostic — it reads the project's own matrix.
> Verified working 2026-06-22.

---

You are driving **this project** (whatever repo this VS Code window is open on) to the competitive frontier
(9.0 per dimension) using DanteForge's parallel multi-agent council. Run it, monitor it, and report **honestly**.

## RULE 0 — never fabricate a score (the whole point)
A 9.0 is real ONLY when the **frontier-review court VALIDATES it** on genuine, runnable evidence. Do NOT author
fake outcomes, stub receipts, or empty `real_user_path`s to inflate a number — the honesty gate rejects them and
the run is wasted. **An honest ceiling at ~8 is a TRUE result; a fabricated 9 is a lie the system exists to
catch.** If a dim can't honestly reach 9, report that and exactly why.

## Step 1 — see THIS project's dimensions (don't assume)
```bash
danteforge compete status        # lists the project's dimensions + current scores
```
The `danteforge` CLI is globally npm-linked, so it's available in every Dante project with no build step. (Only
if you have *changed the DanteForge CLI source itself* do you run `npm run build` in the DanteForge repo.)

## Step 2 — decide what to EXCLUDE (`--skip-dims`), based on the matrix you just saw
Skip two classes of dim — adjust the names to whatever this project actually has:
- **Heavy-benchmark / cloud-graded dims** — any dim whose grade runs a heavy external benchmark in Docker
  (commonly named `code_generation`, or anything graded by SWE-bench / a benchmark suite). These can force-reset
  a local machine (WSL2 RAM pressure) and must run on a dedicated cloud Linux box, NOT here.
- **Market-capped meta-dims** — `token_economy`, `enterprise_readiness`, `community_adoption` (standard across
  Dante projects; permanently 5.0, need real-world adoption). Skipping a dim the project lacks is harmless.

## Step 3 — clean stale state, then launch
```bash
git worktree prune                       # clear stale worktree refs
rm -rf .danteforge-worktrees/council-*   # remove stale council worktrees — they BLOCK fresh agent spawns

danteforge ascend-frontier --parallel \
  --skip-dims <comma,separated,dims,from,Step 2> \
  --max-cycles 40 --max-attempts 2
```
- `--parallel` — each council member owns a different dim, builds in an **isolated git worktree**.
- **4 sub-agents per member is the default** (M members × 4 worktrees). Override with `--slots-per-member <2-8>`
  for less/more parallelism (lower it on a laptop; `--member-slots "claude-code:4,codex:4"` for per-member).
- `--max-cycles 40 --max-attempts 2` — bounded so the run terminates.

## SAFETY (load-bearing — do not skip)
- **NEVER omit the heavy-benchmark dim from `--skip-dims` on a local/Windows machine.** Its Docker grade has
  force-reset machines (WSL2 memory pressure). It runs ONLY on a dedicated cloud Linux box.
- Every other dim's push-to-9 is local + safe (no Docker).
- If a run hangs or you re-launch, re-run the `rm -rf .danteforge-worktrees/council-*` cleanup first.

## What you'll see (the topology — confirm it matches)
```
[ascend-frontier] parallel round: <memberA>→<dimA>, <memberB>→<dimB>   # 2 members, 2 DIFFERENT dims
[council] Slot mode: 4 slot(s)/member → N parallel worktree(s)          # 4 agents each (the standard)
[council] [<memberA>-0] building 1 dim(s)...  [<memberB>-0] building...  # agents building concurrently
[council] Builder never judges. Isolated worktrees. Anonymous peer review.
... frontier-review court ...                                           # the court judges (builders excluded)
```
If you instead see `--goal or --ask is required` or `worktree already exists`, the build didn't spawn — run the
Step 3 cleanup and relaunch (and update the globally-linked CLI if you changed it).

## How to read each dim's result (the three HONEST outcomes)
- **VALIDATED 9.0** — the court confirmed genuine competitor-parity. A real frontier result.
- **honest ceiling ~8 (`generator-ceiling`)** — the capability isn't frontier-grade yet; the court honestly
  rejected. A TRUE result, not a failure — report the gap.
- **`spec-incomplete` ceiling** — the dim's `frontier_spec.real_user_path` is empty/TODO. It needs a real
  `run_command` + an observable artifact + ≥2 realistic inputs authored before the court can judge. **This is
  the #1 blocker for most dims** — surface it as the actionable next step.

## Report back (honestly, no inflation)
1. Which dims the court **VALIDATED to 9** (quote the court verdict).
2. Which honestly **ceilinged at ~8** and the concrete capability gap.
3. Which need their `frontier_spec.real_user_path` **authored** (the actionable list).
4. The honest overall: run `danteforge autonomy` and `danteforge compete status`.

Never report a 9 the court didn't validate. The deliverable is the **honest number + the precise gap to close**.
