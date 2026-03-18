---
name: brainstorming
description: "Use when starting a new feature, project, or significant change. Use when the user needs to think through design before implementation. Use when requirements are unclear or multiple approaches exist."
---
# Brainstorming — Socratic Design Refinement

> DanteForge skill module.

## Iron Law

Every project goes through this process. No implementation without design approval.

## The Process

### Phase 1: Problem Understanding
- Ask clarifying questions about the goal
- Identify constraints (time, tech stack, dependencies)
- Restate the problem in your own words and confirm with the user

### Phase 2: Divergent Thinking
- Generate at least 3 distinct approaches
- For each approach, list:
  - Pros and cons
  - Technical complexity (S/M/L)
  - Risk factors
  - Dependencies on existing code

### Phase 3: Convergent Analysis
- Compare approaches against the DanteForge constitution
- Identify the approach with the best trade-off
- Present recommendation with reasoning

### Phase 4: Design Approval Gate
- Summarize the chosen approach in 3-5 bullet points
- Get explicit user approval before proceeding
- If approved, hand off to `writing-plans` skill for detailed planning
- If not approved, return to Phase 2 with feedback

## Red Flags (Stop and Re-evaluate)
- "Let's just start coding and figure it out" — NO. Design first.
- "This is too simple to need brainstorming" — Simple problems often hide complexity.
- "We already know the answer" — Validate assumptions before committing.
- Skipping Phase 4 (approval) — Always get explicit sign-off.
