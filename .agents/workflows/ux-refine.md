---
name: ux-refine
description: "Refine UI/UX after forge — local OpenPencil extraction or guided Figma workflow"
---

# /ux-refine — UX Refinement

When the user invokes `/ux-refine`, follow this workflow:

1. **Check context**: Verify a forge pass has completed or DESIGN.op exists
2. **Choose path**:
   - **OpenPencil** (`--openpencil`): Extract tokens locally, lint design rules, generate previews
   - **Figma** (`--figma-url`): Generate guided prompt for Figma MCP refinement
   - **Live** (`--live --url`): Capture browser screenshot and accessibility audit
3. **Run refinement**: Apply design rules, check consistency, extract tokens
4. **Report**: Show violations found and fixes applied
5. **Next step**: Suggest `/verify` to check results

Options:
- `--openpencil` — Use local OpenPencil engine instead of Figma MCP
- `--figma-url <url>` — Figma file URL to sync with
- `--live` — Capture live browser screenshot as UX evidence
- `--url <url>` — URL to capture (requires --live)
- `--lint` — Run design rules engine against DESIGN.op
- `--prompt` — Generate a copy-paste prompt instead of auto-executing
- `--light` — Skip hard gates

Use the `ux-refine` skill for refinement workflow patterns.
Use the `design-token-sync` skill for token extraction.
Use the `visual-regression` skill for design consistency verification.

CLI fallback: `danteforge ux-refine --openpencil`
