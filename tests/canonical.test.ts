// canonical.test.ts — unit tests for the five canonical process dispatchers
// Uses _fns injection seams; no LLM calls, no filesystem I/O, no network.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalPlan,
  canonicalBuild,
  canonicalMeasure,
  canonicalCompete,
  canonicalHarvest,
  resolveLevel,
} from '../src/cli/commands/canonical.js';

// ── resolveLevel ───────────────────────────────────────────────────────────────

describe('resolveLevel', () => {
  it('returns light for "light"', () => assert.equal(resolveLevel('light'), 'light'));
  it('returns standard for "standard"', () => assert.equal(resolveLevel('standard'), 'standard'));
  it('returns deep for "deep"', () => assert.equal(resolveLevel('deep'), 'deep'));
  it('is case-insensitive', () => assert.equal(resolveLevel('DEEP'), 'deep'));
  it('uses fallback for unknown value', () => assert.equal(resolveLevel('extreme', 'standard'), 'standard'));
  it('uses fallback for undefined', () => assert.equal(resolveLevel(undefined, 'light'), 'light'));
  it('default fallback is standard', () => assert.equal(resolveLevel(undefined), 'standard'));
});

// ── canonicalPlan ──────────────────────────────────────────────────────────────

describe('canonicalPlan', () => {
  it('light with goal calls specify only', async () => {
    const called: string[] = [];
    await canonicalPlan('my idea', {
      level: 'light',
      _fns: {
        specify: async () => { called.push('specify'); },
        review: async () => { called.push('review'); },
      },
    });
    assert.deepEqual(called, ['specify']);
  });

  it('light without goal calls review only', async () => {
    const called: string[] = [];
    await canonicalPlan(undefined, {
      level: 'light',
      _fns: {
        specify: async () => { called.push('specify'); },
        review: async () => { called.push('review'); },
      },
    });
    assert.deepEqual(called, ['review']);
  });

  it('standard calls constitution + specify + clarify + plan', async () => {
    const called: string[] = [];
    const stub = (name: string) => async () => { called.push(name); };
    await canonicalPlan('my idea', {
      level: 'standard',
      _fns: {
        constitution: stub('constitution'),
        specify: stub('specify'),
        clarify: stub('clarify'),
        plan: stub('plan'),
        techDecide: stub('techDecide'),
        tasks: stub('tasks'),
      },
    });
    assert.deepEqual(called, ['constitution', 'specify', 'clarify', 'plan']);
  });

  it('deep calls constitution + specify + clarify + plan + techDecide + tasks', async () => {
    const called: string[] = [];
    const stub = (name: string) => async () => { called.push(name); };
    await canonicalPlan('my idea', {
      level: 'deep',
      _fns: {
        constitution: stub('constitution'),
        specify: stub('specify'),
        clarify: stub('clarify'),
        plan: stub('plan'),
        techDecide: stub('techDecide'),
        tasks: stub('tasks'),
      },
    });
    assert.deepEqual(called, ['constitution', 'specify', 'clarify', 'plan', 'techDecide', 'tasks']);
  });

  it('standard without goal skips specify', async () => {
    const called: string[] = [];
    const stub = (name: string) => async () => { called.push(name); };
    await canonicalPlan(undefined, {
      level: 'standard',
      _fns: {
        constitution: stub('constitution'),
        specify: stub('specify'),
        clarify: stub('clarify'),
        plan: stub('plan'),
      },
    });
    assert.ok(!called.includes('specify'), 'specify should not be called when no goal provided');
  });

  it('defaults to standard when no level given', async () => {
    const called: string[] = [];
    await canonicalPlan('idea', {
      _fns: {
        constitution: async () => { called.push('constitution'); },
        specify: async () => { called.push('specify'); },
        clarify: async () => { called.push('clarify'); },
        plan: async () => { called.push('plan'); },
      },
    });
    assert.ok(called.includes('constitution'));
    assert.ok(!called.includes('techDecide'));
  });
});

// ── canonicalBuild ─────────────────────────────────────────────────────────────

describe('canonicalBuild', () => {
  it('light calls forgeLight', async () => {
    const called: string[] = [];
    await canonicalBuild('goal', {
      level: 'light',
      _fns: {
        forgeLight: async () => { called.push('forgeLight'); },
        magicStandard: async () => { called.push('magicStandard'); },
        infernoDeep: async () => { called.push('infernoDeep'); },
      },
    });
    assert.deepEqual(called, ['forgeLight']);
  });

  it('standard calls magicStandard', async () => {
    const called: string[] = [];
    await canonicalBuild('goal', {
      level: 'standard',
      _fns: {
        forgeLight: async () => { called.push('forgeLight'); },
        magicStandard: async () => { called.push('magicStandard'); },
        infernoDeep: async () => { called.push('infernoDeep'); },
      },
    });
    assert.deepEqual(called, ['magicStandard']);
  });

  it('deep calls infernoDeep', async () => {
    const called: string[] = [];
    await canonicalBuild('goal', {
      level: 'deep',
      _fns: {
        forgeLight: async () => { called.push('forgeLight'); },
        magicStandard: async () => { called.push('magicStandard'); },
        infernoDeep: async () => { called.push('infernoDeep'); },
      },
    });
    assert.deepEqual(called, ['infernoDeep']);
  });

  it('defaults to standard', async () => {
    const called: string[] = [];
    await canonicalBuild('goal', {
      _fns: {
        forgeLight: async () => { called.push('forgeLight'); },
        magicStandard: async () => { called.push('magicStandard'); },
        infernoDeep: async () => { called.push('infernoDeep'); },
      },
    });
    assert.deepEqual(called, ['magicStandard']);
  });

  it('passes goal to magicStandard', async () => {
    let receivedGoal: string | undefined;
    await canonicalBuild('my goal', {
      level: 'standard',
      _fns: {
        magicStandard: async (g) => { receivedGoal = g; },
      },
    });
    assert.equal(receivedGoal, 'my goal');
  });
});

