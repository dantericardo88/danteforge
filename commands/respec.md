---
name: respec
description: "Re-run specification with lessons learned and refused patterns injected — for escaping a quality plateau"
---

# /respec — Re-Specify with Lessons Learned

When the user invokes `/respec`, regenerate the project specification with all accumulated
knowledge from past failures baked in.

1. **Load context**: Read current SPEC.md + lessons.md + refused-patterns blocklist
2. **Build prompt**: Inject all three into a re-specification prompt
3. **Generate**: Call LLM to produce a revised SPEC.md that:
   - Preserves the core intent
   - Incorporates lessons from past corrections
   - Avoids patterns proven not to work (refused patterns)
   - Adds more precise acceptance criteria based on what went wrong
4. **Write**: Overwrite SPEC.md with the revised version
5. **Next step**: Guide the user to run `/clarify` then `/plan` with the new spec

## When to use this
- After hitting a quality plateau (score stuck for several cycles)
- After running `/outcome-check` and finding hypothesis failures
- After `/refused-patterns` shows a list of dead ends
- As part of Workflow 5 (Recover): `/status → /refused-patterns → /respec`

## Output
- Revised SPEC.md written to `.danteforge/SPEC.md`
- Count of lessons injected and refused patterns blocked

CLI parity: `danteforge respec`
