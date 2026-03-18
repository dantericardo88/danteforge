---
name: synthesize
description: "Generate Ultimate Planning Resource (UPR.md) — consolidate all artifacts into one document"
---

# /synthesize — Artifact Synthesis

When the user invokes `/synthesize`, follow this workflow:

1. **Check context**: Verify should have passed. Load all `.danteforge/` artifacts.
2. **Consolidate**: Read CONSTITUTION.md, SPEC.md, CLARIFY.md, PLAN.md, TASKS.md, CURRENT_STATE.md, and lessons.md
3. **Generate UPR.md**: Create the Ultimate Planning Resource combining:
   - Project overview and decisions made
   - Architecture and tech stack summary
   - Implementation status and verification results
   - Lessons learned and open questions
   - Recommended next steps
4. **Save**: Write to `.danteforge/UPR.md`
5. **Next step**: Suggest `/retro` for retrospective or `/ship` for release

CLI fallback: `danteforge synthesize`
