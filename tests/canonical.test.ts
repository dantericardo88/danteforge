// canonical.test.ts — unit tests for canonical process dispatchers
// Tests all 5 dispatchers (plan, build, measure, compete, harvest) using _fns injection.
// No real LLM calls, no filesystem access.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveLevel,
  canonicalPlan,
  canonicalBuild,
  canonicalMeasure,
  canonicalCompete,
  canonicalHarvest,
} from '../src/cli/commands/canonical.js';

// ── resolveLevel ─────────────────────────────────────────────────────────────

describe('resolveLevel', () => {
  it('returns light for light', () => { assert.equal(resolveLevel('light'), 'light'); });
  it('returns standard for standard', () => { assert.equal(resolveLevel('standard'), 'standard'); });
  it('returns deep for deep', () => { assert.equal(resolveLevel('deep'), 'deep'); });
  it('is case-insensitive', () => {
    assert.equal(resolveLevel('LIGHT'), 'light');
    assert.equal(resolveLevel('DEEP'), 'deep');
  });
  it('unknown value falls back to standard', () => { assert.equal(resolveLevel('bad'), 'standard'); });
  it('undefined falls back to standard', () => { assert.equal(resolveLevel(undefined), 'standard'); });
  it('respects custom fallback', () => {
    assert.equal(resolveLevel(undefined, 'light'), 'light');
    assert.equal(resolveLevel('bad', 'deep'), 'deep');
  });
});

// ── canonicalPlan ─────────────────────────────────────────────────────────────

describe('canonicalPlan: light — goal calls specify', () => {
  it('calls specify with goal', async () => {
    const called: string[] = [];
    await canonicalPlan('myGoal', {
      level: 'light',
      _fns: {
        review: async () => { called.push('review'); },
        specify: async (g) => { called.push('specify:' + g); },
        constitution: async () => { called.push('constitution'); },
        clarify: async () => { called.push('clarify'); },
        plan: async () => { called.push('plan'); },
        techDecide: async () => { called.push('techDecide'); },
        tasks: async () => { called.push('tasks'); },
      },
    });
    assert.deepEqual(called, ['specify:myGoal']);
  });
});

describe('canonicalPlan: light — no goal calls review', () => {
  it('calls review when no goal', async () => {
    const called: string[] = [];
    await canonicalPlan(undefined, {
      level: 'light',
      _fns: {
        review: async () => { called.push('review'); },
        specify: async () => { called.push('specify'); },
        constitution: async () => { called.push('constitution'); },
        clarify: async () => { called.push('clarify'); },
        plan: async () => { called.push('plan'); },
        techDecide: async () => { called.push('techDecide'); },
        tasks: async () => { called.push('tasks'); },
      },
    });
    assert.deepEqual(called, ['review']);
  });
});

describe('canonicalPlan: standard — constitution+clarify+plan', () => {
  it('runs 3-step pipeline without goal', async () => {
    const called: string[] = [];
    await canonicalPlan(undefined, {
      level: 'standard',
      _fns: {
        review: async () => { called.push('review'); },
        specify: async () => { called.push('specify'); },
        constitution: async () => { called.push('constitution'); },
        clarify: async () => { called.push('clarify'); },
        plan: async () => { called.push('plan'); },
        techDecide: async () => { called.push('techDecide'); },
        tasks: async () => { called.push('tasks'); },
      },
    });
    assert.deepEqual(called, ['constitution', 'clarify', 'plan']);
  });

  it('inserts specify when goal given', async () => {
    const called: string[] = [];
    await canonicalPlan('g', {
      level: 'standard',
      _fns: {
        review: async () => { called.push('review'); },
        specify: async (x) => { called.push('specify:' + x); },
        constitution: async () => { called.push('constitution'); },
        clarify: async () => { called.push('clarify'); },
        plan: async () => { called.push('plan'); },
        techDecide: async () => { called.push('techDecide'); },
        tasks: async () => { called.push('tasks'); },
      },
    });
    assert.deepEqual(called, ['constitution', 'specify:g', 'clarify', 'plan']);
  });
});

