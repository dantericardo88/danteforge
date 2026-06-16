// Phase 0.2: the demand-signal taxonomy must be matrix-dim-ids end-to-end. The fetchers previously set
// WeaknessSignal.category to a human LABEL while intelToDemandSignals filters by dim id — so demand
// signals never reached their dimension. These pins lock the contract: category IS a matrix dim id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreOpportunities, type WeaknessSignal, type IntelReport } from '../src/core/competitor-intel-fetcher.ts';
import { intelToDemandSignals } from '../src/core/harvest-to-signals.ts';

const sig = (category: string, demand: number): WeaknessSignal => ({
  tool: 'Aider', source: 'github-issues', title: `issue about ${category}`, snippet: 's',
  url: `https://gh/${category}/${demand}`, demandScore: demand, category, foundAt: '2026-06-16T00:00:00Z',
});

test('scoreOpportunities groups by the dim-id category and sets dimensionId = category (not functionality fallback)', () => {
  const opps = scoreOpportunities(
    [sig('performance', 40), sig('performance', 10), sig('testing', 20)],
    { performance: 3, testing: 1 },
  );
  const byDim = Object.fromEntries(opps.map(o => [o.dimensionId, o]));
  assert.ok(byDim['performance'], 'performance opportunity exists with the real dim id (not collapsed to functionality)');
  assert.ok(byDim['testing'], 'testing opportunity exists with the real dim id');
  assert.equal(byDim['performance']!.totalDemand, 50);
  assert.equal(byDim['performance']!.dimensionId, byDim['performance']!.category, 'dimensionId equals category (both the matrix dim id)');
});

test('a fetcher-shaped signal (category = matrix dim id) reaches its dimension via intelToDemandSignals', () => {
  const report: IntelReport = {
    generatedAt: '2026-06-16T00:00:00Z', opportunities: [],
    signals: [sig('performance', 30), sig('testing', 30)],
  };
  // The Phase 0.2 fix means category is the dim id, so the filter matches.
  assert.equal(intelToDemandSignals(report, 'performance', { minDemand: 5 }).length, 1);
  assert.equal(intelToDemandSignals(report, 'testing', { minDemand: 5 }).length, 1);
  assert.equal(intelToDemandSignals(report, 'security', { minDemand: 5 }).length, 0);
});
