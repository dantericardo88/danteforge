import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issuesToWeaknessSignals } from '../src/core/competitor-intel-fetcher.js';
import { intelToDemandSignals } from '../src/core/harvest-to-signals.js';

// The temporal-gate DATA PATH: a real GitHub issue's filing date (created_at) must flow all the way to a demand
// signal's demand_created_at, so the enforced anti-fabrication gate (checkHarvestProvenance + demand-temporal) can
// verify the demand pre-dates the build.

test('issue created_at flows through WeaknessSignal.createdAt to demand_created_at', () => {
  const issues = [{
    title: 'Add a configurable timeout',
    body: 'feature request: please add X so that Y',
    html_url: 'https://github.com/o/r/issues/1',
    created_at: '2026-06-01T00:00:00Z',
    reactions: { '+1': 5, total_count: 7 },
  }];
  const wsigs = issuesToWeaknessSignals(issues, 'sometool');
  assert.ok(wsigs.length >= 1, 'an issue with reactions is captured');
  assert.equal(wsigs[0]!.createdAt, '2026-06-01T00:00:00Z', 'fetcher captures the real filing date (not just foundAt)');

  const dim = wsigs[0]!.category;
  const demand = intelToDemandSignals({ signals: wsigs } as Parameters<typeof intelToDemandSignals>[0], dim, { minDemand: 0 });
  assert.ok(demand.length >= 1, 'maps to a demand signal');
  assert.equal(demand[0]!.demand_created_at, '2026-06-01T00:00:00Z', 'the filing date reaches demand_created_at');
});

test('a captured demand signal has both fetched_at (when found) and demand_created_at (when filed)', () => {
  const wsigs = issuesToWeaknessSignals(
    [{ title: 'bug: broken thing', body: 'this fails', html_url: 'https://github.com/o/r/issues/2', created_at: '2026-05-15T00:00:00Z', reactions: { '+1': 4, total_count: 4 } }],
    't',
  );
  const demand = intelToDemandSignals({ signals: wsigs } as Parameters<typeof intelToDemandSignals>[0], wsigs[0]!.category, { minDemand: 0 });
  assert.ok(demand[0]!.fetched_at, 'fetched_at is set (when harvested)');
  assert.equal(demand[0]!.demand_created_at, '2026-05-15T00:00:00Z', 'demand_created_at is the issue filing date');
  assert.notEqual(demand[0]!.fetched_at, demand[0]!.demand_created_at, 'the two timestamps are distinct');
});
