---
name: matrixdev
description: "Easy-mode multi-agent matrix dev — one command to dispatch parallel Claude/Codex CLI instances across your project's gap dimensions, run every court, and report what merged"
---

# /matrixdev — Easy-mode multi-agent matrix development

When the user types `/matrixdev [objective]`, drive the full Matrix Kernel loop end-to-end with sensible defaults. This is the headline "one command, many parallel agents" workflow.

## What it does (in order)

For each step, run the matching `danteforge matrix-kernel <subcommand>` via the Bash tool. Use `--cwd` if the user isn't already in the project root. Stream the output to the user with one-line summaries between steps — they should always know which stage you're in.

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

**Default is `--adapter auto`** — the kernel detects whether it's running inside a host AI and picks the right mode:

- If `CLAUDE_PLUGIN_ROOT` is set (you, the AI reading this, ARE Claude Code) → `embedded` mode.
- If `CODEX_SESSION` / `CODEX` / `CODEX_ENV` is set (host is Codex) → `embedded` mode.
- Plain terminal (neither set) → falls back to `fake` for safety, unless the user passed an explicit `--adapter`.

You only need to choose a non-default adapter when running from a plain terminal AND wanting real execution. In that case probe `claude --version`, `codex --version`, `ollama list` and pick the first available.

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

### Phase 3.5 — Embedded mode handoff (the key difference when you're a host AI)

If you (the AI reading this slash command) are running inside Claude Code or Codex AND the user did not pass an explicit `--adapter`, the run-wave step will print:

```
[matrix-kernel] Auto-selected adapter: embedded (host AI: claude)
```

When that line appears, here is what changes about your job:

1. `run-wave 1 --adapter auto` (or `--adapter embedded`) will write one Work Instruction Packet per lease to `.danteforge/embedded-mode/<leaseId>/work-instruction.md`. It will NOT spawn another Claude Code / Codex subprocess.
2. **You** then read each instruction packet and execute the lease using your own Edit/Write tools — stay strictly within `ownedPaths`, never touch `forbiddenPaths`. Run any required local checks (typecheck / tests) yourself before declaring complete.
3. After each lease is done, run `danteforge matrix-kernel embedded-complete <leaseId>` so the kernel captures your diff (via `git diff --name-only HEAD` on the worktree) and queues the lease for verify-court.
4. Proceed to Phase 5 (courts) as usual.

In embedded mode, you ARE the worker. The kernel is the conductor. The mailbox (`danteforge matrix-kernel mailbox list`) records what's happening across leases so a war-room observer (or a parallel Codex CLI in another terminal) can see your progress.

### Phase 4 — Dispatch wave 1

```bash
danteforge matrix-kernel run-wave 1 --adapter <chosen>
```

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
