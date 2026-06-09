import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sensitivityProbe, verifyDimYardstick, type SensitivityProbeOptions } from '../src/matrix/engines/capability-test-sensitivity.js';

/** A runner that returns `baseline` on the first call and `faulted` on the second. */
function runner(baseline: number, faulted: number): SensitivityProbeOptions['_run'] {
  let n = 0;
  return async () => (n++ === 0 ? baseline : faulted);
}

function base(over: Partial<SensitivityProbeOptions> = {}): SensitivityProbeOptions {
  const writes: Array<[string, string]> = [];
  return {
    cwd: '/x', command: 'npx tsx --test tests/x.test.ts', callsite: 'src/foo.ts',
    _readFile: async () => 'ORIGINAL SOURCE',
    _writeFile: async (p, c) => { writes.push([p, c]); },
    // expose writes for assertions
    ...({ writes } as object),
    ...over,
  };
}

describe('sensitivityProbe — break the callsite, a real test must flip', () => {
  test('GENUINE: baseline green, faulted fails (the test depends on the production code)', async () => {
    const r = await sensitivityProbe(base({ _run: runner(0, 1) }));
    assert.equal(r.verdict, 'GENUINE');
    assert.equal(r.baselineExit, 0);
    assert.equal(r.faultedExit, 1);
  });

  test('STUB: baseline green, faulted STILL green (invariant to the code → decoupled / self-fulfilling)', async () => {
    const r = await sensitivityProbe(base({ _run: runner(0, 0) }));
    assert.equal(r.verdict, 'STUB');
  });

  test('BASELINE_RED: a failing-on-HEAD yardstick has no green claim to verify', async () => {
    const r = await sensitivityProbe(base({ _run: runner(1, 1) }));
    assert.equal(r.verdict, 'BASELINE_RED');
  });

  test('INCONCLUSIVE for a pre-built dist product run (source fault cannot reach the bundle)', async () => {
    const r = await sensitivityProbe(base({ command: 'node dist/index.js gap security', _run: runner(0, 0) }));
    assert.equal(r.verdict, 'INCONCLUSIVE');
  });

  test('INCONCLUSIVE when there is no callsite to fault', async () => {
    const r = await sensitivityProbe(base({ callsite: '' }));
    assert.equal(r.verdict, 'INCONCLUSIVE');
  });

  test('always RESTORES the callsite file (working tree never left mutated)', async () => {
    const writes: Array<[string, string]> = [];
    await sensitivityProbe(base({
      _run: runner(0, 1),
      _writeFile: async (p, c) => { writes.push([p, c]); },
    }));
    // last write must restore the ORIGINAL content (not the faulted content)
    assert.equal(writes.at(-1)?.[1], 'ORIGINAL SOURCE');
    assert.match(writes[0]![1], /DANTE_SENSITIVITY_FAULT/); // the fault was applied first
  });
});

describe('verifyDimYardstick — bridge from a dim audit to the probe', () => {
  const runner = (b: number, f: number): SensitivityProbeOptions['_run'] => { let n = 0; return async () => (n++ === 0 ? b : f); };
  test('probes the dim command against its first wired callsite → GENUINE', async () => {
    const r = await verifyDimYardstick({ command: 'npx tsx --test t.test.ts', wiredCallsites: ['src/foo.ts'] }, '/x',
      { _run: runner(0, 1), _readFile: async () => 'X', _writeFile: async () => {} });
    assert.equal(r.verdict, 'GENUINE');
  });
  test('INCONCLUSIVE with no command or no wired callsite (dependence cannot be proven)', async () => {
    assert.equal((await verifyDimYardstick({ command: null, wiredCallsites: ['src/foo.ts'] }, '/x')).verdict, 'INCONCLUSIVE');
    assert.equal((await verifyDimYardstick({ command: 'npx tsx --test t.test.ts', wiredCallsites: [] }, '/x')).verdict, 'INCONCLUSIVE');
  });
});
