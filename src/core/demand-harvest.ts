// demand-harvest.ts — Phase 6 v1 intake: harvest open feature-request demand from GitHub, rank it, and
// emit a backlog that feeds `specify`. GitHub issues are the clean, legal, high-signal source (API-friendly,
// often carrying an acceptance criterion); X/Reddit are deliberately out of v1 (paywalled / anti-scrape —
// add later via official APIs). This is the missing INTAKE that makes the existing
// specify → clarify → capability_test → forge → court pipeline externally GOAL-grounded, not just
// internally chosen. The gh-CLI fetch is fully seamed so the ranking is testable without a network.

import {
  rankClusters,
  type DemandIssue,
  type DemandCluster,
} from './demand-harvest-cluster.js';

export type { DemandIssue, DemandCluster };

export type DemandExecRunner = (cmd: string, args: string[]) => Promise<{ stdout: string }>;

export interface HarvestDemandOptions {
  /** owner/repo slugs to harvest (competitors, or topic repos the operator cares about). */
  repos: string[];
  /** demand labels to query (OR'd, one gh call each for robustness). */
  labels?: string[];
  /** max issues per (repo, label) query. */
  perQueryLimit?: number;
  /** current time in ms — injected for deterministic ranking (tests + workflow scripts). */
  nowMs?: number;
  /** gh-CLI runner seam (defaults to the real `gh`; returns [] on any failure — graceful degrade). */
  _run?: DemandExecRunner;
}

export interface DemandBacklog {
  generatedAt: string;
  sources: string[];
  labelsQueried: string[];
  totalIssues: number;
  clusters: DemandCluster[];
}

export const DEFAULT_DEMAND_LABELS = ['enhancement', 'feature', 'feature request', 'help wanted'];

async function realRunner(cmd: string, args: string[]): Promise<{ stdout: string }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { stdout } = await promisify(execFile)(cmd, args, { timeout: 25_000, maxBuffer: 16 * 1024 * 1024 });
  return { stdout };
}

/** Map one `gh issue list --json` row to a DemandIssue. Tolerant of shape drift / missing fields. */
function rowToIssue(repo: string, row: Record<string, unknown>): DemandIssue | null {
  const number = typeof row.number === 'number' ? row.number : null;
  const title = typeof row.title === 'string' ? row.title : '';
  const url = typeof row.url === 'string' ? row.url : '';
  if (number === null || !title || !url) return null;
  const labels = Array.isArray(row.labels)
    ? row.labels.map(l => (l && typeof l === 'object' && typeof (l as { name?: unknown }).name === 'string'
        ? (l as { name: string }).name : typeof l === 'string' ? l : '')).filter(Boolean)
    : [];
  return {
    repo,
    number,
    title,
    body: typeof row.body === 'string' ? row.body : '',
    labels,
    url,
    createdAt: typeof row.createdAt === 'string' ? row.createdAt : '',
  };
}

/**
 * Fetch open demand issues across repos × labels via the `gh` CLI. One call per (repo, label) keeps each
 * query simple and lets a single failing repo/label degrade to [] without sinking the whole harvest
 * (mirrors ghSearchRepos). Deduped by repo#number (an issue carrying two demand labels counts once).
 */
export async function fetchDemandIssues(opts: HarvestDemandOptions): Promise<DemandIssue[]> {
  const run = opts._run ?? realRunner;
  const labels = opts.labels ?? DEFAULT_DEMAND_LABELS;
  const limit = opts.perQueryLimit ?? 40;
  const byKey = new Map<string, DemandIssue>();
  for (const repo of opts.repos) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) continue; // skip malformed slugs
    for (const label of labels) {
      try {
        const { stdout } = await run('gh', [
          'issue', 'list', '--repo', repo, '--state', 'open', '--label', label,
          '--json', 'number,title,body,labels,url,createdAt', '--limit', String(limit),
        ]);
        const parsed: unknown = JSON.parse(stdout);
        if (!Array.isArray(parsed)) continue;
        for (const r of parsed) {
          const iss = rowToIssue(repo, r as Record<string, unknown>);
          if (iss) byKey.set(`${iss.repo}#${iss.number}`, iss);
        }
      } catch { /* gh missing / unauth / no such label / rate-limited — skip this query, keep harvesting */ }
    }
  }
  return [...byKey.values()];
}

/** Harvest → cluster → rank → backlog. The single entry point the CLI + workflows call. */
export async function harvestDemand(opts: HarvestDemandOptions): Promise<DemandBacklog> {
  const nowMs = opts.nowMs ?? Date.now();
  const issues = await fetchDemandIssues(opts);
  const clusters = rankClusters(issues, nowMs);
  return {
    generatedAt: new Date(nowMs).toISOString(),
    sources: [...opts.repos],
    labelsQueried: opts.labels ?? DEFAULT_DEMAND_LABELS,
    totalIssues: issues.length,
    clusters,
  };
}

function pct(n: number): string { return `${Math.round(n * 100)}%`; }

/** Render the backlog as an operator-readable, specify-ready markdown brief. */
export function formatBacklogMarkdown(backlog: DemandBacklog): string {
  const lines: string[] = [
    `# Demand Backlog — externally-grounded roadmap`,
    `Generated: ${backlog.generatedAt.slice(0, 10)}  |  ${backlog.totalIssues} issue(s) across ${backlog.sources.length} repo(s)`,
    `Sources: ${backlog.sources.join(', ') || '(none)'}`,
    `Labels: ${backlog.labelsQueried.join(', ')}`,
    ``,
    `Ranked by demand = ${pct(0.35)} frequency · ${pct(0.20)} recency · ${pct(0.25)} specificity · ${pct(0.20)} buildability.`,
    `Each top theme is a candidate for \`danteforge specify\` — its acceptance criterion is the requesters' own success condition.`,
    ``,
  ];
  if (backlog.clusters.length === 0) {
    lines.push('No demand harvested. Check `gh auth status`, the --repos slugs, and that the labels exist.');
    return lines.join('\n');
  }
  backlog.clusters.forEach((c, i) => {
    const s = c.signals;
    lines.push(
      `## ${i + 1}. ${c.theme}  —  demand ${c.score.toFixed(1)}/10`,
      `${c.issues.length} ask(s)  |  freq ${pct(s.frequency)} · recency ${pct(s.recency)} · specificity ${pct(s.specificity)} · buildability ${pct(s.buildability)}`,
      ...c.issues.slice(0, 5).map(iss => `- [${iss.repo}#${iss.number}] ${iss.title.slice(0, 110)} — ${iss.url}`),
      c.issues.length > 5 ? `- …and ${c.issues.length - 5} more` : '',
      '',
    );
  });
  return lines.filter(l => l !== '' || true).join('\n');
}
