// Social Signal Capture — Phase 2.3 of PRD-MATRIX-ORCHESTRATION-V1.
//
// V1 STATUS: feature-flagged stub. The default is enabled === false and the
// module returns an empty SocialSignalReport with a skippedReason. The
// interface is wired through state-io and audit-log so downstream consumers
// (dimension-matrix synthesis) can read the artifact unconditionally.
//
// V1.1 PLAN (not in this build, sketched for the next implementer):
//   * Primary signal source: Hacker News Algolia search API
//     (https://hn.algolia.com/api) — no auth, generous rate limit, ideal for
//     a default-on tier.
//   * Optional tiers (require user-supplied API key in ~/.danteforge/config.yaml):
//       - Reddit JSON API (subreddit + query-string search)
//       - X / Twitter API v2 (recent search)
//   * Cache every fetch under .danteforge/matrix-orchestration/social-cache/
//     with a 7-day TTL keyed by (source, query, capturedAt-bucket).
//   * Aggregator computes per-competitor totals + topic clustering via
//     either an LLM call (mode === 'llm') or a regex topic dictionary
//     (mode === 'local').
//
// Injection seams in this stub already match what the v1.1 implementation
// will need, so wiring tests stay valid across the version bump.

import path from 'node:path';
import fs from 'node:fs/promises';
import { saveOrch, appendAudit, ensureOrchDir } from '../state-io.js';
import type {
  CompetitiveUniverse,
  SocialSignalReport,
  SocialSource,
} from '../types.js';

export interface SocialSignalOptions {
  cwd: string;
  /** Default false in v1 — set true to attempt capture (currently still returns disabled report). */
  enabled?: boolean;
  /** Which tiers to enable when v1.1 lands. */
  sources?: SocialSource[];
  /** HN Algolia search seam — v1.1 will wire the real fetch through this. */
  _hnSearch?: (query: string) => Promise<unknown>;
  /** Reddit JSON seam. */
  _redditSearch?: (query: string) => Promise<unknown>;
  /** X / Twitter recent-search seam. */
  _xSearch?: (query: string) => Promise<unknown>;
  _now?: () => string;
  runId?: string;
}

const DEFAULT_SKIP_REASON =
  'social signal capture disabled in v1 (set --social-signal to enable in v1.1)';

export async function captureSocialSignal(
  universe: CompetitiveUniverse,
  options: SocialSignalOptions,
): Promise<SocialSignalReport> {
  const cwd = options.cwd;
  const now = options._now ?? (() => new Date().toISOString());
  const runId = options.runId ?? 'social-signal';
  const enabled = options.enabled ?? false;

  await ensureOrchDir(cwd);

  const report: SocialSignalReport = {
    generatedAt: now(),
    enabled,
    mentions: [],
    aggregates: [],
  };

  if (!enabled) {
    report.skippedReason = DEFAULT_SKIP_REASON;
    await saveOrch(cwd, 'socialSignal', report);
    await appendAudit(cwd, {
      ts: now(), runId, kind: 'stage_completed',
      payload: {
        stage: 'social_signal',
        skipped: true,
        reason: DEFAULT_SKIP_REASON,
        competitorCount: universe.entries.length,
      },
    });
    return report;
  }

  const sources: SocialSource[] = options.sources ?? ['hackernews'];
  const cacheDir = path.join(cwd, '.danteforge', 'matrix-orchestration', 'social-cache');
  await fs.mkdir(cacheDir, { recursive: true });

  const TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const bucket = Math.floor(Date.now() / TTL_MS);

  for (const entry of universe.entries) {
    const competitorName = entry.name;
    for (const source of sources) {
      if (source !== 'hackernews') continue;
      const safeKey = competitorName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const cachePath = path.join(cacheDir, 'hn-' + safeKey + '-' + bucket + '.json');
      type HnHit = { url?: string; story_text?: string; title?: string };
      let hits: HnHit[] = [];
      try {
        hits = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as HnHit[];
      } catch {
        try {
          const hnFetch = options._hnSearch ??
            ((q: string) => fetch(
              'https://hn.algolia.com/api/v1/search?query=' + encodeURIComponent(q) + '&tags=story&hitsPerPage=10',
            ).then(r => r.json()));
          const raw = await hnFetch(competitorName) as { hits?: HnHit[] };
          hits = raw.hits ?? [];
          await fs.writeFile(cachePath, JSON.stringify(hits), 'utf-8');
        } catch { hits = []; }
      }
      for (const hit of hits) {
        const excerpt = ((hit.story_text ?? hit.title ?? '') as string).slice(0, 200);
        if (!excerpt) continue;
        const lc = excerpt.toLowerCase();
        const sentiment =
          lc.includes('slow') || lc.includes('bug') || lc.includes('issue') || lc.includes('fail')
            ? 'complaint' as const
            : lc.includes('great') || lc.includes('love') || lc.includes('excellent') || lc.includes('best')
              ? 'praise' as const
              : 'neutral' as const;
        report.mentions.push({ competitorName, source: 'hackernews', url: hit.url, excerpt, sentiment, capturedAt: now() });
      }
    }
  }

  const aggMap = new Map<string, { totalMentions: number; praiseCount: number; complaintCount: number }>();
  for (const m of report.mentions) {
    const agg = aggMap.get(m.competitorName) ?? { totalMentions: 0, praiseCount: 0, complaintCount: 0 };
    agg.totalMentions++;
    if (m.sentiment === 'praise') agg.praiseCount++;
    else if (m.sentiment === 'complaint') agg.complaintCount++;
    aggMap.set(m.competitorName, agg);
  }
  report.aggregates = Array.from(aggMap.entries()).map(([competitorName, agg]) => ({
    competitorName,
    totalMentions: agg.totalMentions,
    praiseCount: agg.praiseCount,
    complaintCount: agg.complaintCount,
    topComplaints: [],
    topPraises: [],
    confidence: 0.5,
  }));

  await saveOrch(cwd, 'socialSignal', report);
  await appendAudit(cwd, {
    ts: now(), runId, kind: 'stage_completed',
    payload: {
      stage: 'social_signal',
      competitorCount: universe.entries.length,
      mentionsCollected: report.mentions.length,
    },
  });
  return report;
}

// Exported for unit tests + the v1.1 implementer.
export const _internal = {
  DEFAULT_SKIP_REASON,
};
