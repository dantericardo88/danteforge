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
import { intelToDemandSignals } from './harvest-to-signals.js';

/** Matches intel.ts: STATE_DIR/COMPETE_DIR/INTEL_FILE. */
const INTEL_REL = ['.danteforge', 'compete', 'weakness-intelligence.json'] as const;

/** Default demand floor — drops one-off mentions so the bar reflects real, repeated user demand. */
const DEFAULT_MIN_DEMAND = 5;

/** Load every on-disk harvested signal for one matrix dimension. */
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
  } catch { /* no intel report yet — return what we have, no fabrication */ }
  return signals;
}
