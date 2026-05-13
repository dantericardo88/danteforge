---
name: sanitize
description: "DanteSanitize — break up oversized files (>750 LOC) using hybrid AST + LLM splitting with safety rails"
---

# /sanitize — Oversized File Cleanup

When the user invokes `/sanitize`, drive the DanteSanitize engine to bring every file in the project under the LOC threshold.

## Workflow

1. **Pre-flight**: Confirm the repo is on a clean git tree and a feature branch. Refuse to run on uncommitted changes unless `--yes` is passed.
2. **Scan**: Identify files over the threshold (default 750 LOC hard cap; 500 LOC is the ideal).
3. **Split (Tier 1 → Tier 2)**:
   - Tier 1 — deterministic AST mover handles types, interfaces, enums, and pure functions for free.
   - Tier 2 — LLM fallback fires only when AST refuses to move a symbol safely.
   - Every split passes AST-delta validation (no dropped or invented symbols) before disk write.
4. **Verify**: After each split, run `tsc --noEmit` unless `--skip-typecheck` is passed.
5. **Iterate**: Loop until no file exceeds the threshold or `--max-cycles` is reached.
6. **Report**: Summarize files split, cycles run, remaining violations, token spend, and backup session path.

Frozen files (listed in `.danteforge/agent-guard.json`) are skipped by design.

## Options

- `--check` — Report violations and exit 1 if any exist; no modifications. Use this first to see the work.
- `--dry-run` — Show what would be split without writing files.
- `--threshold <n>` — LOC hard limit (default: 750). Lower to 500 for the ideal-standard pass.
- `--max-cycles <n>` — Safety cycle limit (default: 50).
- `--max-tokens <n>` — Cumulative LLM token budget for Tier 2 fallback (default: 200000).
- `--pattern <glob>` — Only process files whose path contains this string.
- `--skip-pattern <glob>` — Skip files whose path contains this string.
- `--skip-typecheck` — Skip the tsc verification step after each split (fast, less safe).
- `--undo` — Restore the most recent backup (best-effort revert of the last split).
- `--prune-backups` — Delete backup files older than `--retention-days`.
- `--retention-days <n>` — Backup retention window in days (default: 7).
- `--yes` — Skip interactive confirmation prompts.
- `--cwd <path>` — Target a different project directory.

## Recommended flow for a new project

```bash
# 1. See the damage
/sanitize --check

# 2. Preview the splits
/sanitize --dry-run

# 3. Run it on a clean branch
/sanitize --yes

# 4. If anything looks off
/sanitize --undo
```

CLI parity: `danteforge sanitize [--check] [--dry-run] [--threshold 750] [--undo] [--prune-backups] [--yes]`
