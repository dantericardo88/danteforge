import { after, afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  requireConstitution,
  requireSpec,
  requireClarify,
  requirePlan,
  requireTests,
  requireDesign,
  requireApproval,
  runGate,
  GateError,
} from '../src/core/gates.js';
import { saveState } from '../src/core/state.js';
import type { DanteState } from '../src/core/state.js';

const tempDirs: string[] = [];

async function createTempProject(overrides?: Partial<DanteState>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-gates-'));
  tempDirs.push(dir);
  const stateDir = path.join(dir, '.danteforge');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(path.join(stateDir, 'reports'), { recursive: true });
  await fs.mkdir(path.join(stateDir, 'scores'), { recursive: true });

  const state: DanteState = {
    project: 'gates-test',
    created: new Date().toISOString(),
    workflowStage: 'initialized' as DanteState['workflowStage'],
    currentPhase: 'phase-1',
    lastHandoff: 'none',
    profile: 'balanced',
    tasks: {},
    gateResults: {},
    auditLog: [],
    ...overrides,
  } as DanteState;
  await saveState(state, { cwd: dir });
  return dir;
}

after(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

afterEach(() => {
  process.exitCode = 0;
});

describe('GateError', () => {
  it('has gate and remedy properties', () => {
    const err = new GateError('blocked', 'testGate', 'run fix');
    assert.strictEqual(err.gate, 'testGate');
    assert.strictEqual(err.remedy, 'run fix');
    assert.strictEqual(err.message, 'blocked');
    assert.strictEqual(err.name, 'GateError');
  });

  it('is an instance of Error', () => {
    const err = new GateError('msg', 'g', 'r');
    assert.ok(err instanceof Error);
    assert.ok(err instanceof GateError);
  });
});

describe('gates light mode bypass', () => {
  it('requireConstitution passes in light mode', async () => {
    await requireConstitution(true);
  });

  it('requireSpec passes in light mode', async () => {
    await requireSpec(true);
  });

  it('requirePlan passes in light mode', async () => {
    await requirePlan(true);
  });

  it('requireTests passes in light mode', async () => {
    await requireTests(true);
  });

  it('requireApproval does not throw in any mode', async () => {
    await requireApproval('test-artifact', false);
    await requireApproval('test-artifact', true);
  });
});

describe('runGate', () => {
  it('returns true when gate passes', async () => {
    const result = await runGate(() => Promise.resolve());
    assert.strictEqual(result, true);
  });

  it('returns false when gate throws GateError', async () => {
    const result = await runGate(() => {
      throw new GateError('blocked', 'test', 'fix');
    });
    assert.strictEqual(result, false);
  });

  it('rethrows non-GateError errors', async () => {
    try {
      await runGate(() => { throw new Error('unexpected'); });
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(err instanceof Error);
      assert.strictEqual(err.message, 'unexpected');
      assert.ok(!(err instanceof GateError));
    }
  });
});

describe('gates with cwd injection', () => {
  it('requireConstitution passes with cwd pointing to valid state + CONSTITUTION.md', async () => {
    const dir = await createTempProject({ constitution: 'test constitution' } as Partial<DanteState>);
    await fs.writeFile(path.join(dir, '.danteforge', 'CONSTITUTION.md'), '# Constitution');
    await requireConstitution(false, dir);
  });

  it('requireConstitution throws GateError with cwd pointing to empty state', async () => {
    const dir = await createTempProject();
    try {
      await requireConstitution(false, dir);
      assert.fail('Should have thrown GateError');
    } catch (err) {
      assert.ok(err instanceof GateError);
      assert.strictEqual(err.gate, 'requireConstitution');
    }
  });

  it('requireSpec passes with cwd and SPEC.md present', async () => {
    const dir = await createTempProject();
    await fs.writeFile(path.join(dir, '.danteforge', 'SPEC.md'), '# Spec');
    await requireSpec(false, dir);
  });

  it('requireSpec throws GateError without SPEC.md at cwd', async () => {
    const dir = await createTempProject();
    try {
      await requireSpec(false, dir);
      assert.fail('Should have thrown GateError');
    } catch (err) {
      assert.ok(err instanceof GateError);
      assert.strictEqual(err.gate, 'requireSpec');
    }
  });

  it('requirePlan passes with cwd and PLAN.md present', async () => {
    const dir = await createTempProject();
    await fs.writeFile(path.join(dir, '.danteforge', 'PLAN.md'), '# Plan');
    await requirePlan(false, dir);
  });

  it('requirePlan throws GateError without PLAN.md at cwd', async () => {
    const dir = await createTempProject();
    try {
      await requirePlan(false, dir);
      assert.fail('Should have thrown GateError');
    } catch (err) {
      assert.ok(err instanceof GateError);
      assert.strictEqual(err.gate, 'requirePlan');
    }
  });

  it('requireDesign passes with valid DESIGN.op at cwd', async () => {
    const dir = await createTempProject();
    const designOp = JSON.stringify({ nodes: [], document: { width: 100, height: 100 } });
    await fs.writeFile(path.join(dir, '.danteforge', 'DESIGN.op'), designOp);
    await requireDesign(false, dir);
  });

  it('requireDesign throws GateError without DESIGN.op at cwd', async () => {
    const dir = await createTempProject();
    try {
      await requireDesign(false, dir);
      assert.fail('Should have thrown GateError');
    } catch (err) {
      assert.ok(err instanceof GateError);
      assert.strictEqual(err.gate, 'requireDesign');
    }
  });

  it('requireClarify passes with cwd and CLARIFY.md present', async () => {
    const dir = await createTempProject();
    await fs.writeFile(path.join(dir, '.danteforge', 'CLARIFY.md'), '# Clarify');
    await requireClarify(false, dir);
  });

  it('requireClarify throws GateError without CLARIFY.md at cwd', async () => {
    const dir = await createTempProject();
    try {
      await requireClarify(false, dir);
      assert.fail('Should have thrown GateError');
    } catch (err) {
      assert.ok(err instanceof GateError);
      assert.strictEqual(err.gate, 'requireClarify');
    }
  });
});
