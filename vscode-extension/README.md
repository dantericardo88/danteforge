# DanteForge VS Code Extension

The DanteForge VS Code extension exposes the DanteForge workflow inside VS Code for developers who prefer command-palette and terminal-driven execution from their editor.

This extension is one of the three launch-supported DanteForge surfaces alongside the local-only CLI and the live-provider CLI.

## Features

- Show setup guidance directly from the command palette with `DanteForge: Setup Help`.
- Launch `constitution`, `specify`, `review`, `verify`, `doctor`, `forge`, `party`, and `magic` from the command palette.
- Prefer a workspace-local DanteForge binary when the current project has one installed.
- Fall back to a globally installed `danteforge` binary when no workspace-local binary is available.
- Sanitize free-form idea input before dispatching shell commands to the integrated terminal.

## Requirements

Install DanteForge in one of these ways:

```bash
npm install
npm run verify:all
npm link
```

Or inside the current workspace:

```bash
npm install
npm run build
```

The extension will look for `node_modules/.bin/danteforge` first and use it automatically.

## Commands

- `DanteForge: Setup Help`
- `DanteForge: Constitution`
- `DanteForge: Specify Idea`
- `DanteForge: Review Project`
- `DanteForge: Verify State`
- `DanteForge: Doctor`
- `DanteForge: Forge Wave`
- `DanteForge: Party Mode`
- `DanteForge: Magic Mode`

## Packaging

For maintainers:

```bash
npm run verify
npm run package:vsix
npm run publish:vsce
npm run publish:ovsx
```

This produces `vscode-extension/.artifacts/danteforge.vsix`.
