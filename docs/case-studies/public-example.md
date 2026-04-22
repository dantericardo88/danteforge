# Case Study: Public Example

This case study is grounded in the bundled `examples/todo-app` snapshot that ships with the repo.

## Why This Is The Official Example

- It is runnable immediately on a fresh checkout.
- It ships the real pipeline artifacts instead of only generated source code.
- It stays intentionally small enough to review without guessing which files matter.

## Environment

- Node.js 18+
- This repository checked out locally
- No API keys required
- Uses the shipped example artifacts under `examples/todo-app/`

## Commands

```bash
cd examples/todo-app
node --test tests/todo.test.js
danteforge quality
danteforge showcase --cwd .
```

## What This Proves

- DanteForge can ship a complete artifact set, not just generated source files.
- The example is runnable immediately and has a standalone test suite.
- The public score surface is generated from the real example state, not hand-written marketing copy.

## Inspect First

- `examples/todo-app/.danteforge/CONSTITUTION.md`
- `examples/todo-app/.danteforge/SPEC.md`
- `examples/todo-app/.danteforge/PLAN.md`
- `examples/todo-app/tests/todo.test.js`

## Receipts

- `examples/todo-app/.danteforge/STATE.yaml`
- `examples/todo-app/evidence/pipeline-run.json`
- `examples/todo-app/evidence/convergence-proof.json`
- `docs/CASE_STUDY.md`

The current generated case study shows the example at `4.2 / 10` and explicitly explains why the score is capped.

## Known Limitations

- This is a minimal example, not a public product.
- Documentation, community adoption, and operator UX are intentionally capped by the example's narrow scope.
- The example proves a finished pipeline snapshot, not live-provider or extension behavior.
