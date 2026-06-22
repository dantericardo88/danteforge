// frontier-spec.ts — the per-dimension "what would 9.0 mean?" contract.
//
// The honest substrate enforces HOW evidence is scored. frontier_spec defines, up front
// and frozen BEFORE implementation, WHAT reaching the frontier means for a dimension: the
// real-user-path run that proves it, the observable artifact it must produce, and the
// competitor it must match-or-beat. Without this, "drive to 9" is a vague grind; with it,
// the work is a concrete, falsifiable target — and the freeze + hash prevent moving the
// goalposts after the fact.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { isTestSuiteCommand } from '../matrix/engines/outcome-quality.js';
import type { DimensionRubricLevel } from '../matrix/types/dimension-graph.js';
import { checkHarvestProvenance, type HarvestedSignal } from './harvested-bar.js';
import { isOutcomePassing, makeEvidenceKey, type Outcome, type OutcomeEvidence } from '../matrix/types/outcome.js';

export type FrontierSpecStatus = 'draft' | 'frozen' | 'validated' | 'stale';

/**
 * The court receipt that authorizes a `validated` spec (court-audit #1). Without this, `status:'validated'`
 * was a bare string anyone could hand-write into matrix.json to mint a 9.0 that never went stale. The
 * receipt binds the validation to THIS dimension, the EXACT content that was reviewed (frozen_hash), and
 * a kernel secret held OUTSIDE the repo (~/.danteforge/kernel-secret) — so a worker editing matrix.json
 * cannot forge it, and a receipt copied to another dim or another machine fails verification.
 */
export interface FrontierValidationReceipt {
  /** computeSpecHash of the content at validation time — must still match or the spec is treated unvalidated. */
  frozen_hash: string;
  /** the independent judges whose consensus produced the PASS. */
  judge_member_ids: string[];
  /** the build-eligible members EXCLUDED from judging (builder-never-judges), bound into the signature so a
   *  receipt where a judge also built the dim fails verification — defense-in-depth on the live court's own
   *  exclusion (which already refuses to convene with a builder-judge). */
  builder_member_ids?: string[];
  validated_at: string;
  /** HMAC over `${dimId}|${frozen_hash}|${sorted judges}[|builders:${sorted builders}]`, keyed by the kernel secret. */
  sig: string;
}

let _kernelSecret: string | null = null;
/** The kernel secret used to sign court receipts. Stored at ~/.danteforge/kernel-secret (a GLOBAL,
 *  gitignored location — NOT the in-repo project .danteforge/), created on first use. Caching keeps the
 *  read-time gate synchronous. NOTE: on a single machine an agent with filesystem read CAN read this
 *  file; the signature still raises forgery from a one-field edit to "read a non-obvious secret + compute
 *  an HMAC", blocks committed/cross-machine forgeries, and is the seam a hardware/remote signer slots into. */
export function kernelSecret(): string {
  if (_kernelSecret) return _kernelSecret;
  const file = join(homedir(), '.danteforge', 'kernel-secret');
  try {
    const existing = readFileSync(file, 'utf8').trim();
    if (existing) { _kernelSecret = existing; return existing; }
  } catch { /* not yet created */ }
  const secret = randomBytes(32).toString('hex');
  try { mkdirSync(join(homedir(), '.danteforge'), { recursive: true }); writeFileSync(file, secret, { mode: 0o600 }); } catch { /* best-effort */ }
  _kernelSecret = secret;
  return secret;
}

/** Sign a court validation. Called ONLY by the frontier-review court on a genuine PASS consensus. The
 *  excluded BUILDERS are bound into the signature (builder-never-judges) so a judge∩builder overlap is
 *  detectable after the fact. Backward-compatible: with no builders recorded the message is the legacy form. */
export function signValidation(dimId: string, frozenHash: string, judges: string[], builders: string[] = []): string {
  const j = [...judges].sort().join(',');
  const msg = builders.length
    ? `${dimId}|${frozenHash}|${j}|builders:${[...builders].sort().join(',')}`
    : `${dimId}|${frozenHash}|${j}`;
  return createHmac('sha256', kernelSecret()).update(msg).digest('hex').slice(0, 32);
}

/** Verify a spec's `validated_by` receipt: present, bound to this dim, matching the current content, the
 *  judges were NOT builders, and correctly signed. A bare `status:'validated'` (no receipt), a post-validation
 *  content edit, or a judge who also built the dim all fail. */
