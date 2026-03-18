---
name: tech-decide
disable-model-invocation: true
description: "Guided tech stack selection — 3-5 options per category with structured pros/cons"
---

# /tech-decide — Tech Stack Selection

When the user invokes `/tech-decide`, follow this workflow:

1. **Read context**: Load SPEC.md for project requirements
2. **Present categories**: For each category (Language, Framework, Database, Deployment, CSS/Styling):
   - Present 3-5 options with structured pros/cons
   - Mark recommended option with reasoning
   - Consider constitution constraints
3. **Capture decisions**: Record chosen stack with rationale
4. **Save**: Write to `.danteforge/TECH_STACK.md`
5. **Next step**: Suggest `/plan` for architecture-aware implementation planning

Options:
- `--prompt` — Generate a copy-paste prompt instead of interactive selection
- `--auto` — Accept all recommended defaults without interactive review

Use the `tech-decide` skill for structured decision framework.

This command has `disable-model-invocation: true` — it facilitates interactive tech stack decisions.

CLI fallback: `danteforge tech-decide`
