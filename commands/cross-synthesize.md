---
name: cross-synthesize
description: "Synthesize winning patterns from attribution history — find what actually worked and generate a prioritized action plan"
---

# /cross-synthesize — Cross-Attribution Synthesis

When the user invokes `/cross-synthesize`, analyze the causal attribution log to identify
which patterns actually improved quality and synthesize a prioritized action plan.

1. **Load attribution log**: Read `.danteforge/attribution-log.json`
2. **Find winners**: Filter to patterns with `verifyStatus: 'pass'` and positive `scoreDelta`
3. **Load context**: Read UPR.md for project context (if available)
4. **Synthesize**: Call LLM to:
   - Identify common threads among the winning patterns
   - Highlight what those patterns have in common
   - Generate a prioritized action plan building on what worked
   - Call out patterns to avoid based on failures
5. **Write**: Save `.danteforge/CROSS_SYNTHESIS.md`

## When to use this
- After a quality plateau — understand what has worked in the past
- Before `/respec` — use the synthesis to inform the new spec direction
- After running `/outcome-check` — synthesize the validated patterns
- As the alternative path in Workflow 5: `/cross-synthesize → /respec → /forge`

## Output
- `.danteforge/CROSS_SYNTHESIS.md` — "what actually worked" report
- Count of patterns analyzed and winners found

Options:
- `--window <n>` — Number of recent attribution records to analyze (default: 10)

CLI parity: `danteforge cross-synthesize [--window 10]`
