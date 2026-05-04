// canonical-harvest.test.ts — Blade Group 6: harvest enhancements
// Tests: --optimize dispatches to autoresearch (ignores --level),
//        existing deep/standard/light dispatch still correct with new fn shape

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalHarvest } from '../src/cli/commands/canonical.js';

function makeHarvestFns(called: string[]) {
  return {
    harvestPattern: async (p: string) => { called.push('pattern:' + p); },
    harvestLite: async () => { called.push('harvestLite'); },
    ossStandard: async () => { called.push('ossStandard'); },
    localHarvestStandard: async () => { called.push('localHarvestStandard'); },
    ossDeep: async () => { called.push('ossDeep'); },
    localHarvestDeep: async () => { called.push('localHarvestDeep'); },
    universeRefresh: async () => { called.push('universeRefresh'); return { featureCount: 0 }; },
    autoresearch: async (m: string) => { called.push('autoresearch:' + m); },
  };
}

describe('canonicalHarvest — --optimize', () => {
  it('dispatches to autoresearch with metric name', async () => {
    const called: string[] = [];
    await canonicalHarvest(undefined, { optimize: 'testing', _fns: makeHarvestFns(called) });
    assert.deepEqual(called, ['autoresearch:testing']);
  });

  it('--optimize ignores --level', async () => {
    const called: string[] = [];
    await canonicalHarvest(undefined, { optimize: 'security', level: 'deep', _fns: makeHarvestFns(called) });
    assert.deepEqual(called, ['autoresearch:security']);
  });

  it('--optimize works with a goal arg', async () => {
    const called: string[] = [];
    await canonicalHarvest('myGoal', { optimize: 'performance', _fns: makeHarvestFns(called) });
    assert.deepEqual(called, ['autoresearch:performance']);
  });
});

describe('canonicalHarvest — existing dispatch unaffected', () => {
  it('deep still runs ossDeep+universeRefresh without --optimize', async () => {
    const called: string[] = [];
    await canonicalHarvest(undefined, { level: 'deep', _fns: makeHarvestFns(called) });
    assert.ok(called.includes('ossDeep'));
    assert.ok(called.includes('universeRefresh'));
    assert.ok(!called.includes('autoresearch:undefined'));
  });
});
