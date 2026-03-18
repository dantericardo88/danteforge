---
name: ux-refine
description: "Use after initial forge to refine UI/UX with an explicit DanteForge path: either prompt-driven Figma guidance or local OpenPencil extraction."
---
# UX Refine

> DanteForge skill module. Use this after planning and either a real forge pass or a completed `DESIGN.op`.

## Supported Paths

```text
review -> constitution -> specify -> clarify -> plan -> tasks -> forge -> ux-refine --prompt -> verify
review -> constitution -> specify -> clarify -> plan -> design -> ux-refine --openpencil -> verify
```

Do not assume DanteForge automatically pushed to or pulled from Figma. The GA-safe paths are:

1. `danteforge ux-refine --prompt --figma-url <url>`
2. `danteforge ux-refine --openpencil`

## Prompt-Driven Figma Workflow

Use this when you have a real UI build and want manual or MCP-assisted visual refinement.

```bash
danteforge ux-refine --prompt --figma-url <your-figma-file-url>
```

What it does:

1. Validates the planning gates and confirms a forge pass exists.
2. Discovers UI components and writes a saved refinement prompt.
3. Tells the operator exactly what to do in Figma or an MCP-capable editor.

What it does not do:

1. It does not claim DanteForge already executed MCP actions.
2. It does not create fake design tokens or placeholder success artifacts.

## Local OpenPencil Workflow

Use this when you already have `DESIGN.op` and want local artifacts only.

```bash
danteforge ux-refine --openpencil
```

Outputs:

1. `.danteforge/design-tokens.css`
2. `.danteforge/design-tokens.tailwind.js`
3. `.danteforge/design-preview.html`

## Figma Setup

```bash
danteforge setup figma
```

After setup, use the prompt path above. Automatic `party --figma` or `forge --figma` execution is not treated as a GA automatic MCP path unless it is explicitly prompt-driven.

## Flags

| Flag | Description |
|------|-------------|
| `--prompt` | Generate the saved prompt/manual workflow |
| `--openpencil` | Extract tokens and previews locally from `DESIGN.op` |
| `--figma-url <url>` | Figma file URL for the prompt workflow |
| `--token-file <path>` | Destination path for operator token updates |
| `--host <type>` | Explicit editor host override |
| `--after-forge` | Skip forge auto-detection when you already know the build exists |
