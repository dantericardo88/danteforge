---
name: design-orchestrator
description: "Use when generating design artifacts. Use when the design command is executing. Use when decomposing complex UIs into spatial sub-tasks."
---
# Design Orchestrator — Spatial UI Decomposition & Artifact Generation

> DanteForge skill module. Drives the `design` command to decompose complex UIs into spatial sub-tasks, generate .op files, extract design tokens, and enforce visual consistency.

## Three-Mode Execution

This skill follows the DanteForge three-mode pattern:

1. **LLM mode** (default) — sends the decomposition prompt to the configured LLM provider and streams structured output.
2. **`--prompt` mode** — generates a copy-paste prompt for manual execution in any LLM chat interface.
3. **Fallback mode** — produces a scaffold locally using template defaults when no LLM is available.

## Spatial Decomposition Pattern

Break every page or screen into four canonical zones, processed in order:

```
+-------------------------------+
|           HEADER              |   Zone 1 - Navigation, branding, global actions
+-------+-----------------------+
|       |                       |
| SIDE  |       CONTENT         |   Zone 2 (sidebar) - Secondary nav, filters, context
| BAR   |                       |   Zone 3 (content) - Primary task area
|       |                       |
+-------+-----------------------+
|           FOOTER              |   Zone 4 - Legal, secondary links, status
+-------------------------------+
```

### Zone Processing Order

1. **Header** — logo, primary navigation, global controls (search, user menu, notifications).
2. **Sidebar** — contextual navigation, filters, collapsible sections. May be absent on simple layouts.
3. **Content** — the primary task area. Further decompose into content blocks (hero, cards, forms, tables, etc.).
4. **Footer** — secondary links, legal text, status indicators.

Each zone becomes a discrete sub-task that can be assigned to a separate agent in party mode or processed sequentially in forge.

## Grid Rules

All spatial measurements must conform to the base grid:

| Rule | Value | Notes |
|------|-------|-------|
| Base unit | 4px | Smallest allowed increment |
| Standard spacing | 8px | Default gap between elements |
| Component padding | 16px (2 x 8px) | Internal padding for cards, panels |
| Section margin | 32px (4 x 8px) | Vertical separation between sections |
| Max content width | 1280px | Constrain readable content |
| Column gutter | 16px or 24px | Consistent across all breakpoints |

**Hard rule:** No spacing value may be an odd number or a value not divisible by 4. Violations fail the verification checklist.

## .op File Generation

For each zone or component, produce an `.op` (OpenPencil) file containing:

1. **Metadata block** — component name, zone, breakpoint targets.
2. **Layout tree** — nested spatial structure with grid coordinates.
3. **Token references** — all colors, typography, spacing, and shadow values reference named tokens (never raw values).
4. **State variants** — default, hover, focus, active, disabled, loading, error.
5. **Responsive rules** — how the component adapts at mobile (< 640px), tablet (640-1024px), and desktop (> 1024px).

## Design Token Extraction

After spatial decomposition, extract a unified token set:

- **Colors** — `--color-primary`, `--color-secondary`, `--color-surface`, `--color-error`, `--color-success`
- **Typography** — `--text-xs` through `--text-4xl`, `--font-display`, `--font-body`, `--leading-tight`, `--leading-normal`
- **Spacing** — `--space-1` (4px) through `--space-16` (64px)
- **Shadows** — `--shadow-sm`, `--shadow-md`, `--shadow-lg`
- **Radii** — `--radius-sm` (4px), `--radius-md` (8px), `--radius-lg` (16px), `--radius-full`

Tokens are written to `.danteforge/design-tokens.yaml` and referenced by all .op files.

## WCAG AA Contrast Requirements

All text must meet WCAG 2.1 AA contrast ratios:

| Element | Minimum Ratio | Test Method |
|---------|---------------|-------------|
| Normal text (< 18px) | 4.5:1 | Foreground vs. background |
| Large text (>= 18px bold or >= 24px) | 3:1 | Foreground vs. background |
| UI components & graphics | 3:1 | Against adjacent colors |
| Focus indicators | 3:1 | Against surrounding content |

If a color pair from the token set fails contrast, the skill must flag it and suggest an accessible alternative before .op file generation completes.

## Visual Consistency Enforcement

Consistency rules applied across all generated artifacts:

1. **Single type scale** — every text size must come from the token set; no ad-hoc `font-size` values.
2. **Single color palette** — every color must reference a named token; raw hex/rgb values are rejected.
3. **Uniform spacing** — all margins, paddings, and gaps use `--space-*` tokens.
4. **Consistent radii** — all border radii use `--radius-*` tokens.
5. **State parity** — if one interactive element defines a hover state, all interactive elements must.

## Verification Checklist

Before marking the design orchestration task as complete, confirm every item:

- [ ] All four spatial zones identified and documented (or explicitly marked as absent with rationale)
- [ ] Each zone decomposed into discrete sub-tasks
- [ ] .op files generated for every component with metadata, layout tree, token references, state variants, and responsive rules
- [ ] Design tokens extracted to `.danteforge/design-tokens.yaml`
- [ ] All spacing values divisible by 4
- [ ] All color pairs meet WCAG AA contrast minimums
- [ ] No raw color, size, or spacing values in .op files (all reference tokens)
- [ ] State variants defined for all interactive elements
- [ ] Responsive breakpoints specified for mobile, tablet, and desktop
- [ ] Token file and .op files are consistent (no orphaned or undefined token references)

## Integration With Other Skills

- **frontend-design** — applies aesthetic direction after orchestration provides structure
- **design-token-sync** — takes extracted tokens and syncs them to CSS/Tailwind/styled-components
- **ux-refine** — runs after forge to push live UI to Figma and pull refinements back
- **visual-regression** — validates that design changes do not introduce unintended regressions

## When to Use

This skill is applicable when the `design` command is executing, when decomposing a complex UI into spatial sub-tasks, or when generating .op design artifacts for any DanteForge project.
