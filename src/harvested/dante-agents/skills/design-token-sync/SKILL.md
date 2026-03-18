---
name: design-token-sync
description: "Use when extracting design tokens from .op files. Use when synchronizing design tokens to CSS, Tailwind, or styled-components."
---
# Design Token Sync — .op to Code Token Pipeline

> DanteForge skill module. Extracts design tokens from .op documents and synchronizes them to CSS custom properties, Tailwind theme configuration, and styled-components theme objects.

## Purpose

Design tokens are the single source of truth for visual values. This skill ensures that tokens defined in .op files or `.danteforge/design-tokens.yaml` are faithfully translated into the code format your project uses, with zero drift between design and implementation.

## Token Naming Conventions

All tokens follow a consistent, semantic naming scheme:

### Colors

```
--color-primary          Main brand color
--color-primary-light    Lighter variant (hover states, backgrounds)
--color-primary-dark     Darker variant (active states, text on light bg)
--color-secondary        Supporting brand color
--color-surface          Default background
--color-surface-raised   Cards, modals, elevated surfaces
--color-on-surface       Default text on surface
--color-error            Error states and destructive actions
--color-success          Success states and confirmations
--color-warning          Warning states and caution indicators
--color-info             Informational states
```

### Typography

```
--text-xs                12px / 0.75rem
--text-sm                14px / 0.875rem
--text-base              16px / 1rem
--text-lg                18px / 1.125rem
--text-xl                20px / 1.25rem
--text-2xl               24px / 1.5rem
--text-3xl               30px / 1.875rem
--text-4xl               36px / 2.25rem
--font-display           Display/heading typeface
--font-body              Body/paragraph typeface
--font-mono              Code/monospace typeface
--leading-tight          1.25 line-height
--leading-normal         1.5 line-height
--leading-relaxed        1.75 line-height
--weight-normal          400
--weight-medium          500
--weight-semibold        600
--weight-bold            700
```

### Spacing

```
--space-px               1px
--space-1                4px / 0.25rem
--space-2                8px / 0.5rem
--space-3                12px / 0.75rem
--space-4                16px / 1rem
--space-6                24px / 1.5rem
--space-8                32px / 2rem
--space-10               40px / 2.5rem
--space-12               48px / 3rem
--space-16               64px / 4rem
```

### Other

```
--radius-sm              4px
--radius-md              8px
--radius-lg              16px
--radius-full            9999px
--shadow-sm              0 1px 2px rgba(0,0,0,0.05)
--shadow-md              0 4px 6px rgba(0,0,0,0.1)
--shadow-lg              0 10px 15px rgba(0,0,0,0.1)
--shadow-xl              0 20px 25px rgba(0,0,0,0.15)
```

## Semantic Grouping

Tokens are organized into five semantic groups in the canonical token file (`.danteforge/design-tokens.yaml`):

1. **Color** — brand, surface, semantic (error/success/warning/info), neutral scale
2. **Typography** — font families, size scale, weight scale, line-height scale
3. **Spacing** — margin/padding/gap scale based on 4px base unit
4. **Shape** — border radii, border widths
5. **Elevation** — box shadows, z-index layers

Each group is a top-level key in the YAML file. Tokens within a group are listed alphabetically.

## Output Format: CSS Custom Properties

Generate a `:root` block with all tokens:

```css
:root {
  /* Color */
  --color-primary: #2563eb;
  --color-primary-light: #3b82f6;
  --color-primary-dark: #1d4ed8;
  --color-surface: #ffffff;
  --color-on-surface: #111827;
  --color-error: #dc2626;
  --color-success: #16a34a;

  /* Typography */
  --font-display: 'Instrument Serif', serif;
  --font-body: 'Inter', sans-serif;
  --text-base: 1rem;
  --leading-normal: 1.5;
  --weight-normal: 400;

  /* Spacing */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-4: 1rem;
  --space-8: 2rem;

  /* Shape */
  --radius-md: 0.5rem;
  --radius-full: 9999px;

  /* Elevation */
  --shadow-md: 0 4px 6px rgba(0,0,0,0.1);
}
```

