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

// ── Outcome kind classifier ───────────────────────────────────────────────────
// Maps an outcome to the highest score tier its evidence can support.
// This is separate from whether the outcome passes — it caps the ceiling
// regardless of pass rate, preventing file-existence checks from claiming T7.

export function classifyOutcomeKind(outcome: Outcome): OutcomeKindClassification {
  const kind = outcome.kind ?? 'shell';
  const cmd = (outcome as { command?: string }).command ?? '';

  // External benchmark outcomes unlock T8 (9.5) — independently reproducible.
  // `swe[-\s]?bench` matches the real variants (swe-bench, swebench, "swe bench")
  // without the unescaped-dot false-match (`swe.bench` would match `sweXbench`).
  if (kind === 'external-benchmark' || /swe[-\s]?bench|exercism|benchmark.*--suite/i.test(cmd)) {
    return { maxScore: 9.5, evidenceTier: 'external-benchmark', reason: 'External benchmark — independently reproducible' };
  }

  // Full E2E workflow or runtime-exec with meaningful output → T7 (9.0)
  if (kind === 'e2e-workflow' || kind === 'runtime-exec') {
    return { maxScore: 9.0, evidenceTier: 'e2e', reason: 'Runtime execution with observable E2E output' };
  }

  // CLI smoke: invokes the real CLI and checks stdout → T6 (8.5)
  if (kind === 'cli-smoke') {
    return { maxScore: 8.5, evidenceTier: 'cli-smoke', reason: 'CLI smoke — real invocation, pattern-checked output' };
  }

  // Shell command running a real test suite (npx tsx, npm test, jest, vitest) → T4 (7.0).
  // These commands prove tests pass in isolation, not production behavior. To unlock T5+,
  // use kind='runtime-exec', 'cli-smoke', or 'e2e-workflow' instead.
  if (kind === 'shell' && /npx\s+tsx\s+--test|npm\s+(?:run\s+)?test|jest|vitest|mocha/.test(cmd)) {
    return { maxScore: 7.0, evidenceTier: 'unit-test', reason: 'Unit/integration test suite — proves isolation, not production behavior; caps at T4/7.0' };
  }

  // Shell: structural file checks (readFileSync, existsSync, file contains string) → T4 (7.0)
  if (kind === 'shell' && /readFileSync|readFile\b|existsSync|statSync/.test(cmd)) {
    return { maxScore: 7.0, evidenceTier: 'file-existence', reason: 'Structural file check — proves code exists, not that it runs' };
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

  // T5+ shell outcomes: reject structural-only file checks (readFileSync pattern).
  // Runtime verification requires cli-smoke, runtime-exec, or e2e-workflow kinds.
  if (rank >= RANK.T5) {
    const kind = outcome.kind ?? 'shell';
    if (kind === 'shell') {
      const cmd = (outcome as { command?: string }).command ?? '';
      if (/readFileSync|readFile|existsSync/.test(cmd) && !/spawn|exec(?:Sync)?|(?:npm|npx)\s+(?:run\s+)?(?:test|build)|tsx\s+--test/.test(cmd)) {
        errors.push({
          outcomeId: outcome.id,
          tier: outcome.tier,
          reason: `T5+ shell outcome is a structural file check, not runtime execution.`,
          remedy: `Change kind to 'cli-smoke', 'runtime-exec', or 'e2e-workflow'. Structural checks cap at T4/7.0.`,
        });
      }
    }
  }

  return errors;
}
