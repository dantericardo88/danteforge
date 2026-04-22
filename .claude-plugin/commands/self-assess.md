---
name: danteforge-self-assess
description: "Run full self-assessment — capture objective metrics, diff vs baseline, surface top improvement candidates"
---

# /self-assess — Quality Self-Assessment

When the user invokes `/self-assess`, run a full objective quality snapshot of the current project.

1. **Capture metrics**: Run ESLint, TypeScript, and test pass rate checks against the current codebase
2. **Build snapshot**: Compute objective score (0-10) and hybrid score (0.6 × objective + 0.4 × LLM)
3. **Diff vs baseline**: Compare against the last stored snapshot — flag any regressions
4. **Surface improvements**: Identify the top 3 dimensions with the most room to improve
5. **Save**: Store the snapshot to `.danteforge/snapshots/` for future diffs

Report the results inline: current score, delta vs last run, any regressions detected.

## When to use this
- Before starting a new improvement cycle to establish a baseline
- After a merge to check for regressions
- When you want an honest score that the LLM cannot game

## Output
- Current hybrid score (0-10)
- Per-dimension breakdown
- Diff vs previous snapshot (+ or - per metric)
- Top 3 candidates for improvement

CLI parity: `danteforge self-assess`
