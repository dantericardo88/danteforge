// Tests for the Phase 6 v1 demand harvester. The cluster/rank core is pure (deterministic, nowMs
// injected); the gh-CLI fetch is seamed so no network is touched.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractKeywords, clusterIssues, rankClusters, scoreCluster, type DemandIssue } from '../src/core/demand-harvest-cluster.js';
import { harvestDemand, fetchDemandIssues, formatBacklogMarkdown, type DemandExecRunner } from '../src/core/demand-harvest.js';
import { deriveReposFromMatrix } from '../src/cli/commands/harvest-demand-cmd.js';

const NOW = Date.parse('2026-06-15T00:00:00.000Z');
function daysAgo(d: number): string { return new Date(NOW - d * 86_400_000).toISOString(); }
function iss(over: Partial<DemandIssue>): DemandIssue {
  return { repo: 'o/r', number: 1, title: 't', body: '', labels: ['enhancement'], url: 'u', createdAt: daysAgo(1), ...over };
}

describe('extractKeywords', () => {
  it('drops stopwords, short tokens, and pure numbers; keeps meaningful terms', () => {
    const k = extractKeywords({ title: 'Add support for SQLite database backups', body: '' });
    assert.ok(k.includes('sqlite'));
    assert.ok(k.includes('database'));
    assert.ok(k.includes('backups'));
    assert.ok(!k.includes('add'));      // stopword
    assert.ok(!k.includes('for'));      // stopword
  });
});

describe('clusterIssues — groups by shared keyword, one cluster per issue', () => {
  it('two SQLite asks cluster together; an unrelated ask is its own cluster', () => {
    const issues = [
      iss({ number: 1, title: 'SQLite backup support' }),
      iss({ number: 2, title: 'Please add SQLite export' }),
      iss({ number: 3, title: 'Dark mode for the dashboard' }),
    ];
    const clusters = clusterIssues(issues);
    const sqlite = clusters.find(c => c.keywords.includes('sqlite'));
    assert.ok(sqlite, 'a sqlite cluster formed');
    assert.equal(sqlite!.issues.length, 2, 'both sqlite asks grouped');
    // every issue lands in exactly one cluster (no double counting)
    assert.equal(clusters.reduce((s, c) => s + c.issues.length, 0), 3);
  });
});

describe('scoreCluster — transparent signal model', () => {
  it('frequency saturates at 5 asks', () => {
    const five = Array.from({ length: 5 }, (_, i) => iss({ number: i, title: `sqlite ask ${i}` }));
    const c = scoreCluster({ theme: 'sqlite', keywords: ['sqlite'], issues: five, signals: { frequency: 0, recency: 0, specificity: 0, buildability: 0 }, score: 0 }, NOW);
    assert.equal(c.signals.frequency, 1);
  });
  it('recency decays with age; a fresh ask scores higher than a year-old one', () => {
    const fresh = scoreCluster({ theme: 'x', keywords: ['x'], issues: [iss({ createdAt: daysAgo(1) })], signals: { frequency: 0, recency: 0, specificity: 0, buildability: 0 }, score: 0 }, NOW);
    const old = scoreCluster({ theme: 'x', keywords: ['x'], issues: [iss({ createdAt: daysAgo(360) })], signals: { frequency: 0, recency: 0, specificity: 0, buildability: 0 }, score: 0 }, NOW);
    assert.ok(fresh.signals.recency > old.signals.recency);
  });
  it('a question/discussion scores lower buildability than a labeled feature ask', () => {
    const feature = scoreCluster({ theme: 'x', keywords: ['x'], issues: [iss({ labels: ['enhancement'], title: 'Add X' })], signals: { frequency: 0, recency: 0, specificity: 0, buildability: 0 }, score: 0 }, NOW);
    const question = scoreCluster({ theme: 'x', keywords: ['x'], issues: [iss({ labels: ['question'], title: 'How do I X?' })], signals: { frequency: 0, recency: 0, specificity: 0, buildability: 0 }, score: 0 }, NOW);
    assert.ok(feature.signals.buildability > question.signals.buildability);
  });
  it('an ask with an acceptance criterion scores higher specificity', () => {
    const specific = scoreCluster({ theme: 'x', keywords: ['x'], issues: [iss({ body: 'Expected: the CLI should export to CSV.\n```\ndanteforge export --csv\n```\nSo that downstream tools can read it.' })], signals: { frequency: 0, recency: 0, specificity: 0, buildability: 0 }, score: 0 }, NOW);
    const vague = scoreCluster({ theme: 'x', keywords: ['x'], issues: [iss({ body: 'would be nice' })], signals: { frequency: 0, recency: 0, specificity: 0, buildability: 0 }, score: 0 }, NOW);
    assert.ok(specific.signals.specificity > vague.signals.specificity);
  });
});

