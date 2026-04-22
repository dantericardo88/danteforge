# PLAN.md

## Architecture Overview

- `src/todo.js` owns the pure CRUD logic and formatting helpers.
- `src/storage.js` owns persistence and corrupt-store validation.
- `src/cli.js` is the thin command dispatcher that translates operator input into pure-function calls.
- `tests/todo.test.js` verifies both the pure logic and the storage boundary.

## Implementation Phases

1. Define the zero-dependency command surface and persistence rules.
2. Implement the pure todo state transitions.
3. Add file storage with a helpful corrupt-data failure mode.
4. Wire the CLI and verify the bundled app with automated tests.

## Verification Plan

- `node --test tests/todo.test.js`
- Manual smoke path: `add`, `list`, `done`, `delete`, `clear`
- Public evidence files must reference the actual bundled `.js` files and `.danteforge/` artifacts

## Risk Notes

- The example should not depend on repo-level build tooling.
- The example should avoid fake proof files that mention deleted artifacts or missing tests.
