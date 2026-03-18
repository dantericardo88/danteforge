---
name: design
description: "Generate design artifacts from natural language — OpenPencil Design-as-Code engine"
---

# /design — Design-as-Code Generation

When the user invokes `/design`, follow this workflow:

1. **Check context**: Read SPEC.md for requirements. Warn if not found.
2. **Accept prompt**: Take a natural language design description (e.g., "a modern login form with email and Google OAuth")
3. **Generate design**: Create `.danteforge/DESIGN.op` with zone-based layout using the OpenPencil engine
4. **Extract tokens**: Write design tokens to `.danteforge/design-tokens.yaml`
5. **Preview**: Generate headless SVG preview of the design
6. **Next step**: Suggest `/forge` to implement or `/ux-refine` for refinement

Options:
- `--format jsx|vue|html` — Export format (default: jsx)
- `--parallel` — Enable spatial parallel decomposition
- `--worktree` — Run in isolated git worktree
- `--prompt` — Generate a copy-paste prompt instead of auto-executing
- `--light` — Skip hard gates

Use the `design-orchestrator` skill for spatial decomposition and zone generation.
Use the `design-token-sync` skill for token extraction to CSS/Tailwind.

CLI fallback: `danteforge design "<prompt>"`
