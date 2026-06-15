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
      // No stale sidecar in the normal case: the crash-safe journal reads <callsite>.df-probe-backup on
      // start and restores it if present. Return the source for the callsite, but signal "no sidecar" so
      // the spurious stale-restore doesn't fire (the original test predated the journaling feature).
      _readFile: async (p: string) => { if (p.endsWith('.df-probe-backup')) throw new Error('no sidecar'); return 'ORIGINAL SOURCE'; },
      _writeFile: async (p, c) => { writes.push([p, c]); },
    }));
    // The fault WAS applied at some point (into the callsite), and the LAST write restores the original —
    // so the working tree is never left mutated regardless of the journaling steps in between.
    // callsitePath is path.join(cwd, callsite) (absolute, platform separators) — match by suffix.
    const isCallsite = (p: string): boolean => p.endsWith('foo.ts'); // excludes the *.df-probe-backup sidecar
    const faultWrite = writes.find(([p, c]) => isCallsite(p) && /DANTE_SENSITIVITY_FAULT/.test(c));
    assert.ok(faultWrite, 'the fault marker was written into the callsite');
    const lastCallsiteWrite = [...writes].reverse().find(([p]) => isCallsite(p));
    assert.equal(lastCallsiteWrite?.[1], 'ORIGINAL SOURCE', 'the final callsite write restores the original');
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
