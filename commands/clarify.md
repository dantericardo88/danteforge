---
name: clarify
disable-model-invocation: true
description: "Run clarification Q&A on current spec — identify gaps and ambiguities"
---

# /clarify — Spec Clarification

When the user invokes `/clarify`, follow this workflow:

1. **Check gates**: Verify `.danteforge/SPEC.md` exists. If not, suggest `/specify` first.
2. **Read spec**: Load SPEC.md and CONSTITUTION.md for context
3. **Identify gaps**: Find ambiguities, undefined edge cases, missing requirements, and consistency issues
4. **Ask questions**: Present 5-10 targeted clarification questions grouped by theme
5. **Update artifacts**: Write clarified requirements to `.danteforge/CLARIFY.md`
6. **Next step**: Suggest `/tech-decide` for tech stack selection or `/plan` for implementation planning

Options:
- `--prompt` — Generate a copy-paste prompt instead of auto-generating
- `--light` — Skip hard gates

This command has `disable-model-invocation: true` — it facilitates Q&A discussion with the user.

CLI fallback: `danteforge clarify`
