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

## Pipeline (6 Stages)

1. **OSS Discovery** — Find the top 5–10 open-source repos doing the target thing best. Clone, license-gate, extract patterns.

1.5. **Dossier pre-flight** — Before autoforge begins, ensure competitor evidence is current.
     Run: `danteforge dossier build --all --since 7d`
     (Skips competitors built within 7 days — runs in seconds if all are fresh.)
     This anchors the autoforge target: what the rubric shows leaders actually ship,
     not what Claude remembers from training data. Check `danteforge landscape gap` to
     confirm which dimension to attack.

2. **Maximum-depth autoforge** — Implement harvested patterns with parallel execution lanes. Runs until all gates pass.
3. **Party mode** — Multi-agent review and quality pass. Catches issues the single-agent loop missed.
4. **Verify + synthesize** — Confirm all gates pass, write synthesis summary with what changed and why.
5. **Compact lessons** — Distill what worked into `.danteforge/lessons.md` for future sprints.

6. **Landscape rebuild** — After improvements land, rebuild the competitive landscape to capture
   DanteCode's new position: `danteforge landscape`
   Then show: `danteforge landscape gap` — which dimensions closed, which gaps remain.
   This updates the rubric-backed gap list for the next sprint.

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
