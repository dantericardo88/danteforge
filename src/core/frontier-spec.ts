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
import type { DimensionRubricLevel } from '../matrix/types/dimension-graph.js';

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
    /**
     * Multiple realistic inputs/scenarios. The two-session protocol uses a DIFFERENT one per
     * session (selectInputForSession), so a single prepared fixture can't satisfy both sessions —
     * the anti-circular-validation defense. The run_command may reference the input via {input}.
     */
    realistic_inputs?: string[];
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

/** Build a draft spec from whatever the dimension already knows. Operator fills the blanks.
 *
 * Auto-derives every field the dim's real data can honestly support — the highest-scoring TRACKED
 * competitor (never "self"; dims that self-scored above all peers would otherwise scaffold an
 * un-freezable "self" target), and the run_command + required_callsite from the dim's declared
 * capability_test / grounded outcomes. It NEVER fabricates the genuinely-human fields
 * (observed_capability, the beyond-parity category_delta, the observable artifact): those stay
 * honest TODOs so `checkFrontierSpec` flags them as the specific real work that unlocks 9.0.
 *
 * `trackedCompetitors` (the matrix's closed+oss competitor lists) keeps the seeded leader
 * consistent with the guardrail: `checkFrontierSpec` rejects untracked leaders, so seeding one
 * here would make every autonomous init dead-on-arrival. Empty list = legacy behavior (no filter). */
export function scaffoldFrontierSpec(dim: Record<string, unknown>, trackedCompetitors: string[] = []): FrontierSpec {
  const { competitor, score } = pickLeaderTarget(dim, trackedCompetitors);
  const target = 9.0;
  const leaderBelowTarget = !!competitor && score > 0 && score < target;
  const { runCommand, callsite } = deriveRealUserPath(dim);
  return {
    version: 1,
    target_score: target,
    status: 'draft',
    leader_target: {
      competitor: competitor || 'TODO: name the real tracked competitor to match or beat',
      score: score > 0 ? score : 9.0,
      observed_capability: competitor
        ? `TODO: the specific capability "${competitor}" demonstrates at ${score} that this dim must match or beat (see .danteforge/compete/universe/${String(dim.id ?? '<dim>')}.md Score Ladder).`
        : 'TODO: the specific thing the leader does that we must match or beat.',
      // A sub-target leader can only be the frontier via a real beyond-parity delta — emit an
      // unfilled sentinel so the guardrail demands the operator author it (never auto-pass an easy target).
      ...(leaderBelowTarget ? { category_delta: `TODO: the beyond-parity capability that takes this past ${competitor} (${score}) to ${target}.` } : {}),
    },
    real_user_path: {
      required_callsite: callsite ?? 'TODO: src/... the production file this run exercises',
      run_command: runCommand ?? 'TODO: node dist/index.js <real product command> (NOT a test runner)',
      observable_artifacts: [{ kind: 'TODO', path: 'TODO: path to the artifact the run produces' }],
    },
    required_receipts: { min_t5_plus_outcomes: 3, min_distinct_sessions: 2, input_source: 'real-user-path' },
  };
}

/** The honest frontier leader: the highest-scoring TRACKED competitor in dim.scores, never "self"
 *  or "derived". When a non-empty `tracked` list is supplied, only names on it qualify — a dim's
 *  scores map (or legacy named-leader fields) can carry reference-tier tools the matrix does not
 *  track, and `checkFrontierSpec` rejects those, so seeding one would be self-defeating.
 *  Falls back to the legacy named-leader fields (still never "self", still tracked-only). */
function pickLeaderTarget(dim: Record<string, unknown>, tracked: string[] = []): { competitor: string; score: number } {
  const isTracked = (name: string): boolean =>
    tracked.length === 0 || tracked.some(c => c.toLowerCase() === name.toLowerCase());
  const scores = (dim.scores as Record<string, unknown> | undefined) ?? {};
  let best = '', bestScore = -1;
  for (const [name, val] of Object.entries(scores)) {
    if (name === 'self' || name === 'derived' || !isTracked(name)) continue;
    const n = Number(val);
    if (Number.isFinite(n) && n > bestScore) { bestScore = n; best = name; }
  }
  if (best) return { competitor: best, score: bestScore };
  const named = [dim.oss_leader, dim.closed_source_leader]
    .find(v => typeof v === 'string' && v && v !== 'self' && isTracked(v)) as string | undefined;
  const namedScore = Number(dim.oss_leader_score ?? dim.leader_score ?? 9.0) || 9.0;
  return { competitor: named ?? '', score: named ? namedScore : 0 };
}

/** Derive a REAL-product run_command (from the dim's capability_test) and the production callsite
 *  (from its highest-tier grounded outcome). Both honestly default to null → an unfilled sentinel when
 *  the dim has no real-product probe / no wired src/ callsite, so the guardrails still demand authoring. */
