// Tests for the dynamic STATE.yaml injection in hooks/session-start.mjs.
// Imports the pure exported buildSessionContext() function — no process.cwd() side effects.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// @ts-expect-error — .mjs hook, not in TS compilation; import works at runtime via tsx
import { buildSessionContext } from '../hooks/session-start.mjs';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FORGE_STATE = `
project: my-app
workflowStage: forge
currentPhase: 1
tasks:
  1:
    - name: Add user model
      files:
        - src/models/user.ts
    - name: Add user routes
      files:
        - src/routes/user.ts
`;

const FORGE_STATE_PHASE2 = `
project: multi-phase-app
workflowStage: forge
currentPhase: 2
tasks:
  1:
    - name: Add user model
  2:
    - name: Add API routes
      files:
        - src/routes/api.ts
`;

const SPECIFY_STATE = `
project: my-app
workflowStage: specify
currentPhase: 1
`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('session-start hook buildSessionContext()', () => {
  it('returns a non-empty string when stateYaml is null (no project)', () => {
    const ctx = buildSessionContext(null);
    assert.strictEqual(typeof ctx, 'string');
    assert.ok(ctx.length > 0, 'must return non-empty string');
  });

  it('includes static DanteForge context in all cases', () => {
    const ctx = buildSessionContext(null);
    assert.ok(ctx.includes('DanteForge'), 'static context must always be present');
  });

  it('forge stage: context includes @danteforge-forge invocation hint', () => {
    const ctx = buildSessionContext(FORGE_STATE);
    assert.ok(ctx.includes('@danteforge-forge'), 'must suggest loading the forge skill');
  });

  it('forge stage: context includes the current phase number', () => {
    const ctx = buildSessionContext(FORGE_STATE);
    assert.ok(ctx.includes('Phase 1') || ctx.includes('phase 1'), 'must show active phase number');
  });

  it('forge stage: context lists task names from the current phase', () => {
    const ctx = buildSessionContext(FORGE_STATE);
    assert.ok(ctx.includes('Add user model'), 'must list task names from current phase');
    assert.ok(ctx.includes('Add user routes'), 'must list all tasks in phase');
  });

  it('forge stage: context mentions danteforge verify --json', () => {
    const ctx = buildSessionContext(FORGE_STATE);
    assert.ok(ctx.includes('danteforge verify --json'), 'must surface the --json flag');
  });

  it('forge stage phase 2: lists phase 2 tasks, not phase 1 tasks', () => {
    const ctx = buildSessionContext(FORGE_STATE_PHASE2);
    assert.ok(ctx.includes('Add API routes'), 'must list current phase 2 tasks');
    assert.ok(!ctx.includes('Add user model'), 'must NOT list completed phase 1 tasks');
  });

  it('non-forge stage: context does NOT include @danteforge-forge', () => {
    const ctx = buildSessionContext(SPECIFY_STATE);
    assert.ok(!ctx.includes('@danteforge-forge'), 'non-forge stage must not trigger forge skill');
  });

  it('non-forge stage: context mentions the active workflow stage', () => {
    const ctx = buildSessionContext(SPECIFY_STATE);
    assert.ok(ctx.includes('specify'), 'must mention current workflow stage by name');
  });

  it('invalid or empty yaml: returns static context without throwing', () => {
    assert.doesNotThrow(() => buildSessionContext('not: valid: yaml: :::'));
    const ctx = buildSessionContext('');
    assert.strictEqual(typeof ctx, 'string');
    assert.ok(ctx.includes('DanteForge'), 'static context must still appear');
  });
});
