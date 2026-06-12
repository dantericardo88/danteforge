// Pin: the rehearsal drive-through PASSES on the current coordination layer. If any invariant
// fails here, the coordination layer would burn live budget the same way — fix it BEFORE a run.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runAscendRehearsal } from '../src/cli/commands/ascend-rehearse.js';

describe('ascend-frontier --rehearse — full coordination drive-through (seam plan component 3)', () => {
  test('all invariants hold: honest termination, re-open, novelty ceiling, no spinning, scripted work layer', async () => {
    const report = await runAscendRehearsal({ json: false });
    for (const i of report.invariants) {
      assert.ok(i.ok, `${i.name}: ${i.detail}`);
    }
    assert.equal(report.ok, true);
    assert.equal(report.terminal, 'done');
  });
});
