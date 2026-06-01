// outcome-quality.ts — Depth Doctrine quality gate for outcomes.
//
// Prevents trivial outcomes (echo "done", instant commands) from producing
// valid receipts at high tiers. A receipt from a trivial outcome is breadth
// masquerading as depth.
//
// Wired into outcome-runner.ts: after evidence is written, the quality gate
// runs. If it finds violations at T3+, the evidence entry is marked as failed
// even if the shell command exited 0.

import type { CapabilityTier } from '../types/capability-test.js';
import { applyOutcomeDefaults, type Outcome, type OutcomeEvidenceEntry } from '../types/outcome.js';
import { isRegisteredExternalSuite } from './external-suite-registry.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface OutcomeQualityError {
  outcomeId: string;
  tier: CapabilityTier;
  reason: string;
  remedy: string;
}

export interface OutcomeKindClassification {
  /** Evidence-supported max score this outcome can unlock (0–9.5). */
  maxScore: number;
  /** Short label for display. */
  evidenceTier: 'file-existence' | 'unit-test' | 'cli-smoke' | 'e2e' | 'external-benchmark';
  /** Human-readable justification. */
  reason: string;
}

// ── Structural-file-check detection (kind-agnostic) ───────────────────────────
// A command is a "structural file check" when it inspects file contents/existence
// (readFileSync/existsSync/...) WITHOUT actually spawning a process or running a real
// suite. The build loop learned to dodge the file-existence cap by mislabeling
// `node -e "readFileSync(...).includes(...)"` as kind:'runtime-exec' / 'e2e-workflow'
// — but a file read is not runtime execution regardless of what the outcome declares.
// Detection therefore looks at the COMMAND, never the trusted `kind`. Commands that
// ALSO spawn a process / run a suite / invoke the built CLI are exempt (they read a
// file as part of a real run, e.g. checking a generated artifact).
const STRUCTURAL_READ_RE = /readFileSync|readFile\b|existsSync|statSync/;
const REAL_EXECUTION_RE = /spawn|execFile|exec(?:Sync)?\(|child_process|(?:npm|npx)\s+(?:run\s+)?(?:test|build|start)|tsx\s+--test|node\s+dist\//;

export function isStructuralFileCheck(cmd: string): boolean {
  return STRUCTURAL_READ_RE.test(cmd) && !REAL_EXECUTION_RE.test(cmd);
}

// ── Outcome kind classifier ───────────────────────────────────────────────────
// Maps an outcome to the highest score tier its evidence can support.
// This is separate from whether the outcome passes — it caps the ceiling
// regardless of pass rate, preventing file-existence checks from claiming T7.

export function classifyOutcomeKind(outcome: Outcome): OutcomeKindClassification {
  const kind = outcome.kind ?? 'shell';
  const cmd = (outcome as { command?: string }).command ?? '';
  const source = outcome.input_source;

  // 9.5 (T8) — ONLY a registered external suite, declared structurally. Command text
  // alone never earns 9.5: an agent can print "benchmark --suite pass". Two structural
  // paths: a declared input_source.external-benchmark with a registered suite, or the
  // typed ExternalBenchmarkOutcome.benchmark field set to a registered suite (back-compat).
  if (kind === 'external-benchmark' && source?.type === 'external-benchmark' && isRegisteredExternalSuite(source.suite)) {
    return { maxScore: 9.5, evidenceTier: 'external-benchmark', reason: `Registered external benchmark (${source.suite}) — independently reproducible` };
  }
  const benchField = (outcome as { benchmark?: string }).benchmark;
  if (kind === 'external-benchmark' && isRegisteredExternalSuite(benchField)) {
    return { maxScore: 9.5, evidenceTier: 'external-benchmark', reason: `Registered external benchmark (${benchField}) — independently reproducible` };
  }

  // Structural file checks cap at T4/7.0 REGARDLESS of declared kind. Runs before the
  // runtime/e2e branch so a builder cannot escape the cap by mislabeling a
  // `readFileSync(...).includes(...)` one-liner as runtime-exec (the recurring hole).
  if (isStructuralFileCheck(cmd)) {
    return { maxScore: 7.0, evidenceTier: 'file-existence', reason: 'Structural file check (readFileSync/existsSync) — proves code exists, not that it runs; capped at T4/7.0 regardless of declared kind' };
  }

  // Explicitly synthetic evidence (agent-authored fixtures, scaffold stubs): honest about
  // what it is, but cannot prove production behavior → caps at T4/7.0.
  if (source?.type === 'synthetic-fixture') {
    return { maxScore: 7.0, evidenceTier: 'unit-test', reason: 'Synthetic-fixture evidence — declared agent-authored; caps at T4/7.0' };
  }

  // The 9.0 (T7) consensus tier structurally requires a declared real-user-path. Runtime
  // /e2e WITHOUT that declaration are honest runtime checks but cannot self-certify the
  // frontier — they cap at T5/8.0 until provenance is declared. This is what stops
  // mislabeled or undeclared evidence from reaching 9.0, the level where audits found inflation.
  if (kind === 'e2e-workflow' || kind === 'runtime-exec') {
    if (source?.type === 'real-user-path') {
      return { maxScore: 9.0, evidenceTier: 'e2e', reason: 'Runtime execution on a declared real-user-path — observable E2E output' };
    }
    return { maxScore: 8.0, evidenceTier: 'e2e', reason: 'Runtime execution without a declared real-user-path input_source — caps at T5/8.0 until provenance is declared' };
  }

  // CLI smoke: invokes the real CLI and checks stdout → T6 (8.5)
  if (kind === 'cli-smoke') {
    return { maxScore: 8.5, evidenceTier: 'cli-smoke', reason: 'CLI smoke — real invocation, pattern-checked output' };
  }

  // Shell command running a real test suite (npx tsx, npm test, jest, vitest) → T4 (7.0).
  if (kind === 'shell' && /npx\s+tsx\s+--test|npm\s+(?:run\s+)?test|jest|vitest|mocha/.test(cmd)) {
    return { maxScore: 7.0, evidenceTier: 'unit-test', reason: 'Unit/integration test suite — proves isolation, not production behavior; caps at T4/7.0' };
  }

  // Default for unknown shell commands: treat as unit-test level (8.0) — benefit of the doubt
  return { maxScore: 8.0, evidenceTier: 'unit-test', reason: 'Shell command — assumed runtime execution' };
}

// ── Tier rank lookup (local, avoids circular import) ──────────────────────────

const RANK: Record<string, number> = {
  T0: 0, T1: 1, T2: 2, T3: 3, T4: 4, T5: 5, T6: 6, T7: 7, T8: 8,
};

// ── Main gate ─────────────────────────────────────────────────────────────────

/**
 * Validate that an outcome and its evidence meet the quality bar for the
 * declared tier. Returns an empty array when the outcome passes.
 */
export function validateOutcomeQuality(
  outcome: Outcome,
  evidence: OutcomeEvidenceEntry | undefined,
): OutcomeQualityError[] {
  const errors: OutcomeQualityError[] = [];
  const rank = RANK[outcome.tier] ?? 0;

  // T5+ outcomes must have timeout_ms >= 5000 (instant commands can't verify production)
  if (rank >= RANK.T5) {
    const defaults = applyOutcomeDefaults(outcome);
    const timeout = defaults.timeout_ms ?? 0;
    if (timeout < 5000) {
      errors.push({
        outcomeId: outcome.id,
        tier: outcome.tier,
        reason: `T5+ outcome has timeout_ms=${timeout} (<5000ms). Instant outcomes cannot verify production behavior.`,
        remedy: `Set timeout_ms >= 5000 or lower the tier.`,
      });
    }
  }

  // T5+ evidence must produce stdout > 0 bytes (silent outcomes prove nothing observable)
  if (rank >= RANK.T5 && evidence) {
    if ((evidence.stdoutTail ?? '').trim().length === 0) {
      errors.push({
        outcomeId: outcome.id,
        tier: outcome.tier,
        reason: `T5+ outcome produced zero stdout. Silent outcomes cannot prove observable behavior.`,
        remedy: `Ensure the outcome command produces meaningful stdout (test results, metrics, etc).`,
      });
    }
  }

  // T3+ shell outcomes: reject trivially short commands (echo, true, exit 0)
  if (rank >= RANK.T3) {
    const kind = outcome.kind ?? 'shell';
    if (kind === 'shell') {
      const cmd = (outcome as { command?: string }).command ?? '';
      if (cmd.length < 10 || /^(echo|true|exit)\s/i.test(cmd)) {
        errors.push({
          outcomeId: outcome.id,
          tier: outcome.tier,
          reason: `Shell command "${cmd.slice(0, 40)}" looks trivial for T${rank}+ outcome.`,
          remedy: `Use a real test/benchmark command. Trivial commands cannot prove production behavior.`,
        });
      }
    }
  }

  // T5+ duration floor (every kind, not just runtime-exec). A receipt that "passes" in
  // a few ms did not exercise real behavior. Enforced against the declared min_duration_ms;
  // T5+ outcomes that set one below 500ms are themselves suspect.
  if (rank >= RANK.T5 && evidence) {
    const minDur = (outcome as { min_duration_ms?: number }).min_duration_ms ?? 0;
    if (minDur > 0 && (evidence.durationMs ?? 0) < minDur) {
      errors.push({
        outcomeId: outcome.id,
        tier: outcome.tier,
        reason: `T5+ outcome ran in ${evidence.durationMs ?? 0}ms (< declared min_duration_ms=${minDur}). Instant passes do not prove production behavior.`,
        remedy: `Ensure the command actually exercises the capability, or lower the tier.`,
      });
    }
  }

  // T5+ outcomes: reject structural-only file checks (readFileSync pattern) REGARDLESS
  // of declared kind. A builder mislabeling a `readFileSync(...).includes(...)` one-liner
  // as runtime-exec/e2e does not make it runtime verification — detection is by command,
  // not the trusted kind. Commands that also spawn/exec/run a suite are exempt.
  if (rank >= RANK.T5) {
    const cmd = (outcome as { command?: string }).command ?? '';
    if (isStructuralFileCheck(cmd)) {
      errors.push({
        outcomeId: outcome.id,
        tier: outcome.tier,
        reason: `T5+ outcome "${outcome.id}" (kind=${outcome.kind ?? 'shell'}) is a structural file check, not runtime execution.`,
        remedy: `Make the command actually run the capability (spawn the CLI / run a suite) — relabeling the kind does not lift the cap. Structural checks cap at T4/7.0.`,
      });
    }
  }

  return errors;
}
