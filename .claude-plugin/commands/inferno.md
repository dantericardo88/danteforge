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

## Convergence Gate — TypeScript Owns This Decision

After EVERY implementation wave, run:
```
danteforge converge --check-only --target 9.0
```
- Exit **0** → all dimensions pass, you MAY stop
- Exit **1** → one or more below target, run `danteforge converge --target 9.0` to continue the loop automatically

Do NOT self-score. Do NOT estimate. Do NOT make the stop/continue decision yourself.
`converge` reads real filesystem scores with no LLM involvement — it is the only valid termination oracle.

## Code Quality Constraints (enforced — applies to ALL projects)

**File size limit:** Every file you create or modify must stay under **500 non-blank LOC** (ideal) / **750 LOC hard cap**.
- If a module would exceed 500 LOC, split it: `foo.ts` â†’ `foo.ts` + `foo-types.ts` + `foo-utils.ts`
- Never write a single file exceeding 750 LOC — LLMs make structural mistakes at this size
- This applies to TypeScript, JavaScript, Python, and any other source language

## Pipeline (6 Stages)

1. **OSS Discovery** — Find the top 5â€“10 open-source repos doing the target thing best. Clone, license-gate, extract patterns.

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
First-time new matrix dimension + fresh OSS discovery â†’ /danteforge-inferno
All follow-up PRD gap closing                         â†’ /danteforge-magic
```

## Options

- `--prompt` — Show the preset plan without executing it
- `--worktree` — Execute in isolated git worktree
- `--max-repos N` — Control OSS discovery depth (default: 5)
- `--profile quality|balanced|budget` — Override budget profile

## After Inferno

Run `/danteforge-score --full` to see the new dimension values. The biggest remaining gap becomes the target for the next `/danteforge-magic` follow-up.

CLI parity: `danteforge inferno [goal] [options]`