function deriveRealUserPath(dim: Record<string, unknown>): { runCommand: string | null; callsite: string | null } {
  let runCommand: string | null = null;
  const capCmd = (dim.capability_test as { command?: string } | undefined)?.command;
  if (capCmd && looksLikeProductRun(capCmd)) runCommand = capCmd;

  let callsite: string | null = null;
  const outcomes = (dim.outcomes as Array<Record<string, unknown>> | undefined) ?? [];
  const ranked = [...outcomes].sort((a, b) => tierRank(String(b.tier ?? '')) - tierRank(String(a.tier ?? '')));
  for (const o of ranked) {
    const cs = o.required_callsite;
    if (typeof cs === 'string' && cs.startsWith('src/') && !TODO_RE.test(cs)) { callsite = cs; break; }
  }
  return { runCommand, callsite };
}

/** A real product invocation (`node dist/index.js <cmd>` / `danteforge <cmd>`), not a test runner,
 *  not a bare `node -e`/echo shell probe, and not a help/version-only screen (a bare help screen
 *  renders for ANY install regardless of capability, so it proves nothing) — the only commands
 *  honest enough to seed a run_command. Exported so the deterministic spec completer
 *  (frontier-spec-complete.ts) applies the SAME bar when mining a dim's outcome evidence. */
export function looksLikeProductRun(cmd: string): boolean {
  if (isTestSuiteCommand(cmd)) return false;
  const m = /(?:node\s+dist\/index\.js|(?:^|\s|&&\s*)danteforge)\s+([a-z][\w-]*)/i.exec(cmd);
  if (!m) return false;
  // Trivially-green subcommands: `danteforge help` / `danteforge version` exercise no capability.
  if (/^(?:help|version)$/i.test(m[1]!)) return false;
  // A standalone --help / -h / --version token anywhere turns the invocation into a help screen
  // (commander prints usage and exits before any capability code runs).
  if (/(?:^|\s)(?:--help|-h|--version)(?:\s|$)/i.test(cmd)) return false;
  return true;
}

/** Numeric rank of a capability tier string ("T5" → 5; unknown → -1). Exported for the spec
 *  completer, which prefers higher-tier outcome evidence when deriving run_command. */
export function tierRank(tier: string): number {
  const m = /^T(\d+)$/.exec(tier.trim());
  return m ? Number(m[1]) : -1;
}

// ── Score-Ladder grounding (the anti-laundering anchor) ─────────────────────────
//
// The two genuinely-hard frontier_spec fields — observed_capability (what the competitor does)
// and category_delta (the beyond-parity bar) — are exactly where an agent could "write its own
// easy exam." But the bar already exists, researched: the per-dim `## Score Ladder`
// (.danteforge/compete/universe/<dim>.md) is competitor-grounded research output (real code paths).
// So we SEED those fields VERBATIM from the ladder rather than letting an agent invent them, and
// `checkFrontierSpec` later rejects any spec whose bar was silently softened away from the ladder.

/** The ladder row at-or-below a score — what a competitor sitting AT that score demonstrates. */
function ladderRowAtOrBelow(rubric: DimensionRubricLevel[], score: number): DimensionRubricLevel | null {
  const atOrBelow = rubric.filter(l => l.score <= score + 1e-9).sort((a, b) => b.score - a.score);
  return atOrBelow[0] ?? null;
}

/** The lowest ladder row at-or-above a target rung — the bar a sub-target leader has not reached. */
function ladderRowAtOrAbove(rubric: DimensionRubricLevel[], score: number): DimensionRubricLevel | null {
  const atOrAbove = rubric.filter(l => l.score >= score - 1e-9).sort((a, b) => a.score - b.score);
  return atOrAbove[0] ?? null;
}

/** Normalize for substring matching — lowercase, collapse whitespace. */
function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** The fingerprint of a ladder descriptor that must survive in the spec field for the bar to count
 *  as "still grounded in the ladder." A meaningful leading fragment, robust to minor human edits. */
function ladderFingerprint(descriptor: string): string {
  return norm(descriptor).slice(0, 48);
}

export interface LadderSeedResult {
  spec: FrontierSpec;
  seeded: { observed_capability: boolean; category_delta: boolean };
  ladder_rows_used: number[];
}

/**
 * Fill the two genuinely-hard `leader_target` fields VERBATIM from the dim's competitor-grounded
 * Score Ladder, when they are still unauthored. The ladder rows are RESEARCH OUTPUT (real competitor code
 * paths) — copying them is not fabrication, it is grounding the 9.0 bar in the documented frontier
 * instead of an agent-invented (potentially laundered) one.
 *
 *  - observed_capability ← the ladder row at the competitor's tracked score (what they demonstrate)
 *  - category_delta      ← the ladder row at the target rung (the beyond-parity bar they haven't reached)
 *
 * Records a `score-ladder:rows N,M` provenance tag in `evidence_ref` so `checkFrontierSpec` can verify
 * the bar was not silently softened. A no-op (returns the spec unchanged) when there is no ladder or
 * the fields are already authored — it NEVER overwrites human authoring and never invents a level.
 */
