# Example: TODO CLI Snapshot

This directory ships a completed DanteForge example. The goal is to let you inspect a truthful pipeline snapshot and run the resulting app immediately, without depending on an external LLM.

## What this example proves

- DanteForge can ship a finished pipeline snapshot with the planning artifacts intact.
- The bundled app is runnable without hidden dependencies or a local maintainer setup.
- The example includes real verification proof: tests, state, and public evidence artifacts.

## What this example does not prove

- This is not a launch-ready product.
- It is a finished pipeline snapshot, not a polished public app or full customer-facing workflow.
- The score is intentionally capped by its narrow scope, small docs surface, and minimal operator UX.

## What ships in this example

- `.danteforge/CONSTITUTION.md` - the project constraints for the example
- `.danteforge/SPEC.md` - the feature contract for the todo CLI
- `.danteforge/CLARIFY.md`, `.danteforge/PLAN.md`, `.danteforge/TASKS.md` - the planning artifacts that drove the implementation
- `src/cli.js`, `src/storage.js`, `src/todo.js` - the bundled zero-dependency app
- `tests/todo.test.js` - the automated proof that the shipped behavior works
- `evidence/pipeline-run.json` and `evidence/convergence-proof.json` - public proof artifacts copied from the example run

Generated scratch files such as assessment history or wiki indexes are intentionally excluded from the shipped snapshot so the example stays reviewable.

## Inspect the pipeline artifacts

```bash
cd examples/todo-app
danteforge quality
```

Useful files to open next:

- `.danteforge/CONSTITUTION.md`
- `.danteforge/SPEC.md`
- `.danteforge/PLAN.md`
- `.danteforge/TASKS.md`
- `.danteforge/STATE.yaml`

## Run the bundled app

```bash
cd examples/todo-app
node src/cli.js add "Ship DanteForge"
node src/cli.js list
node src/cli.js done 1
node src/cli.js clear
```

Todos are stored locally in `~/.todos.json`.

## Verify the example

```bash
cd examples/todo-app
node --test tests/todo.test.js
```

The test suite covers the pure todo logic plus the file-storage behavior, including corrupt JSON handling.

## How this maps to DanteForge

1. **Constitution** keeps the example local-first, explicit, and zero-dependency.
2. **Spec** defines the exact CLI commands, persistence model, and edge cases.
3. **Clarify / Plan / Tasks** translate the idea into concrete files and verification steps.
4. **Forge output** lives in `src/` and `tests/`.
5. **Verify evidence** lives in `.danteforge/STATE.yaml` and `evidence/`.

This is a snapshot of a finished example, not a half-generated workspace. If you want to iterate on it further, edit the artifacts in `.danteforge/` and rerun the DanteForge commands from this directory.
