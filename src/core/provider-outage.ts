// provider-outage.ts — detect agent-CLI provider outages (usage limits, auth failures) in
// sub-command output so the autonomous frontier loop PAUSES instead of minting permanent ceilings
// against dims whose only problem was the provider being down (self-challenge CH-019).
//
// The loop spawns council CLIs (codex, claude-code) as builders and judges. When a provider is
// exhausted — a shared session/usage limit, or an auth failure — EVERY build and judge fails
// identically until the window reopens. Run 3m (2026-06-12): codex died ~6 PM, claude ~7:45 PM; the
// loop convened courts whose judges all abstained (booked REJECTED), then minted FIVE permanent
// generator-ceilings + 4 build-faileds against live dims. Run 3n then exited DONE after 0 cycles
// with a fully-alive council, and the ceilings had to be lifted by hand TWICE in one night.
//
// The pre-existing budget-pause (ascend-frontier-runner.noteBudgetLimit) only parsed claude's
// "session limit · resets 7:10pm" phrasing. Codex's "usage limit … try again at 8:45 PM" and
// untimed auth failures never reached it, so the orchestrator ceilinged instead of pausing. This
// detector recognizes the broader provider-outage class and reports a resume instant (the named
// reset time, or null → the caller applies a default backoff).

export interface ProviderOutage {
  /** True when the text carries a provider-outage signature. */
  outage: boolean;
  /** Epoch-ms instant to resume at: the named reset/retry time, or null → caller uses a default backoff. */
  resumeAtMs: number | null;
  /** The matched signature, whitespace-collapsed and clipped — for logs and the run ledger. */
  signature: string;
}

const NO_OUTAGE: ProviderOutage = { outage: false, resumeAtMs: null, signature: '' };

// TIMED: a usage/session/rate limit that NAMES its reset instant. Covers both phrasings seen live:
//   claude: "You've hit your session limit · resets 7:10pm (America/New_York)"
//   codex:  "ERROR: You have hit your usage limit … try again at 8:45 PM"
const TIMED_RE = /(?:session|usage|rate|account)\s*limit[^]{0,160}?(?:resets?|try again(?:\s+at)?|again at|retry(?:\s+at)?)\s+(\d{1,2}):(\d{2})\s*([ap]m)/i;

// UNTIMED: a clear provider-outage signature with no parseable reset time → default backoff. Each
// anchor is specific enough not to fire on ordinary build/test output (a bare "limit" or "401" in a
// diff would not match).
const UNTIMED_RES: readonly RegExp[] = [
  /you(?:'ve| have| ?ve)?\s+(?:hit|reached|exceeded)\s+(?:your\s+)?(?:usage|session|rate|account)\s*limit/i,
  /(?:usage|session|rate|account)\s*limit\s+(?:reached|exceeded|hit)/i,
  /rate[-\s]?limit(?:ed|\s+exceeded|\s+reached)/i,
  /quota (?:exceeded|exhausted|reached)/i,
  /insufficient[_\s]quota/i,
  /\b(?:401|403)\b[^]{0,40}?(?:unauthorized|forbidden)/i,
  /(?:authentication|authorization)\s+(?:failed|error|required)/i,
  /\bnot (?:authenticated|logged in|signed in)\b/i,
  /\b(?:invalid|missing|expired)\s+api[_\s]?key\b/i,
  /please (?:run\s+)?(?:login|log in|sign in|authenticate)\b/i,
];

const TIMED_MARGIN_MS = 2 * 60_000;

/** Resolve a named "H:MM am/pm" reset to the NEXT occurrence of that local time + a small margin. Pure. */
export function resolveResetMs(hour12: number, minutes: number, ampm: string, nowMs: number): number {
  let hours = hour12 % 12;
  if (ampm.toLowerCase() === 'pm') hours += 12;
  const at = new Date(nowMs);
  at.setHours(hours, minutes, 0, 0);
  let t = at.getTime();
  if (t <= nowMs) t += 24 * 3_600_000; // the named time already passed today → it's tomorrow's reset
  return t + TIMED_MARGIN_MS;
}

/**
 * Scan sub-command output for a provider-outage signature. Pure given nowMs.
 *
 * Timed limits resolve to the named reset instant; untimed outages return `resumeAtMs: null` so the
 * caller applies a default backoff — better to sleep a fixed window than burn cycles on guaranteed
 * failures that get misrecorded as permanent generator-ceilings. The first matching signature wins;
 * timed phrasings are tried first so a "usage limit … try again at 8:45 PM" line yields the exact
 * resume rather than the generic backoff.
 */
export function detectProviderOutage(output: string, nowMs: number): ProviderOutage {
  if (!output) return NO_OUTAGE;
  const timed = TIMED_RE.exec(output);
  if (timed) {
    return {
      outage: true,
      resumeAtMs: resolveResetMs(Number.parseInt(timed[1]!, 10), Number.parseInt(timed[2]!, 10), timed[3]!, nowMs),
      signature: timed[0].replace(/\s+/g, ' ').trim().slice(0, 160),
    };
  }
  for (const re of UNTIMED_RES) {
    const m = re.exec(output);
    if (m) return { outage: true, resumeAtMs: null, signature: m[0].replace(/\s+/g, ' ').trim().slice(0, 160) };
  }
  return NO_OUTAGE;
}