// ── canonicalMeasure ───────────────────────────────────────────────────────────

describe('canonicalMeasure', () => {
  it('light (default) calls score only', async () => {
    const called: string[] = [];
    await canonicalMeasure({
      level: 'light',
      _fns: {
        score: async () => { called.push('score'); },
        maturity: async () => { called.push('maturity'); },
        proof: async () => { called.push('proof'); },
        verify: async () => { called.push('verify'); },
      },
    });
    assert.deepEqual(called, ['score']);
  });

  it('defaults to light when no level given', async () => {
    const called: string[] = [];
    await canonicalMeasure({
      _fns: {
        score: async () => { called.push('score'); },
        maturity: async () => { called.push('maturity'); },
      },
    });
    assert.deepEqual(called, ['score']);
  });

  it('standard calls score + maturity + proof', async () => {
    const called: string[] = [];
    await canonicalMeasure({
      level: 'standard',
      _fns: {
        score: async () => { called.push('score'); },
        maturity: async () => { called.push('maturity'); },
        proof: async () => { called.push('proof'); },
        verify: async () => { called.push('verify'); },
      },
    });
    assert.deepEqual(called, ['score', 'maturity', 'proof']);
  });

  it('deep calls verify + score + proof', async () => {
    const called: string[] = [];
    await canonicalMeasure({
      level: 'deep',
      _fns: {
        score: async () => { called.push('score'); },
        maturity: async () => { called.push('maturity'); },
        proof: async () => { called.push('proof'); },
        verify: async () => { called.push('verify'); },
      },
    });
    assert.deepEqual(called, ['verify', 'score', 'proof']);
  });

  it('deep continues when verify throws', async () => {
    const called: string[] = [];
    await canonicalMeasure({
      level: 'deep',
      _fns: {
        score: async () => { called.push('score'); },
        proof: async () => { called.push('proof'); },
        verify: async () => { throw new Error('verify failed'); },
      },
    });
    assert.ok(called.includes('score'), 'score should still run after verify failure');
  });

  it('standard continues when proof throws', async () => {
    const called: string[] = [];
    await canonicalMeasure({
      level: 'standard',
      _fns: {
        score: async () => { called.push('score'); },
        maturity: async () => { called.push('maturity'); },
        proof: async () => { throw new Error('proof failed'); },
      },
    });
    assert.deepEqual(called, ['score', 'maturity']);
  });
});

// ── canonicalCompete ───────────────────────────────────────────────────────────

describe('canonicalCompete', () => {
  it('light calls assess only', async () => {
    const called: string[] = [];
    await canonicalCompete({
      level: 'light',
      _fns: {
        assess: async () => { called.push('assess'); },
        universe: async () => { called.push('universe'); },
        compete: async () => { called.push('compete'); },
      },
    });
    assert.deepEqual(called, ['assess']);
  });

  it('standard calls assess + universe', async () => {
    const called: string[] = [];
    await canonicalCompete({
      level: 'standard',
      _fns: {
        assess: async () => { called.push('assess'); },
        universe: async () => { called.push('universe'); },
        compete: async () => { called.push('compete'); },
      },
    });
    assert.deepEqual(called, ['assess', 'universe']);
  });

  it('deep calls compete (full CHL loop)', async () => {
    const called: string[] = [];
    await canonicalCompete({
      level: 'deep',
      _fns: {
        assess: async () => { called.push('assess'); },
        universe: async () => { called.push('universe'); },
        compete: async () => { called.push('compete'); },
      },
    });
    assert.deepEqual(called, ['compete']);
  });

  it('defaults to standard', async () => {
    const called: string[] = [];
    await canonicalCompete({
      _fns: {
        assess: async () => { called.push('assess'); },
        universe: async () => { called.push('universe'); },
        compete: async () => { called.push('compete'); },
      },
    });
    assert.deepEqual(called, ['assess', 'universe']);
  });
});

// ── canonicalHarvest ───────────────────────────────────────────────────────────

