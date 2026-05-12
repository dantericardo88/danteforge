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

Default decision tree (in order):

1. **If `--adapter <name>` was in the user's `/matrixdev` invocation**, use that.
2. **Otherwise, probe what's available**: try `claude --version`, `codex --version`, `ollama list` (via Bash). Pick the FIRST one that works.
3. **If nothing is available**, use `--adapter fake` so the loop completes without LLM calls. Tell the user clearly.

Adapter aliases (most-to-least preferred):
- `claude` — spawns local Claude Code CLI; uses your Claude Pro/Max subscription
- `codex` — spawns local Codex CLI; uses your ChatGPT Plus/Pro subscription
- `ollama` — local + free; uses whatever model is in `~/.danteforge/config.yaml#ollamaModel`
- `fake` — no LLM calls (dry-run-ish; agents write known content)

API-key alternatives (only if user explicitly wants them):
- `claude-api` (needs `ANTHROPIC_API_KEY`)
- `codex-api` (needs `OPENAI_API_KEY`)
- `gemini`, `grok`, `together`, `groq`, `mistral`

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

## Argument parsing

The slash command may be invoked with:

- `/matrixdev` — full auto, all defaults
- `/matrixdev <objective>` — full auto; pass the objective as a one-shot context hint (use it in messages back to the user, not in the kernel CLI since work packets come from the compete-matrix)
- `/matrixdev --adapter <name>` — override adapter
- `/matrixdev --max-agents <n>` — override the simulate count (default 5)
- `/matrixdev --safe` — use `--adapter fake` no matter what (for dry-run validation of the kernel pipeline without spawning any CLI)
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
- The synthesize-dimensions step produced 0 dimensions — same fix
- The user invoked with `--adapter claude` but `claude --version` exits non-zero — tell them to install Claude Code or pick a different adapter
- Simulate reports `Safe agents now: 0` AND `Blocked packets > 0` — there's a conflict; tell the user and don't dispatch

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
