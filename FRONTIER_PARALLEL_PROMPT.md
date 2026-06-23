# Finish-to-Honest-Ceiling — portable parallel prompt (any Dante project)

> Copy everything below the line into a fresh Claude/agent session in the target project's VS Code window.
> It drives **that** project to each dimension's **honest ceiling** (not a blanket 9) using DanteForge's parallel
> multi-agent council: **two council members each own a DIFFERENT dimension and spin up 4 sub-agents to build it,
> while the third judges (builder-never-judges).** Project-agnostic — it reads the project's own matrix.
> Rewritten 2026-06-23 for the three-axis honest model; finish-mode + `danteforge finish` now live (council-unanimous).

---

You are driving **this project** (whatever repo this VS Code window is open on) to each dimension's **honest
ceiling** using DanteForge's parallel multi-agent council. Run it, monitor it, and report **honestly**.

## RULE 0 — never fabricate a score (the whole point)
**8.0 BUILD-COMPLETE is a terminal SUCCESS, not a shortfall.** A score is real only when its gate passes on
genuine, runnable evidence. Never author fake outcomes, stub receipts, or empty `real_user_path`s to inflate a
number — the honesty gate rejects them and the run is wasted. **A dim that honestly finishes at 8.0 is DONE; a
fabricated 9 is a lie the system exists to catch.**

## RULE 1 — the honest target is set by DEMAND POSTURE, not by ambition
Each dimension's honest ceiling (council-unanimous; encoded in `src/core/finish-ceiling.ts`):
- **Market / adoption dim** (`token_economy`, `enterprise_readiness`, `community_adoption`) → **5.0**. Needs
  real-world spend/adoption evidence; never autonomous. Stamp 5.0 and stop.
- **No artifact-aligned external demand** (a demand harvest RAN and found zero) → **8.0 BUILD-COMPLETE**. Wired +
  smoke-passing + no stubs. This is the terminal "done" for most dims of an internal tool.
- **Real artifact-aligned demand is bound** → **8.5 (demand-anchored) → 9.0 (demand-satisfied court)**.
- **Beat a named competitor** → 9.5–10, **funded**, never autonomous. Off the table for this run.

> "No demand" must be **OBSERVED, not assumed** — you must actually run the harvest and see zero (like DanteForge's
> `ecosystem_mcp`, which found 0 self-addressed issues). A dim that skips the harvest and claims "no demand" is
> dodging the 8.5 bar.

## Step 1 — see THIS project's dimensions + scores (don't assume)
```bash
danteforge finish                # START HERE: each dim vs its HONEST ceiling + whether the project is FINISHED
danteforge compete status        # the raw dimensions + current scores
```
The `danteforge` CLI is globally npm-linked — available in every Dante project, no build step. (Only if you changed
the DanteForge CLI source itself do you run `npm run build` in the DanteForge repo.)

## Step 2 — classify each dim's honest target (OBSERVE demand, don't assume)
For each non-market dim, run a demand harvest to find out whether real, artifact-aligned demand exists:
```bash
# Dogfood/operator demand lives on THIS project's own repo; ecosystem demand on competitor/topic repos.
danteforge harvest-demand --repos <this-org/this-repo>,<relevant-competitor-repos> --write
danteforge demand-spec --rank 1          # inspect the top cluster + its acceptance criteria
```
- **Harvest empty, or the demand is addressed to a DIFFERENT actor** (the attribution gate caps cross-actor demand
  at 8.5) → the dim's honest target is **8.0**. Finish it and stop.
- **Real, aligned, dated, re-fetchable demand exists** → target **8.5 → 9.0** via the demand-satisfaction court.

## Step 3 — clean stale state, then push every dim to ITS honest target
```bash
git worktree prune
rm -rf .danteforge-worktrees/council-*    # stale council worktrees BLOCK fresh agent spawns

danteforge ascend-frontier --parallel \
  --skip-dims <market-capped + heavy-benchmark dims> \
  --max-cycles 40 --max-attempts 2
```
- `--parallel` — each member owns a different dim, builds in an **isolated git worktree** (4 sub-agents/member by
  default; lower with `--slots-per-member <2-8>` on a laptop).
- **FINISH-MODE is wired** — `ascend-frontier` now STOPS a no-demand dim at 8.0 BUILD-COMPLETE (it is not pushed
  toward a 9 the demand gate would reject); only a demand-bound dim (a frozen `harvest-demand:` spec) is pushed to 9.
  Read the live status with **`danteforge finish`** — a no-demand dim at 8.0 reads FINISHED, not "1.0 below 9."

## The route past 8.0 — operator/dogfood feedback IS demand (the honest path to 9)
Once you START USING the finished tool, your real feedback grounds the engineering frontier — it flows through the
demand loop **identically to a competitor's demand**, with three enforced safeguards:
1. **File it as a real, dated GitHub issue on this repo** (durable + externally-held; a local note the agent can
   rewrite does NOT count). `harvest-demand --repos <this repo>` then picks it up.
2. **Dated BEFORE the build that satisfies it** — ENFORCED in `checkHarvestProvenance` via `demand-temporal.ts`
   (post-hoc demand is rejected, fail-closed). File the issue BEFORE you build; the gate verifies the ordering.
   (Auto-activation of this gate is pending one data-flow wiring; until then, file-before-build is your discipline.)
3. **Satisfied + court-confirmed** — the artifact must demonstrably clear the ask and the demand-satisfaction court
   (builder-never-judges, `ATTRIBUTION: PASS` fail-closed) must validate it.
A 9 earned this way is **honestly stamped SELF-SIGNED** (local-hmac signer = convergence, not proven ground truth)
and is **categorically not** a competitive 9.5–10 until an external signer (CH-045) is installed.

## SAFETY (load-bearing — do not skip)
- **NEVER omit the heavy-benchmark dim from `--skip-dims` on a local/Windows machine.** Its Docker grade has
  force-reset machines (WSL2 memory pressure). It runs ONLY on a dedicated cloud Linux box.
- Every other dim's push is local + safe (no Docker). If a run hangs or you relaunch, re-run the
  `rm -rf .danteforge-worktrees/council-*` cleanup first.

## Report back (honestly, no inflation)
1. Dims **FINISHED at 8.0 BUILD-COMPLETE** (no aligned demand — harvest ran empty). This is success.
2. Dims with **bound demand the court VALIDATED to 8.5–9.0** (quote the verdict; note SELF-SIGNED).
3. Dims **below their honest target** + the concrete gap to close (wire a callsite / author a smoke outcome / etc.).
4. Market dims **stamped 5.0**. The honest overall: `danteforge gap --all` and `danteforge compete status`.

**Never report a 9 the court didn't validate, and never report 8.0 as failure.** The deliverable is **each dim AT
its honest ceiling + the precise gap for any that aren't**.

## Portability note (read before sending to another project)
The prompt mechanics are generic; the **demand posture is per-project**. Before running elsewhere, know: which dims
are market-capped (→5), which repos to harvest for that project's demand (its own repo for dogfood + its real
competitors), and which dims have real users. A project with real public users binds demand and reaches 9 where an
internal tool with zero issues honestly finishes at 8.0 — same numbers, different reachable ceilings, all honest.
