---
name: multi-agent
description: Run the Multi-Agent flow — parallel agent blitz for a large dimension gap, with live per-agent progress and auto PRIME.md refresh.
contract_version: "danteforge.workflow/v1"
stages: [inferno, score, prime]
execution_mode: freeform
failure_policy: continue
verification_required: true
---

# /multi-agent — Multi-Agent Parallel Improvement Flow

When the user invokes `/multi-agent`, ask what quality dimension or goal they want to attack. Then execute:

1. Determine which preset to use:
   - If this is the **first time attacking** this dimension, or the gap is > 2.0 points: run `danteforge inferno "<goal>"` — maximum power, runs OSS discovery + full party mode with parallel agents. You will see live `[party:<agent>] starting/done/failed` output per agent.
   - If this is a **follow-up** on a dimension already partially improved: run `danteforge magic "<goal>"` — balanced preset, faster.

2. Observe the per-agent output. If an agent shows `failed`, note which one and report it. The pipeline continues with remaining agents.

3. After the inferno/magic run completes, run `danteforge score` — report the new score and which dimensions improved.

4. Run `danteforge prime` — PRIME.md is auto-refreshed after inferno. After magic, refresh it manually. Tell the user to reload `@.danteforge/PRIME.md`.

After all steps complete, report:
- Which agents ran and their status (starting/done/failed)
- Before and after scores per dimension
- The overall score delta
- Whether the target dimension met its gap-close goal

CLI parity: `danteforge inferno "<goal>"` or `danteforge magic "<goal>"`
