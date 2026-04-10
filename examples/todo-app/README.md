# Example: Build a TODO CLI with DanteForge

This example demonstrates the DanteForge workflow from spec to working code. The constitution and spec are pre-written — you drive the build.

## Prerequisites

```bash
npm i -g danteforge    # Install DanteForge globally
# OR: clone the repo and run `npm link` from the root
```

You also need a configured LLM provider:
```bash
danteforge init        # Interactive setup — picks Ollama (local, free) by default
```

## Walkthrough

### 1. Review the current state

```bash
cd examples/todo-app
danteforge review
```

DanteForge reads the CONSTITUTION.md, SPEC.md, and `.danteforge/STATE.yaml` to understand where the project is. You should see it's in the `specify` stage with the constitution and spec already written.

### 2. Plan the implementation

```bash
danteforge plan
```

The LLM reads the spec and generates a phased implementation plan. Review the output — it should propose:
- Phase 1: Core data model + storage layer
- Phase 2: CLI commands (add, list, done, delete, clear)
- Phase 3: Tests

### 3. Generate the task list

```bash
danteforge tasks
```

Breaks the plan into executable tasks with file lists and verify commands.

### 4. Build it

```bash
danteforge forge
```

Executes the first wave of tasks. DanteForge generates the source files, runs the verify commands, and advances the state.

For a more autonomous experience:
```bash
danteforge magic       # Balanced: plan → forge → verify cycle
# OR
danteforge blaze       # High power: adds party mode + self-improvement
```

### 5. Verify

```bash
danteforge verify
```

Runs all quality checks: tests pass, types check, no lint errors.

### 6. See the result

After a successful forge + verify cycle, you should have:
```
examples/todo-app/
  src/
    store.ts           # TodoStore CRUD operations
    cli.ts             # Commander.js CLI entry point
  tests/
    store.test.ts      # Unit tests for store operations
  package.json
  tsconfig.json
```

## What just happened?

DanteForge followed its spec-driven pipeline:

1. **Constitution** defined project principles and constraints
2. **Spec** described exact behavior and data model
3. **Plan** decomposed the spec into implementation phases
4. **Tasks** broke phases into file-level work items
5. **Forge** executed each task with LLM-generated code
6. **Verify** confirmed the result meets quality gates

No code was written manually. The spec drove everything.

## Next steps

- Try `danteforge assess` to see how the generated code scores
- Try `danteforge synthesize` to generate a project summary
- Modify SPEC.md (add priorities, due dates) and run `danteforge forge` again
