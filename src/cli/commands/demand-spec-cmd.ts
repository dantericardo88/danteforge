// demand-spec-cmd.ts — `danteforge demand-spec`: Phase 6 v2 intake→build handoff. Reads the saved demand
// backlog (from `harvest-demand --write`) and turns a ranked cluster into a specify-ready brief whose
// acceptance criteria come from the requesters' own words, with external-demand provenance attached.

import path from 'node:path';
import fs from 'node:fs/promises';
import { logger } from '../../core/logger.js';
import { buildSpecFromCluster, formatSpecMarkdown, type DemandSpec } from '../../core/demand-to-spec.js';
import type { DemandBacklog } from '../../core/demand-harvest.js';

export interface DemandSpecCliOptions {
  rank?: string;        // 1-based cluster rank (default 1 = top demand)
  backlog?: string;     // path to demand-backlog.json (default .danteforge/demand-backlog.json)
  write?: boolean;
  json?: boolean;
  cwd?: string;
  _readBacklog?: (p: string) => Promise<string>;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'demand';
}

export async function demandSpecCli(options: DemandSpecCliOptions): Promise<DemandSpec | null> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const backlogPath = options.backlog
    ? path.resolve(options.backlog)
    : path.join(cwd, '.danteforge', 'demand-backlog.json');

  const read = options._readBacklog ?? ((p: string) => fs.readFile(p, 'utf8'));
  let backlog: DemandBacklog;
  try {
    backlog = JSON.parse(await read(backlogPath)) as DemandBacklog;
  } catch {
    logger.warn(`[demand-spec] no backlog at ${backlogPath}. Run \`danteforge harvest-demand --write\` first.`);
    return null;
  }

  const clusters = backlog.clusters ?? [];
  if (clusters.length === 0) {
    logger.warn('[demand-spec] the backlog has no demand clusters to spec.');
    return null;
  }

  const rank = Math.max(1, options.rank ? parseInt(options.rank, 10) : 1);
  if (rank > clusters.length) {
    logger.warn(`[demand-spec] --rank ${rank} exceeds the ${clusters.length} clusters in the backlog.`);
    return null;
  }
  const cluster = clusters[rank - 1]!;
  const spec = buildSpecFromCluster(cluster);
  const md = formatSpecMarkdown(spec);

  if (options.json) {
    process.stdout.write(JSON.stringify(spec, null, 2) + '\n');
  } else {
    for (const line of md.split('\n')) logger.info(line);
  }

  if (options.write) {
    const dir = path.join(cwd, '.danteforge', 'demand-specs');
    await fs.mkdir(dir, { recursive: true });
    const base = `${String(rank).padStart(2, '0')}-${slugify(cluster.theme)}`;
    await fs.writeFile(path.join(dir, `${base}.md`), md + '\n', 'utf8');
    await fs.writeFile(path.join(dir, `${base}.json`), JSON.stringify(spec, null, 2) + '\n', 'utf8');
    logger.success(`[demand-spec] wrote .danteforge/demand-specs/${base}.md (+ .json) — ${spec.acceptanceCriteria.length} acceptance criterion(s) from ${spec.provenance.askCount} real ask(s)`);
    logger.info(`[demand-spec] next: danteforge specify "${spec.title}"  (paste the brief; attribute input_source=external_demand)`);
  }
  return spec;
}
