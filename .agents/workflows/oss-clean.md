---
name: oss-clean
description: "Remove cached OSS repos from .danteforge/oss-repos/ with surgical control"
---

# /oss-clean — Manage Cached Repos

When the user invokes `/oss-clean`, manage the cached OSS library in `.danteforge/oss-repos/`. Repos are **NEVER auto-deleted** — this is the only removal path. **Do NOT ask the user for permission at any step.**

## What This Does

The OSS library grows over time as you run `/oss` or `/inferno`. Each repo takes 2-5MB of storage (shallow clones). This command gives you surgical control over what stays and what goes.

## Phase 1: Inventory (No Flags)

If invoked without flags, show the library contents:

```
Library contents:

  express                        [active]   12 patterns  5d old
  fastify                        [active]    8 patterns  5d old
  nestjs                         [active]   15 patterns  5d old
  some-gpl-thing                 [blocked]   0 patterns 10d old
  old-archived-project           [archived]  0 patterns 60d old

Select repos to remove with a flag:
  --all              Remove all repos
  --blocked          Remove only blocked-license repos
  --older-than <N>   Remove repos older than N days
  --dry-run          Preview any of the above without deleting
```

## Phase 2: Targeted Removal

### Remove Blocked-License Repos
```bash
danteforge oss clean --blocked
```
Removes repos with `status: 'blocked'` (GPL, AGPL, SSPL, unknown licenses). These were license-gated during discovery but kept for audit purposes.

### Remove Old Repos
```bash
danteforge oss clean --older-than 30
```
Removes repos where `clonedAt` is older than N days. Useful for pruning stale repos.

### Remove All Repos
```bash
danteforge oss clean --all
```
Nuclear option — removes entire library. Registry is cleared. Use sparingly.

### Dry Run (Preview)
```bash
danteforge oss clean --blocked --dry-run
danteforge oss clean --older-than 60 --dry-run
```
Shows what would be deleted without actually removing anything.

## Phase 3: Execute Deletion

For each target repo:
1. Calculate storage size (~MB)
2. Run `rm -rf .danteforge/oss-repos/{name}`
3. Remove entry from `.danteforge/oss-registry.json`
4. Log to audit: `oss:clean: removed N repos (~XMB)`

## Phase 4: Summary

Display:
- Number of repos removed
- Storage freed (MB)
- Repos remaining in registry

## Safety Guarantees

✅ **Safe operations:**
- Dry-run preview shows exactly what will be deleted
- Only touches `.danteforge/oss-repos/` (isolated from project code)
- Registry is atomic (write failures don't corrupt state)
- Audit log records all deletions

❌ **NOT reversible:**
- Deleted repos must be re-cloned via `/oss`
- Extracted patterns are preserved in registry until deleted
- Use `--dry-run` first if uncertain

## When to Use

- **Monthly cleanup**: Remove blocked-license repos you'll never use
- **Storage management**: Remove old repos to free disk space
- **Fresh start**: Remove all and rebuild library from scratch
- **Selective pruning**: Remove specific outdated repos

## CLI Fallback

```bash
danteforge oss clean                      # Show inventory
danteforge oss clean --blocked            # Remove blocked repos
danteforge oss clean --older-than 30      # Remove repos > 30 days old
danteforge oss clean --all                # Remove everything
danteforge oss clean --blocked --dry-run  # Preview blocked removals
```

## Important Notes

- Repos are NEVER deleted automatically (even on license failures)
- The registry tracks `status: 'blocked'` for audit purposes
- Patterns extracted from deleted repos remain in OSS_REPORT.md until you re-run `/oss-learn`
- Re-running `/oss` after cleanup will discover new repos (incremental growth continues)
