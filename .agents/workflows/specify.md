---
name: specify
description: "Start the SPEC refinement flow — transform a high-level idea into full spec artifacts"
---

# /specify — SPEC Refinement Flow

When the user invokes `/specify`, follow this workflow:

1. **Gather the idea**: Ask the user what they want to build if not provided as an argument
2. **Check gates**: Verify a constitution exists (suggest running `danteforge constitution` if not)
3. **Generate spec**: Create a comprehensive SPEC.md with:
   - Feature name and summary
   - Constitution reference
   - User stories
   - Non-functional requirements
   - Acceptance criteria
   - Task breakdown with parallel flags
   - Dependencies and risks
4. **Save artifacts**: Write to `.danteforge/SPEC.md`
5. **Next step**: Suggest running `/forge` or `danteforge clarify` to continue

Use the `brainstorming` skill if the idea is vague or multiple approaches exist.
Use the `writing-plans` skill when breaking down the spec into tasks.
