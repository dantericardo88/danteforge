---
name: council
description: Multi-LLM council orchestration from Claude Code — dispatch real build work to Codex / Grok Build / Gemini and judge it with DIFFERENT models, enforcing "the one who builds is never the one who judges." Use when the operator says /council or /askcouncil, or wants an independent second opinion / builder-never-judges review.
version: 1.0.0
risk: medium
source: danteforge-native
importDate: 2026-06-29
---

# DanteForge Council Skill (`/council`, `/askcouncil`)

Run a real "builder never judges" council using the CLI subscriptions on this machine. The core rule:
**the agent that builds the code must never be one of the agents that scores or approves it.** This is
what kills score inflation and hallucinated quality — it is the same principle as Ornith's frozen-judge
veto and COMPILOT's "never let the model judge its own correctness."

## When to use this skill

- The operator types `/council` or `/askcouncil`.
- A diff/plan/score needs an INDEPENDENT second opinion before it's trusted.
- You (Claude) built something and must not be the one who approves it.

## Council members (what actually works today)

| Role | Tool | Dispatch |
|------|------|----------|
| Builder | Codex (`codex exec`) or Gemini (`gemini --prompt --yolo`) | headless subprocess |
| Judge 1 | Claude Code (you) | native — you orchestrate / review |
| Judge 2 | Codex or Gemini (a DIFFERENT instance than the builder) | headless, plan/approval mode |
| Judge 3 | Grok Build | via DanteForge skills / embedded mode (uses your Grok subscription, no API key) |

## How to run it

1. **Dispatch the build** to a non-Claude member (so Claude stays a judge):
   ```bash
   codex exec -C "<project>" --sandbox workspace-write -o "<tmp>/result.txt" "Implement <task>."
   ```
   Then read the output file + `git diff` in the worktree.
2. **Judge with different models.** Have Claude (you) review, and dispatch a second judge (Codex/Gemini)
   that did NOT build. Adversarial scoring: `danteforge score --adversary`.
3. **Apply the builder-never-judges rule** to the verdict — if the builder model also scored it, discard
   that score.

## Integration

- Adversarial gate in loops: `danteforge ascend --adversarial-gating`, `danteforge autoforge --adversarial`.
- The council's frozen-judge veto feeds the Supervisor's reward-hacking defenses: a vetoed candidate
  earns zero reward and can never improve a scaffold's standing (see the `supervise` skill).
- Quorum matters: a degraded panel (a dead/declining member) makes the Supervisor PAUSE rather than
  let a single model grade itself.
