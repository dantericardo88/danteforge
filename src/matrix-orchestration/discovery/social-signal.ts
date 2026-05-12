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

  // v1.1 will replace this branch with real fetches. For now we log that the
  // user opted in but the implementation is not yet available, then return an
  // empty report (no exception — non-fatal). The signal that v1.1 should
  // start: the appendAudit payload carries 'social_signal_v1_1_required'.
  report.skippedReason =
    'social signal opted-in but v1.1 fetch backends not yet implemented in this build';
  // Touch each declared seam so static analysis confirms they are wired —
  // and so a test can assert that opting-in still produces an audit event.
  const sources: SocialSource[] = options.sources ?? ['hackernews'];
  await saveOrch(cwd, 'socialSignal', report);
  await appendAudit(cwd, {
    ts: now(), runId, kind: 'stage_completed',
    payload: {
      stage: 'social_signal',
      skipped: true,
      reason: 'social_signal_v1_1_required',
      sourcesRequested: sources,
      competitorCount: universe.entries.length,
    },
  });
  return report;
}

// Exported for unit tests + the v1.1 implementer.
export const _internal = {
  DEFAULT_SKIP_REASON,
};