Write to `src/styles/tokens.css` (or the project's designated token file path).

## Output Format: Tailwind Theme Config

Generate a `theme.extend` object for `tailwind.config.js` or `tailwind.config.ts`:

```js
theme: {
  extend: {
    colors: {
      primary: {
        DEFAULT: 'var(--color-primary)',
        light: 'var(--color-primary-light)',
        dark: 'var(--color-primary-dark)',
      },
      surface: {
        DEFAULT: 'var(--color-surface)',
        raised: 'var(--color-surface-raised)',
      },
      error: 'var(--color-error)',
      success: 'var(--color-success)',
    },
    fontFamily: {
      display: ['var(--font-display)'],
      body: ['var(--font-body)'],
    },
    spacing: {
      'sp-1': 'var(--space-1)',
      'sp-2': 'var(--space-2)',
      'sp-4': 'var(--space-4)',
      'sp-8': 'var(--space-8)',
    },
    borderRadius: {
      sm: 'var(--radius-sm)',
      md: 'var(--radius-md)',
      lg: 'var(--radius-lg)',
    },
    boxShadow: {
      sm: 'var(--shadow-sm)',
      md: 'var(--shadow-md)',
      lg: 'var(--shadow-lg)',
    },
  },
}
```

Tailwind classes reference CSS custom properties so that a single token change propagates everywhere.

## Output Format: styled-components Theme Object

Generate a theme object for the `<ThemeProvider>`:

```ts
export const theme = {
  colors: {
    primary: 'var(--color-primary)',
    primaryLight: 'var(--color-primary-light)',
    primaryDark: 'var(--color-primary-dark)',
    surface: 'var(--color-surface)',
    surfaceRaised: 'var(--color-surface-raised)',
    onSurface: 'var(--color-on-surface)',
    error: 'var(--color-error)',
    success: 'var(--color-success)',
  },
  fonts: {
    display: 'var(--font-display)',
    body: 'var(--font-body)',
    mono: 'var(--font-mono)',
  },
  fontSizes: {
    xs: 'var(--text-xs)',
    sm: 'var(--text-sm)',
    base: 'var(--text-base)',
    lg: 'var(--text-lg)',
    xl: 'var(--text-xl)',
    '2xl': 'var(--text-2xl)',
    '3xl': 'var(--text-3xl)',
    '4xl': 'var(--text-4xl)',
  },
  space: {
    1: 'var(--space-1)',
    2: 'var(--space-2)',
    3: 'var(--space-3)',
    4: 'var(--space-4)',
    6: 'var(--space-6)',
    8: 'var(--space-8)',
  },
  radii: {
    sm: 'var(--radius-sm)',
    md: 'var(--radius-md)',
    lg: 'var(--radius-lg)',
    full: 'var(--radius-full)',
  },
  shadows: {
    sm: 'var(--shadow-sm)',
    md: 'var(--shadow-md)',
    lg: 'var(--shadow-lg)',
    xl: 'var(--shadow-xl)',
  },
} as const;
```

Write to `src/styles/theme.ts` (or the project's designated theme file path).

## Sync Workflow

1. **Read** `.danteforge/design-tokens.yaml` (canonical source) or extract tokens from .op files.
2. **Detect** the project's styling approach (CSS, Tailwind, styled-components, or multiple).
3. **Generate** output files in the appropriate format(s).
4. **Diff** generated output against existing code token files.
5. **Report** added, changed, and removed tokens.
6. **Write** updated files (or produce a prompt for manual application in `--prompt` mode).

## Parity Verification

After sync, verify zero drift between design and code:

1. Parse the canonical token file and collect all defined tokens.
2. Parse each generated output file and collect all referenced tokens.
3. **Missing in code** — token exists in design but not in any output file. Flag as error.
4. **Missing in design** — token referenced in code but not defined in the canonical file. Flag as warning (may be a framework default).
5. **Value mismatch** — token exists in both but the code file uses a hardcoded value instead of the token reference. Flag as error.
6. Produce a parity report and write it to `.danteforge/token-parity.md`.

A clean parity report has zero errors. Warnings are acceptable when they reference framework-provided defaults.

## Integration With Other Skills

- **design-orchestrator** — provides the .op files and initial token extraction
- **figma-to-op** — converts Figma designs that may carry different token naming into the canonical format
- **ux-refine** — pulls refined tokens from Figma after visual review
- **frontend-design** — consumes tokens when building production UI

## When to Use

This skill is applicable when extracting design tokens from .op files, when synchronizing tokens to CSS, Tailwind, or styled-components, or when verifying parity between design tokens and code.
