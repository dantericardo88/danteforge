---
name: oss-sync
description: "Matrix-aware OSS workspace restore — reads oss_leader from every matrix dimension, checks disk, re-clones anything missing, and optionally pulls updates on stale repos. Run after oss-clean or on any new machine to instantly restore the full OSS workspace."
---
# /oss-sync — Matrix-Aware OSS Workspace Restore

When the user invokes `/oss-sync`, restore the OSS workspace from the competitive matrix.

## What it does

1. Reads every `oss_leader` and `harvest_source` field from `.danteforge/compete/matrix.json`
2. Loads `.danteforge/oss-registry.json` to find the GitHub URL for each repo
3. Checks `X:\Projects\OSSHarvest\` (or `$DANTEFORGE_OSS_CACHE`) for each repo
4. **Re-clones** any repo that is in the registry but missing from disk
5. Optionally **git pulls** repos that are on disk but older than `--stale-days` (when `--update` is passed)
6. Reports what was restored, updated, already-fresh, failed, or needs discovery

## Usage

```bash
danteforge oss-sync                      # restore anything missing from disk
danteforge oss-sync --update             # restore missing + pull repos older than 7 days
danteforge oss-sync --update --stale-days 3   # pull anything older than 3 days
danteforge oss-sync --dry-run            # show what would happen without cloning
```

## When to run

- **After `danteforge oss-clean`** — instantly restores everything the matrix needs
- **On a new machine** — no manual URL lookup; the registry has everything
- **Before a crusade** — ensures every `oss_leader` is available for inferno to harvest from
- **Weekly maintenance** — `--update` pulls latest versions of all tracked repos

## Output example

```
[oss-sync] Matrix requires 12 OSS leader(s): Aider, OpenHands, MetaGPT, CrewAI...
[oss-sync] Registry tracks 14 repo(s).
[oss-sync] "Aider" missing from disk — restoring from https://github.com/paul-gauthier/aider
[oss-sync] ✓ Restored "Aider"
[oss-sync] ✓ "OpenHands" already present.
[oss-sync] "re_gent" has no registry entry — run `danteforge oss` to discover its URL first.
───────────────────────────────────────────
[oss-sync] Restored:         2 repo(s) — Aider, MetaGPT
[oss-sync] Updated:          0 repo(s) — none
[oss-sync] Already fresh:    10 repo(s)
[oss-sync] Failed:           0 repo(s) — none
[oss-sync] Needs discovery:  re_gent
[oss-sync] → Run `danteforge oss` to find URLs for the above, then re-run oss-sync.
```

## Needs discovery vs missing

- **Missing from disk** = in registry (URL known) but `.git` dir absent → re-cloned automatically
- **Needs discovery** = in matrix as `oss_leader` but no URL in registry → run `danteforge oss` first to find the URL, then re-run `oss-sync`

## Relationship to other OSS commands

| Command | Purpose |
|---|---|
| `danteforge oss` | One-shot LLM discovery + clone (finds URLs, adds to registry) |
| `danteforge oss-loop` | Repeated discovery until competitive landscape is complete |
| `danteforge oss-sync` | Restore from registry (no LLM needed, uses cached URLs) |
| `danteforge oss-intel` | Extract patterns from all cloned repos |
| `danteforge oss-clean` | Wipe disk cache (oss-sync restores it) |

CLI parity: `danteforge oss-sync [--update] [--stale-days N] [--dry-run]`
