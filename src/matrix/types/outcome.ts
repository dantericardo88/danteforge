// Matrix Kernel — Outcome types (Phase F).
//
// THE LEAP: scores are no longer something agents write. They are computed at
// load time from the set of outcomes a dim declares and the evidence files
// showing which ones currently pass. Inflation becomes structurally impossible
// because there is no score field to inflate.
//
// Each Outcome is a shell command + an expected exit code (and optionally an
// output pattern). It runs cold, produces an evidence file keyed by gitSha,
// and contributes to the dim's derived score. The Capability Ladder tier is
// the unit of the score: a dim's score is determined by which tiers have all
// outcomes passing, with continuous progress within the next un-cleared tier.
//
// This replaces the writable scores.self field as the source of truth.

import type { CapabilityTier } from './capability-test.js';

// ── The shape of an outcome ──────────────────────────────────────────────────

/**
 * Outcome kind discriminator. `shell` is the default for backward compatibility
 * with everything already declared. `production-usage-fresh` and `telemetry`
 * are substrate-built-in checks that don't run an arbitrary shell command.
 */
export type OutcomeKind =
  | 'shell' | 'production-usage-fresh' | 'external-benchmark' | 'telemetry'
  | 'cli-smoke' | 'runtime-exec' | 'e2e-workflow';

/** Common fields shared by all outcome kinds. */
interface BaseOutcome {
  /** Stable id, used to key evidence files. Must be unique within a dim. */
  id: string;
  /** The Capability Ladder tier this outcome contributes to. */
  tier: CapabilityTier;
  /** Human description: what user-visible thing this outcome proves. */
  description: string;
  /** Default: T0/T1 60s, T2/T3 600s, T4+ 900s. */
  timeout_ms?: number;
  /** Tolerated flake rate (0..1) — fraction of recent runs that may fail. Default 0. */
  flake_tolerance?: number;
  /**
   * File path the outcome claims is the capability's home. MANDATORY for T2+ outcomes
   * (enforced by `validateOutcomeForTier`). At T3+, the harden gate also verifies
   * the callsite is reachable from production code.
   */
  required_callsite?: string;
  /**
   * True when this outcome was written by the matrix-build scaffolder as a
   * placeholder (command is `exit 1`, callsite is a TODO). It declares the depth
   * requirement so the 7→9 path is visible, but proves nothing until a human
   * replaces it with a real check. Scaffold outcomes fail by construction and are
   * treated as INFERRED — they can never contribute to a T7 receipt.
   */
  _scaffold?: boolean;
}

/** Default outcome kind: runs a shell command and checks exit code + output pattern. */
export interface ShellOutcome extends BaseOutcome {
  kind?: 'shell';
  /** Shell command run from the project root. Cold execution — no cache reuse. */
  command: string;
  /** Default 0 (exit success). Set non-zero only for "expected failure" outcomes. */
  expected_exit?: number;
  /** Optional regex on combined stdout+stderr that must match for the outcome to pass. */
  expected_output_pattern?: string;
}

/**
 * Substrate-built-in check: production-usage-fresh.
 * Passes iff at least one non-test file imports `required_callsite` AND was
 * modified within `freshnessDays` against `baseBranch`. Catches the orphan +
 * parallel-implementation failure modes.
 */
export interface ProductionUsageFreshOutcome extends BaseOutcome {
  kind: 'production-usage-fresh';
  /** Lookback window in days. Default 30. */
  freshnessDays?: number;
  /** Git base branch to measure freshness against. Default 'main'. */
  baseBranch?: string;
}

/**
 * External-benchmark outcome (Phase H Slice 1 future): runs a recognized
 * benchmark suite and checks pass rate. Schema reserved; runner not yet
 * implemented — substrate falls back to shell.
 */
export interface ExternalBenchmarkOutcome extends BaseOutcome {
  kind: 'external-benchmark';
  /** Benchmark name from a recognized registry (e.g. 'swe-bench-lite', 'humaneval'). */
  benchmark: string;
  /** Minimum pass rate (0..1) required. */
  min_pass_rate: number;
  /** Shell command to invoke the benchmark. Substrate also validates `benchmark` is registered. */
  command: string;
}