describe('canonicalPlan: deep — full pipeline', () => {
  it('runs all 5 steps', async () => {
    const called: string[] = [];
    await canonicalPlan(undefined, {
      level: 'deep',
      _fns: {
        review: async () => { called.push('review'); },
        specify: async () => { called.push('specify'); },
        constitution: async () => { called.push('constitution'); },
        clarify: async () => { called.push('clarify'); },
        plan: async () => { called.push('plan'); },
        techDecide: async () => { called.push('techDecide'); },
        tasks: async () => { called.push('tasks'); },
      },
    });
    assert.deepEqual(called, ['constitution', 'clarify', 'plan', 'techDecide', 'tasks']);
  });
});

// ── canonicalBuild ────────────────────────────────────────────────────────────

describe('canonicalBuild: light', () => {
  it('calls forgeLight only', async () => {
    const called: string[] = [];
    await canonicalBuild('s', {
      level: 'light',
      _fns: {
        forgeLight: async () => { called.push('forgeLight'); },
        magicStandard: async () => { called.push('magicStandard'); },
        infernoDeep: async () => { called.push('infernoDeep'); },
      },
    });
    assert.deepEqual(called, ['forgeLight']);
  });
});

describe('canonicalBuild: standard', () => {
  it('calls magicStandard with goal', async () => {
    const called: string[] = [];
    await canonicalBuild('goal', {
      level: 'standard',
      _fns: {
        forgeLight: async () => { called.push('forgeLight'); },
        magicStandard: async (g) => { called.push('magic:' + g); },
        infernoDeep: async () => { called.push('infernoDeep'); },
      },
    });
    assert.deepEqual(called, ['magic:goal']);
  });
});

describe('canonicalBuild: deep', () => {
  it('calls infernoDeep with goal', async () => {
    const called: string[] = [];
    await canonicalBuild('big', {
      level: 'deep',
      _fns: {
        forgeLight: async () => { called.push('forgeLight'); },
        magicStandard: async () => { called.push('magicStandard'); },
        infernoDeep: async (g) => { called.push('inferno:' + g); },
      },
    });
    assert.deepEqual(called, ['inferno:big']);
  });

  it('passes undefined goal when none given', async () => {
    const goals: (string | undefined)[] = [];
    await canonicalBuild(undefined, {
      level: 'deep',
      _fns: {
        forgeLight: async () => {},
        magicStandard: async () => {},
        infernoDeep: async (g) => { goals.push(g); },
      },
    });
    assert.deepEqual(goals, [undefined]);
  });
});

// ── canonicalMeasure ──────────────────────────────────────────────────────────

describe('canonicalMeasure: light (default)', () => {
  it('calls score only', async () => {
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
        proof: async () => { called.push('proof'); },
        verify: async () => { called.push('verify'); },
      },
    });
    assert.deepEqual(called, ['score']);
  });
});

