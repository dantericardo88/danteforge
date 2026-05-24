// intel.ts — Real-time competitor weakness intelligence command.
// Fetches from GitHub Issues, HackerNews, and Reddit to surface actionable
// opportunities: competitor pain = our gain.
//
// Usage:
//   danteforge intel                        # fetch all competitors, show top 10 opportunities
//   danteforge intel --competitor aider     # one competitor only
//   danteforge intel --opportunities        # show ranked opportunity table
//   danteforge intel --github-only          # skip HN + Reddit (faster)
//   danteforge intel --save                 # write to weakness-intelligence.json
//   danteforge intel --watch                # poll every 6 hours

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import {
  fetchCompetitorIntel,
  scoreOpportunities,
  COMPETITOR_REPOS,
  type WeaknessSignal,
  type OpportunityScore,
  type IntelReport,
} from '../../core/competitor-intel-fetcher.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface IntelOptions {
  cwd?: string;
  competitor?: string;          // single competitor name (partial match OK)
  opportunities?: boolean;      // show opportunity ranking
  githubOnly?: boolean;         // skip HN + Reddit
  save?: boolean;               // write weakness-intelligence.json
  watch?: boolean;              // poll every 6 hours
  topN?: number;                // top N signals to show (default 10)
  timeoutMs?: number;           // per-source timeout (default 20_000)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATE_DIR = '.danteforge';
const COMPETE_DIR = 'compete';
const INTEL_FILE = 'weakness-intelligence.json';

async function resolveCompetitors(competitor?: string): Promise<string[]> {
  const all = Object.keys(COMPETITOR_REPOS);
  if (!competitor) return all;

  const lower = competitor.toLowerCase();
  const match = all.filter(c => c.toLowerCase().includes(lower));
  if (match.length === 0) {
    logger.warn(`[intel] No known competitor matched "${competitor}". Known: ${all.join(', ')}`);
    return [];
  }
  return match;
}

async function loadMatrixGaps(cwd: string): Promise<Record<string, number>> {
  try {
    const matrixPath = path.join(cwd, STATE_DIR, COMPETE_DIR, 'matrix.json');
    const raw = await fs.readFile(matrixPath, 'utf-8');
    const matrix = JSON.parse(raw) as {
      dimensions: Array<{ id: string; gap_to_leader: number; scores: Record<string, number> }>;
    };
    const gaps: Record<string, number> = {};
    for (const dim of matrix.dimensions ?? []) {
      gaps[dim.id] = dim.gap_to_leader ?? 0;
    }
    return gaps;
  } catch {
    return {};
  }
}

async function saveIntelReport(cwd: string, report: IntelReport): Promise<string> {
  const dir = path.join(cwd, STATE_DIR, COMPETE_DIR);
  await fs.mkdir(dir, { recursive: true });
  const outPath = path.join(dir, INTEL_FILE);
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf-8');
  return outPath;
}

function renderSignalTable(signals: WeaknessSignal[], topN: number): void {
  const top = signals
    .sort((a, b) => b.demandScore - a.demandScore)
    .slice(0, topN);

  if (top.length === 0) {
    logger.info('[intel] No weakness signals found.');
    return;
  }

  logger.info('');
  logger.info('── Top Weakness Signals ─────────────────────────────────────────────────');
  logger.info(` ${'Tool'.padEnd(24)} ${'Category'.padEnd(26)} ${'Demand'.padEnd(7)} Source`);
  logger.info(` ${'-'.repeat(24)} ${'-'.repeat(26)} ${'-'.repeat(7)} ------`);

  for (const s of top) {
    const demand = s.demandScore.toFixed(1).padEnd(7);
    const tool = s.tool.slice(0, 22).padEnd(24);
    const cat = s.category.slice(0, 24).padEnd(26);
    logger.info(` ${tool} ${cat} ${demand} ${s.source}`);
  }
  logger.info('');
}

function renderOpportunityTable(opportunities: OpportunityScore[], topN: number): void {
  const top = opportunities.slice(0, topN);
  if (top.length === 0) {
    logger.info('[intel] No opportunities computed.');
    return;
  }

  logger.info('── Ranked Opportunities (demand × gap) ──────────────────────────────────');
  logger.info(` ${'Dimension'.padEnd(32)} ${'Category'.padEnd(26)} Demand  Signals  Score`);
  logger.info(` ${'-'.repeat(32)} ${'-'.repeat(26)} ------  -------  -----`);

  for (const op of top) {
    const dim = op.dimensionId.slice(0, 30).padEnd(32);
    const cat = op.category.slice(0, 24).padEnd(26);
    const demand = op.totalDemand.toFixed(0).padStart(6);
    const count = String(op.signalCount).padStart(7);
    const score = op.opportunityScore.toFixed(1).padStart(5);
    logger.info(` ${dim} ${cat} ${demand}  ${count}  ${score}`);
  }
  logger.info('');

  if (top[0]) {
    logger.info(`── Top opportunity: ${top[0].category} (${top[0].dimensionId})`);
    logger.info(`   ${top[0].signalCount} competitor signal(s), demand ${top[0].totalDemand.toFixed(0)}`);
    if (top[0].topSignals[0]) {
      logger.info(`   Example: "${top[0].topSignals[0].title.slice(0, 80)}"`);
      logger.info(`   Source:  ${top[0].topSignals[0].url}`);
    }
    logger.info('');
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runIntel(options: IntelOptions): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const topN = options.topN ?? 10;

  const toolNames = await resolveCompetitors(options.competitor);
  if (toolNames.length === 0) return;

  logger.info(`[intel] Fetching competitor intelligence for: ${toolNames.join(', ')}`);
  if (options.githubOnly) logger.info('[intel] Mode: GitHub Issues only');

  const signals = await fetchCompetitorIntel(toolNames, {
    githubOnly: options.githubOnly,
    timeoutMs: options.timeoutMs,
  });

  logger.info(`[intel] Total signals found: ${signals.length}`);

  if (signals.length === 0) {
    logger.warn('[intel] No signals found — check network connectivity or GITHUB_TOKEN for higher rate limits.');
    return;
  }

  renderSignalTable(signals, topN);

  const gaps = await loadMatrixGaps(cwd);
  const opportunities = scoreOpportunities(signals, gaps);

  if (options.opportunities !== false) {
    renderOpportunityTable(opportunities, topN);
  }

  if (options.save) {
    const report: IntelReport = {
      generatedAt: new Date().toISOString(),
      signals,
      opportunities,
    };
    const outPath = await saveIntelReport(cwd, report);
    logger.info(`[intel] Report saved to ${outPath}`);
  }
}

// ── Watch mode ────────────────────────────────────────────────────────────────

const WATCH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function watchIntel(options: IntelOptions): Promise<void> {
  logger.info('[intel] Watch mode enabled — polling every 6 hours. Ctrl+C to stop.');

  const run = async () => {
    logger.info(`[intel] Poll at ${new Date().toISOString()}`);
    await runIntel({ ...options, save: true, watch: false });
  };

  await run();
  setInterval(() => { run().catch(err => logger.warn(`[intel] Watch cycle failed: ${(err as Error).message}`)); }, WATCH_INTERVAL_MS);

  // Keep process alive
  await new Promise<never>(() => {});
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function intelCommand(options: IntelOptions = {}): Promise<void> {
  if (options.watch) {
    await watchIntel(options);
  } else {
    await runIntel(options);
  }
}
