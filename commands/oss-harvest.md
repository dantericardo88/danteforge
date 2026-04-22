---
name: oss-harvest
description: Run the OSS Harvest flow — search GitHub for a pattern, review gaps one at a time with Y/N, implement and score each.
contract_version: "danteforge.workflow/v1"
stages: [harvest-pattern, score, prime]
execution_mode: interactive
failure_policy: continue
verification_required: false
---

# /oss-harvest — OSS Pattern Harvest Flow

When the user invokes `/oss-harvest`, ask the user what pattern or quality dimension they want to improve (e.g. "error boundaries", "retry logic", "structured logging"). Then execute:

1. Run `danteforge harvest-pattern "<pattern the user named>"` — this command:
   - Searches GitHub for TypeScript repos matching the pattern
   - Uses LLM to identify 1–3 gaps per repo vs the current project
   - Sorts gaps by estimated impact (highest first)
   - Presents each gap with source repo, file, dimension, and estimated gain
   - For each gap: the user sees `Implement this pattern? [Y/n]` — respond Y or N based on the user's preference
   - On Y: runs a magic cycle targeting the gap, then captures a lesson
   - Shows score delta after each implementation

2. After the harvest loop completes, run `danteforge score` — show the new total score and updated P0 gaps.

3. Run `danteforge prime` — refresh PRIME.md with lessons captured during harvest. Tell the user to reload `@.danteforge/PRIME.md`.

After all steps complete, report:
- How many patterns were presented and how many were implemented
- The before and after score
- Which dimensions improved

CLI parity: `danteforge harvest-pattern "<pattern>" [--max-repos <n>]`
