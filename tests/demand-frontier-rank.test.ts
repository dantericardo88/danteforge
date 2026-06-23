import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scoreCluster,
  rankForFrontierBinding,
  frontierBindingLaunderingWarning,
  type DemandCluster,
  type DemandIssue,
} from '../src/core/demand-harvest-cluster.js';

const NOW = Date.parse('2026-06-23T00:00:00Z');
function iss(over: Partial<DemandIssue> = {}): DemandIssue {
  return { repo: 'o/r', number: 1, title: 'Add a configurable timeout', body: 'feature request: please add X so that Y can happen', labels: ['enhancement'], url: 'https://gh/1', createdAt: '2026-06-20T00:00:00Z', ...over };
}

test('scoreCluster always sets a frontierScore in [0,10]', () => {
  const c = scoreCluster({ theme: 't', keywords: ['t'], issues: [iss(), iss({ number: 2 }), iss({ number: 3 })], signals: { frequency: 0, recency: 0, specificity: 0, buildability: 0 }, score: 0 }, NOW);
  assert.equal(typeof c.frontierScore, 'number');
  assert.ok(c.frontierScore! >= 0 && c.frontierScore! <= 10);
});

function cl(theme: string, frontierScore: number, buildability: number): DemandCluster {
  return { theme, keywords: [], issues: [], signals: { frequency: 0, recency: 0, specificity: 0, buildability }, score: 0, frontierScore };
}

test('frontierBindingLaunderingWarning flags a more-buildable-but-less-wanted binding', () => {
  const clusters = [cl('most-wanted', 8.0, 0.1), cl('most-buildable', 5.0, 0.9)];
  const w = frontierBindingLaunderingWarning(clusters, 'most-buildable');
  assert.ok(w && /selection-laundering/.test(w), `expected a warning, got: ${w}`);
});

test('frontierBindingLaunderingWarning clears when the bound demand IS the most-wanted', () => {
  const clusters = [cl('most-wanted', 8.0, 0.1), cl('most-buildable', 5.0, 0.9)];
  assert.equal(frontierBindingLaunderingWarning(clusters, 'most-wanted'), null);
});

test('rankForFrontierBinding orders by frontierScore (wanted), independent of buildability', () => {
  // two themes, one with more distinct asks (higher frequency → higher frontierScore)
  const issues: DemandIssue[] = [
    iss({ number: 1, title: 'alpha stable identity', body: 'alpha alpha alpha need stable identity' }),
    iss({ number: 2, title: 'alpha stable identity again', body: 'alpha alpha need stable identity' }),
    iss({ number: 3, title: 'alpha identity third', body: 'alpha need stable identity' }),
    iss({ number: 4, title: 'beta one-off ask', body: 'beta single request' }),
  ];
  const ranked = rankForFrontierBinding(issues, NOW);
  assert.ok(ranked.length >= 1);
  assert.ok((ranked[0]!.frontierScore ?? 0) >= (ranked[ranked.length - 1]!.frontierScore ?? 0));
});
