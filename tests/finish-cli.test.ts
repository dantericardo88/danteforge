import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runFinishCli } from '../src/cli/commands/finish.js';
import type { loadMatrix } from '../src/core/compete-matrix.js';
import type { runGapCli } from '../src/cli/commands/gap.js';

function fakeMatrix(dims: Array<{ id: string; evidenceRef?: string }>): typeof loadMatrix {
  return (async () => ({
    dimensions: dims.map(d => ({
      id: d.id,
      frontier_spec: d.evidenceRef ? { leader_target: { evidence_ref: d.evidenceRef } } : undefined,
    })),
  })) as unknown as typeof loadMatrix;
}
function fakeGap(scores: Record<string, number>): typeof runGapCli {
  return (async () => ({
    dimensions: Object.entries(scores).map(([dimensionId, currentScore]) => ({ dimensionId, currentScore })),
  })) as unknown as typeof runGapCli;
}

test('finish: market dim FINISHED at 5.0; no-demand dim FINISHED at 8.0; no-demand at 7.0 not', async () => {
  const r = await runFinishCli({
    json: true, _harvestAttempted: true,
    _loadMatrix: fakeMatrix([{ id: 'token_economy' }, { id: 'functionality' }, { id: 'security' }]),
    _runGap: fakeGap({ token_economy: 5.0, functionality: 8.0, security: 7.0 }),
  });
  const byId = Object.fromEntries(r.perDim.map(d => [d.dimId, d]));
  assert.equal(byId['token_economy']!.finished, true);
  assert.equal(byId['token_economy']!.target, 5.0);
  assert.equal(byId['functionality']!.finished, true);
  assert.equal(byId['functionality']!.target, 8.0);
  assert.equal(byId['security']!.finished, false);
  assert.equal(byId['security']!.gap, 1.0);
  assert.equal(r.finished, false);
});

test('finish: a DEMAND-grounded dim targets 9.0 — not finished at 8.0', async () => {
  const r = await runFinishCli({
    json: true, _harvestAttempted: true,
    _loadMatrix: fakeMatrix([{ id: 'ecosystem_mcp', evidenceRef: 'harvest-demand:org/repo#1' }]),
    _runGap: fakeGap({ ecosystem_mcp: 8.0 }),
  });
  assert.equal(r.perDim[0]!.target, 9.0);
  assert.equal(r.perDim[0]!.profile, 'demand-frontier');
  assert.equal(r.perDim[0]!.finished, false);
});

test('finish: a no-demand dim at 8.0 WITHOUT a harvest is unobserved → project NOT finished', async () => {
  const r = await runFinishCli({
    json: true, _harvestAttempted: false,
    _loadMatrix: fakeMatrix([{ id: 'functionality' }]),
    _runGap: fakeGap({ functionality: 8.0 }),
  });
  assert.equal(r.perDim[0]!.unobservedNoDemand, true);
  assert.equal(r.finished, false);
});

test('finish: all dims at their honest ceiling + harvested → PROJECT FINISHED', async () => {
  const r = await runFinishCli({
    json: true, _harvestAttempted: true,
    _loadMatrix: fakeMatrix([{ id: 'token_economy' }, { id: 'functionality' }]),
    _runGap: fakeGap({ token_economy: 5.0, functionality: 8.0 }),
  });
  assert.equal(r.finished, true);
  assert.equal(r.doneCount, 2);
});
