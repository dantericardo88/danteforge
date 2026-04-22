## Research Strategy: Testing Coverage — 59 Low-Coverage Files

**Goal**: Write tests for zero/low-coverage src/ files to raise testing dimension 9.4→10.0.

**Priority order**:
1. Zero-coverage files (0%L) — 13 files, highest impact per test written
2. Sub-20% files — CLI commands with thin wrappers
3. Sub-40% files — core modules with exportable pure functions

**Test patterns (project conventions)**:
- Use `_opts`/`_fns` injection seams already present in most commands
- Direct function calls, no mocking frameworks (no jest/sinon/etc)
- `before`/`after` + `fs.mkdtemp` for isolated tmp dirs
- Factory functions for test data
- Import from `../src/cli/commands/X.js` (not .ts) for test imports

**Avoid**:
- Changing source files unless needed to add an injection seam
- Tests that require real LLM calls (use `_llmCaller` injection)
- Tests that require real git repos (use `_gitFn` injection if present)
- Adding dependencies

**Measurement**: cumulative passing test count across all new test files.
**Stop condition**: all 13 zero-coverage files have tests; overall coverage > 80%.