describe('canonicalHarvest', () => {
  it('light with goal calls harvestPattern', async () => {
    const called: string[] = [];
    let capturedPattern = '';
    await canonicalHarvest('cli patterns', {
      level: 'light',
      _fns: {
        harvestPattern: async (p) => { called.push('harvestPattern'); capturedPattern = p; },
        harvestLite: async () => { called.push('harvestLite'); },
      },
    });
    assert.deepEqual(called, ['harvestPattern']);
    assert.equal(capturedPattern, 'cli patterns');
  });

  it('light without goal calls harvestLite', async () => {
    const called: string[] = [];
    await canonicalHarvest(undefined, {
      level: 'light',
      _fns: {
        harvestPattern: async () => { called.push('harvestPattern'); },
        harvestLite: async () => { called.push('harvestLite'); },
      },
    });
    assert.deepEqual(called, ['harvestLite']);
  });

  it('standard oss calls ossStandard', async () => {
    const called: string[] = [];
    await canonicalHarvest('topic', {
      level: 'standard',
      source: 'oss',
      _fns: {
        ossStandard: async () => { called.push('ossStandard'); },
        localHarvestStandard: async () => { called.push('localHarvestStandard'); },
      },
    });
    assert.deepEqual(called, ['ossStandard']);
  });

  it('standard local calls localHarvestStandard', async () => {
    const called: string[] = [];
    await canonicalHarvest(undefined, {
      level: 'standard',
      source: 'local',
      _fns: {
        ossStandard: async () => { called.push('ossStandard'); },
        localHarvestStandard: async () => { called.push('localHarvestStandard'); },
      },
    });
    assert.deepEqual(called, ['localHarvestStandard']);
  });

  it('deep oss calls ossDeep + universeRefresh', async () => {
    const called: string[] = [];
    await canonicalHarvest(undefined, {
      level: 'deep',
      source: 'oss',
      _fns: {
        ossDeep: async () => { called.push('ossDeep'); },
        localHarvestDeep: async () => { called.push('localHarvestDeep'); },
        universeRefresh: async () => { called.push('universeRefresh'); return { featureCount: 10 }; },
      },
    });
    assert.deepEqual(called, ['ossDeep', 'universeRefresh']);
  });

  it('deep mixed calls ossDeep + localHarvestDeep + universeRefresh', async () => {
    const called: string[] = [];
    await canonicalHarvest(undefined, {
      level: 'deep',
      source: 'mixed',
      _fns: {
        ossDeep: async () => { called.push('ossDeep'); },
        localHarvestDeep: async () => { called.push('localHarvestDeep'); },
        universeRefresh: async () => { called.push('universeRefresh'); return { featureCount: 10 }; },
      },
    });
    assert.deepEqual(called, ['ossDeep', 'localHarvestDeep', 'universeRefresh']);
  });
});

// ── canonicalHarvest --until-saturation ────────────────────────────────────────

describe('canonicalHarvest --until-saturation', () => {
  it('stops after 2 consecutive lean cycles', async () => {
    let cycle = 0;
    const ossCalls: number[] = [];
    const universeCalls: number[] = [];

    // Cycle 1: +5 features (rich), cycle 2: +1 (lean #1), cycle 3: +2 (lean #2 → stop)
    const featureCounts = [10, 11, 13];

    await canonicalHarvest(undefined, {
      level: 'deep',
      untilSaturation: true,
      saturationThreshold: 3,
      maxCycles: 10,
      _fns: {
        ossDeep: async () => { ossCalls.push(++cycle); },
        universeRefresh: async () => {
          const fc = featureCounts[universeCalls.length] ?? 13;
          universeCalls.push(fc);
          return { featureCount: fc };
        },
      },
    });

    assert.equal(ossCalls.length, 3, 'should run exactly 3 OSS cycles before saturation');
  });

  it('respects maxCycles cap', async () => {
    let ossCycles = 0;
    const featurePerCycle = 10;

    await canonicalHarvest(undefined, {
      level: 'deep',
      untilSaturation: true,
      saturationThreshold: 3,
      maxCycles: 2,
      _fns: {
        ossDeep: async () => { ossCycles++; },
        universeRefresh: async () => ({ featureCount: ossCycles * featurePerCycle }),
      },
    });

    assert.equal(ossCycles, 2, 'should respect maxCycles=2 cap');
  });

  it('resets lean counter when a rich cycle follows two lean cycles in progress', async () => {
    let ossCycles = 0;
    // lean (1), rich (reset), lean (1), lean (2) → stop at cycle 4
    const featureCounts = [2, 20, 1, 0];

    await canonicalHarvest(undefined, {
      level: 'deep',
      untilSaturation: true,
      saturationThreshold: 3,
      maxCycles: 10,
      _fns: {
        ossDeep: async () => { ossCycles++; },
        universeRefresh: async () => {
          const idx = ossCycles - 1;
          const fc = (featureCounts[idx] ?? 0) + (idx > 0 ? featureCounts.slice(0, idx).reduce((a, b) => a + b, 0) : 0);
          return { featureCount: fc };
        },
      },
    });

    assert.ok(ossCycles >= 3, `expected at least 3 cycles, got ${ossCycles}`);
  });
});