export function seedLeaderTargetFromLadder(spec: FrontierSpec, rubric: DimensionRubricLevel[]): LadderSeedResult {
  const rowsUsed: number[] = [];
  const seeded = { observed_capability: false, category_delta: false };
  if (rubric.length === 0) return { spec, seeded, ladder_rows_used: rowsUsed };
  const lt = spec.leader_target;

  if (!lt.observed_capability || TODO_RE.test(lt.observed_capability)) {
    const row = ladderRowAtOrBelow(rubric, lt.score) ?? ladderRowAtOrAbove(rubric, lt.score);
    if (row) {
      lt.observed_capability = `[${row.score}/10 — competitor-grounded Score Ladder] ${row.descriptor}`;
      rowsUsed.push(row.score);
      seeded.observed_capability = true;
    }
  }
  if (lt.score < spec.target_score && (!lt.category_delta || TODO_RE.test(lt.category_delta))) {
    const row = ladderRowAtOrAbove(rubric, spec.target_score);
    if (row) {
      lt.category_delta = `[${row.score}/10 — competitor-grounded Score Ladder] ${row.descriptor}`;
      rowsUsed.push(row.score);
      seeded.category_delta = true;
    }
  }
  if (rowsUsed.length > 0) {
    const tag = `score-ladder:rows ${[...new Set(rowsUsed)].sort((a, b) => a - b).join(',')}`;
    lt.evidence_ref = lt.evidence_ref ? `${lt.evidence_ref}; ${tag}` : tag;
  }
  return { spec, seeded, ladder_rows_used: rowsUsed };
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

/** Marks an unauthored spec field. Exported so the spec completer can tell scaffold sentinels
 *  apart from authored values without re-implementing (and drifting from) the guardrail's test. */
export const TODO_RE = /TODO/i;

/** The real-exercise floor: a frontier evidence run must take at least this long — instant
 *  commands prove nothing. SINGLE SOURCE for session-record's Guard 3 AND the spec completer's
 *  viability check, so a completed spec can never carry a run_command the evidence protocol
 *  will structurally reject (live finding: a 644ms derived run_command burned every session). */
export const REAL_RUN_MIN_MS = 1000;

/**
 * Honesty guardrails. A frontier_spec must define a REAL target, not an easy one.
 * `competitors` is the matrix's tracked competitor list (closed + oss).
 */
export function checkFrontierSpec(spec: FrontierSpec, competitors: string[], rubric: DimensionRubricLevel[] = []): FrontierCheckResult {
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

  // Anti-laundering: when a competitor-grounded Score Ladder exists, the frontier bar must be GROUNDED
  // in it — an agent cannot soften the bar into an easy exam it can clear. The category_delta (the
  // target rung the sub-target leader hasn't reached) is the one most worth softening, so guard it.
  if (rubric.length > 0 && lt.score < spec.target_score) {
    const targetRow = ladderRowAtOrAbove(rubric, spec.target_score);
    const delta = lt.category_delta ?? '';
    if (targetRow && delta && !TODO_RE.test(delta) && !norm(delta).includes(ladderFingerprint(targetRow.descriptor))) {
      errors.push(`leader_target.category_delta is not grounded in the competitor-grounded Score Ladder ${targetRow.score}-row ("${targetRow.descriptor.slice(0, 64)}…"). You cannot soften a researched frontier bar — build to the documented ${targetRow.score}.0 capability (seed it with frontier-spec init), or raise target_score with explicit justification.`);
    }
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

  // Anti-circular: the multi-session protocol resists prepared fixtures only when each session runs a
  // DIFFERENT realistic input. With <2 inputs both sessions run the SAME command, so the sessions
  // differ only by a process UUID — proving "two invocations happened," NOT "two meaningfully different
  // exercises happened." That is too weak for the frontier, so it is an ERROR, not a nudge. (Council.)
  if (spec.required_receipts.min_distinct_sessions >= 2 && (rup.realistic_inputs?.length ?? 0) < 2) {
    errors.push('real_user_path.realistic_inputs[] needs ≥2 entries so each distinct session exercises a DIFFERENT realistic input — with one input both sessions run the same command and differ only by a process UUID, which a single staged fixture can satisfy.');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Pick the realistic input for a 0-based session index. With multiple realistic_inputs the
 * two-session protocol rotates through them, so a single prepared fixture cannot satisfy every
 * session. Falls back to the singular realistic_input, or undefined.
 */
export function selectInputForSession(spec: FrontierSpec, sessionIndex: number): string | undefined {
  const inputs = spec.real_user_path.realistic_inputs;
  if (inputs && inputs.length > 0) return inputs[sessionIndex % inputs.length];
  return spec.real_user_path.realistic_input;
}

/** Resolve the run_command for a session, substituting the session's input into any {input} token. */
export function resolveRunCommand(spec: FrontierSpec, sessionIndex: number): string {
  const input = selectInputForSession(spec, sessionIndex);
  const cmd = spec.real_user_path.run_command;
  return input ? cmd.replace(/\{input\}/g, input) : cmd;
}
