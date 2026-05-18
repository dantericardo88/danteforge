// Matrix Kernel — Capability Test types (Fix A: eliminate self-scoring)
//
// Every dimension must declare a capability_test: a shell command that exits 0
// only when the underlying capability produces real, validated output.
// Dimensions without a passing capability_test are hard-capped at 5.0.
//
// Phase B extends this with a Capability Ladder — tiered probes T0..T6, each
// with its own score cap. Legacy single-command capability_test entries auto-
// normalize to a T2 probe so the existing 19 DanteForge dimensions keep their
// current 5.0 ceiling unchanged.

export interface CapabilityTestSpec {
  /** Shell command that probes the real capability. Exit 0 = capability present. */
  command: string;
  /** Human-readable explanation of what this tests. */
  description: string;
  /** Timeout in milliseconds. Default: 30000. */
  timeoutMs?: number;
}

export interface CapabilityTestResult {
  dimensionId: string;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  ranAt: string;
}

/** Dimension marks this flag when no automated capability test is possible. */
export interface NoCapabilityTestMarker {
  no_capability_test: true;
  /** Reason why no capability test is possible (e.g. "requires live API key"). */
  reason: string;
}

export type CapabilityTestEntry = CapabilityTestSpec | NoCapabilityTestMarker;

/** Type guard: is this a "no test possible" marker? */
export function isNoCapabilityTest(v: unknown): v is NoCapabilityTestMarker {
  return typeof v === 'object' && v !== null
    && (v as Record<string, unknown>).no_capability_test === true;
}

/** Type guard: is this a real test spec? */
export function isCapabilityTestSpec(v: unknown): v is CapabilityTestSpec {
  return typeof v === 'object' && v !== null
    && typeof (v as Record<string, unknown>).command === 'string'
    && typeof (v as Record<string, unknown>).description === 'string';
}

/** Max score allowed for a dimension without a passing capability_test. */
export const CAPABILITY_TEST_SCORE_CAP = 5.0;

// ── Phase B: Capability Ladder ───────────────────────────────────────────────

export type CapabilityTier = 'T0' | 'T1' | 'T2' | 'T3' | 'T4' | 'T5' | 'T6';

/** Per-tier score caps. T2 = legacy capability_test cap (5.0). */
export const TIER_SCORE_CAPS: Record<CapabilityTier, number> = {
  T0: 1.0, T1: 4.0, T2: 5.0, T3: 6.0, T4: 7.0, T5: 8.0, T6: 8.5,
};

/**
 * Per-tier evidence freshness windows in milliseconds. When cached evidence is
 * older than this, the outcome runner treats it as stale and re-executes.
 *
 * Why graded: higher tiers represent stronger claims about production behavior,
 * so their evidence must be more recent to remain trustworthy. T0/T1 are
 * spec-level (long-lived); T6 is a live-prod claim (must be fresh).
 *
 *   T0: indefinite (file-existence checks rarely decay)
 *   T1: 90 days   (typecheck / lint; fine to cache for a sprint cycle)
 *   T2: 60 days   (unit tests; weekly rerun is typical)
 *   T3: 30 days   (production-usage-fresh; one calendar month)
 *   T4: 14 days   (integration; bi-weekly cadence)
 *   T5: 7 days    (smoke against real env; weekly minimum)
 *   T6: 24 hours  (live telemetry; same-day evidence only)
 *
 * Note: SHA-based eviction already invalidates evidence on any commit. This
 * layer adds time-based decay for the case where the SHA hasn't moved but
 * the claim has aged.
 */
export const TIER_FRESHNESS_MS: Record<CapabilityTier, number> = {
  T0: Number.POSITIVE_INFINITY,
  T1: 90 * 24 * 60 * 60 * 1000,
  T2: 60 * 24 * 60 * 60 * 1000,
  T3: 30 * 24 * 60 * 60 * 1000,
  T4: 14 * 24 * 60 * 60 * 1000,
  T5: 7 * 24 * 60 * 60 * 1000,
  T6: 24 * 60 * 60 * 1000,
};

/**
 * Returns true when the evidence is older than its tier's freshness window.
 * Cached evidence beyond this age should be treated as a cache miss and the
 * outcome re-executed.
 */
export function isEvidenceStale(
  tier: CapabilityTier,
  ranAtISO: string,
  now: Date = new Date(),
): boolean {
  const limit = TIER_FRESHNESS_MS[tier];
  if (!Number.isFinite(limit)) return false;
  const ranAt = new Date(ranAtISO).getTime();
  if (!Number.isFinite(ranAt)) return false; // Malformed timestamps are not stale; let the cache decide.
  return now.getTime() - ranAt > limit;
}

export interface TierProbe {
  /** Shell command run from REPO ROOT. Exit 0 = tier proven. */
  command: string;
  description: string;
  /** Timeout in ms. Defaults: T0/T1 120000, T2/T3 600000, T4/T5/T6 900000. */
  timeoutMs?: number;
  /** Parser hint for per-package mapping in monorepos. */
  parser?: 'turbo' | 'pnpm-r' | 'lerna' | 'npm' | 'tap' | 'node-test' | 'exit-code-only';
  /** If true, the probe's failedPackages output is attributed via package-to-dim map. */
  perPackage?: boolean;
}

export interface CapabilityLadder {
  /** Tier → probe. Sparse map: missing tiers are "not declared" — score caps at previous tier reached. */
  tiers: Partial<Record<CapabilityTier, TierProbe>>;
  /** Hard ceiling for the ladder. Declared by the dim author. */
  declared_ceiling: CapabilityTier;
}

export interface TierResult {
  tier: CapabilityTier;
  ran: boolean;
  passed: boolean;
  exitCode: number;
  durationMs: number;
  /** Path to .danteforge/runtime-evidence/<sha>-<tier>.json */
  evidencePath: string;
  /** Per-package failures (only populated when probe.perPackage). */
  failedPackages: string[];
  errorSummary?: string;
}

export interface CapabilityLadderVerdict {
  dimensionId: string;
  /** Highest tier the dim PASSED in this run; null if every probe failed. */
  highestTierPassed: CapabilityTier | null;
  /** TIER_SCORE_CAPS[highestTierPassed] or 1.0 if null. */
  scoreCap: number;
  results: TierResult[];
  reason: string;
}

/**
 * Wrap a legacy `{ command, description }` capability_test entry as a Capability
 * Ladder with a single T2 probe. The 19 existing DanteForge dimensions load
 * unchanged through this normalization — they keep their 5.0 ceiling.
 *
 * Returns null when the input is a NoCapabilityTestMarker (those dims are
 * permanently capped at 5.0 by definition).
 */
export function normalizeToLadder(entry: CapabilityTestEntry | CapabilityLadder | undefined): CapabilityLadder | null {
  if (!entry) return null;
  if (isNoCapabilityTest(entry)) return null;
  // Already a Capability Ladder.
  if (typeof entry === 'object' && 'tiers' in entry && entry.tiers) {
    return entry as CapabilityLadder;
  }
  if (isCapabilityTestSpec(entry)) {
    return {
      tiers: {
        T2: {
          command: entry.command,
          description: entry.description,
          timeoutMs: entry.timeoutMs,
        },
      },
      declared_ceiling: 'T2',
    };
  }
  return null;
}

/** Type guard: does a value look like a CapabilityLadder? */
export function isCapabilityLadder(v: unknown): v is CapabilityLadder {
  return typeof v === 'object'
    && v !== null
    && 'tiers' in v
    && typeof (v as Record<string, unknown>).tiers === 'object'
    && 'declared_ceiling' in v;
}
