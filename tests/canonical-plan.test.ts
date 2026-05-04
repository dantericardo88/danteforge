// canonical-plan.test.ts — Blade Group 2: plan enhancements
// Tests: --mode sprint, --mode define-done, --skip-critique, standard+deep critique gate dispatch

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPlan } from '../src/cli/commands/canonical.js';

function makePlanFns(called: string[]) {
  return {
    review: async () => { called.push('review'); },
    specify: async (g: string) => { called.push('specify:' + g); },
    constitution: async () => { called.push('constitution'); },
    clarify: async () => { called.push('clarify'); },
    plan: async () => { called.push('plan'); },
    critique: async () => { called.push('critique'); },
    techDecide: async () => { called.push('techDecide'); },
    tasks: async () => { called.push('tasks'); },
    sprintPlan: async () => { called.push('sprintPlan'); },
    defineDone: async () => { called.push('defineDone'); },
  };
}

describe('canonicalPlan — --mode sprint', () => {
  it('dispatches to sprintPlan and returns immediately', async () => {
    const called: string[] = [];
    await canonicalPlan(undefined, { mode: 'sprint', _fns: makePlanFns(called) });
    assert.deepEqual(called, ['sprintPlan']);
  });

  it('--mode sprint ignores --level', async () => {
    const called: string[] = [];
    await canonicalPlan('goal', { mode: 'sprint', level: 'deep', _fns: makePlanFns(called) });
    assert.deepEqual(called, ['sprintPlan']);
  });
});

describe('canonicalPlan — --mode define-done', () => {
  it('dispatches to defineDone and returns immediately', async () => {
    const called: string[] = [];
    await canonicalPlan(undefined, { mode: 'define-done', _fns: makePlanFns(called) });
    assert.deepEqual(called, ['defineDone']);
  });
});

describe('canonicalPlan — standard includes auto-critique', () => {
  it('runs critique after plan by default', async () => {
    const called: string[] = [];
    await canonicalPlan(undefined, { level: 'standard', _fns: makePlanFns(called) });
    assert.ok(called.includes('critique'), 'critique should be in standard pipeline');
    assert.ok(called.indexOf('critique') > called.indexOf('plan'), 'critique runs after plan');
  });

  it('--skip-critique bypasses critique gate', async () => {
    const called: string[] = [];
    await canonicalPlan(undefined, { level: 'standard', skipCritique: true, _fns: makePlanFns(called) });
    assert.ok(!called.includes('critique'), 'critique should be skipped');
    assert.ok(called.includes('plan'), 'plan should still run');
  });
});

describe('canonicalPlan — deep includes critique + techDecide + tasks', () => {
  it('runs full pipeline in order', async () => {
    const called: string[] = [];
    await canonicalPlan(undefined, { level: 'deep', _fns: makePlanFns(called) });
    assert.deepEqual(called, ['constitution', 'clarify', 'plan', 'critique', 'techDecide', 'tasks']);
  });
});
