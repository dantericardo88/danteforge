---
name: retro
disable-model-invocation: true
description: "Project retrospective — metrics, delta scoring, and trend tracking"
---

# /retro — Project Retrospective

When the user invokes `/retro`, follow this workflow:

1. **Analyze metrics**: Gather project data:
   - Lines changed, files modified
   - Test coverage delta
   - Build/verify pass rate
   - PDSE score progression
2. **Calculate deltas**: Compare against previous retros for trend analysis
3. **Facilitate discussion**: Guide the user through:
   - What went well
   - What could improve
   - Action items for next iteration
4. **Save**: Write to `.danteforge/RETRO_<date>.md`
5. **Track trends**: `--summary` shows trend data from last 5 retros

Options:
- `--summary` — Print trend summary of last 5 retros
- `--cwd <path>` — Project directory

Use the `lessons` skill to capture corrections discovered during the retro.

This command has `disable-model-invocation: true` — it facilitates a reflective discussion.

CLI fallback: `danteforge retro`
