// frontier-spec.ts — the per-dimension "what would 9.0 mean?" contract.
//
// The honest substrate enforces HOW evidence is scored. frontier_spec defines, up front
// and frozen BEFORE implementation, WHAT reaching the frontier means for a dimension: the
// real-user-path run that proves it, the observable artifact it must produce, and the
// competitor it must match-or-beat. Without this, "drive to 9" is a vague grind; with it,
// the work is a concrete, falsifiable target — and the freeze + hash prevent moving the
// goalposts after the fact.

import { createHash } from 'node:crypto';
import { isTestSuiteCommand } from '../matrix/engines/outcome-quality.js';

export type FrontierSpecStatus = 'draft' | 'frozen' | 'validated' | 'stale';

export interface FrontierSpec {
  version: number;
  target_score: number;
  status: FrontierSpecStatus;
  frozen_at?: string;
  /** sha256 of the content fields at freeze — a later edit makes the spec `stale`. */
  frozen_hash?: string;
  leader_target: {
    competitor: string;
    competitor_type?: 'closed-source' | 'oss';
    score: number;
    observed_capability: string;
    /** Required when the leader's own score is below target_score: the beyond-parity delta. */
    category_delta?: string;
    evidence_ref?: string;
  };
  real_user_path: {
    entry_point?: string;
    required_callsite: string;
    /** The REAL product command (not a test runner) that exercises the capability. */
    run_command: string;
    realistic_input?: string;
    observable_artifacts: Array<{ kind: string; path: string }>;
  };
  required_receipts: {
    min_t5_plus_outcomes: number;
    min_distinct_sessions: number;
    input_source: 'real-user-path' | 'external-benchmark';
  };
}

export interface FrontierCheckResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

/** Build a draft spec from whatever the dimension already knows. Operator fills the blanks. */
export function scaffoldFrontierSpec(dim: Record<string, unknown>): FrontierSpec {
  const leader = (dim.oss_leader as string | undefined) ?? (dim.closed_source_leader as string | undefined) ?? '';
  const leaderScore = Number(dim.oss_leader_score ?? dim.leader_score ?? 9.0) || 9.0;
  return {
    version: 1,
    target_score: 9.0,
    status: 'draft',
    leader_target: {
      competitor: leader,
      score: leaderScore,
      observed_capability: 'TODO: the specific thing the leader does that we must match or beat.',
    },
    real_user_path: {
      required_callsite: 'TODO: src/... the production file this run exercises',
      run_command: 'TODO: node dist/index.js <real product command> (NOT a test runner)',
      observable_artifacts: [{ kind: 'TODO', path: 'TODO: path to the artifact the run produces' }],
    },
    required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' },
  };
}

/** Content fields that define the contract — hashed for the freeze, excludes status/frozen_*. */
function contentForHash(spec: FrontierSpec): unknown {
  const { status: _s, frozen_at: _a, frozen_hash: _h, ...content } = spec;
  return content;
}

export function computeSpecHash(spec: FrontierSpec): string {
  return createHash('sha256').update(JSON.stringify(contentForHash(spec))).digest('hex').slice(0, 16);
}

/** Effective status: a frozen spec whose content changed since freeze is `stale`. */
export function effectiveStatus(spec: FrontierSpec): FrontierSpecStatus {
  if ((spec.status === 'frozen' || spec.status === 'validated') && spec.frozen_hash
      && computeSpecHash(spec) !== spec.frozen_hash) {
    return 'stale';
  }
  return spec.status;
}

const TODO_RE = /TODO/i;

/**
 * Honesty guardrails. A frontier_spec must define a REAL target, not an easy one.
 * `competitors` is the matrix's tracked competitor list (closed + oss).
 */
export function checkFrontierSpec(spec: FrontierSpec, competitors: string[]): FrontierCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lt = spec.leader_target;
  const rup = spec.real_user_path;

  if (!lt.competitor || TODO_RE.test(lt.competitor)) {
    errors.push('leader_target.competitor is empty/TODO — name the real competitor to match.');
  } else if (competitors.length > 0 && !competitors.some(c => c.toLowerCase() === lt.competitor.toLowerCase())) {
    errors.push(`leader_target.competitor "${lt.competitor}" is not a tracked competitor (${competitors.join(', ')}). Cannot target self or a reference-tier tool.`);
  }
  if (!lt.observed_capability || TODO_RE.test(lt.observed_capability)) {
    errors.push('leader_target.observed_capability is empty/TODO — state the specific capability the leader has.');
  }
  // A 9.0 spec cannot merely match a sub-9 leader: that would define an easy target.
  if (lt.score < spec.target_score && (!lt.category_delta || TODO_RE.test(lt.category_delta))) {
    errors.push(`leader "${lt.competitor}" scores ${lt.score} < target ${spec.target_score}. Matching a sub-target leader is not frontier — declare leader_target.category_delta (the beyond-parity capability) or lower target_score honestly.`);
  }

  if (!rup.run_command || TODO_RE.test(rup.run_command)) {
    errors.push('real_user_path.run_command is empty/TODO — it must run the real product on a realistic input.');
  } else if (isTestSuiteCommand(rup.run_command)) {
    errors.push(`real_user_path.run_command is a test-runner command — 9.0 requires running the actual product (e.g. node dist/index.js ...), not a test suite.`);
  }
  if (!rup.required_callsite || TODO_RE.test(rup.required_callsite)) {
    errors.push('real_user_path.required_callsite is empty/TODO — name the production file the run exercises.');
  }
  if (!rup.observable_artifacts.length || rup.observable_artifacts.some(a => TODO_RE.test(a.path) || TODO_RE.test(a.kind))) {
    errors.push('real_user_path.observable_artifacts is empty/TODO — declare at least one real artifact the run produces.');
  }

  if (spec.required_receipts.min_distinct_sessions < 2) {
    errors.push('required_receipts.min_distinct_sessions must be >= 2 (single-session evidence cannot self-certify T7).');
  }
  if (spec.required_receipts.min_t5_plus_outcomes < 3) {
    errors.push('required_receipts.min_t5_plus_outcomes must be >= 3 (multi-receipt consensus).');
  }

  if (lt.score < spec.target_score && lt.category_delta && !TODO_RE.test(lt.category_delta)) {
    warnings.push(`Targeting beyond a ${lt.score} leader via a category delta — make sure the delta is real and reviewer-confirmed, not aspirational.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
