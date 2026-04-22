# SPEC.md

## Feature Name
TODO CLI example

## What & Why
Ship a small, honest example that demonstrates how DanteForge planning artifacts map to a working command-line app. The example must be simple enough to inspect quickly and complete enough to run immediately from the repo.

## Operator Stories
1. As an operator, I can add a todo item from the terminal.
2. As an operator, I can list all todos or filter the list to pending or done items.
3. As an operator, I can mark a todo as complete, delete an item, or clear completed work.
4. As a reviewer, I can inspect the planning artifacts in `.danteforge/` and see that they match the shipped code.

## Functional Requirements
- Commands: `add`, `list [all|pending|done]`, `done`, `delete`, `clear`
- Todos persist to `~/.todos.json`
- Empty todo text must be rejected
- Unknown IDs must return a non-zero exit code with a clear error
- Listing with an invalid filter must return a non-zero exit code with usage help

## Non-Functional Requirements
- Zero runtime dependencies beyond Node.js
- ESM modules only
- Business logic stays pure in `src/todo.js`
- Storage is isolated in `src/storage.js`
- Automated tests prove the public behavior and the storage error path

## Acceptance Criteria
1. `node src/cli.js add "Task"` writes a todo to the persisted store.
2. `node src/cli.js list pending` and `node src/cli.js list done` filter correctly.
3. `node src/cli.js done <id>` and `node src/cli.js delete <id>` fail clearly when the ID is missing.
4. `node --test tests/todo.test.js` passes.
5. The pipeline artifacts in `.danteforge/` and `evidence/` reference the files that actually ship in this directory.
