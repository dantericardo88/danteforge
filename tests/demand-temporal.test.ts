import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demandPredatesArtifact, latestDemandDate, demandClusterPredatesArtifact } from '../src/core/demand-temporal.js';

test('demandPredatesArtifact: demand BEFORE the build grounds it; demand AT/AFTER does not', () => {
  assert.equal(demandPredatesArtifact('2026-06-01T00:00:00Z', '2026-06-10T00:00:00Z').ok, true);
  const after = demandPredatesArtifact('2026-06-15T00:00:00Z', '2026-06-10T00:00:00Z');
  assert.equal(after.ok, false);
  assert.match(after.reason, /post-hoc/);
  // equal timestamps are NOT strictly before → fail (can't have been demanded before it existed)
  assert.equal(demandPredatesArtifact('2026-06-10T00:00:00Z', '2026-06-10T00:00:00Z').ok, false);
});

test('demandPredatesArtifact: FAIL-CLOSED on unparseable/missing dates', () => {
  assert.equal(demandPredatesArtifact(undefined, '2026-06-10T00:00:00Z').ok, false);
  assert.equal(demandPredatesArtifact('2026-06-01T00:00:00Z', undefined).ok, false);
  assert.equal(demandPredatesArtifact('not a date', '2026-06-10T00:00:00Z').ok, false);
});

test('latestDemandDate returns the most recent parseable date (the binding one), ignores junk', () => {
  assert.equal(
    latestDemandDate(['2026-06-01T00:00:00Z', 'junk', '2026-06-05T00:00:00Z', undefined]),
    '2026-06-05T00:00:00Z',
  );
  assert.equal(latestDemandDate(['junk', undefined]), undefined);
});

test('demandClusterPredatesArtifact: the WHOLE cluster must predate the build (latest is binding)', () => {
  // all before → ok
  assert.equal(demandClusterPredatesArtifact(['2026-06-01T00:00:00Z', '2026-06-05T00:00:00Z'], '2026-06-10T00:00:00Z').ok, true);
  // one filed AFTER the build → the cluster fails (post-hoc demand snuck in)
  assert.equal(demandClusterPredatesArtifact(['2026-06-01T00:00:00Z', '2026-06-12T00:00:00Z'], '2026-06-10T00:00:00Z').ok, false);
  // no parseable dates → fail-closed
  assert.equal(demandClusterPredatesArtifact(['junk', undefined], '2026-06-10T00:00:00Z').ok, false);
});
