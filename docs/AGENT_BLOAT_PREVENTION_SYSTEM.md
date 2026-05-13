# DanteForge Agent Bloat Prevention System

This document is the common operating contract for Claude Code, Codex, Cursor,
DanteCode, and any other agent running DanteForge workflows in the same repo.

## Core Insight

Parallel agents do not bloat files because they are careless. They bloat files
because every important score dimension wants a foothold in the same runtime
kernel files:

- command dispatchers
- autoforge and ascend loops
- scorer implementations
- MCP servers
- extension activation files

If agents edit those files directly, every dimension adds "one small branch" and
the file becomes a 1000+ LOC coordination dump. The fix is to treat shared files
as a kernel and dimension work as plugins.

## Operating Model

1. **Kernel files are frozen by default.**
   Files listed in `.danteforge/agent-guard.json.frozenFiles` cannot be changed
   by normal dimension/workstream agents.

2. **Agents own modules, not central dispatchers.**
   A workstream edits files listed in `.danteforge/agent-ownership.json`.
   Shared files are read-only unless a platform-maintainer explicitly runs with
   `DANTEFORGE_ALLOW_FROZEN=1`.

3. **Extension points beat inline edits.**
   If a score dimension needs loop behavior, add a hook/adapter/registrar in an
   owned module and wire it through an existing extension point. Do not add
   business logic to the kernel file.

4. **Claims coordinate humans and tools.**
   Before starting parallel work, write an ephemeral claim under
   `.danteforge/agent-claims/`. Claim files are never committed.

5. **LOC limits are enforced on changed files.**
   New source files should stay under 500 logical LOC and must stay under 750.
   Legacy allowlisted files are tolerated only until they are split.

6. **Score movement must be atomic.**
   Guarded score/truth surfaces must move together so one agent cannot inflate a
   score while another agent leaves the public planning surface stale.

## Required Files

| File | Purpose |
|---|---|
| `.danteforge/agent-guard.json` | Guard thresholds, frozen files, claim dir, atomic file groups |
| `.danteforge/agent-ownership.json` | Workstream ownership map |
| `.danteforge/agent-claims/.gitkeep` | Keeps claim directory present without committing locks |
| `scripts/check-agent-guard.mjs` | Enforced guard used by CI and local agents |
| `scripts/dimension-ascent.mjs` | Locked score-proposal lane for concurrent dimension scoring |

## Standard Agent Flow

1. Choose a workstream, for example `scoring`, `autonomy-loop`, or
   `workflow-commands`.
2. Create `.danteforge/agent-claims/<workstream>-<agent>.lock` with:

   ```json
   {
     "workstream": "scoring",
     "agent": "codex",
     "claimedAt": "2026-05-11T12:00:00.000Z",
     "intent": "Improve score evidence without touching frozen scorer kernel"
   }
   ```

3. Run:

   ```bash
   node scripts/check-agent-guard.mjs --workstream scoring
   ```

4. Edit only owned files.
5. If a frozen file truly needs a new extension point, pause normal dimension
   work and make a separate platform-kernel change.
6. Before commit, run:

   ```bash
   node scripts/check-agent-guard.mjs --staged --workstream scoring
   npm run check:file-size
   npm run typecheck
   ```

7. Delete the claim file before commit.

## Concurrent Matrix Updates

When many agents work on the same scoring dimension, they must not edit
`.danteforge/compete/matrix.json` directly. Use:

```bash
npm run dimension:ascent -- claim --dimension <id-or-number> --agent <name>
npm run dimension:ascent -- propose --dimension <id-or-number> --score <n> --agent <name> --rationale "<why>"
npm run dimension:ascent -- merge --policy harsh-min --agent <name>
```

The merge command takes `.danteforge/score-merge.lock`, reloads the latest matrix,
and applies pending proposals. If several agents propose different scores for the
same dimension, `harsh-min` keeps the lowest score so self-review downgrades win
over optimistic upgrades.

## Workflow Command Requirements

All high-power workflows must respect this system:

- `/autoforge`: should operate inside one workstream and run the guard before
  each commit or checkpoint. **After each successful wave, `postWaveSanitize`
  is automatically called** to split any newly-oversized owned files; frozen
  files surface a `platform-kernel-needed.json` for human follow-up.
- `/ascend`: must not raise scores unless the atomic score/truth group is updated
  together.
- `/inferno`: may create platform-kernel changes only in an explicit Sprint 0;
  subsequent dimension work must use owned modules.
- `/magic`: default to one workstream; avoid multi-dimension edits in one commit.
- `/party`: assign each lane a distinct workstream and claim file.

## DanteSanitize Integration

`danteforge sanitize` is the **autonomous splitter** that enforces the LOC
budget. It is used three ways:

1. **Pre-flight check** — `danteforge sanitize --check` exits 1 if any file
   exceeds the threshold. Wire into `npm run verify` to gate commits.
2. **Wave-time auto-sanitize** — after each successful autoforge wave, the
   loop calls `postWaveSanitize` automatically (best-effort, never blocks).
   Owned files are split immediately; frozen-file violations are deferred to
   the platform-kernel workstream via `.danteforge/sanitize/platform-kernel-needed.json`.
3. **Manual run** — `danteforge sanitize` runs against the full project. Use
   `--dry-run` first to review the queue, `--undo` to revert the most recent
   split, `--prune-backups` to clean up `.danteforge/sanitize/backups/`.

The splitter uses a tiered architecture:
- **Tier 1 (AST):** deterministic move of types/interfaces/enums/functions via
  the TypeScript compiler API. Zero LLM cost, runs offline.
- **Tier 2 (LLM):** only fires when Tier 1 refuses (decorators, multi-decl
  consts, etc.). AST-delta validation catches dropped or invented symbols.
- **Locks:** per-file O_EXCL locks under `.danteforge/sanitize/claims/`
  with 15-minute TTL stale-reclaim. Prevents multi-agent races.

## What To Do When The Guard Blocks You

| Block | Correct response |
|---|---|
| `FROZEN_FILE_CHANGED` | Move logic to an owned module and call an existing extension point |
| `OWNERSHIP_VIOLATION` | Switch workstream or ask the owning workstream to make the change |
| `ATOMIC_GROUP_PARTIAL` | Update the full truth/score group in the same commit |
| `CLAIM_FILE_COMMITTED` | Unstage and delete the claim file |
| `FILE_TOO_LARGE` | Split the file before merging |

## Platform-Kernel Changes

A platform-kernel sprint is allowed to edit frozen files only to add or adjust
extension points. It must be small and reviewed separately from dimension work.

Allowed platform-kernel changes:

- Add a hook phase.
- Add a typed registrar.
- Add a generated index loader.
- Split a frozen file into smaller files while preserving public behavior.

Disallowed platform-kernel changes:

- Add dimension-specific business logic.
- Raise a score.
- Mix hook wiring and feature work in the same commit.

## Design Rule

If two agents could plausibly need the same file, that file is not an implementation
surface. It is a kernel surface. Build a hook, adapter, manifest, or generated
registrar around it.