/**
 * Telemetry outcome (Phase H Slice 1 future): queries a real telemetry source.
 * Schema reserved; runner not yet implemented.
 */
export interface TelemetryOutcome extends BaseOutcome {
  kind: 'telemetry';
  /** Registered telemetry source id. */
  source: string;
  /** Min distinct users in the last 30 days. */
  min_users: number;
}

/**
 * CLI smoke outcome: spawns the real CLI binary as a subprocess and validates
 * exit code + stdout patterns. Proves the feature RUNS, not just EXISTS.
 */
export interface CliSmokeOutcome extends BaseOutcome {
  kind: 'cli-smoke';
  /** CLI args passed after the binary (e.g. ['--help'] or ['validate', 'testing']). */
  cli_args: string[];
  /** Expected exit code. Default 0. */
  expected_exit?: number;
  /** Regex patterns that stdout must match (all must match). */
  expected_stdout_patterns?: string[];
  /** Regex patterns that indicate failure (any match = fail). */
  forbidden_stdout_patterns?: string[];
  /** Where to run: 'project-root' (default) or 'temp' for isolated runs. */
  cwd_strategy?: 'temp' | 'project-root';
}

/**
 * Runtime execution outcome: runs a real command (tests, builds) and enforces
 * minimum duration to reject trivial file checks masquerading as runtime.
 */
export interface RuntimeExecOutcome extends BaseOutcome {
  kind: 'runtime-exec';
  /** Shell command that exercises real runtime behavior. */
  command: string;
  /** Expected exit code. Default 0. */
  expected_exit?: number;
  /** Regex pattern stdout must match. */
  expected_output_pattern?: string;
  /** Minimum duration in ms — rejects instant file checks. Default 0 (no minimum). */
  min_duration_ms?: number;
}

/**
 * End-to-end workflow outcome: runs a multi-step CLI workflow and validates
 * artifacts after each step. The ultimate runtime quality proof.
 */
export interface E2eWorkflowOutcome extends BaseOutcome {
  kind: 'e2e-workflow';
  /** Ordered steps to execute. Each step is a CLI invocation + validation. */
  steps: Array<{
    cli_args: string[];
    expected_exit?: number;
    expected_stdout_patterns?: string[];
    /** Artifact paths (relative to cwd) that must exist after this step. */
    expected_artifacts?: string[];
  }>;
  /** If true, run the generated project's build+test after all steps. */
  verify_generated_project?: boolean;
  /** Where to run: 'project-root' (default) or 'temp' for isolated runs. */
  cwd_strategy?: 'temp' | 'project-root';
}

/** Discriminated union — every outcome is one of these. */
export type Outcome =
  | ShellOutcome | ProductionUsageFreshOutcome | ExternalBenchmarkOutcome | TelemetryOutcome
  | CliSmokeOutcome | RuntimeExecOutcome | E2eWorkflowOutcome;

// ── Evidence ─────────────────────────────────────────────────────────────────

