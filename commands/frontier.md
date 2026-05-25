---
name: frontier
description: "Autonomous 1-command drive to genuine frontier across 50-100+ competitive dimensions. Runs hardened crusade loops, validates with strict gates (CIP, capability_test, harden, recent outcomes, Time Machine), expands the matrix as needed, and continues until the target number of dimensions simultaneously meet the full frontier criteria. Use when the goal is 'set it and forget it until the project is undeniably at the frontier'."
---

# DanteForge Frontier — Autonomous Frontier Attainment Loop

**One command. Full autonomy. No hand-holding until the 50-100 dimension frontier is honestly reached.**

## Purpose

Drive the current project until a large number of competitive dimensions (target: 50-100+) are simultaneously at genuine frontier status according to the strict Scoring Doctrine and Matrix rules.

This is the highest-level "set and forget" command for serious long-term projects.

## Strict Frontier Definition (non-negotiable)

A dimension only counts as "at frontier" when **ALL** of the following are true simultaneously:

1. Evidence-derived score ≥ 9.0 (or its declared natural ceiling).
2. Declared `capability_test` passes (exit code 0). Scores > 5.0 are clamped without this (Fix A).
3. At least 3 T5+ outcomes from the past 7 days (recency + depth).
4. Completion Integrity Pass (CIP): `cipScore` within 0.5 of target, `cipClass` is `verified` or `partially-verified`, zero stubs/mocks/TODOs on the critical path.
5. Harden gate passes all 7 substrate checks (orphan audit, recency, claim auditor, no hardcoded fallbacks, import resolves, functional diff, primary not parallel).
6. Time Machine provenance exists for the score (causal commit recorded).
7. No active dispensations blocking the dimension.

The project's terminal state is only `frontier-reached` when the configured target number of dimensions meet the above.

## Recommended Usage (CLI)

```bash
# Drive DanteForge itself toward 70+ frontier dimensions at 9.0+
danteforge frontier --drive --target-dims 70 --target 9.0 --loop

# More aggressive parallel, longer budget per dim
danteforge frontier --drive --target-dims 100 --parallel 6 --time 60

# CI / release gate
danteforge frontier --require frontier-reached --target-dims 50 --json
```

## How the Loop Works (Autonomous Protocol)

`danteforge frontier --drive` is the highest-level autonomous command. It aims to become the single "set and forget it" command for reaching genuine frontier across 50–100+ dimensions.

Current behavior (evolving toward full vision):

1. **Phase 0 – Review & Universe Health**
   - Automatically runs `danteforge review`
   - Checks matrix health and dimension count
   - Strongly surfaces (with specific commands) when dimension expansion (`compete --init`, OSS harvesting, universe definition) is needed before real progress can be made

2. **Inner Drive Loops**
   - Repeatedly launches `harden-crusade --loop` with strong doctrine-enforcing defaults (CIP, capability_test gate, harden gate)
   - Periodically runs strict frontier gate evaluation
   - Captures `proof` deltas for real before/after visibility

3. **Progress & Escalation**
   - Writes both machine-readable JSON and human-readable `FRONTIER_PROGRESS.md`
   - Detects stagnation (no progress for multiple cycles) and surfaces escalation recommendations (`cross-synthesize`, `ascend`, matrix expansion, etc.)

4. **Termination**
   - Continues until the configured `--target-dims` number of dimensions simultaneously meet the full strict frontier criteria (CIP + capability_test + harden gate + recency + Time Machine provenance).

The long-term vision for this command is to become the true single "set it and forget it" driver that intelligently expands the competitive universe from OSS + closed-source references when needed, then relentlessly pushes dimensions to frontier using the optimal mix of tools.

## Flags & Behavior

- `--drive` / `--autonomous`: Enter the continuous attainment loop (the main mode).
- `--target-dims <n>`: Goal number of dimensions at frontier (default: 50, recommended 70-100 for serious projects).
- `--target <score>`: Per-dimension target (default 9.0).
- `--parallel <n>`: How many dimensions to push simultaneously.
- `--max-cycles <n>`: Safety cap on outer loops.
- `--require frontier-reached`: Exit 0 only when the goal is met (excellent for CI/release gates).

## Integration with Other Tools

After running `danteforge setup assistants --assistants all`, the behavior is available as a native slash command:

- `/frontier --drive --target-dims 70`
- In Grok Build, Claude Code, Codex, Cursor, etc.

The host AI will follow the protocol using its native tools where possible, falling back to the `danteforge` CLI for deterministic steps (harden, validate, matrix writes, etc.).

## Safety & Doctrine

This command strictly honors the full Scoring Doctrine (13 rules), Matrix Development Engine constraints (Fix A/B/C), and completion integrity checks.

It will **never** declare frontier on a dimension whose `capability_test` is failing or whose harden gate is red.

If a natural ceiling is reached honestly on many dimensions, it will surface that clearly rather than forcing artificial progress.

## Output Artifacts

- `FRONTIER_PROGRESS.md` — living report updated each cycle
- Time Machine commits for all major transitions
- Updated `.danteforge/compete/matrix.json` with honest scores
- `HARDEN_CRUSADE_REPORT.md` and `CRUSADE_REPORT.md` from inner loops

## When to Use This Command

- You have a serious project and want it driven to undeniable competitive excellence.
- You are willing to let a rigorous autonomous system run for hours/days while you do other work.
- You want the strongest possible evidence that the project has reached a real frontier (not self-reported hype).

## Current Implementation Status

`danteforge frontier --drive` is the primary 1-command interface. It chains the hardened crusade engine with strict periodic frontier gate evaluation using the project's own doctrine machinery.

It writes `.danteforge/FRONTIER_PROGRESS.json` each outer cycle for observability.

## Running the Loop

```bash
danteforge frontier --drive --target-dims 70
```

Run it and let it work. Check progress with `danteforge frontier` or by reading the progress artifact.

---

**Run it. Walk away. Come back when it reports the target number of dimensions at genuine frontier.**

---

**This file is the canonical definition.** Any implementation (CLI, skill, agent prompt) must follow the protocol above.