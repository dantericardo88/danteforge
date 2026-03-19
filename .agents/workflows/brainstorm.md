---
name: brainstorm
disable-model-invocation: true
description: "Socratic design refinement — think through the design before implementation"
---

# /brainstorm — Design Before Implementation

When the user invokes `/brainstorm`, follow this workflow:

Load the `brainstorming` skill and follow all 4 phases:

**Phase 1: Problem Understanding**
- Ask clarifying questions about the goal
- Identify constraints
- Restate the problem and confirm

**Phase 2: Divergent Thinking**
- Generate at least 3 distinct approaches
- For each: pros, cons, complexity, risks, dependencies

**Phase 3: Convergent Analysis**
- Compare against DanteForge constitution (if defined)
- Identify best trade-off
- Present recommendation with reasoning

**Phase 4: Design Approval Gate**
- Summarize chosen approach in 3-5 bullet points
- Get explicit user approval
- If approved, hand off to plan writing

**Iron Law**: No implementation without design approval.

This command has `disable-model-invocation: true` — it facilitates discussion, not code generation.
