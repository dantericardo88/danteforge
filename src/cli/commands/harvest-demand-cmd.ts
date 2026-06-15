// harvest-demand-cmd.ts — `danteforge harvest-demand`: the Phase 6 v1 demand intake CLI. Harvests open
// feature-request issues from competitor/topic repos, ranks them into a demand backlog, and (with
// --write) emits .danteforge/demand-backlog.json + DEMAND_BACKLOG.md that feed `danteforge specify`.

import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../../core/logger.js';
import { harvestDemand, formatBacklogMarkdown, type DemandBacklog } from '../../core/demand-harvest.js';

export interface HarvestDemandCliOptions {
  repos?: string;          // comma-separated owner/repo slugs
  labels?: string;         // comma-separated labels (override defaults)
  limit?: string;          // per-(repo,label) cap
  write?: boolean;         // persist the backlog
  json?: boolean;
  cwd?: string;
  _loadMatrix?: (cwd: string) => Promise<unknown>;
  _harvest?: typeof harvestDemand;
  _now?: number;
}

/** Pull owner/repo slugs out of github URLs / bare slugs found on the matrix competitor list. */
export function deriveReposFromMatrix(matrix: unknown): string[] {
  const m = matrix as { competitors_oss?: unknown; competitors?: unknown } | null;
  if (!m) return [];
  const candidates: string[] = [];
  for (const v of [m.competitors_oss, m.competitors]) {
    if (Array.isArray(v)) for (const c of v) if (typeof c === 'string') candidates.push(c);
  }
  const slugs = new Set<string>();
  for (const c of candidates) {
    const urlMatch = c.match(/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git|\/|$)/i);
    if (urlMatch) { slugs.add(urlMatch[1]!.replace(/\.git$/, '')); continue; }
    if (/^[\w.-]+\/[\w.-]+$/.test(c)) slugs.add(c); // already a bare slug
  }
  return [...slugs];
}

export async function harvestDemandCli(options: HarvestDemandCliOptions): Promise<DemandBacklog> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  let repos = (options.repos ?? '').split(',').map(s => s.trim()).filter(Boolean);

  if (repos.length === 0) {
    // No explicit --repos: derive from the matrix's OSS competitors (github slugs/URLs).
    const loadFn = options._loadMatrix ?? (async (c: string) => {
      const { loadMatrix } = await import('../../core/compete-matrix.js');
      return loadMatrix(c);
    });
    repos = deriveReposFromMatrix(await loadFn(cwd));
    if (repos.length > 0) logger.info(`[harvest-demand] no --repos given — derived ${repos.length} from matrix competitors: ${repos.join(', ')}`);
  }

  if (repos.length === 0) {
    logger.warn('[harvest-demand] no repos to harvest. Pass --repos owner/repo,owner2/repo2 (or add OSS competitors with github URLs to the matrix).');
    const empty: DemandBacklog = { generatedAt: new Date(options._now ?? Date.now()).toISOString(), sources: [], labelsQueried: [], totalIssues: 0, clusters: [] };
    if (options.json) process.stdout.write(JSON.stringify(empty, null, 2) + '\n');
    return empty;
  }

  const harvest = options._harvest ?? harvestDemand;
  logger.info(`[harvest-demand] harvesting feature-request demand from ${repos.length} repo(s)…`);
  const backlog = await harvest({
    repos,
    labels: options.labels ? options.labels.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    perQueryLimit: options.limit ? parseInt(options.limit, 10) : undefined,
    nowMs: options._now,
  });

  if (options.json) {
    process.stdout.write(JSON.stringify(backlog, null, 2) + '\n');
  } else {
    for (const line of formatBacklogMarkdown(backlog).split('\n')) logger.info(line);
  }

  if (options.write) {
    const dir = path.join(cwd, '.danteforge');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'demand-backlog.json'), JSON.stringify(backlog, null, 2) + '\n', 'utf8');
    await fs.writeFile(path.join(dir, 'DEMAND_BACKLOG.md'), formatBacklogMarkdown(backlog) + '\n', 'utf8');
    logger.success(`[harvest-demand] wrote .danteforge/demand-backlog.json + DEMAND_BACKLOG.md (${backlog.clusters.length} themes, ${backlog.totalIssues} asks)`);
    if (backlog.clusters.length > 0) {
      const top = backlog.clusters[0]!;
      logger.info(`[harvest-demand] top demand: "${top.theme}" (${top.score.toFixed(1)}/10) → next: danteforge specify "${top.theme}"`);
    }
  }
  return backlog;
}