describe('rankClusters — highest demand first', () => {
  it('a frequent + fresh + specific theme out-ranks a single vague stale one', () => {
    const issues = [
      ...Array.from({ length: 4 }, (_, i) => iss({ number: i, title: `webhook integration retry ${i}`, labels: ['enhancement'], body: 'Expected: webhooks should retry. Steps to reproduce included.', createdAt: daysAgo(5) })),
      iss({ number: 99, title: 'maybe telemetry someday', labels: ['question'], body: '', createdAt: daysAgo(340) }),
    ];
    const ranked = rankClusters(issues, NOW);
    assert.ok(ranked.length >= 2);
    assert.ok(ranked[0]!.keywords.includes('webhook') || ranked[0]!.theme.includes('webhook'), 'the strong demand theme ranks first');
    assert.ok(ranked[0]!.score > ranked[ranked.length - 1]!.score);
  });
});

describe('fetchDemandIssues — seamed gh-CLI, graceful degrade', () => {
  it('parses gh issue list rows + dedups an issue carrying two demand labels', async () => {
    const run: DemandExecRunner = async (_cmd, args) => {
      const label = args[args.indexOf('--label') + 1];
      // #7 appears under BOTH enhancement and feature → must dedup to one.
      if (label === 'enhancement') return { stdout: JSON.stringify([{ number: 7, title: 'SQLite', body: 'b', url: 'u7', createdAt: daysAgo(2), labels: [{ name: 'enhancement' }, { name: 'feature' }] }]) };
      if (label === 'feature') return { stdout: JSON.stringify([{ number: 7, title: 'SQLite', body: 'b', url: 'u7', createdAt: daysAgo(2), labels: [{ name: 'enhancement' }, { name: 'feature' }] }]) };
      return { stdout: '[]' };
    };
    const issues = await fetchDemandIssues({ repos: ['o/r'], _run: run });
    assert.equal(issues.length, 1, 'deduped by repo#number');
    assert.deepEqual(issues[0]!.labels, ['enhancement', 'feature']);
  });

  it('a failing gh call degrades to no issues from that query (never throws)', async () => {
    const run: DemandExecRunner = async () => { throw new Error('gh: not authenticated'); };
    const issues = await fetchDemandIssues({ repos: ['o/r'], _run: run });
    assert.deepEqual(issues, []);
  });

  it('skips malformed repo slugs', async () => {
    let called = 0;
    const run: DemandExecRunner = async () => { called++; return { stdout: '[]' }; };
    await fetchDemandIssues({ repos: ['not-a-slug', 'has spaces/x'], _run: run });
    assert.equal(called, 0, 'no gh call for malformed slugs');
  });
});

describe('harvestDemand — end to end (seamed)', () => {
  it('produces a ranked backlog + a specify-ready markdown brief', async () => {
    const run: DemandExecRunner = async (_cmd, args) => {
      const label = args[args.indexOf('--label') + 1];
      if (label !== 'enhancement') return { stdout: '[]' };
      return { stdout: JSON.stringify([
        { number: 1, title: 'webhook retry on failure', body: 'Expected: should retry 3x.', url: 'u1', createdAt: daysAgo(3), labels: [{ name: 'enhancement' }] },
        { number: 2, title: 'webhook signing secret', body: 'so that we can verify payloads', url: 'u2', createdAt: daysAgo(4), labels: [{ name: 'enhancement' }] },
      ]) };
    };
    const backlog = await harvestDemand({ repos: ['o/r'], labels: ['enhancement'], nowMs: NOW, _run: run });
    assert.equal(backlog.totalIssues, 2);
    assert.ok(backlog.clusters.length >= 1);
    const md = formatBacklogMarkdown(backlog);
    assert.match(md, /Demand Backlog/);
    assert.match(md, /webhook/);
    assert.match(md, /danteforge specify/);
  });
});

describe('deriveReposFromMatrix — pull github slugs from competitors', () => {
  it('extracts owner/repo from github URLs and bare slugs', () => {
    const repos = deriveReposFromMatrix({
      competitors_oss: ['https://github.com/aider-ai/aider', 'continuedev/continue'],
      competitors: ['Cursor', 'https://github.com/sourcegraph/cody.git'],
    });
    assert.ok(repos.includes('aider-ai/aider'));
    assert.ok(repos.includes('continuedev/continue'));
    assert.ok(repos.includes('sourcegraph/cody'));
    assert.ok(!repos.includes('Cursor'), 'a non-repo competitor name is skipped');
  });
});
