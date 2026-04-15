import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runFlow, WORKFLOWS } from '../src/cli/commands/flow.js';

describe('danteforge flow', () => {
  it('T1: returns all 5 workflows', async () => {
    const result = await runFlow({ _readState: async () => null, _writeOutput: () => {} });
    assert.strictEqual(result.workflows.length, 5);
  });

  it('T2: each workflow has steps and trigger', async () => {
    const result = await runFlow({ _readState: async () => null, _writeOutput: () => {} });
    for (const w of result.workflows) {
      assert.ok(Array.isArray(w.steps) && w.steps.length > 0, `${w.id} must have steps`);
      assert.ok(typeof w.trigger === 'string' && w.trigger.length > 0, `${w.id} must have trigger`);
      assert.ok(typeof w.label === 'string' && w.label.length > 0, `${w.id} must have label`);
    }
  });

  it('T3: WORKFLOWS constant contains 5 named workflows with expected IDs', () => {
    const ids = WORKFLOWS.map(w => w.id);
    assert.ok(ids.includes('daily-driver'), 'must have daily-driver workflow');
    assert.ok(ids.includes('oss-harvest'), 'must have oss-harvest workflow');
    assert.ok(ids.includes('multi-agent'), 'must have multi-agent workflow');
    assert.ok(ids.includes('spec-to-ship'), 'must have spec-to-ship workflow');
    assert.ok(ids.includes('competitive-leapfrog'), 'must have competitive-leapfrog workflow');
  });

  it('T4: correct workflow recommended for improve intent (has a current stage)', async () => {
    const stateYaml = 'workflowStage: verify\nproject: my-app\n';
    const result = await runFlow({
      _readState: async () => stateYaml,
      _writeOutput: () => {},
    });
    assert.strictEqual(result.currentStage, 'verify');
    assert.strictEqual(result.recommended, 'daily-driver');
  });

  it('T5: output is printable — no undefined fields in any workflow', async () => {
    for (const w of WORKFLOWS) {
      assert.notStrictEqual(w.id, undefined);
      assert.notStrictEqual(w.label, undefined);
      assert.notStrictEqual(w.trigger, undefined);
      assert.ok(Array.isArray(w.steps));
      for (const step of w.steps) {
        assert.ok(typeof step === 'string', `step in ${w.id} must be a string`);
      }
    }
  });

  it('T6: _writeOutput injection receives non-empty lines array', async () => {
    let captured: string[] = [];
    await runFlow({
      _readState: async () => null,
      _writeOutput: (lines) => { captured = lines; },
    });
    assert.ok(captured.length > 0, 'must write output lines');
    assert.ok(
      captured.some(l => l.includes('DanteForge')),
      'output must mention DanteForge'
    );
  });
});
