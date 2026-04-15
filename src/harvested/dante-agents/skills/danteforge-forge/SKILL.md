---
name: danteforge-forge
description: Autonomous forge phase execution — implement the current phase tasks using native AI tools, then verify
version: 1.0.0
risk: medium
source: danteforge
importDate: 2026-04-11
---

# DanteForge Forge Skill

Activate this skill when `danteforge tasks` has run and you are ready to implement the current forge phase. You are the forge engine — implement tasks using your own native tools, then call `danteforge verify` to validate.

## When to Activate

Check `.danteforge/STATE.yaml`:
- `workflowStage` is `forge`
- `currentPhase` is set (e.g., `1`)
- `tasks[currentPhase]` contains a list of tasks

If STATE.yaml does not exist, run `danteforge tasks` first.

## Step 1 — Read Current State

```bash
cat .danteforge/STATE.yaml
```

Extract these fields:
- `currentPhase` — the phase number to implement (e.g., `1`)
- `tasks[currentPhase]` — array of task objects for this phase
- `constitution` — project principles (read for context)
- `profile` — execution profile (`budget` / `balanced` / `quality`)

Each task object has:
- `name` (string) — what to implement
- `files` (string[], optional) — files this task touches; read these first
- `verify` (string, optional) — acceptance criterion to check after implementing

## Step 2 — Implement Each Task

For each task in `tasks[currentPhase]`, in order:

### 2a. Read before writing

If the task has `files`, read each one first:
- Use your Read tool (or `cat`) to load current content
- Never overwrite a file without reading it first
- If a file does not exist yet, you will create it

### 2b. Implement the task

Use your native tools:
- **Read** — load existing file content
- **Edit** — make targeted changes to existing files
- **Write** — create new files
- **Bash** — run build commands, install packages, generate files

Follow the task `name` as your specification. If a `verify` criterion is present, keep it in mind as you implement — it defines what "done" means for this task.

### 2c. Move to the next task

After implementing each task, move directly to the next one. Do not call `danteforge verify` between individual tasks — verify once after all tasks in the phase are complete.

## Step 3 — Verify the Phase

After all tasks are implemented, stage your changes and verify:

```bash
git add -A
danteforge verify --json
```

**Exit 0 (pass):** The phase is complete. You may stop or proceed to `danteforge synthesize`.

**Exit 1 (fail or warn):** Read the verify output carefully:
- Identify which tasks or checks failed
- Fix the failing code using Edit/Write/Bash
- Run `danteforge verify` again

Repeat until exit 0. If verify fails 3 times on the same check, report the failing check and the verify output to the user — do not loop forever.

### Using Structured Verify Output

For reliable failure parsing, use the `--json` flag:

```bash
danteforge verify --json
```

This writes clean JSON to stdout AND persists to `.danteforge/evidence/verify/latest.json`.

The JSON structure:
```json
{
  "status": "pass",
  "counts": { "passed": 12, "warnings": 0, "failures": 0 },
  "passed": ["typecheck", "lint", "tests"],
  "warnings": [],
  "failures": []
}
```

**Action by `status`:**
- `"pass"` — phase complete, proceed to Step 4
- `"warn"` — phase complete but review the `warnings` array before proceeding
- `"fail"` — read the `failures` array; fix each item; re-run `danteforge verify --json`

## Step 4 — Report Completion

When `danteforge verify` exits 0, report to the user:
- Which phase completed
- Which tasks were implemented
- Any files created or modified

## Example Workflow

```
# 1. Read state
cat .danteforge/STATE.yaml
# → currentPhase: 1
# → tasks[1]: [{name: "Add user model", files: ["src/models/user.ts"], verify: "UserModel type is exported"}]

# 2. Read task files
# (use Read tool on src/models/user.ts — may not exist yet)

# 3. Implement
# (use Write to create src/models/user.ts with the UserModel type and export)

# 4. Stage and verify
git add -A
danteforge verify --json
# → {"status": "pass", ...}: phase 1 complete

# 5. Report to user
# "Phase 1 complete. Created src/models/user.ts with UserModel type. All checks passed."
```

## Multi-Phase Projects

After `danteforge verify --json` returns `"status": "pass"` for the current phase:

1. Re-read `.danteforge/STATE.yaml` — `currentPhase` will have incremented automatically
2. Check if tasks exist for the next phase: look for `tasks[newPhase]` entries in STATE.yaml
3. If the next phase has tasks, implement them following Steps 2–3
4. If no more phases exist, run `danteforge synthesize`

```bash
# After phase 1 passes:
cat .danteforge/STATE.yaml
# → currentPhase: 2
# → tasks:
#     2:
#       - name: Add API routes
#         files: [src/routes/api.ts]

# Implement phase 2 tasks using Read/Edit/Write/Bash, then:
danteforge verify --json
# → {"status": "pass", ...}

# No phase 3 tasks? Wrap up:
danteforge synthesize
```

## Notes

- Never skip the verify step — it updates STATE.yaml and gates the next pipeline stage
- Do not call `danteforge forge` — that triggers an LLM API call. You ARE the forge engine.
- If you need the project specification, read `SPEC.md` or `.danteforge/PLAN.md`
- If tests are part of the phase, run them with `npm test` (or the project's test command) before calling verify
- For additional context on the full DanteForge pipeline, see the `danteforge-workflow` skill
