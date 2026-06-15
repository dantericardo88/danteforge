// Tests for Phase 6 v2: demand cluster → specify-ready spec with requester-sourced acceptance criteria.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpecFromCluster, formatSpecMarkdown } from '../src/core/demand-to-spec.js';
import type { DemandCluster, DemandIssue } from '../src/core/demand-harvest-cluster.js';
import { demandSpecCli } from '../src/cli/commands/demand-spec-cmd.js';
import type { DemandBacklog } from '../src/core/demand-harvest.js';

function iss(over: Partial<DemandIssue>): DemandIssue {
  return { repo: 'o/r', number: 1, title: 't', body: '', labels: ['enhancement'], url: 'https://x/1', createdAt: '2026-06-10T00:00:00Z', ...over };
}
function cluster(over: Partial<DemandCluster> = {}): DemandCluster {
  return {
    theme: 'webhook / retry', keywords: ['webhook', 'retry'],
    issues: [iss({ number: 1 })],
    signals: { frequency: 0.6, recency: 0.9, specificity: 0.8, buildability: 0.85 },
    score: 8.2, ...over,
  };
}

describe('buildSpecFromCluster — acceptance criteria from the requesters\' own words', () => {
  it('mines criteria from issue bodies (Expected/should/so that/checkboxes), attributed to the issue', () => {
    const spec = buildSpecFromCluster(cluster({
      issues: [
        iss({ number: 11, url: 'https://x/11', body: 'Expected: webhooks should retry 3 times on 5xx.\nrandom prose.' }),
        iss({ number: 12, url: 'https://x/12', body: '- [ ] sign the payload so that consumers can verify it' }),
      ],
    }));
    assert.ok(spec.acceptanceCriteria.length >= 2);
    assert.ok(spec.acceptanceCriteria.some(c => /retry 3 times/i.test(c.text) && c.sourceIssue === 11));
    assert.ok(spec.acceptanceCriteria.some(c => /sign the payload/i.test(c.text) && c.sourceIssue === 12));
  });

  it('falls back to a "Support: <title>" criterion for an ask with no explicit criterion', () => {
    const spec = buildSpecFromCluster(cluster({ issues: [iss({ number: 5, title: 'SQLite export', body: 'pls' })] }));
    assert.ok(spec.acceptanceCriteria.some(c => /Support: SQLite export/.test(c.text) && c.sourceIssue === 5));
  });

  it('dedups identical criteria and caps the list', () => {
    const dupes = Array.from({ length: 12 }, (_, i) => iss({ number: i, url: `https://x/${i}`, body: 'Expected: it should export to CSV.' }));
    const spec = buildSpecFromCluster(cluster({ issues: dupes }), 8);
    const csv = spec.acceptanceCriteria.filter(c => /export to csv/i.test(c.text));
    assert.equal(csv.length, 1, 'identical criteria deduped');
    assert.ok(spec.acceptanceCriteria.length <= 8, 'capped at maxCriteria');
  });

  it('carries external-demand provenance (score, ask count, issue URLs)', () => {
    const spec = buildSpecFromCluster(cluster({ score: 9.1, issues: [iss({ number: 1, url: 'https://x/1' }), iss({ number: 2, url: 'https://x/2' })] }));
    assert.equal(spec.provenance.demandScore, 9.1);
    assert.equal(spec.provenance.askCount, 2);
    assert.deepEqual(spec.provenance.issues.map(i => i.url), ['https://x/1', 'https://x/2']);
  });

  it('the markdown is specify-ready: objective, checkboxed criteria, provenance, handoff', () => {
    const md = formatSpecMarkdown(buildSpecFromCluster(cluster({ issues: [iss({ body: 'Expected: should work' })] })));
    assert.match(md, /## Objective/);
    assert.match(md, /## Acceptance criteria/);
    assert.match(md, /- \[ \]/);
    assert.match(md, /External-demand provenance/);
    assert.match(md, /danteforge specify/);
    assert.match(md, /external_demand/);
  });
});

describe('demandSpecCli — reads the saved backlog (offline)', () => {
  const backlog: DemandBacklog = {
    generatedAt: '2026-06-15T00:00:00Z', sources: ['o/r'], labelsQueried: ['enhancement'], totalIssues: 3,
    clusters: [
      cluster({ theme: 'top theme', score: 9.0, issues: [iss({ number: 1, body: 'Expected: should be fast' })] }),
      cluster({ theme: 'second theme', score: 5.0, issues: [iss({ number: 2 })] }),
    ],
  };

  it('specs the top cluster by default (rank 1)', async () => {
    const spec = await demandSpecCli({ _readBacklog: async () => JSON.stringify(backlog) });
    assert.ok(spec);
    assert.equal(spec!.title, 'Demand: top theme');
  });

  it('honors --rank to pick a lower cluster', async () => {
    const spec = await demandSpecCli({ rank: '2', _readBacklog: async () => JSON.stringify(backlog) });
    assert.equal(spec!.title, 'Demand: second theme');
  });

  it('returns null (no throw) when the backlog is missing', async () => {
    const spec = await demandSpecCli({ _readBacklog: async () => { throw new Error('ENOENT'); } });
    assert.equal(spec, null);
  });

  it('returns null when --rank exceeds the cluster count', async () => {
    const spec = await demandSpecCli({ rank: '99', _readBacklog: async () => JSON.stringify(backlog) });
    assert.equal(spec, null);
  });
});