export function verifyValidation(dimId: string, spec: FrontierSpec): boolean {
  const v = spec.validated_by;
  if (!v || !v.sig || !v.frozen_hash) return false;
  if (v.frozen_hash !== computeSpecHash(spec)) return false;            // content edited since validation
  const judges = v.judge_member_ids ?? [];
  const builders = v.builder_member_ids ?? [];
  // builder-never-judges, BOUND into the receipt: a judge who also built the dim makes the validation
  // self-certifying — reject it regardless of an otherwise-valid signature.
  if (builders.some(b => judges.includes(b))) return false;
  return v.sig === signValidation(dimId, v.frozen_hash, judges, builders);
}

/** Sign a builder-provenance token: a KERNEL attestation of which member(s) actually built `dimId`. The court
 *  uses it to seat genuine PEER judges — members that did NOT build this dim (e.g. claude judges a codex-built
 *  dim) — instead of the over-broad "no build-eligible member may judge ANY dim" floor. Only the kernel holds
 *  `kernelSecret()`, so a build agent cannot forge a token to re-seat itself as judge of its own work. */
export function signBuilderProvenance(dimId: string, builders: string[]): string {
  const b = [...builders].sort().join(',');
  return createHmac('sha256', kernelSecret()).update(`court-builder-provenance|${dimId}|${b}`).digest('hex').slice(0, 32);
}

/** Verify a builder-provenance token names EXACTLY the given builders for this dim and is kernel-signed.
 *  Empty builders or a missing/forged token → false (the court then keeps the safe floor). */
export function verifyBuilderProvenance(dimId: string, builders: string[], token: string | undefined): boolean {
  if (!token || builders.length === 0) return false;
  return token === signBuilderProvenance(dimId, builders);
}

