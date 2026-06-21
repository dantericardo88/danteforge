// Phase 0.2: the demand-signal taxonomy must be matrix-dim-ids end-to-end. The fetchers previously set
// WeaknessSignal.category to a human LABEL while intelToDemandSignals filters by dim id — so demand
// signals never reached their dimension. These pins lock the contract: category IS a matrix dim id.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreOpportunities, issuesToWeaknessSignals, type WeaknessSignal, type IntelReport } from '../src/core/competitor-intel-fetcher.ts';
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

test('CH-048: a rate-limit/error OBJECT response yields [] (never a "not iterable" crash)', () => {
  // GitHub returns {message:"API rate limit exceeded"} (an object, not an array) when unauthenticated.
  assert.deepEqual(issuesToWeaknessSignals({ message: 'API rate limit exceeded' }, 'Aider'), []);
  assert.deepEqual(issuesToWeaknessSignals(null, 'Aider'), []);
  assert.deepEqual(issuesToWeaknessSignals(undefined, 'Aider'), []);
});

test('CH-048: a real issues ARRAY still produces signals (the guard does not break the happy path)', () => {
  const signals = issuesToWeaknessSignals(
    [{ title: 'crash when running', body: 'it fails every time', html_url: 'https://gh/1', reactions: { '+1': 5, total_count: 8 } }],
    'Aider',
  );
  assert.equal(signals.length, 1);
  assert.equal(signals[0]!.tool, 'Aider');
  assert.equal(signals[0]!.demandScore, 5 + 8 * 0.5);
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
