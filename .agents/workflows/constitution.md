---
name: constitution
disable-model-invocation: true
description: "Initialize project constitution — define principles, constraints, and quality standards"
---

# /constitution — Project Constitution

When the user invokes `/constitution`, follow this workflow:

1. **Check existing**: Look for `.danteforge/CONSTITUTION.md`. If it exists, offer to update or create fresh.
2. **Gather principles**: Ask the user about:
   - Project purpose and core values
   - Non-negotiable constraints (compliance, performance, accessibility)
   - Quality standards (test coverage, code style, review requirements)
   - Scale expectations (solo dev, team, open-source)
3. **Structure the constitution**: Write sections for Purpose, Principles, Constraints, Quality Standards, Non-Negotiables
4. **Save**: Write to `.danteforge/CONSTITUTION.md` and update STATE.yaml
5. **Next step**: Suggest running `/specify` to start building from the constitution

This command has `disable-model-invocation: true` — it facilitates a conversation to capture the user's intent, not generate code.

CLI fallback: `danteforge constitution`
