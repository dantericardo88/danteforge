---
name: design-system-audit
description: "Use when auditing design system consistency. Use when reviewing color, typography, and spacing patterns. Use when enforcing design standards."
---
# Design System Audit — Consistency, Compliance & Scoring

> DanteForge skill module. Audits a design system implemented in .op files and code for consistency across color, typography, spacing, component patterns, and accessibility.

## Purpose

Design systems degrade over time. One-off overrides accumulate, new components diverge from established patterns, and accessibility requirements slip. This skill systematically audits the entire design system, scores it against a rubric, and produces actionable remediation tasks.

## Audit Scope

The audit covers five domains, each scored independently:

1. **Color Palette Analysis**
2. **Typography Scale Review**
3. **Spacing Grid Compliance**
4. **Component Consistency Checks**
5. **Accessibility Validation**

## Domain 1: Color Palette Analysis

### What to Check

1. **Token coverage** — every color used in .op files and code references a named token from `design-tokens.yaml`.
2. **Palette size** — a healthy system uses 8-20 color tokens (semantic + neutral scale). Fewer than 6 signals under-tokenization; more than 30 signals bloat.
3. **Semantic completeness** — the palette includes tokens for: primary, secondary, surface, on-surface, error, success, warning, info.
4. **Contrast compliance** — every foreground/background pair meets WCAG AA (4.5:1 normal text, 3:1 large text, 3:1 UI components).
5. **Duplicate detection** — identify tokens with identical or near-identical values (delta-E < 3) that should be consolidated.
6. **Dark mode parity** — if the system supports dark mode, verify that every light-mode token has a dark-mode equivalent.

### Scoring (0-20 points)

| Criterion | Points | Condition |
|-----------|--------|-----------|
| All colors use tokens | 5 | Zero raw color values in .op or code files |
| Palette size 8-20 | 3 | Within healthy range |
| Semantic tokens complete | 4 | All 8 semantic categories present |
| WCAG AA contrast | 5 | All pairs pass |
| No near-duplicates | 3 | Zero pairs with delta-E < 3 |

## Domain 2: Typography Scale Review

### What to Check

1. **Scale consistency** — font sizes follow a defined ratio (e.g., major third 1.25, perfect fourth 1.333, or custom). No arbitrary sizes.
2. **Font family count** — 2-3 families maximum (display, body, mono). More than 3 signals inconsistency.
3. **Weight usage** — weights used in the system form a coherent subset (e.g., 400, 600, 700). Avoid using more than 4 weights.
4. **Line-height pairing** — each font size has an explicit line-height pairing in the token set.
5. **Token coverage** — every text style in .op files and code references typography tokens (no inline `font-size: 17px`).
6. **Hierarchy clarity** — the type scale produces clear visual hierarchy (each step is perceptibly larger than the previous).

### Scoring (0-20 points)

| Criterion | Points | Condition |
|-----------|--------|-----------|
| Consistent scale ratio | 5 | All sizes follow the defined ratio (within 2% tolerance) |
| Font families <= 3 | 3 | Maximum 3 font families |
| Weights <= 4 | 3 | Maximum 4 font weights |
| Line-height pairings | 4 | Every size has an explicit line-height |
| All text uses tokens | 5 | Zero raw typography values |

## Domain 3: Spacing Grid Compliance

### What to Check

1. **Base unit adherence** — all spacing values are multiples of the base unit (4px by default).
2. **Token coverage** — every margin, padding, and gap in .op files and code references a `--space-*` token.
3. **Scale consistency** — the spacing scale follows a logical progression (e.g., 4, 8, 12, 16, 24, 32, 48, 64).
4. **No magic numbers** — zero one-off spacing values that do not correspond to any token.
5. **Consistent application** — similar components use the same spacing tokens (e.g., all cards have `--space-4` padding).
6. **Responsive adaptation** — spacing tokens adjust (or are overridden) at breakpoints rather than using fixed pixel values.

### Scoring (0-20 points)

| Criterion | Points | Condition |
|-----------|--------|-----------|
| All values on 4px grid | 5 | Zero non-grid spacing values |
| All spacing uses tokens | 5 | Zero raw spacing values |
| Logical scale progression | 3 | Scale is monotonic and evenly distributed |
| No magic numbers | 4 | Zero one-off values |
| Consistent across similar components | 3 | Same component types use same tokens |

## Domain 4: Component Consistency Checks

### What to Check

