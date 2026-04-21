# CLARIFY.md

## Resolved Decisions

1. **Runtime shape**
   The bundled example ships as plain JavaScript so it runs on a clean Node install without additional tooling.

2. **Persistence**
   Todos are stored in `~/.todos.json` so the CLI behaves like a real local utility instead of an in-repo fixture.

3. **Command surface**
   The `list` command accepts `all`, `pending`, or `done`. Unknown filters are treated as operator errors.

4. **Verification bar**
   The example is not considered complete until the todo logic and storage behavior both pass `node --test tests/todo.test.js`.

## Follow-Through

- Keep `.danteforge/STATE.yaml` in the `verify` stage because the code and tests ship, but no synthesis artifact is bundled.
- Keep public evidence files aligned with the shipped `.js` files and `.danteforge/` artifacts.
