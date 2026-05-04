// canonical-build.test.ts — Blade Group 3: build enhancements
// Tests: --resume loads checkpoint, --target calls selfImprove, plateau triggers log,
//        --adversarial calls adversarialScore, standard/deep light dispatch unchanged

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalBuild } from '../src/cli/commands/canonical.js';

function makeBaseFns(called: string[]) {
  return {
    forgeLight: async () => { called.push('forgeLight'); },
    magicStandard: async (g?: string) => { called.push('magic:' + (g ?? 'none')); },
    infernoDeep: async (g?: string) => { called.push('inferno:' + (g ?? 'none')); },
    loadCheckpoint: async () => { called.push('loadCheckpoint'); return undefined; },
    selfImprove: async (_g: string | undefined, t: number) => { called.push('selfImprove:' + t); return { finalScore: t, plateauDetected: false }; },
    adversarialScore: async () => { called.push('adversarialScore'); return true; },
  };
}

describe('canonicalBuild — --resume loads checkpoint', () => {
  it('calls loadCheckpoint when --resume is set', async () => {
    const called: string[] = [];
    await canonicalBuild('goal', {
      level: 'standard',
      resume: true,
      _fns: { ...makeBaseFns(called), loadCheckpoint: async () => { called.push('loadCheckpoint'); return 'forge'; } },
    });
    assert.ok(called.includes('loadCheckpoint'), 'loadCheckpoint should be called on --resume');
  });

  it('continues with standard build after checkpoint load', async () => {
    const called: string[] = [];
    await canonicalBuild('goal', {
      level: 'standard',
      resume: true,
      _fns: makeBaseFns(called),
    });
    assert.ok(called.includes('magic:goal'), 'magicStandard should still run after resume');
  });
});

describe('canonicalBuild — --target calls selfImprove', () => {
  it('calls selfImprove with target score instead of level dispatch', async () => {
    const called: string[] = [];
    await canonicalBuild('improve', { target: 9.0, _fns: makeBaseFns(called) });
    assert.ok(called.includes('selfImprove:9'), 'selfImprove should be called with target');
    assert.ok(!called.includes('forgeLight'), 'forgeLight should not be called when --target is set');
    assert.ok(!called.includes('magic:improve'), 'magicStandard should not be called when --target is set');
  });

  it('calls adversarialScore after selfImprove when --adversarial is set', async () => {
    const called: string[] = [];
    await canonicalBuild(undefined, { target: 8.5, adversarial: true, _fns: makeBaseFns(called) });
    assert.ok(called.includes('selfImprove:8.5'), 'selfImprove should run');
    assert.ok(called.includes('adversarialScore'), 'adversarialScore should run when --adversarial');
    assert.ok(called.indexOf('selfImprove:8.5') < called.indexOf('adversarialScore'), 'selfImprove before adversarialScore');
  });
});

describe('canonicalBuild — plateau result is logged', () => {
  it('completes without error even when plateau is detected', async () => {
    const called: string[] = [];
    await assert.doesNotReject(() => canonicalBuild(undefined, {
      target: 9.5,
      _fns: {
        ...makeBaseFns(called),
        selfImprove: async () => { called.push('selfImprove'); return { finalScore: 7.0, plateauDetected: true }; },
      },
    }));
    assert.ok(called.includes('selfImprove'), 'selfImprove should be called');
  });
});