export interface OutcomeEvidenceEntry {
  dimensionId: string;
  outcomeId: string;
  tier: CapabilityTier;
  gitSha: string | null;
  passed: boolean;
  exitCode: number;
  durationMs: number;
  /** Last ~100 lines of stdout, for forensics. */
  stdoutTail: string;
  /** Last ~100 lines of stderr. */
  stderrTail: string;
  /** Reason for failure when passed=false. */
  failureReason?: string;
  ranAt: string;
  /** Path to the file on disk that holds this entry. */
  evidencePath: string;
  /**
   * Number of execution attempts. Absent (or 1) means a single attempt.
   * 2+ means a retry occurred due to flake_tolerance.
   */
  attemptCount?: number;
  /**
   * When attemptCount > 1 and the outcome ultimately passed, this records
   * why the first attempt failed — so evidence is not misleadingly silent
   * about the initial failure.
   */
  firstAttemptFailureReason?: string;
  /**
   * Evidence quality tier from the confidence-tagging doctrine.
   * EXTRACTED = explicitly observed from a primary source (trust 1.0).
   * INFERRED  = reasonable deduction; confidence 0.55–0.95.
   * AMBIGUOUS = uncertain; score should not be raised based on this alone.
   */
  evidenceQuality?: 'EXTRACTED' | 'INFERRED' | 'AMBIGUOUS';
  /** Numeric confidence: 1.0 (EXTRACTED), 0.55–0.95 (INFERRED), 0.1–0.3 (AMBIGUOUS). */
  confidenceScore?: number;
  /**
   * Process-level session identifier stamped by the outcome-runner at write time.
   * A new UUID is generated per `danteforge validate` invocation. T7 requires
   * evidence from ≥2 distinct sessions — a single run cannot self-certify at T7.
   */
  session_id?: string;
}

/**
 * Aggregate of outcome evidence for many dims/outcomes, keyed by `${dimId}/${outcomeId}`.
 * The runner produces this; the score derivation consumes it.
 */
export type OutcomeEvidence = Map<string, OutcomeEvidenceEntry>;

export function makeEvidenceKey(dimensionId: string, outcomeId: string): string {
  return `${dimensionId}/${outcomeId}`;
}

// ── Status snapshot (mirrored into matrix.json for fast display) ─────────────

export interface DimensionOutcomeStatus {
  lastRun: string;
  perOutcome: Record<string, {
    passed: boolean;
    evidencePath: string;
    ranAt: string;
  }>;
}

// ── Validators (pattern matches isCapabilityTestSpec) ────────────────────────

const TIER_NAMES: ReadonlyArray<CapabilityTier> = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8'];
const TIER_RANK: Record<CapabilityTier, number> = { T0: 0, T1: 1, T2: 2, T3: 3, T4: 4, T5: 5, T6: 6, T7: 7, T8: 8 };

function isTier(v: unknown): v is CapabilityTier {
  return typeof v === 'string' && (TIER_NAMES as ReadonlyArray<string>).includes(v);
}

export function isValidOutcome(v: unknown): v is Outcome {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || o.id.length === 0) return false;
  if (!isTier(o.tier)) return false;
  if (typeof o.description !== 'string') return false;
  // Shape varies by kind; check the union members.
  const kind = (o.kind as OutcomeKind | undefined) ?? 'shell';
  if (kind === 'shell') {
    if (typeof o.command !== 'string' || o.command.length === 0) return false;
  } else if (kind === 'production-usage-fresh') {
    if (typeof o.required_callsite !== 'string' || o.required_callsite.length === 0) return false;
  } else if (kind === 'external-benchmark') {
    if (typeof o.benchmark !== 'string' || typeof o.command !== 'string') return false;
    if (typeof o.min_pass_rate !== 'number') return false;
  } else if (kind === 'telemetry') {
    if (typeof o.source !== 'string' || typeof o.min_users !== 'number') return false;
  } else if (kind === 'cli-smoke') {
    if (!Array.isArray(o.cli_args)) return false;
  } else if (kind === 'runtime-exec') {
    if (typeof o.command !== 'string' || o.command.length === 0) return false;
  } else if (kind === 'e2e-workflow') {
    if (!Array.isArray(o.steps) || o.steps.length === 0) return false;
  }
  return true;
}

// ── Tier validation ──────────────────────────────────────────────────────────

export interface OutcomeValidationError {
  outcomeId: string;
  tier: CapabilityTier;
  reason: string;
  remedy: string;
}

/**
 * Enforces tier-appropriate constraints on an outcome at declaration time.
 * See docs/CAPABILITY-TIERS.md for the contracts.
 *
 *  - T2+: required_callsite is mandatory
 *  - T3+: required_callsite must exist on disk; the substrate's harden gate
 *         additionally checks production-reachability at run time
 *  - T4+: dim must also declare at least one snapshot-style outcome
 *  - T5+: outcome kind must be 'external-benchmark' OR command references a
 *         recognized benchmark name
 *  - T6:  outcome kind must be 'telemetry'
 *
 * Returns an array of errors (empty when valid). Callers should reject any
 * outcome whose validation array is non-empty.
 */
