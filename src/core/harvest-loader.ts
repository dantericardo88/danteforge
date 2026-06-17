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
 *  verified_live, sig }] }`. Populated by the leaderboard fetcher (leaderboard-fetcher.ts) — the
 *  objective anchor. verified_live is the FETCHER's to set on a real re-fetch; `sig` is the CH-030
 *  signature the fetcher stamps so the harvest gate trusts verified_live under enforcement. The dossier
 *  source is deliberately NOT loaded: dossiers score competitors on the code-tool DIMENSIONS_28 rubric,
 *  a different domain from the matrix dims. */
export const LEADERBOARD_REL = ['.danteforge', 'compete', 'leaderboards.json'] as const;

/** Default demand floor — drops one-off mentions so the bar reflects real, repeated user demand. */
const DEFAULT_MIN_DEMAND = 5;

export interface LeaderboardEntry {
  suite?: unknown; numeric?: unknown; source_url?: unknown; fetched_at?: unknown; verified_live?: unknown;
  /** CH-030 signature the fetcher stamps over the reconstructed signal; read back onto the signal here. */
  sig?: unknown;
}

/** Build the benchmark signal a leaderboard entry represents, attaching the entry's CH-030 signature so the
 *  harvest gate can verify it. The fetcher signs the SAME reconstruction, so the signature round-trips. */
export function signalFromLeaderboardEntry(r: LeaderboardEntry): HarvestedSignal {
  const numeric = Number(r.numeric);
  const signal = benchmarkSignal({
    suite: typeof r.suite === 'string' ? r.suite : 'suite',
    numeric,
    sourceUrl: typeof r.source_url === 'string' ? r.source_url : (typeof r.suite === 'string' ? r.suite : 'suite'),
    fetchedAt: typeof r.fetched_at === 'string' ? r.fetched_at : '',
    verifiedLive: r.verified_live === true,
  });
  if (typeof r.sig === 'string' && r.sig) signal.sig = r.sig;
  return signal;
}

/** Build benchmark signals from a leaderboards.json entry list for one dimension (skips malformed rows). */
function leaderboardToSignals(byDim: Record<string, LeaderboardEntry[]>, dimId: string): HarvestedSignal[] {
  const rows = Array.isArray(byDim[dimId]) ? byDim[dimId]! : [];
  const out: HarvestedSignal[] = [];
  for (const r of rows) {
    if (typeof r.suite !== 'string' || !Number.isFinite(Number(r.numeric))) continue;
    out.push(signalFromLeaderboardEntry(r));
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
