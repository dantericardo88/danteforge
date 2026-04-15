---
name: danteforge-inferno
description: "Maximum-power preset — OSS discovery + deep autoforge + party mode + retro. Use for the first attack on a new quality matrix dimension."
---

# /danteforge-inferno — Maximum-Power Preset

When the user invokes `/danteforge-inferno [goal]`, execute the maximum-depth improvement pipeline.

## Execution

```
danteforge inferno "improve security to 9.0+"
danteforge inferno "close the testing coverage gap"
danteforge inferno "add self-healing convergence loop"
```

## Pipeline (5 Stages)

1. **OSS Discovery** — Find the top 5–10 open-source repos doing the target thing best. Clone, license-gate, extract patterns.
2. **Maximum-depth autoforge** — Implement harvested patterns with parallel execution lanes. Runs until all gates pass.
3. **Party mode** — Multi-agent review and quality pass. Catches issues the single-agent loop missed.
4. **Verify + synthesize** — Confirm all gates pass, write synthesis summary with what changed and why.
5. **Compact lessons** — Distill what worked into `.danteforge/lessons.md` for future sprints.

## Usage Rule

```
First-time new matrix dimension + fresh OSS discovery → /danteforge-inferno
All follow-up PRD gap closing                         → /danteforge-magic
```

## Options

- `--prompt` — Show the preset plan without executing it
- `--worktree` — Execute in isolated git worktree
- `--max-repos N` — Control OSS discovery depth (default: 5)
- `--profile quality|balanced|budget` — Override budget profile

## After Inferno

Run `/danteforge-score --full` to see the new dimension values. The biggest remaining gap becomes the target for the next `/danteforge-magic` follow-up.

CLI parity: `danteforge inferno [goal] [options]`
