---
name: canvas
description: "Design-first frontend sprint — generate .op design artifact, autoforge implementation, extract design tokens, verify"
contract_version: "danteforge.workflow/v1"
stages: [design, autoforge, ux-refine, verify]
execution_mode: sequential
failure_policy: continue
rollback_policy: preserve_untracked
worktree_policy: optional
verification_required: true
---

# /canvas — Design-First Frontend Sprint

When the user invokes `/canvas`, run the design-first frontend preset:

1. Generate a `.danteforge/DESIGN.op` artifact from the goal using the OpenPencil engine
2. Run `autoforge` (6 waves, parallel) with the DESIGN.op as context for all task prompts
3. Extract design tokens: CSS custom properties + Tailwind config via `ux-refine --openpencil`
4. Verify the implementation against artifacts
5. Compact lessons as self-improvement cleanup

## When to Use

Use `/canvas` when:
- Building a new UI feature where visual design should drive code generation
- You want DESIGN.op artifacts committed alongside code
- The feature is frontend-heavy (dashboard, data viz, forms, landing pages)
- You want consistent design tokens (colors, typography, spacing) extracted automatically

## Options

- `--prompt` - Show the preset plan without executing it
- `--profile quality|balanced|budget` - Override the default budget profile
- `--skip-tech-decide` - Not applicable (canvas is execution-only; run spark first for planning)

## Workflow

```
danteforge canvas "Build the analytics dashboard with chart components"
```

Pipeline: **design → autoforge(6 waves) → ux-refine --openpencil → verify → convergence loop**

## Output Artifacts

- `.danteforge/DESIGN.op` — OpenPencil scene graph (components, layout, design tokens)
- `.danteforge/design-tokens.css` — CSS custom properties extracted from DESIGN.op
- `.danteforge/design-tokens.tailwind.js` — Tailwind config with design tokens
- `.danteforge/design-preview.html` — HTML preview rendered from DESIGN.op

## Combining with Planning

For a complete frontend sprint from scratch:
```bash
danteforge spark "Build analytics dashboard"    # planning + tech-decide
danteforge canvas "Build analytics dashboard"   # design-first execution
```

Or use nova/inferno with --with-design for an all-in-one pipeline:
```bash
danteforge nova "Build analytics dashboard" --with-design
```

CLI parity: `danteforge canvas [goal]`
