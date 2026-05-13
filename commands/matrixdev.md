---
name: matrixdev
description: "Easy-mode multi-agent matrix dev — one command to dispatch parallel Claude/Codex CLI instances across your project's gap dimensions, run every court, and report what merged"
---

# /matrixdev — Easy-mode multi-agent matrix development

When the user types `/matrixdev [objective]`, drive the full Matrix Kernel loop end-to-end with sensible defaults. This is the headline "one command, many parallel agents" workflow.

## What it does (in order)

For each step, run the matching `danteforge matrix-kernel <subcommand>` via the Bash tool. Use `--cwd` if the user isn't already in the project root. Stream the output to the user with one-line summaries between steps — they should always know which stage you're in.

### Phase 0 — Pre-flight (REQUIRED, do not skip)

Before touching any matrix state, probe the working tree:

```bash
danteforge matrix-kernel preflight --json
```

Parse the JSON. If `clean: true`, proceed to Phase 1.

If `clean: false`, STOP and surface the modified/untracked file list to the user. The run-wave dispatcher will refuse to dispatch on a dirty tree (it bundles unrelated changes into the captured diff and contaminates verify-court). Offer the user, in this order:

1. **Commit** the uncommitted changes ("they're related to my current work")
2. **Stash** them (`git stash push -m "before /matrixdev"`) — restore later with `git stash pop`
3. **Abort** `/matrixdev` and resolve the WIP manually
4. **`--force-dirty`** — only if the user explicitly insists they understand the risk

Default to **(3) abort** unless the user picks one of the others.

Also, before Phase 1, check for stale worktrees:

```bash
ls .danteforge-worktrees/ 2>/dev/null | wc -l
```

If there's more than one or two stale dirs from prior runs, suggest:

```bash
danteforge matrix-kernel prune --older-than 24
```

Proceed only if the user says yes or auto-prune is requested via `/matrixdev --auto-prune`.

### Phase 1 — Detect state and bootstrap

Check whether `.danteforge/matrix/` exists. If not, run:

```bash
danteforge matrix-kernel init
danteforge matrix-kernel map-project
danteforge matrix-kernel synthesize-dimensions
```

If it does exist, just run `danteforge matrix-kernel status` to confirm what's there and skip ahead.

### Phase 2 — Plan parallel work

```bash
danteforge matrix-kernel work-packets
danteforge matrix-kernel simulate --max-agents 5
```

Read the simulate output: how many waves? how many packets per wave? what's the USD estimate? Surface this to the user in a 3-line summary BEFORE dispatching.

### Phase 3 — Pick the adapter

**You are reading this slash command from inside a host AI (Claude Code or Codex).** The right adapter is **always `--adapter embedded`** in this context. Do NOT use `--adapter auto` here.

**Why explicit, not auto?** `detectHostAI()` reads `CLAUDE_PLUGIN_ROOT` / `CODEX_SESSION`, but those env vars are injected into plugin scripts, NOT into Bash subprocesses spawned by a slash command. When you call `danteforge matrix-kernel run-wave` via the Bash tool, the kernel's auto-probe sees a clean env → falls back to `fake` → spawns a stub adapter that doesn't do real work. Explicit `--adapter embedded` skips the broken probe and tells the kernel: "the host AI executing this markdown will do the work itself; just write the instruction packet."

The `--adapter auto` flag is correct for **plain-terminal invocations** (a human typing `danteforge matrix-kernel run-wave --adapter auto` in their shell). Those processes ARE the host's plugin context and inherit the env vars. From a slash command body, ALWAYS pass `--adapter embedded`.

If the user explicitly overrode adapter on the slash command (`/matrixdev --adapter claude`, `--adapter codex`, etc.), honor that — the override path is the user asking for a real subprocess instead of embedded execution.

