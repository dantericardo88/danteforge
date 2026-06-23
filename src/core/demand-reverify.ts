// demand-reverify.ts — the AUTONOMOUS demand-clearance primitive.
//
// Codex's gap (council 2026-06-23): checkHarvestProvenance (the autonomy flip) clears a DEMAND bar only on a
// SIGNED `verified_live` re-fetch — but nothing ever PRODUCED `verified_live` on a demand signal, so demand bars
// were permanently stuck and the engineering-frontier loop could not run autonomously. This module closes that:
// it re-fetches a demand's real source (the issue URL + reaction count) and, ONLY when the world still confirms
// it, stamps `verified_live` + a fresh kernel signature. The count is the external truth, not the agent's say-so;
// a demand that no longer exists stays unverified (blocked).

import type { HarvestedSignal } from './harvested-bar.js';
import { signedHarvestedSignal } from './harvested-signal-signer.js';

export interface DemandRefetchResult {
  /** True only if the demand is still live in the world — the issue exists/open. */
  live: boolean;
  /** The re-fetched reaction/ask count, recorded for the audit trail. */
  count?: number;
}

/** Re-fetch a demand signal's real source. Injected so the primitive is testable without a live network. */
export type DemandRefetcher = (signal: HarvestedSignal) => Promise<DemandRefetchResult>;

/**
 * Stamp `verified_live` + a fresh signature on a demand signal IFF a real re-fetch confirms it is still live.
 * Non-demand signals pass through untouched. An unconfirmed re-fetch returns the signal unchanged — so it stays
 * not-verified_live and the provenance gate keeps blocking it. This is the only honest way `verified_live` gets
 * set on a demand bar (it can never be self-asserted past the gate's signature check).
 */
export async function verifyDemandLive(signal: HarvestedSignal, refetch: DemandRefetcher): Promise<HarvestedSignal> {
  if (signal.kind !== 'demand') return signal;
  const r = await refetch(signal);
  if (!r.live) return signal;
  return signedHarvestedSignal({ ...signal, verified_live: true });
}

/** Parse owner/repo/number from a GitHub issue HTML or API URL. */
export function parseIssueUrl(url: string): { owner: string; repo: string; number: string } | null {
  const m = /(?:github\.com|api\.github\.com\/repos)\/([^/]+)\/([^/]+)\/issues\/(\d+)/.exec(url ?? '');
  return m ? { owner: m[1]!, repo: m[2]!, number: m[3]! } : null;
}

/**
 * The real default refetcher: re-fetch the GitHub issue named in the demand signal's `source` and report it live
 * when the issue is still OPEN, with its current reaction count. Uses GITHUB_TOKEN/GH_TOKEN when present.
 */
export const githubDemandRefetcher: DemandRefetcher = async (signal) => {
  const parsed = parseIssueUrl(signal.source);
  if (!parsed) return { live: false };
  const api = `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}`;
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'danteforge' };
  const token = process.env['GITHUB_TOKEN'] || process.env['GH_TOKEN'];
  if (token) headers['Authorization'] = `Bearer ${token}`;
  try {
    const res = await fetch(api, { headers });
    if (!res.ok) return { live: false };
    const data = await res.json() as { state?: string; reactions?: { total_count?: number } };
    return { live: data.state === 'open', count: data.reactions?.total_count ?? 0 };
  } catch {
    return { live: false };
  }
};
