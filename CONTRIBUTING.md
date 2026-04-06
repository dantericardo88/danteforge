# Contributing to DanteForge

Thank you for your interest in contributing to DanteForge.

## Development Setup

**Prerequisites:**
- Node.js 18+ (we test on 18, 20, and 22)
- npm 9+
- Git

**Getting started:**
```bash
git clone https://github.com/your-org/danteforge
cd danteforge
npm ci            # deterministic install
npm run verify    # typecheck + lint + all tests
npm run build     # build dist/index.js + dist/sdk.js
```

## Architecture Overview

DanteForge follows a strict layered architecture:

- **`src/cli/commands/`** — thin Commander.js adapters; each command delegates immediately to a core module
- **`src/core/`** — business logic, state management, LLM routing, scoring, MCP server
- **`src/harvested/`** — battle-tested patterns harvested from OSS tools (GSD executor, spec engine, agent roles)
- **`src/utils/`** — git worktree isolation and other utilities

**Injection seams invariant:** Every module that has side effects (LLM calls, file I/O, shell execution) exposes an optional `Deps` interface for testing. Production code calls the real implementations; tests inject stubs. No mocking frameworks are used anywhere.

## Adding a New Command

1. Create `src/cli/commands/<name>.ts` with an exported function:
```typescript
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

export interface MyCommandOptions {
  _someSeam?: (...args: unknown[]) => Promise<unknown>;  // injection seam for tests
}

export async function myCommand(options: MyCommandOptions = {}): Promise<void> {
  return withErrorBoundary('my-command', async () => {
    // implementation
  });
}
```

2. Export it from `src/cli/commands/index.ts`:
```typescript
export { myCommand } from './my-command.js';
```

3. Register it in `src/cli/index.ts`:
```typescript
program
  .command('my-command')
  .description('What it does')
  .action(() => commands.myCommand());
```

4. Add tests in `tests/my-command.test.ts`

5. Add it to the command group in `src/cli/index.ts` help text

## Testing Conventions

- **Test runner:** Node.js built-in `node:test` with `assert/strict` — no Jest, no Vitest, no Mocha
- **File naming:** `tests/<module-name>.test.ts`
- **Injection seam pattern:**
```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { myFunction } from '../src/core/my-module.js';

describe('my-module', () => {
  it('does the thing', async () => {
    const result = await myFunction({
      _llmCaller: async () => 'mocked response',  // injection seam
    });
    assert.equal(result, 'expected');
  });
});
```
- **No `as any`** — use type guards or proper typing
- **No mocking frameworks** — use direct function calls with injected dependencies only
- **Isolated tmp dirs** for tests that write files:
```typescript
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

let tmpDir: string;
before(async () => { tmpDir = await mkdtemp(`${tmpdir()}/test-`); });
after(async () => { await rm(tmpDir, { recursive: true, force: true }); });
```

Run all tests: `npm test`
Run a single test file: `npx tsx --test tests/my-command.test.ts`

## TypeScript Conventions

- **No `as any`** — use type guards (`instanceof`, `typeof`, custom predicates)
- **`.js` extensions** in all imports (required for ESM)
- **Strict mode** — `tsconfig.json` has `"strict": true`
- **ESM-only** — `"type": "module"` in `package.json`
- Do not use CommonJS `require()` — use dynamic `await import(...)` for optional dependencies

## Submitting a Pull Request

1. Branch naming: `feat/<description>`, `fix/<description>`, `chore/<description>`
2. All CI checks must pass: `npm run verify` + `npm run build`
3. Update `CHANGELOG.md` with your changes under the `[Unreleased]` section
4. Keep PRs focused — one logical change per PR
5. Tests are required for new functionality and bug fixes

## Security Issues

Please do **not** open a public GitHub issue for security vulnerabilities.

Email security reports to the maintainers directly (see `package.json` for contact info). We will respond within 48 hours.

For details on the premium license system and workspace security model, see `docs/INTEGRATION-GUIDE.md`.

## Quality Gates

- `npm run verify` (fail-closed): `typecheck + lint + tests`
- `npm run verify:all`: root verify + CLI build + VS Code extension verification
- `npm run check:repo-hygiene`: fails if generated/vendor paths are tracked by git
- `npm run check:repo-hygiene:strict`: also fails if generated/vendor paths merely exist in the checkout (use in fresh CI clones)
- `npm run check:third-party-notices`: fails if `THIRD_PARTY_NOTICES.md` still has TODO placeholders

## Repo Hygiene

Do not commit generated or vendor directories:

- `node_modules/`
- `dist/`
- `coverage/`
- `.danteforge/`
- `vscode-extension/node_modules/`
- `vscode-extension/dist/`

## Error Handling Patterns

DanteForge uses a structured error hierarchy defined in `src/core/errors.ts`:

- **`DanteError`** — base class for all DanteForge errors (includes `code` and `context` fields)
- **`LLMError`** — errors from LLM provider calls (includes `provider` and `statusCode`)
- **`BudgetError`** — token/cost budget exceeded errors

All new CLI commands must use `withErrorBoundary` from `src/core/cli-error-boundary.ts`. All side-effect operations (file writes, API calls) should be wrapped in try/catch so they never block the main execution path.

## Premium Features

Features listed in `PREMIUM_FEATURES` in `src/core/premium.ts` require a license check at the command entry point. Call `requirePremiumFeature('feature-name')` before any work is done — this throws a user-friendly error if the feature is not unlocked.

The license is validated against `DANTEFORGE_LICENSE_KEY` (env var) or the key stored in `~/.danteforge/config.yaml`. Expiry dates are checked at validation time.

## Workspace Awareness

Commands that modify config or state should call `requireWorkspaceRole('editor')` (from `src/core/workspace-gate.ts`) when a workspace is active. Read-only commands should call `requireWorkspaceRole('reviewer')`.

If `DANTEFORGE_WORKSPACE` is not set, all role checks are no-ops (single-user mode).