describe('canonicalMeasure: standard', () => {
  it('calls score+maturity+proof', async () => {
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

  it('does not call verify', async () => {
    const called: string[] = [];
    await canonicalMeasure({
      level: 'standard',
      _fns: {
        score: async () => {},
        maturity: async () => {},
        proof: async () => {},
        verify: async () => { called.push('verify'); },
      },
    });
    assert.deepEqual(called, []);
  });
});

describe('canonicalMeasure: deep', () => {
  it('calls verify+score+proof', async () => {
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

  it('continues even if verify throws', async () => {
    const called: string[] = [];
    await canonicalMeasure({
      level: 'deep',
      _fns: {
        score: async () => { called.push('score'); },
        maturity: async () => {},
        proof: async () => { called.push('proof'); },
        verify: async () => { throw new Error('fail'); },
      },
    });
    assert.ok(called.includes('score'), 'score should be called even after verify failure');
  });
});

// ── canonicalCompete ──────────────────────────────────────────────────────────

describe('canonicalCompete: light', () => {
  it('calls assess only', async () => {
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
});

describe('canonicalCompete: standard', () => {
  it('calls assess+universe', async () => {
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
});

describe('canonicalCompete: deep', () => {
  it('calls compete (full CHL loop) only', async () => {
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
});

// ── canonicalHarvest ──────────────────────────────────────────────────────────

function makeHarvestFns(called: string[]) {
  return {
    harvestPattern: async (p: string) => { called.push('pattern:' + p); },
    harvestLite: async () => { called.push('harvestLite'); },
    ossStandard: async () => { called.push('ossStandard'); },
    localHarvestStandard: async () => { called.push('localHarvestStandard'); },
    ossDeep: async () => { called.push('ossDeep'); },
    localHarvestDeep: async () => { called.push('localHarvestDeep'); },
    universeRefresh: async () => { called.push('universeRefresh'); return { featureCount: 0 }; },
  };
}

describe('canonicalHarvest: light', () => {
  it('calls harvestPattern when goal given', async () => {
    const called: string[] = [];
    await canonicalHarvest('pat', { level: 'light', _fns: makeHarvestFns(called) });
    assert.deepEqual(called, ['pattern:pat']);
  });

  it('calls harvestLite when no goal', async () => {
    const called: string[] = [];
    await canonicalHarvest(undefined, { level: 'light', _fns: makeHarvestFns(called) });
    assert.deepEqual(called, ['harvestLite']);
  });
});

describe('canonicalHarvest: standard', () => {
  it('calls ossStandard by default', async () => {
    const called: string[] = [];
    await canonicalHarvest(undefined, { level: 'standard', _fns: makeHarvestFns(called) });
    assert.deepEqual(called, ['ossStandard']);
  });

  it('calls localHarvestStandard when source=local', async () => {
    const called: string[] = [];
    await canonicalHarvest(undefined, { level: 'standard', source: 'local', _fns: makeHarvestFns(called) });
    assert.deepEqual(called, ['localHarvestStandard']);
  });
});

describe('canonicalHarvest: deep', () => {
  it('ossDeep+universeRefresh without local source', async () => {
    const called: string[] = [];
    await canonicalHarvest(undefined, { level: 'deep', _fns: makeHarvestFns(called) });
    assert.deepEqual(called, ['ossDeep', 'universeRefresh']);
  });

  it('ossDeep+localHarvestDeep+universeRefresh when source=local', async () => {
    const called: string[] = [];
    await canonicalHarvest(undefined, { level: 'deep', source: 'local', _fns: makeHarvestFns(called) });
    assert.deepEqual(called, ['ossDeep', 'localHarvestDeep', 'universeRefresh']);
  });
});

describe('canonicalHarvest: deep --until-saturation', () => {
  it('stops after two consecutive lean cycles', async () => {
    let ossCalls = 0;
    let cycle = 0;
    await canonicalHarvest(undefined, {
      level: 'deep',
      untilSaturation: true,
      maxCycles: 5,
      saturationThreshold: 3,
      _fns: {
        harvestPattern: async () => {},
        harvestLite: async () => {},
        ossStandard: async () => {},
        localHarvestStandard: async () => {},
        ossDeep: async () => { ossCalls++; },
        localHarvestDeep: async () => {},
        universeRefresh: async () => {
          cycle++;
          // cycle 1: total=5 (+5 productive), cycle 2: total=6 (+1 lean 1), cycle 3: total=7 (+1 lean 2 -> stop)
          const totals = [5, 6, 7, 17, 27];
          return { featureCount: totals[cycle - 1] ?? 7 };
        },
      },
    });
    assert.equal(ossCalls, 3, 'should stop at 3 cycles (2 lean cycles trigger saturation)');
  });

  it('stops at maxCycles when never saturated', async () => {
    let ossCalls = 0;
    let total = 0;
    await canonicalHarvest(undefined, {
      level: 'deep',
      untilSaturation: true,
      maxCycles: 3,
      saturationThreshold: 3,
      _fns: {
        harvestPattern: async () => {},
        harvestLite: async () => {},
        ossStandard: async () => {},
        localHarvestStandard: async () => {},
        ossDeep: async () => { ossCalls++; },
        localHarvestDeep: async () => {},
        universeRefresh: async () => { total += 10; return { featureCount: total }; },
      },
    });
    assert.equal(ossCalls, 3, 'should stop at maxCycles');
  });
});
