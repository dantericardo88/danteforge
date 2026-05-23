---
name: canvas
description: "Design-first frontend sprint - generate .op design artifact, autoforge implementation, extract design tokens, verify"
---
# /canvas - Design-First Frontend Sprint

When the user invokes `/canvas`, run the design-first frontend preset:

1. Generate a `.danteforge/DESIGN.op` artifact from the goal using the OpenPencil engine.
2. Run `autoforge` (6 waves, parallel) with the design artifact as context.
3. Extract design tokens via `ux-refine --openpencil`.
4. Verify the implementation against the artifacts.
5. Compact lessons as self-improvement cleanup.

Use `/canvas` when visual design should drive implementation for a frontend-heavy feature.

Options:
- `--prompt` - Show the preset plan without executing it
- `--profile quality|balanced|budget` - Override the default budget profile
- `--design-prompt <text>` - Override the design prompt passed to the design step

CLI parity: `danteforge canvas [goal]`

Matrix development note: UX/design score movement must be queued as a Matrix Development proposal and merged with `harsh-min`; never rewrite `.danteforge/compete/matrix.json` directly.
