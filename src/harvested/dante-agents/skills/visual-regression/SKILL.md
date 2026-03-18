---
name: visual-regression
description: "Use when checking for visual changes in designs. Use when comparing design iterations. Use when verifying design consistency after modifications."
---
# Visual Regression — Design Diff & Consistency Verification

> DanteForge skill module. Detects unintended visual changes by comparing .op file revisions through structural diffing and optional pixel comparison.

## Purpose

Every design change should be intentional. Visual regression testing catches unintended side effects when modifying components, tokens, or layouts. This skill operates on .op files (structural analysis) and optionally on rendered output (pixel comparison) to provide layered confidence that changes are deliberate and scoped.

## Workflow Overview

```
[1. Baseline Capture]  Record the current state of .op files and rendered output
        |
        v
[2. Modification]      Make design changes (token updates, layout changes, new components)
        |
        v
[3. Structural Diff]   Compare .op file trees to detect changes in layout, tokens, states
        |
        v
[4. Pixel Comparison]  (Optional) Compare rendered screenshots for visual delta
        |
        v
[5. Report]            Produce a regression report with categorized changes
```

## Phase 1: Baseline Capture

Capture the current design state as the regression baseline:

### Structural Baseline

1. Snapshot all .op files in the project (copy to `.danteforge/baselines/structural/`).
2. Record the current `design-tokens.yaml` contents.
3. Generate a component manifest listing every component, its token dependencies, and state variants.
4. Timestamp the baseline for audit trail.

### Rendered Baseline (Optional)

If a renderer is available (browser, Storybook, or .op renderer):

1. Render each component at three breakpoints: mobile (375px), tablet (768px), desktop (1440px).
2. Capture screenshots to `.danteforge/baselines/rendered/`.
3. Record rendering configuration (viewport, theme, font loading state) for reproducibility.

### Baseline Commands

```bash
# Capture structural baseline
danteforge design-baseline --structural

# Capture structural + rendered baseline
danteforge design-baseline --full

# Capture baseline for specific components
danteforge design-baseline --components "Button,Card,Header"
```

## Phase 2: Structural Diff Analysis

After modifications, compare current .op files against the baseline:

### Token Diff

| Change Type | Detection Method | Severity |
|-------------|-----------------|----------|
| Token added | Present in current, absent in baseline | Info |
| Token removed | Present in baseline, absent in current | Warning |
| Token value changed | Same name, different value | Review |
| Token renamed | Heuristic: similar value, different name | Review |

### Layout Diff

| Change Type | Detection Method | Severity |
|-------------|-----------------|----------|
| Node added | New node in component tree | Info |
| Node removed | Node present in baseline, absent in current | Warning |
| Node reordered | Same nodes, different sibling order | Review |
| Layout type changed | flex to grid, or vice versa | Review |
| Spacing changed | Different gap, padding, or margin values | Review |

### State Diff

| Change Type | Detection Method | Severity |
|-------------|-----------------|----------|
| State added | New variant block in component | Info |
| State removed | Variant present in baseline, absent in current | Warning |
| State values changed | Same state name, different property values | Review |

### Component Diff

| Change Type | Detection Method | Severity |
|-------------|-----------------|----------|
| Component added | New .op file not in baseline | Info |
| Component removed | .op file in baseline, absent in current | Warning |
| Component structure changed | Different node tree shape | Review |

## Phase 3: Pixel Comparison

When rendered baselines are available, perform pixel-level comparison:

1. Render current components at the same breakpoints and configuration as the baseline.
2. Compute a per-pixel difference image.
3. Calculate the percentage of changed pixels.
4. Apply threshold to categorize the result.

### Threshold Configuration

Configure thresholds in `.danteforge/config.yaml` or per-command flags:

```yaml
visual_regression:
  pixel_threshold: 0.1       # Percentage of pixels that may differ (0.1 = 0.1%)
  antialiasing_tolerance: 2  # Pixel color distance tolerance for AA edges
  ignore_regions: []         # CSS selectors for regions to mask (e.g., dynamic content)
  breakpoints:
    mobile: 375
    tablet: 768
    desktop: 1440
```

### Threshold Interpretation

| Pixel Diff % | Category | Action |
|---------------|----------|--------|
| 0.0% | Identical | Pass |
| < 0.1% | Noise | Pass (likely antialiasing) |
| 0.1% - 1.0% | Minor change | Review (may be intentional refinement) |
| 1.0% - 5.0% | Significant change | Review required |
| > 5.0% | Major change | Likely intentional redesign; confirm scope |

## Phase 4: Regression Report

Produce a report at `.danteforge/visual-regression-report.md`:

```markdown
# Visual Regression Report
Date: YYYY-MM-DD
Baseline: <commit-hash or timestamp>
Current:  <commit-hash or timestamp>

## Summary
- Components checked: N
- Components changed: N
- Tokens changed: N
- New regressions: N

## Token Changes
| Token | Baseline | Current | Severity |
|-------|----------|---------|----------|

## Component Changes
| Component | Change Type | Details | Severity |
|-----------|-------------|---------|----------|

## Pixel Comparison (if available)
| Component | Breakpoint | Diff % | Status |
|-----------|------------|--------|--------|

## Action Items
- [ ] Review: ...
- [ ] Confirm intentional: ...
```

## CI Integration Patterns

### GitHub Actions

```yaml
- name: Visual Regression Check
  run: |
    danteforge design-baseline --structural  # uses committed baseline
    danteforge visual-regression --ci --fail-on-warning
  env:
    DANTEFORGE_BASELINE_REF: ${{ github.event.pull_request.base.sha }}
```

### Pre-commit Hook

```bash
# .danteforge/hooks/pre-commit-visual-regression.sh
danteforge visual-regression --structural-only --quiet
if [ $? -ne 0 ]; then
  echo "Visual regression detected. Run 'danteforge visual-regression' for details."
  exit 1
fi
```

### PR Comment Bot

Configure DanteForge to post a regression summary as a PR comment:

```yaml
# .danteforge/config.yaml
visual_regression:
  ci:
    post_pr_comment: true
    fail_on: warning    # or "error" for stricter enforcement
    include_screenshots: true
```

## Updating Baselines

When regressions are intentional (deliberate redesign), update the baseline:

```bash
# Update all baselines
danteforge design-baseline --update

# Update baseline for specific components
danteforge design-baseline --update --components "Button,Card"

# Update with commit message for audit trail
danteforge design-baseline --update --reason "Redesigned Button component for new brand"
```

Always commit updated baselines in the same PR as the design change so reviewers can see the before/after.

## Integration With Other Skills

- **design-orchestrator** — structural baselines align with the spatial decomposition zones
- **design-token-sync** — token changes detected here trigger a re-sync check
- **figma-to-op** — run visual regression after migration to verify fidelity against Figma source
- **design-system-audit** — regression data feeds into the audit scoring rubric

## When to Use

This skill is applicable when verifying that design changes are intentional and scoped, when comparing design iterations across branches or commits, when running design checks in CI pipelines, or when validating visual consistency after token or layout modifications.
