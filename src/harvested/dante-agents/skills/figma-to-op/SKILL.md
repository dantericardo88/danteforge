---
name: figma-to-op
description: "Use when migrating from Figma to OpenPencil. Use when converting Figma designs to .op format. Use when transitioning from proprietary to open design workflows."
---
# Figma to OpenPencil Migration — Design-as-Code Transition Guide

> DanteForge skill module. Converts Figma designs into .op (OpenPencil) format for version-controlled, code-native design workflows.

## Why Design-as-Code

Proprietary design platforms create workflow bottlenecks:

- **Vendor lock-in** — designs live in a cloud platform you do not control.
- **No true versioning** — Figma version history is limited and non-diffable.
- **Developer handoff friction** — inspect panels approximate; developers reinterpret intent.
- **No CI integration** — design changes cannot trigger automated checks.

The .op format solves these by making design artifacts plain-text, diffable, version-controlled, and CI-ready. Designs live in the same repository as code, reviewed in the same pull requests, and validated by the same pipelines.

## Migration Overview

```
Figma File
  |
  v
[1. Export]  Extract components, tokens, and layout from Figma (via MCP or API)
  |
  v
[2. Map]     Convert Figma concepts to .op equivalents
  |
  v
[3. Transform]  Generate .op files with proper token references
  |
  v
[4. Verify]  Visual comparison and structural validation
  |
  v
.op Files (committed to repo)
```

## Phase 1: Export from Figma

Extract design data using Figma MCP or the Figma REST API:

1. **Component inventory** — list all components, variants, and instances.
2. **Token extraction** — colors, typography, spacing, effects (shadows, blurs), corner radii.
3. **Layout data** — auto-layout direction, gap, padding, alignment, constraints.
4. **Asset references** — images, icons, illustrations (export as SVG where possible).
5. **Interactive states** — identify components with variant properties (hover, pressed, disabled, etc.).

Save the raw export to `.danteforge/figma-export.json` for traceability.

## Phase 2: Component Mapping

Figma concepts map to .op equivalents as follows:

| Figma Concept | .op Equivalent | Notes |
|---------------|----------------|-------|
| Frame | `container` | Top-level layout wrapper |
| Auto Layout | `flex` or `grid` | Direction, gap, padding carry over |
| Component | `component` definition | Reusable, parameterized |
| Instance | `component` reference | References the definition by name |
| Variant | `state` or `variant` block | Maps to interactive or theme states |
| Text Layer | `text` node | With font, size, weight, color tokens |
| Rectangle/Shape | `box` node | With fill, stroke, radius tokens |
| Group | `group` node | Logical grouping without layout |
| Boolean Property | `prop` with boolean type | Toggles within component variants |
| Instance Swap | `slot` | Named insertion point |
| Fill Color | `--color-*` token reference | Never raw hex in .op |
| Text Style | Combined `--text-*`, `--font-*`, `--weight-*` tokens | Decomposed into atomic tokens |
| Effect (Shadow) | `--shadow-*` token reference | Mapped to elevation tokens |
| Corner Radius | `--radius-*` token reference | Mapped to shape tokens |

## Phase 3: .op File Generation

For each Figma component or page, generate an .op file:

1. **Header** — component name, description, source Figma node ID (for traceability).
2. **Token references** — all visual values reference tokens from `.danteforge/design-tokens.yaml`.
3. **Layout structure** — nested tree matching the Figma layer hierarchy.
4. **State variants** — each Figma variant becomes a named state block.
5. **Responsive rules** — translate Figma constraints into breakpoint-aware layout rules.
6. **Slots** — Figma instance swap properties become named slots for content injection.

### Token Conversion Rules

| Figma Value Type | Token Naming Convention | Example |
|------------------|------------------------|---------|
| Fill color | `--color-{semantic-name}` | `--color-primary` |
| Font family | `--font-{role}` | `--font-display` |
| Font size | `--text-{scale}` | `--text-lg` |
| Font weight | `--weight-{name}` | `--weight-semibold` |
| Line height | `--leading-{name}` | `--leading-normal` |
| Spacing (padding/gap) | `--space-{n}` | `--space-4` |
| Corner radius | `--radius-{size}` | `--radius-md` |
| Shadow | `--shadow-{size}` | `--shadow-lg` |

If a Figma value does not map to an existing token, create a new token and add it to `design-tokens.yaml`. Never leave raw values in .op files.

## Phase 4: Verification

After generating .op files, verify the migration:

### Structural Verification

1. **Component count** — number of .op component files matches the Figma component count.
2. **Token coverage** — every visual value in .op files references a defined token.
3. **No orphan tokens** — every token in `design-tokens.yaml` is referenced by at least one .op file.
4. **State completeness** — every Figma variant has a corresponding state block.
5. **Layout fidelity** — auto-layout properties (direction, gap, padding, alignment) are preserved.

### Visual Verification

1. Render .op files (if a renderer is available) and compare side-by-side with Figma screenshots.
2. Check spacing, alignment, and proportions at mobile, tablet, and desktop widths.
3. Verify color accuracy (compare hex values in rendered output against Figma).

### Verification Report

Write results to `.danteforge/figma-migration-report.md` with:

- Total components migrated
- Token mapping summary
- Discrepancies found
- Manual adjustments needed

## Common Pitfalls

1. **Detached instances** — Figma components that were detached from their master lose variant info. Manually inspect detached layers and re-associate or document them.
2. **Absolute positioning** — Figma frames without auto-layout use absolute coordinates that do not translate to responsive .op layouts. Convert to flex/grid with explicit breakpoint rules.
3. **Hidden layers** — Figma files often contain hidden layers from design exploration. Filter them out during export to avoid bloating .op files.
4. **Text overrides** — Instance text overrides may carry inline style changes that diverge from the component definition. Normalize text styles to token references.
5. **Plugin-generated effects** — Effects from Figma plugins (gradients, noise, meshes) may not have direct .op equivalents. Document these as manual implementation notes.
6. **Non-standard spacing** — Figma designs may use arbitrary spacing (e.g., 13px, 7px). Snap to the nearest 4px grid value during conversion and document any visual adjustments.

## Integration With Other Skills

- **design-orchestrator** — provides spatial decomposition context for organizing migrated components
- **design-token-sync** — syncs the extracted tokens to CSS/Tailwind/styled-components after migration
- **ux-refine** — continues the Figma round-trip workflow for ongoing design iterations
- **visual-regression** — captures baselines from migrated .op files for future change detection

## When to Use

This skill is applicable when migrating an existing Figma design system to .op format, when converting individual Figma files or frames to OpenPencil, or when transitioning a team from proprietary design tools to a Design-as-Code workflow.