Adapter aliases (most-to-least preferred for terminal mode):
- `embedded` — write a Work Instruction Packet for the host AI to execute inline (no subprocess, no double-billing)
- `claude` — spawns local Claude Code CLI; uses your Claude Pro/Max subscription
- `codex` — spawns local Codex CLI; uses your ChatGPT Plus/Pro subscription
- `ollama` — local + free; uses whatever model is in `~/.danteforge/config.yaml#ollamaModel`
- `fake` — no LLM calls (dry-run-ish; agents write known content)

API-key alternatives (only if user explicitly wants them):
- `claude-api` (needs `ANTHROPIC_API_KEY`)
- `codex-api` (needs `OPENAI_API_KEY`)
- `gemini`, `grok`, `together`, `groq`, `mistral`

### Phase 3.5 — Embedded mode handoff (REQUIRED — this is your job in this context)

You invoked `run-wave 1 --adapter embedded` in Phase 4 below. The kernel will print:

```
[matrix-kernel] Issued lease <leaseId> (provider=embedded)
```

Then for each lease, here is what you (the host AI) MUST do — no exceptions:

1. **Read the work-instruction packet** at `.danteforge/embedded-mode/<leaseId>/work-instruction.md` (and the JSON sibling for machine-readable scope). The packet tells you the objective, owned paths, forbidden paths, acceptance criteria — and `worktreePath`, the real git worktree the kernel created for this lease.
2. **Execute the lease inline using your own Edit/Write/Read tools, INSIDE the worktreePath** (NOT the main repo checkout). Every owned-path is relative to `<worktreePath>/`. The worktree is on its own branch (e.g. `matrix/<dim>/<provider>-<short>`); edits there don't touch your main branch. Stay strictly within `ownedPaths`. NEVER touch `forbiddenPaths`.
3. **Run required local checks** (typecheck, tests) **from the worktree directory** before declaring completion. If they fail, fix or back out — do not call embedded-complete with broken state.
4. **Capture the diff** via `danteforge matrix-kernel embedded-complete <leaseId>`. The kernel reads `git diff --name-only HEAD` inside the lease's worktree and feeds those files into verify-court + merge-court. Because Phase 0 ensured a clean main tree AND because Phase 4 created a real `git worktree add`, the captured diff is strictly the lease's work — no contamination from unrelated WIP.
5. **Then** proceed to Phase 5 (courts).

**Critical kernel rule (merge-court v2):** an `embedded-complete` call that captures **zero file changes** will be REJECTED by merge-court. The work-packet generator only emits packets for dimensions with `gapVsTarget > 0`; a 0-change response to a real packet is, semantically, "I did nothing" — and the kernel will tell the user that honestly rather than fake an APPROVED outcome. If a lease's acceptance criteria are genuinely impossible in one shot, return early and tell the user; don't pretend.

In embedded mode you ARE the worker. The kernel is the conductor. The mailbox (`danteforge matrix-kernel mailbox list`) records what's happening across leases.

### Phase 4 — Dispatch wave 1

```bash
danteforge matrix-kernel run-wave 1 --adapter embedded
```

(If the user explicitly overrode the adapter via `/matrixdev --adapter <name>`, substitute that. Otherwise always use `embedded` here because you are inside a slash command body — see Phase 3.)

The kernel will dispatch all packets in wave 1 IN PARALLEL via `Promise.all`. Each agent gets its own lease + worktree. Each is constrained by its lease's `allowedWritePaths`.

After dispatch, read the agent-run summary. Tell the user how many succeeded vs failed and (if available) the per-lease file-change counts.

### Phase 5 — Run every court

```bash
danteforge matrix-kernel verify --all
# For any lease whose work packet has redTeamRequired: true OR if user passed --red-team
danteforge matrix-kernel red-team <leaseId> --mock
# For any lease whose work packet has tasteGateRequired: true
danteforge matrix-kernel taste-gate <leaseId>
danteforge matrix-kernel merge-court
```

Tell the user the gate-by-gate verdict in a compact table.

### Phase 6 — Final reports

```bash
danteforge matrix-kernel retrospective
danteforge matrix-kernel report
```

Read the final markdown report path from the report command's output and SHOW the path to the user so they can open it.

## Autonomous defaults (no-prompt behavior)

