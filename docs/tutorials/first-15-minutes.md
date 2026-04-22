# First 15 Minutes

This tutorial is the shortest honest path to seeing DanteForge work without pretending you already know the architecture.

This is the flagship local-only path: no API keys, no launch claims, just the core workflow and the receipts it produces.

## Environment

- Node.js 18+ installed
- A local checkout of this repo
- No API keys required for the local-only path
- Optional later: provider keys if you want to run `npm run verify:live`

## Commands

```bash
npm ci
npm run build
danteforge init
danteforge go
danteforge review
danteforge verify
```

If you want a bundled project to inspect instead of starting from scratch:

```bash
cd examples/todo-app
node --test tests/todo.test.js
danteforge showcase --cwd .
```

## What To Expect

1. `danteforge init` sets up `.danteforge/` and ends with a mode/next-command summary.
2. `danteforge go` runs the daily-driver flow and points you at the highest-value next action.
3. `danteforge review` captures the current repo state in `.danteforge/CURRENT_STATE.md`.
4. `danteforge verify` writes a machine-readable verify receipt instead of relying on a narrative success claim.

## Receipts

- `.danteforge/STATE.yaml`
- `.danteforge/CURRENT_STATE.md`
- `.danteforge/evidence/verify/latest.json`
- `.danteforge/evidence/verify/latest.md`
- `docs/CASE_STUDY.md` if you also run `danteforge showcase --cwd examples/todo-app`

## Known Limitations

- The local-only path proves workflow structure and diagnostics, not live-provider quality.
- `npm run verify:live` is intentionally separate because it needs secrets and external services.
- The bundled `examples/todo-app` is a truthful pipeline snapshot, not a launch-ready app.
