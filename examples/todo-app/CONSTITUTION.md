# Constitution: TODO CLI App

## Project Identity
A simple command-line TODO list manager built with Node.js and TypeScript.

## Core Principles
1. **Simplicity first** — plain text storage, no database required
2. **Type safety** — full TypeScript with strict mode
3. **Testable** — all logic in pure functions, CLI is a thin wrapper
4. **Portable** — single file storage in `~/.todos.json`

## Technical Constraints
- Node.js 18+ (LTS)
- Zero runtime dependencies (only dev dependencies for TypeScript + testing)
- ESM modules (`"type": "module"` in package.json)
- Node.js built-in test runner (`node --test`)

## Quality Gates
- All commands must have corresponding tests
- `npm test` must pass before any commit
- No `any` types in source code

## Scope Boundaries
- IN SCOPE: add, list, complete, delete, clear commands
- OUT OF SCOPE: due dates, priorities, categories, syncing, GUI