export function validateOutcomeForTier(
  outcome: Outcome,
  context: { siblingOutcomes?: Outcome[] } = {},
): OutcomeValidationError[] {
  const errors: OutcomeValidationError[] = [];
  const rank = TIER_RANK[outcome.tier];

  if (rank >= TIER_RANK.T2 && !outcome.required_callsite) {
    errors.push({
      outcomeId: outcome.id,
      tier: outcome.tier,
      reason: `T2+ outcomes must declare required_callsite (the file the outcome exercises)`,
      remedy: `Add "required_callsite": "src/...your-file.ts" to the outcome declaration. See docs/CAPABILITY-TIERS.md`,
    });
  }

  if (rank >= TIER_RANK.T4 && context.siblingOutcomes) {
    // T4+ dims must coexist with a snapshot-style outcome.
    // Best-heuristic: command contains "snapshot" / "golden" / "e2e".
    // `kind` undefined is treated as 'shell' (the default).
    const hasSnapshot = context.siblingOutcomes.some(s => {
      const kind = s.kind ?? 'shell';
      if (kind !== 'shell') return false;
      const cmd = (s as ShellOutcome).command ?? '';
      return /\b(snapshot|golden[-_]?path|e2e)\b/i.test(cmd);
    });
    if (!hasSnapshot) {
      errors.push({
        outcomeId: outcome.id,
        tier: outcome.tier,
        reason: `T4+ outcomes require the dim to also declare a snapshot-test outcome`,
        remedy: `Add an outcome whose command invokes a snapshot/golden-path test. See docs/CAPABILITY-TIERS.md tier T4`,
      });
    }
  }

  if (rank >= TIER_RANK.T5) {
    const kind = outcome.kind ?? 'shell';
    const runtimeKinds = new Set(['external-benchmark', 'cli-smoke', 'runtime-exec', 'e2e-workflow']);
    const isRuntimeKind = runtimeKinds.has(kind);
    const cmd = kind === 'shell' ? (outcome as ShellOutcome).command ?? '' : '';
    const refsBenchmark = /\b(swe[-_]?bench|humaneval|mbpp|mmlu)\b/i.test(cmd);
    const refsRealExec = /\b(npx|tsx|node\s+dist|npm\s+run\s+(test|build)|spawn|exec)\b/i.test(cmd);
    if (!isRuntimeKind && !refsBenchmark && !refsRealExec) {
      errors.push({
        outcomeId: outcome.id,
        tier: outcome.tier,
        reason: `T5+ outcomes must use a runtime kind (cli-smoke, runtime-exec, e2e-workflow, external-benchmark) OR execute real code`,
        remedy: `Change kind to 'cli-smoke', 'runtime-exec', or 'e2e-workflow', or rewrite the command to exercise real behavior`,
      });
    }
  }

  if (rank >= TIER_RANK.T6) {
    if (outcome.kind !== 'telemetry') {
      errors.push({
        outcomeId: outcome.id,
        tier: outcome.tier,
        reason: `T6 outcomes must use kind="telemetry" with a registered source`,
        remedy: `Change "kind" to "telemetry" and declare "source" + "min_users". T6 requires real production telemetry`,
      });
    }
  }

  // T7 (multi-receipt consensus): dim must declare 3+ outcomes at T5+ to merit 9.0.
  if (rank >= TIER_RANK.T7 && context.siblingOutcomes) {
    const highTierCount = context.siblingOutcomes.filter(
      s => TIER_RANK[s.tier] >= TIER_RANK.T5,
    ).length;
    if (highTierCount < 3) {
      errors.push({
        outcomeId: outcome.id,
        tier: outcome.tier,
        reason: `T7 (multi-receipt consensus) requires 3+ sibling outcomes at T5+. Found ${highTierCount}.`,
        remedy: `Declare at least 3 outcomes at T5 or higher before adding T7. Multi-receipt consensus proves breadth of depth.`,
      });
    }
  }

  // T8 (live verification): outcome must be telemetry kind or declare a live-check flag.
  if (rank >= TIER_RANK.T8) {
    const kind = outcome.kind ?? 'shell';
    if (kind !== 'telemetry') {
      errors.push({
        outcomeId: outcome.id,
        tier: outcome.tier,
        reason: `T8 (live verification) requires kind="telemetry" with live production evidence`,
        remedy: `Change "kind" to "telemetry". T8 represents same-day live verification.`,
      });
    }
  }

  return errors;
}