1. **Structural patterns** — similar components (buttons, cards, inputs) share the same structural pattern (same node tree shape).
2. **Token usage alignment** — all instances of a component type use the same token set (e.g., all buttons use `--color-primary` for background).
3. **State completeness** — interactive components define all expected states (default, hover, focus, active, disabled).
4. **Naming conventions** — component names follow a consistent convention (kebab-case, PascalCase, etc.).
5. **Slot/prop consistency** — similar components expose the same slots and props.
6. **Variant coherence** — component variants differ only in intended ways (not accidental token mismatches).

### Scoring (0-20 points)

| Criterion | Points | Condition |
|-----------|--------|-----------|
| Structural consistency | 4 | Same-type components share node tree patterns |
| Token alignment | 4 | Same-type components use same token set |
| All states defined | 5 | Every interactive component has all 5 states |
| Naming convention | 3 | 100% adherence to chosen convention |
| Variant coherence | 4 | No accidental divergence between variants |

## Domain 5: Accessibility Validation

### What to Check

1. **Color contrast** — all text/background pairs meet WCAG 2.1 AA (4.5:1 normal, 3:1 large).
2. **Focus indicators** — all interactive elements have visible focus styles with at least 3:1 contrast against surrounding content.
3. **Touch targets** — interactive elements are at least 44x44 CSS pixels (WCAG 2.5.5 Level AAA) or 24x24 (Level AA minimum).
4. **Text scaling** — layouts accommodate 200% text zoom without content loss or overlap.
5. **Semantic structure** — heading levels are sequential (no skipping h1 to h3), landmarks are present.
6. **Motion safety** — animations respect `prefers-reduced-motion` and do not trigger vestibular issues (no parallax, no auto-play video).

### Scoring (0-20 points)

| Criterion | Points | Condition |
|-----------|--------|-----------|
| Color contrast WCAG AA | 5 | All pairs pass |
| Focus indicators visible | 4 | All interactive elements have focus styles |
| Touch targets >= 44px | 3 | All interactive elements meet minimum |
| Text scaling tolerance | 3 | No breakage at 200% zoom |
| Semantic heading structure | 3 | Sequential, no skips |
| Motion safety | 2 | `prefers-reduced-motion` respected |

## Scoring Rubric

### Total Score Calculation

```
Total = Color (0-20) + Typography (0-20) + Spacing (0-20) + Components (0-20) + Accessibility (0-20)
Range: 0 - 100
```

### Grade Interpretation

| Score | Grade | Interpretation | Action |
|-------|-------|----------------|--------|
| 90-100 | A | Excellent | Minor polish only |
| 80-89 | B | Good | Address specific findings |
| 70-79 | C | Acceptable | Systematic remediation needed |
| 60-69 | D | Below standard | Prioritize audit findings in next sprint |
| < 60 | F | Failing | Design system overhaul required |

## Audit Report

Write results to `.danteforge/design-system-audit.md`:

```markdown
# Design System Audit Report
Date: YYYY-MM-DD
Project: <project-name>

## Overall Score: XX/100 (Grade: X)

## Domain Scores
| Domain | Score | Grade |
|--------|-------|-------|
| Color Palette | XX/20 | |
| Typography Scale | XX/20 | |
| Spacing Grid | XX/20 | |
| Component Consistency | XX/20 | |
| Accessibility | XX/20 | |

## Findings

### Critical (must fix)
1. ...

### Warning (should fix)
1. ...

### Info (nice to fix)
1. ...

## Remediation Tasks
- [ ] ...
- [ ] ...

## Token Health
- Total tokens defined: N
- Tokens in use: N
- Orphaned tokens: N
- Missing tokens (raw values in code): N
```

## Running the Audit

```bash
# Full audit
danteforge design-audit

# Audit specific domains
danteforge design-audit --domains "color,typography"

# Audit with auto-fix for trivial issues (token renaming, duplicate consolidation)
danteforge design-audit --fix

# CI mode (exit code reflects grade)
danteforge design-audit --ci --min-grade B
```

## Integration With Other Skills

- **design-orchestrator** — audit runs after orchestration to verify the generated artifacts
- **design-token-sync** — audit findings about token coverage feed directly into sync tasks
- **visual-regression** — regression data complements the audit with change-over-time perspective
- **frontend-design** — audit enforces that high-craft design choices remain consistent at scale

## When to Use

This skill is applicable when auditing design system consistency, when reviewing color, typography, or spacing patterns for compliance, when onboarding a new project to DanteForge design standards, or when enforcing design quality gates in CI.
