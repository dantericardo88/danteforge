// leaderboard-fetch — Phase 2.1 CLI surface: re-fetch published benchmark frontier numbers from real,
// structured leaderboard sources, sign them (CH-030), and write `.danteforge/compete/leaderboards.json`.
// The objective anchor of the auto-grounded yardstick: a benchmarked dimension's bar = the top system's
// re-fetched, signed resolve-rate (not LLM prose). Dimensions with no published leaderboard get no entry.

import { get as httpsGet } from 'node:https';
import {
  DEFAULT_LEADERBOARD_SOURCES, fetchLeaderboards, writeLeaderboards, type LeaderboardSource,
} from '../../core/leaderboard-fetcher.js';
import { normalizeBenchmarkScore } from '../../core/harvested-bar.js';

/** Live HTTPS GET → body text (follows one redirect; rejects non-2xx). The injectable seam in tests. */
function httpsText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = httpsGet(url, { timeout: 30000 }, (res) => {
      const status = res.statusCode ?? 0;
      const loc = res.headers.location;
      if (status >= 300 && status < 400 && loc) { res.resume(); httpsText(loc).then(resolve, reject); return; }
      if (status < 200 || status >= 300) { res.resume(); reject(new Error(`HTTP ${status} for ${url}`)); return; }
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`timeout fetching ${url}`)));
  });
}

export async function leaderboardFetch(opts: { dim?: string; cwd?: string } = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const sources: LeaderboardSource[] = opts.dim
    ? DEFAULT_LEADERBOARD_SOURCES.filter(s => s.dimId === opts.dim)
    : DEFAULT_LEADERBOARD_SOURCES;
  if (sources.length === 0) {
    console.error(`[leaderboard] no configured leaderboard source${opts.dim ? ` for dimension "${opts.dim}"` : ''}. ` +
      `A dimension with no published benchmark stays capped at the grounding threshold (honest — no fabrication).`);
    return;
  }
  console.error(`[leaderboard] re-fetching ${sources.length} published benchmark frontier number(s)…`);
  const nowIso = new Date().toISOString();
  const { byDim, fetched } = await fetchLeaderboards(sources, httpsText, nowIso);
  if (fetched.length === 0) {
    console.error('[leaderboard] no source yielded a usable number — nothing written (no fabrication).');
    process.exitCode = 1;
    return;
  }
  const path = await writeLeaderboards(cwd, byDim);
  for (const f of fetched) {
    console.error(`[leaderboard] ${f.dimId} ← ${f.entry.suite}: frontier ${(f.topRate * 100).toFixed(1)}% ` +
      `→ bar ${normalizeBenchmarkScore(f.topRate)}/10 (verified_live, signed) — ${f.entry.source_url}`);
  }
  console.error(`[leaderboard] wrote ${fetched.length} signed benchmark anchor(s) → ${path}`);
  console.error(`[leaderboard] frontier-spec init will now seed these dims' bars from the leaderboard (loadHarvestedSignals).`);
}
