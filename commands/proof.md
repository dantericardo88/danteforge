---
name: proof
description: Generate a score-arc report showing before/after quality delta since a point in time. Produces HTML and Markdown evidence files.
---

# /proof — Score Arc Report

Generates a before/after score arc from the rolling score history. Shows how much the project
has improved since a given point in time. Produces both HTML and Markdown evidence files.

## Basic usage
```
danteforge proof
```
Scores the current project and generates a proof receipt in `.danteforge/evidence/verify/`.

## Score arc since a date or git SHA
```
danteforge proof --since yesterday
danteforge proof --since 2026-04-10
danteforge proof --since abc1234
```
Shows:
- Before score (earliest entry after the `since` cutoff)
- After score (current)
- Gain (delta)
- Score arc entries with timestamps and git SHAs
- Shareable HTML one-pager
- Markdown report

## Output example
```
Score Arc — since 2026-04-10

  Before:  6.8/10
  After:   8.1/10
  Gain:    +1.3

  Entries:
    2026-04-10T09:12  6.8  abc1234
    2026-04-11T14:33  7.2  def5678
    2026-04-12T11:05  7.8  ghi9012
    2026-04-13T08:44  8.1  jkl3456

  Report: .danteforge/evidence/proof/arc-2026-04-13.md
  HTML:   .danteforge/evidence/proof/arc-2026-04-13.html
```

## How score history is recorded
Every `danteforge score` call appends an entry to `STATE.yaml → scoreHistory[]`.
Max 90 entries are kept (rolling window). Each entry has `timestamp`, `displayScore`, and `gitSha`.

## Integration with Daily Driver flow
```bash
danteforge score          # records entry at session start
# ... work throughout the day ...
danteforge proof --since this-morning  # see day's arc
```
