---
name: goal-loop-matrix
description: "Scoring-gated Matrix Kernel loop — drives parallel agents via /matrixdev on the weakest competitive dimensions, adversarially rescores, then checks /goal. One cycle per invocation; pair with /goal for fully autonomous repetition."
---

# /goal-loop-matrix — Scoring-gated Matrix Kernel Loop

When the user types `/goal-loop-matrix`, run one full improvement cycle:

1. Check current state
2. Find weakest dimensions
3. Run `/matrixdev` on them (parallel agents + courts)
4. Adversarially rescore
5. Update `/goal` verdict

**Pair with `/goal` for autopilot:**
```
/goal danteforge compete --check-all-nine exits 0
/goal-loop-matrix
```
The `/goal` evaluator fires another turn automatically if gaps remain. No further input needed.

---

## Phase 0 — State check

Run:
```bash
danteforge compete --check-all-nine
```

If exit code is **0**: report "All dimensions at 9.0+. Goal achieved." and **stop** — do not run matrixdev.

If exit code is **1**: continue to Phase 1. Show the failing dimension list from `.danteforge/GOAL_STATUS.json`.

---

## Phase 1 — Find weakest dimensions

```bash
danteforge compete --next-dims 3 --json
```

Parse the JSON array. Each entry has: `{ id, label, selfScore, target, gap, touches }`.

If the array is empty: the matrix has no actionable dimensions — tell the user to run `danteforge compete --init --use-canonical` first and stop.

Build the objective string for matrixdev:
- If 1 dim: `"Improve <label> from <selfScore> to 9.0+"`
- If 2–3 dims: `"Improve these dimensions to 9.0+: <label1> (gap: <gap1>), <label2> (gap: <gap2>), <label3> (gap: <gap3>)"`

Show the user a one-line summary: `Working on: <labels> | Gaps: <gaps>`

---

## Phase 2 — Pre-flight

```bash
danteforge matrix-kernel preflight --json
```

Parse JSON. If `clean: false`:
- Auto-stash: `git stash push --include-untracked -m "goal-loop-matrix $(date -u +%Y-%m-%dT%H-%M-%SZ)"`
- Note the stash — restore it in Phase 7.

Check for stale worktrees:
```bash
danteforge matrix-kernel prune --older-than 24
```

---

## Phase 3 — Bootstrap matrix kernel (skip if already initialized)

Check whether `.danteforge/matrix/` exists. If not:
```bash
danteforge matrix-kernel init
danteforge matrix-kernel map-project
danteforge matrix-kernel synthesize-dimensions
```

If it exists, just confirm with:
```bash
danteforge matrix-kernel status
```

---

## Phase 4 — Plan work packets

```bash
danteforge matrix-kernel work-packets
danteforge matrix-kernel simulate --max-agents 4
```

Read the simulate output: waves, packets, USD estimate. Show the user a 2-line plan summary before dispatching.

---

## Phase 5 — Dispatch wave (embedded adapter — parallel agents)

**ALWAYS use `--adapter embedded` here.** You are inside Claude Code; the embedded adapter writes Work Instruction Packets for you to dispatch as sub-agents. Never use `--adapter auto` from a skill body (env vars are not inherited by subprocesses).

```bash
danteforge matrix-kernel run-wave 1 --adapter embedded
```

Parse stdout for lines matching:
```
[matrix-kernel] Issued lease <leaseId> (provider=embedded)
```

Collect all `<leaseId>` values.

### 5a — Build sub-agent prompts (parallel Bash calls, one message)

In **one message**, call Bash once per leaseId:
```bash
danteforge matrix-kernel build-subagent-prompt <leaseId>
```

Each returns JSON: `{ leaseId, description, prompt }`.

### 5b — Dispatch sub-agents IN PARALLEL (one message, multiple Agent calls)

In **one message**, call the Agent tool once per lease:
- `subagent_type`: `"general-purpose"`
- `description`: the `description` field from build-subagent-prompt
- `prompt`: the `prompt` field verbatim

Cap at **4 concurrent agents**. If more than 4 leases, chunk into batches of 4 in successive messages.

Each sub-agent works in its own isolated git worktree branch. Wait for all to return.

### 5c — Complete leases (parallel, one message)

After all sub-agents return, in **one message** call Bash once per leaseId:
```bash
danteforge matrix-kernel embedded-complete <leaseId>
```

### 5d — Failure handling

If a sub-agent fails or returns zero file changes: record it as failed and continue. Merge-court rejects zero-diff completions automatically. Good leases still merge.

---

## Phase 6 — Run courts

```bash
danteforge matrix-kernel verify --all
danteforge matrix-kernel merge-court
danteforge matrix-kernel retrospective
```

Show the user a compact verdict table:
```
Courts
  Verification:  N passed, M failed
  Merge Court:   N approved, M rejected
```

---

## Phase 7 — Restore stash (only if stashed in Phase 2)

```bash
git stash pop
```

If pop has conflicts: DO NOT auto-resolve. Show the stash ref and conflict list. The user resolves manually.

---

## Phase 8 — Adversarial rescore

This is the critical anti-inflation gate. Run:
```bash
danteforge compete --calibrate
```

The adversarial scorer runs in a fresh context with a hostile reviewer prompt. It can only lower scores from what agents self-reported — never inflate them. Any dimension where the adversarial score is ≥1.5 points below the self-reported score gets corrected.

Show the user which dimensions were corrected and by how much.

---

## Phase 9 — Update goal verdict

```bash
danteforge compete --check-all-nine
```

This writes `.danteforge/GOAL_STATUS.json` and exits 0 (all green) or 1 (gaps remain).

Show the final progress table. Report: `N/50 dimensions at 9.0+ | M gaps remain`.

If the `/goal` condition is set (`/goal danteforge compete --check-all-nine exits 0`), the evaluator reads the exit code and fires another `/goal-loop-matrix` turn automatically if gaps remain.

If no `/goal` is active: offer to run another cycle or suggest setting `/goal` for autopilot.

---

## Arguments

- `/goal-loop-matrix` — full auto, 3 weakest dims per cycle
- `/goal-loop-matrix <n>` — work on N dimensions per cycle (default 3)
- `/goal-loop-matrix --target <score>` — override 9.0 target
- `/goal-loop-matrix --serial` — one lease at a time (debug mode)
- `/goal-loop-matrix --max-parallel <n>` — cap sub-agents (default 4)
- `/goal-loop-matrix --status` — just run Phase 0 + show table, no dispatch

---

## What this does NOT do

- Does NOT call `/inferno` — matrixdev with courts is strictly more rigorous
- Does NOT self-report scores — all scoring goes through `compete --calibrate` (adversarial)
- Does NOT touch `main` directly — every agent works in an isolated worktree; merge-court approves
- Does NOT skip courts — verify-court + merge-court run every cycle; zero-diff completions are rejected

---

## Full autopilot setup (copy-paste)

```
/goal danteforge compete --check-all-nine exits 0
/goal-loop-matrix
```

That's it. The loop runs until every reachable dimension is at 9.0+, then stops.
For a specific project not in the current directory, run from that project's IDE window — `compete --check-all-nine` and `matrix-kernel` both read from the current working directory automatically.
