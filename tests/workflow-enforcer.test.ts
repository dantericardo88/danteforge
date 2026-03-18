import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import yaml from 'yaml';
import { validateTransition, getNextSteps, isStageComplete, getWorkflowGraph, enforceWorkflow } from '../src/core/workflow-enforcer.js';
import type { WorkflowStage } from '../src/core/state.js';
import { GateError } from '../src/core/gates.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-wf-test-'));
  await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true });
  // Create minimal state file
  const state = {
    project: 'test',
    lastHandoff: 'initialized',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: {},
    auditLog: [],
    profile: 'balanced',
  };
  await fs.writeFile(path.join(tmpDir, '.danteforge', 'STATE.yaml'), yaml.stringify(state));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('validateTransition', () => {
  it('allows initialized -> review', async () => {
    const result = await validateTransition('initialized', 'review');
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.blocked.length, 0);
  });

  it('allows initialized -> constitution', async () => {
    const result = await validateTransition('initialized', 'constitution');
    assert.strictEqual(result.valid, true);
  });

  it('blocks initialized -> forge (not adjacent)', async () => {
    const result = await validateTransition('initialized', 'forge');
    assert.strictEqual(result.valid, false);
    assert.ok(result.blocked.length > 0);
    assert.ok(result.blocked[0].message.includes('Cannot transition'));
  });

  it('blocks constitution -> forge (skips specify/plan)', async () => {
    const result = await validateTransition('constitution', 'forge');
    assert.strictEqual(result.valid, false);
  });

  it('allows plan -> tasks', async () => {
    const result = await validateTransition('plan', 'tasks');
    // This will fail the requirePlan gate since no PLAN.md file exists,
    // but the graph edge is valid
    assert.ok(result.transition !== undefined);
  });

  it('allows light mode to bypass gate checks', async () => {
    const result = await validateTransition('constitution', 'specify', true);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.blocked.length, 0);
  });

  it('reports unknown target stage', async () => {
    const result = await validateTransition('initialized', 'nonexistent' as WorkflowStage);
    assert.strictEqual(result.valid, false);
    assert.ok(result.blocked[0].message.includes('Unknown workflow target'));
  });
});

describe('getNextSteps', () => {
  it('returns review and constitution from initialized', () => {
    const steps = getNextSteps('initialized');
    assert.ok(steps.includes('review'));
    assert.ok(steps.includes('constitution'));
  });

  it('returns specify from constitution', () => {
    const steps = getNextSteps('constitution');
    assert.ok(steps.includes('specify'));
  });

  it('returns clarify and plan from specify', () => {
    const steps = getNextSteps('specify');
    assert.ok(steps.includes('clarify'));
    assert.ok(steps.includes('plan'));
  });

  it('returns synthesize from verify', () => {
    const steps = getNextSteps('verify');
    assert.ok(steps.includes('synthesize'));
  });

  it('returns empty array from synthesize (terminal)', () => {
    const steps = getNextSteps('synthesize');
    assert.strictEqual(steps.length, 0);
  });
});

describe('isStageComplete', () => {
  it('returns false when artifact is missing', async () => {
    const complete = await isStageComplete('review', tmpDir);
    assert.strictEqual(complete, false);
  });

  it('returns true when artifact exists', async () => {
    await fs.writeFile(path.join(tmpDir, '.danteforge', 'CURRENT_STATE.md'), '# State');
    const complete = await isStageComplete('review', tmpDir);
    assert.strictEqual(complete, true);
  });

  it('returns true for stages with no required artifacts', async () => {
    const complete = await isStageComplete('forge', tmpDir);
    assert.strictEqual(complete, true);
  });
});

describe('getWorkflowGraph', () => {
  it('returns a non-empty graph', () => {
    const graph = getWorkflowGraph();
    assert.ok(graph.length > 0);
  });

  it('graph covers all major stages', () => {
    const graph = getWorkflowGraph();
    const targets = graph.map(t => t.to);
    assert.ok(targets.includes('review'));
    assert.ok(targets.includes('constitution'));
    assert.ok(targets.includes('specify'));
    assert.ok(targets.includes('forge'));
    assert.ok(targets.includes('verify'));
    assert.ok(targets.includes('synthesize'));
  });
});

describe('enforceWorkflow strict-by-default', () => {
  it('throws GateError for out-of-order commands when enforcementMode is not set', async () => {
    // State file has no enforcementMode — should default to strict and block
    const originalCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      await assert.rejects(
        () => enforceWorkflow('forge'),
        (err: Error) => {
          assert.ok(err instanceof GateError, 'Expected GateError but got: ' + err.constructor.name);
          assert.ok(err.message.includes('Workflow blocked'));
          return true;
        },
      );
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('allows valid transitions even in strict mode', async () => {
    const originalCwd = process.cwd();
    try {
      process.chdir(tmpDir);
      // initialized -> review is a valid transition, should not throw
      await enforceWorkflow('review');
    } finally {
      process.chdir(originalCwd);
    }
  });
});