/**
 * Validate that all outcomes in a set have unique ids. Duplicate ids cause
 * evidence key collisions — the second evidence entry silently overwrites the
 * first, producing an incorrect derived score.
 *
 * Returns one error per duplicated id (not per duplicated occurrence).
 */
export function validateOutcomesForDuplicateIds(outcomes: Outcome[]): OutcomeValidationError[] {
  const seen = new Set<string>();
  const errors: OutcomeValidationError[] = [];
  for (const o of outcomes) {
    if (seen.has(o.id)) {
      errors.push({
        outcomeId: o.id,
        tier: o.tier,
        reason: `Duplicate outcome id "${o.id}" in dimension. Duplicate ids cause evidence key collisions — the second write silently overwrites the first.`,
        remedy: `Rename one of the outcomes with id "${o.id}" to a unique id. Outcome ids must be unique within a dimension.`,
      });
    }
    seen.add(o.id);
  }
  return errors;
}

/**
 * Apply default timeouts based on tier. Returns a copy.
 */
export function applyOutcomeDefaults(outcome: Outcome): Outcome {
  if (outcome.timeout_ms !== undefined) return outcome;
  let timeout_ms: number;
  switch (outcome.tier) {
    case 'T0':
    case 'T1':
      timeout_ms = 60_000;
      break;
    case 'T2':
    case 'T3':
      timeout_ms = 600_000;
      break;
    default:
      timeout_ms = 900_000;
  }
  return { ...outcome, timeout_ms };
}

/**
 * Does the evidence entry pass? Uniform rule across outcome kinds:
 *   - entry.passed === true (the runner already encodes kind-specific logic)
 *   - For shell outcomes additionally: exitCode === (outcome.expected_exit ?? 0)
 *     and the output pattern (if any) matches.
 */
export function isOutcomePassing(
  outcome: Outcome,
  entry: OutcomeEvidenceEntry | undefined,
): boolean {
  if (!entry) return false;
  if (!entry.passed) return false;

  const kind = outcome.kind ?? 'shell';
  // Non-shell kinds: the runner has already encoded pass/fail. Trust it.
  if (kind !== 'shell' && kind !== 'runtime-exec') return entry.passed;
  // runtime-exec uses same exit+pattern check as shell.
  if (kind === 'runtime-exec') {
    const rt = outcome as RuntimeExecOutcome;
    const expectedExit = rt.expected_exit ?? 0;
    if (entry.exitCode !== expectedExit) return false;
    if (rt.expected_output_pattern) {
      try {
        if (!new RegExp(rt.expected_output_pattern).test(`${entry.stdoutTail}\n${entry.stderrTail}`)) return false;
      } catch { return false; }
    }
    return true;
  }

  // Shell outcomes get the additional exit + pattern checks.
  const shell = outcome as ShellOutcome;
  const expectedExit = shell.expected_exit ?? 0;
  if (entry.exitCode !== expectedExit) return false;
  if (shell.expected_output_pattern) {
    try {
      const re = new RegExp(shell.expected_output_pattern);
      if (!re.test(`${entry.stdoutTail}\n${entry.stderrTail}`)) return false;
    } catch {
      // Bad regex on the outcome declaration — treat as a hard fail with a clear reason.
      return false;
    }
  }
  return true;
}