`/matrixdev` defaults to **autonomous mode**: probe → pick adapter → dispatch → run all courts → emit report, without asking the user to confirm anything. Only ask if the user explicitly passed `--ask`.

When the compete-matrix has an `excludedDimensions` list, those dimensions are already filtered out by the engine before work-packet generation reaches you — no manual policing needed. If the user wants to permanently skip a dimension, run `danteforge compete --exclude <dim_id>` once and it sticks across sessions.

Treat `Safe agents now: 0` AS NON-BLOCKING when every wave contains exactly one packet (single-packet waves are trivially safe — the parallelism counter only matters when waves have ≥2 packets). Still bail out if `Blocked packets > 0` because that signals a real protected-path or ownership violation.

## Argument parsing

The slash command may be invoked with:

- `/matrixdev` — **full auto, all defaults** (no prompts; pick first available adapter)
- `/matrixdev <objective>` — full auto; pass the objective as a one-shot context hint
- `/matrixdev --adapter <name>` — override adapter
- `/matrixdev --max-agents <n>` — override the simulate count (default 5)
- `/matrixdev --safe` — use `--adapter fake` no matter what (dry-run validation; no LLM spend)
- `/matrixdev --ask` — explicitly opt into the old confirmation-per-step flow
- `/matrixdev --status` — just run `matrix-kernel status` and report; don't dispatch
- `/matrixdev --auto-prune` — auto-run `matrix-kernel prune --older-than 24` during Phase 0 instead of prompting the user about stale worktrees
- `/matrixdev --force-dirty` — pass through to `run-wave --force-dirty` (only when the user explicitly asks; the dirty-tree refusal is there for a reason)

## Output format

Use this exact section structure when reporting back to the user:

```
🟢 Matrix Kernel — Wave 1 dispatched

Plan
  Waves:     2
  Packets:   5
  Adapter:   claude (Pro/Max subscription)
  Cost est:  $0.18 – $0.92

Results
  ✓ feature_a       (3 files changed)
  ✓ feature_b       (1 file changed)
  ✗ feature_c       (failed: edit_outside_lease)
  ⏭ feature_d       (skipped: no work needed)

Courts
  Verification:  4 passed, 1 failed
  Red Team:      1 ran, 0 findings
  Merge Court:   3 approved, 2 rejected

Report: .danteforge/matrix/matrix.final-report.md
```

## When to stop early

Bail out early (and tell the user) if:

- **Phase 0 preflight reports `clean: false`** and the user did not pick commit/stash/`--force-dirty`. Dispatching against a dirty tree contaminates verify-court; refusing is the safer default.
- No `compete-matrix.json` exists at `.danteforge/compete/matrix.json` — tell the user to run `danteforge init` or `danteforge compete --calibrate` first
- The synthesize-dimensions step produced 0 dimensions (which now also happens when *every* dimension is excluded — same fix path: run `danteforge compete --include <dim>` to re-enable one)
- The user invoked with `--adapter claude` but `claude --version` exits non-zero — tell them to install Claude Code or pick a different adapter
- Simulate reports `Blocked packets > 0` — that signals a real protected-path or ownership violation; surface the affected paths and don't dispatch. (Note: `Safe agents now: 0` on its own is not a blocker — single-packet waves can still run sequentially.)

## What it does NOT do

- Does NOT run `matrix-orchestrate` (the higher PRD→frontier layer). That's `/matrixorchestrate` (separate command).
- Does NOT touch your `main` branch. Every agent runs in an isolated worktree; only `merge-court` approves a branch for actual merging, and even then it happens at the kernel level — not as `git push` against any remote.
- Does NOT spend money silently. Every adapter that costs (claude-api/codex-api/gemini/grok/together/groq/mistral) must be opted into explicitly via `--adapter <kind>`. Default order is sub-based or free.

## Constitutional reminders

The kernel runs under the constitutional discipline (PRD §6):

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

Any agent run that violates these is rejected automatically. You don't need to police it manually — the kernel does.