export interface FrontierSpec {
  version: number;
  target_score: number;
  status: FrontierSpecStatus;
  frozen_at?: string;
  /** sha256 of the content fields at freeze — a later edit makes the spec `stale`. */
  frozen_hash?: string;
  /** The court receipt authorizing `status:'validated'`. Required for the frontier gate to honor a 9.0
   *  (court-audit #1). Only the frontier-review court writes it. */
  validated_by?: FrontierValidationReceipt;
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

/** Content fields that define the contract — hashed for the freeze. Excludes status, frozen_at,
 *  frozen_hash, and validated_by (the receipt is computed FROM this hash, so it cannot be part of it). */
function contentForHash(spec: FrontierSpec): unknown {
  const { status: _s, frozen_at: _a, frozen_hash: _h, validated_by: _v, ...content } = spec;
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

/** Score above this requires an independently court-VALIDATED frontier_spec. */
export const FRONTIER_GATE_THRESHOLD = 8.0;

/**
 * The frontier gate makes "9.0 = the competitive frontier" binding, AND independently reviewed.
 *   ≤8.0 — real execution, capability proven (real run + frozen target), but NOT court-confirmed.
 *   >8.0 — requires frontier_spec.status === 'validated', which ONLY the frontier-review-court sets
 *          (builder-never-judges, K-of-M consensus). A frozen-but-unvalidated spec caps at 8.0: the
 *          target is declared and a real run exists, but no independent reviewer has confirmed it
 *          genuinely matches the named competitor. This is what makes autonomous-to-9 honest — the
 *          builder cannot self-certify a 9.0. (A `validated` spec edited after the fact goes `stale`
 *          via effectiveStatus and drops back to 8.0.)
 *
 * Lives in core (not validate.ts) so the READ-TIME derived path applies it too — without that, a
 * frozen-but-unvalidated dim with T7 receipts read 9.0 through loadMatrix/gap/decision scores while
 * the court had REJECTED it (live pilot finding, fleet run 3: a court-less 9.0 leaked to the board).
 */
export function applyFrontierGate(score: number, dim: unknown): { score: number; capped: boolean } {
  if (score <= FRONTIER_GATE_THRESHOLD) return { score, capped: false };
  const d = dim as { id?: string; frontier_spec?: FrontierSpec };
  const spec = d.frontier_spec;
  const status = spec ? effectiveStatus(spec) : 'none';
  // 'validated' is honored ONLY with a verifiable court receipt bound to THIS dim, the current content,
  // and the kernel secret (court-audit #1). A bare `status:'validated'` hand-edit — or a content edit
  // after validation — no longer reaches 9.0; it caps at 8.0 like any unvalidated dim.
  if (status === 'validated' && spec && verifyValidation(d.id ?? '', spec)) return { score, capped: false };
  return { score: FRONTIER_GATE_THRESHOLD, capped: true };
}

/** Score above this requires EXTERNAL grounding (master-plan Phase 1c). */
export const GROUNDING_GATE_THRESHOLD = 7.0;

/** True when a dim has ≥1 external-benchmark outcome with a PASSING receipt at HEAD (CH-032
 *  follow-through). Declaration alone is NOT grounding — the gate must require the same passing,
 *  loaded receipt the score derives from, or it can be fooled by an unrun declared outcome. With no
 *  evidence supplied, returns false (the safe direction — a caller that can't verify can't grant). */
function dimIsExternallyGrounded(dim: unknown, evidence?: OutcomeEvidence): boolean {
  const outs = (dim as { outcomes?: Outcome[] }).outcomes;
  const dimId = (dim as { id?: string }).id ?? '';
  if (!Array.isArray(outs)) return false;
  return outs.some(o =>
    o.input_source?.type === 'external-benchmark'
    && !!evidence
    && isOutcomePassing(o, evidence.get(makeEvidenceKey(dimId, o.id))));
}

/**
 * The EXTERNAL-GROUNDING gate (master-plan shape-move #1, Phase 1c). A score >7.0 requires evidence the
 * grader CANNOT author — a registered external-benchmark receipt — not merely internal court validation
 * (the court still judges against a ladder WE wrote). When enabled, an un-grounded dim caps at 7.0; this
 * makes external grounding the ONLY road past 7, which structurally retires the internal-forgery surface.
 *
 * DEFAULT-OFF (`DANTEFORGE_GROUNDING_GATE=1` activates it). It MUST stay off until the first external
 * benchmark lands (Phase 1b): with 0% grounding it caps every dim at 7.0 with no path up and would stall
 * the loop. The operator flips it on in the same step that registers the first external-benchmark outcome.
 * Composed AFTER applyFrontierGate at every read-time score site (the 7.0 floor sits under the 8.0 cap).
 */
export function applyGroundingGate(
  score: number,
  dim: unknown,
  evidence?: OutcomeEvidence,
  enabled: boolean = process.env['DANTEFORGE_GROUNDING_GATE'] === '1',
): { score: number; capped: boolean } {
  if (!enabled || score <= GROUNDING_GATE_THRESHOLD) return { score, capped: false };
  if (dimIsExternallyGrounded(dim, evidence)) return { score, capped: false };
  return { score: GROUNDING_GATE_THRESHOLD, capped: true };
}

/**
 * Honesty guardrails. A frontier_spec must define a REAL target, not an easy one.
 * `competitors` is the matrix's tracked competitor list (closed + oss).
 */
export function checkFrontierSpec(
  spec: FrontierSpec,
  competitors: string[],
  rubric: DimensionRubricLevel[] = [],
  signals: HarvestedSignal[] = [],
): FrontierCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lt = spec.leader_target;
  const rup = spec.real_user_path;

  // The KEYSTONE gate (harvested-bar.ts): when the grounding gate is on, a >7 bar must trace to
  // HARVESTED external feedback, not self-authored Score Ladder prose. No-op when no signals are
  // supplied (legacy callers) or the gate is off — so it never stalls today's loop.
  if (signals.length > 0) {
    const hp = checkHarvestProvenance(spec, signals);
    errors.push(...hp.errors);
    warnings.push(...hp.warnings);
  }

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

  // Missing-ladder gate (court-audit #12): a dim cannot honestly target >8.0 without a competitor-grounded
  // Score Ladder to judge against — otherwise the frontier bar is whatever the agent declares it to be,
  // and a ladderless dim is graded the same as a laddered one purely by omission. Make that omission a
  // loud, actionable failure (only for >gate targets; ≤8.0 needs no ladder).
  if (spec.target_score > FRONTIER_GATE_THRESHOLD && rubric.length === 0) {
    errors.push(`no Score Ladder for this dimension — a >${FRONTIER_GATE_THRESHOLD} target needs a researched rubric to judge against (the per-dim "## Score Ladder"). Author .danteforge/compete/universe/<dim>.md (mirror any sibling dim), then re-freeze.`);
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
