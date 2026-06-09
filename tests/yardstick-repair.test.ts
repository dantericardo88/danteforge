import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { repairStubYardstick } from '../src/matrix/engines/yardstick-repair.js';

function dim(capCmd: string | undefined, outcomes: Array<Record<string, unknown>> = []) {
  return { id: 'skill_plugin_system', capability_test: capCmd === undefined ? undefined : { command: capCmd }, outcomes };
}
const realOutcome = { id: 'o', kind: 'shell', tier: 'T5', command: 'npx vitest run src/registry.test.ts', required_callsite: 'packages/skill-adapter/src/index.ts' };

describe('repairStubYardstick — only repairs a stub MASKING a working capability (never relabels a broken dim)', () => {
  test('REPAIRS: stub capability_test FAILS + the real wired outcome PASSES → repoint to the real test', async () => {
    // runShell: the stub (.sh) exits 1; the real outcome exits 0.
    const runShell = async (cmd: string) => (/\.sh\b/.test(cmd) ? 1 : 0);
    const r = await repairStubYardstick(dim('bash .danteforge/capability-tests/skill_plugin_system.sh', [realOutcome]), '/x', runShell);
    assert.equal(r.repaired, true, r.reason);
    assert.equal(r.newCommand, realOutcome.command);
    assert.equal(r.callsite, realOutcome.required_callsite);
  });

  test('REFUSES: the real outcome also FAILS → a GENUINE gap, not a stub-block (never relabel a broken dim)', async () => {
    const runShell = async () => 1; // everything fails
    const r = await repairStubYardstick(dim('bash x.sh', [realOutcome]), '/x', runShell);
    assert.equal(r.repaired, false);
    assert.match(r.reason, /GENUINE capability gap/);
  });

  test('REFUSES: the capability_test already passes → not a stub-block', async () => {
    const runShell = async () => 0;
    const r = await repairStubYardstick(dim('node dist/index.js x', [realOutcome]), '/x', runShell);
    assert.equal(r.repaired, false);
    assert.match(r.reason, /already passes/);
  });

  test('REFUSES: no real wired outcome to point at → genuine gap, route to build', async () => {
    const runShell = async () => 1;
    const scaffold = { id: 'o', kind: 'shell', command: 'exit 1', required_callsite: null };
    const r = await repairStubYardstick(dim('bash x.sh', [scaffold]), '/x', runShell);
    assert.equal(r.repaired, false);
    assert.match(r.reason, /no real wired outcome/);
  });

  test('REFUSES: a test-file callsite is not production wiring', async () => {
    const runShell = async (cmd: string) => (/\.sh\b/.test(cmd) ? 1 : 0);
    const testCallsite = { id: 'o', kind: 'shell', command: 'npx vitest run x.test.ts', required_callsite: 'packages/x/src/registry.test.ts' };
    const r = await repairStubYardstick(dim('bash x.sh', [testCallsite]), '/x', runShell);
    assert.equal(r.repaired, false);
  });
});
