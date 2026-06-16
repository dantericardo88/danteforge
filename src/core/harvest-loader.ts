// harvest-loader.ts — the I/O wrapper around the pure transforms in harvest-to-signals.ts.
// Reads on-disk harvest artifacts and returns HarvestedSignal[] for one matrix dimension, so the
// live frontier-spec init path can seed the bar from harvested feedback (the keystone going live).
//
// Today it loads the competitor-intel report (`.danteforge/compete/weakness-intelligence.json`,
// written by `danteforge intel --save`), whose signals already key by matrix dim id. Returns [] when
// no artifact exists — NO fabrication. The dossier path (needs the DIMENSIONS_28 <-> matrix-dim
// reconciliation) and the leaderboard benchmark fetch are the remaining CH-031 sub-steps.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { IntelReport } from './competitor-intel-fetcher.js';
import type { HarvestedSignal } from './harvested-bar.js';
import { intelToDemandSignals, benchmarkSignal } from './harvest-to-signals.js';

/** Matches intel.ts: STATE_DIR/COMPETE_DIR/INTEL_FILE. */
const INTEL_REL = ['.danteforge', 'compete', 'weakness-intelligence.json'] as const;

/** The benchmark-leaderboard source: `{ "<dimId>": [{ suite, numeric, source_url, fetched_at,
 *  verified_live }] }`. Populated by the leaderboard fetcher (or operator) — the objective anchor.
 *  verified_live is the FETCHER's to set on a real re-fetch; the harvest gate trusts it only when
 *  signed (CH-030) under enforcement. The dossier source is deliberately NOT loaded: dossiers score
 *  competitors on the code-tool DIMENSIONS_28 rubric, a different domain from the matrix dims. */
const LEADERBOARD_REL = ['.danteforge', 'compete', 'leaderboards.json'] as const;

/** Default demand floor — drops one-off mentions so the bar reflects real, repeated user demand. */
const DEFAULT_MIN_DEMAND = 5;

interface LeaderboardEntry {
  suite?: unknown; numeric?: unknown; source_url?: unknown; fetched_at?: unknown; verified_live?: unknown;
}

/** Build benchmark signals from a leaderboards.json entry list for one dimension (skips malformed rows). */
function leaderboardToSignals(byDim: Record<string, LeaderboardEntry[]>, dimId: string): HarvestedSignal[] {
  const rows = Array.isArray(byDim[dimId]) ? byDim[dimId]! : [];
  const out: HarvestedSignal[] = [];
  for (const r of rows) {
    const numeric = Number(r.numeric);
    if (typeof r.suite !== 'string' || !Number.isFinite(numeric)) continue;
    out.push(benchmarkSignal({
      suite: r.suite,
      numeric,
      sourceUrl: typeof r.source_url === 'string' ? r.source_url : r.suite,
      fetchedAt: typeof r.fetched_at === 'string' ? r.fetched_at : '',
      verifiedLive: r.verified_live === true,
    }));
  }
  return out;
}

/** Load every on-disk harvested signal for one matrix dimension (intel demand + benchmark anchor). */
export async function loadHarvestedSignals(
  cwd: string,
  dimId: string,
  opts: { minDemand?: number } = {},
): Promise<HarvestedSignal[]> {
  const signals: HarvestedSignal[] = [];
  try {
    const raw = await readFile(join(cwd, ...INTEL_REL), 'utf8');
    const report = JSON.parse(raw) as IntelReport;
    if (report && Array.isArray(report.signals)) {
      signals.push(...intelToDemandSignals(report, dimId, { minDemand: opts.minDemand ?? DEFAULT_MIN_DEMAND }));
    }
  } catch { /* no intel report yet — no fabrication */ }
  try {
    const raw = await readFile(join(cwd, ...LEADERBOARD_REL), 'utf8');
    const byDim = JSON.parse(raw) as Record<string, LeaderboardEntry[]>;
    if (byDim && typeof byDim === 'object') signals.push(...leaderboardToSignals(byDim, dimId));
  } catch { /* no leaderboard file yet — no fabrication */ }
  return signals;
}
