---
name: danteforge-flow
description: "Workflow decision tree — shows the 5 DanteForge journeys and what command to run next based on what you're trying to do"
---

# /danteforge-flow — Choose Your Path

When the user invokes `/danteforge-flow`, show the 5 DanteForge workflows and help them pick
the right starting point.

Display this decision tree:

```
DanteForge Workflows — Choose Your Path
========================================

What are you trying to do?

1. Start a new project from scratch
   → /specify "your idea" → /plan → /tasks → /forge → /verify → /synthesize

2. Improve quality of an existing project
   → /assess → /goal "target quality" → /magic or /inferno → /outcome-check

3. Learn from open-source (harvest patterns)
   → /harvest-forge → /outcome-check → /share-patterns

4. Validate what you've built
   → /self-assess → /self-mutate → /ci-report

5. Recover from a plateau or regression
   → /status → /refused-patterns → /cross-synthesize or /respec
```

Then check if the project is initialized and suggest the single best next action:
- If `.danteforge/STATE.yaml` does not exist → suggest Workflow 1 (`/specify`) or Workflow 2 (`/assess`)
- If stage is `forge` → suggest `/forge` (continue implementing)
- If plateau is detected → suggest Workflow 5
- Otherwise → show all 5 workflows and ask which fits

## When to use this
- First time using DanteForge (the "where do I start?" answer)
- After a session break when you've forgotten where you were
- When you want to change what you're working on (e.g., switch from building to validating)
- When onboarding a new developer to the workflow

## Output
- All 5 workflow paths with command sequences
- Current project state (if initialized)
- One recommended next action (based on current state)

CLI parity: `danteforge flow [--interactive]`
