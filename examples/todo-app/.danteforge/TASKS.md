# TASKS.md

## Phase 1

1. Implement the todo domain in `src/todo.js`.
   Verify: CRUD helpers return new store objects and format list output consistently.

2. Implement persistence in `src/storage.js`.
   Verify: missing stores initialize cleanly and corrupt JSON throws a reset hint.

3. Wire the operator commands in `src/cli.js`.
   Verify: usage errors set a non-zero exit code and successful commands update the persisted store.

4. Prove the shipped behavior in `tests/todo.test.js`.
   Verify: `node --test tests/todo.test.js` passes.
