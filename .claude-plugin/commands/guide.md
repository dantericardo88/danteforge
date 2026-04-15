---
name: danteforge-guide
description: "Generate a project-specific contextual guide — creates .danteforge/GUIDE.md you can load with @.danteforge/GUIDE.md"
---

# /danteforge-guide — Generate Your Project Guide

When the user invokes `/danteforge-guide`, read the current project state and generate a
personalized guide file at `.danteforge/GUIDE.md`.

1. **Read state**: Load `.danteforge/STATE.yaml` — stage, phase, task count, project name
2. **Read score**: Load the latest snapshot from `.danteforge/snapshots/` for current quality score
3. **Read goal**: Load `.danteforge/goal.md` if it exists
4. **Generate guide**: Write `.danteforge/GUIDE.md` with:
   - Current stage, phase, and quality score
   - The single most important next action
   - The full workflow path for the current journey
   - Which commands to use most in this phase
   - Troubleshooting advice (what to do when things go wrong)
5. **Confirm**: Tell the user the file was written and how to use it

After generating, the user can type `@.danteforge/GUIDE.md` in Claude Code to load this
context into any new conversation — no need to re-explain where they are.

## When to use this
- At the start of a new working session (regenerate a fresh guide)
- After completing a major milestone (update the guide with new state)
- When handing off to another AI assistant that needs project context
- When you want a clean "what should I do next?" summary

## Output
- `.danteforge/GUIDE.md` written with personalized content
- Confirmation of file path + reminder to use `@.danteforge/GUIDE.md`

CLI parity: `danteforge guide [--cwd <path>]`
