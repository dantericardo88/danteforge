// harvested-bar.ts — write a dimension's frontier bar from HARVESTED external feedback.
//
// THE KEYSTONE (define-and-reach-9 feasibility map, 2026-06-16). The "what is a 9" bar — the
// frontier_spec.leader_target (observed_capability + the beyond-parity category_delta) — is today
// seeded from a per-dim `## Score Ladder` that an LLM council member authored, validated only by
// "≥2 source links exist" (hasMinimumSources). checkFrontierSpec grounds the SPEC against that
// LADDER, but nothing grounds the ladder against the world. So an agent can soften the ladder and
// the spec faithfully copies it — the bar is self-authored prose.
//
// Meanwhile harvested external feedback (benchmark leaderboards, competitor capability, real user
// demand) flows ONLY into outcome receipts — it proves the bar was CLEARED but can never WRITE it.
// This module wires harvested feedback into the bar, with a HYBRID trust posture (operator choice,
// 2026-06-16):
//   - benchmark NUMBERS (the leaderboard IS the truth) auto-accept once verified live;
//   - capability / demand PROSE (subjective) is accepted only with a human ratification record.
//
// TRUST BOUNDARY (honest scope): the gate logic here is a PURE function over HarvestedSignal records.
// Its forgery-resistance depends on those records being trustworthy — i.e. `verified_live` set by a
// real re-fetch and `ratified_by` set by a real operator approval, persisted in a kernel-owned,
// signed store (the CH-025 outcome-evidence signing pattern). Building that signed signal store is a
// follow-up (see the challenge filed alongside this module). This module is the bar-writer + the
// posture gate; it does not itself fetch leaderboards or sign records.

import type { FrontierSpec } from './frontier-spec.js';
import { TODO_RE, GROUNDING_GATE_THRESHOLD } from './frontier-spec.js';
import { verifyHarvestedSignalSignature } from './harvested-signal-signer.js';
import { classifyAddressedActor } from './attribution-gate.js';
import { demandPredatesArtifact } from './demand-temporal.js';

export type HarvestKind = 'benchmark' | 'capability' | 'demand';

/** One harvested external fact about what the frontier is. */
export interface HarvestedSignal {
  kind: HarvestKind;
  /** Where this fact came from: a leaderboard URL, a competitor repo/issue URL, or a demand-cluster id. */
  source: string;
  /** ISO timestamp the fact was fetched from the world. */
  fetched_at: string;
  /** DEMAND signals: ISO timestamp the demand was FILED in the world (the issue's createdAt). The anti-fabrication
   *  temporal gate requires this to predate the artifact build, so post-hoc "demand" can't ground a frontier score. */
  demand_created_at?: string;
  /** The human-readable claim this signal grounds (what the competitor does / what users demand). */
  claim: string;
  /** Benchmark signals: the published frontier score. 0-1 (a pass_rate) is normalized to 0-10. */
  numeric?: number;
  /** Benchmark signals: the registered suite this number is from (e.g. 'swe-bench-lite'). */
  suite?: string;
  /** OBJECTIVE (benchmark): true once the source was RE-FETCHED and the number matched. The hybrid
   *  posture auto-accepts a benchmark bar only when this is true. */
  verified_live?: boolean;
  /** SUBJECTIVE (capability/demand): the operator id who ratified this as an honest bar. The hybrid
   *  posture accepts a capability/demand bar only when this is set. */
  ratified_by?: string;
  /** CH-030: HMAC over the signal's factual content (kernel secret). Under enforcement, the gate
   *  trusts verified_live/ratified_by ONLY when this signature is present and valid. */
  sig?: string;
}

/** Normalize a benchmark number to the 0-10 scale the matrix scores on. A value in [0,1] is read as a
 *  pass_rate; anything above 1 is assumed already on 0-10. Clamped to [0,10], one decimal. */
export function normalizeBenchmarkScore(n: number): number {
  const scaled = n <= 1 ? n * 10 : n;
  return Math.round(Math.max(0, Math.min(10, scaled)) * 10) / 10;
}

/** The provenance tag a harvested signal stamps into leader_target.evidence_ref. Mirrors the
 *  `score-ladder:rows N,M` convention so checkFrontierSpec-style gates can read provenance off one field. */
export function harvestTag(sig: HarvestedSignal): string {
  if (sig.kind === 'benchmark') {
    const suite = sig.suite ?? 'suite';
    const num = sig.numeric === undefined ? '?' : normalizeBenchmarkScore(sig.numeric);
    return `harvest-benchmark:${suite}@${num}`;
  }
  return `harvest-${sig.kind}:${sig.source}`;
}

export interface BarProvenance {
  benchmark: Array<{ suite: string; numeric: number | null; raw: string }>;
  capability: string[];
  demand: string[];
}

/** Parse the harvest provenance tags out of an evidence_ref string (ignores non-harvest tags such as
 *  `score-ladder:...`). Returns which harvested signals the bar claims to be grounded in. */
export function classifyBarProvenance(evidenceRef: string | undefined): BarProvenance {
  const out: BarProvenance = { benchmark: [], capability: [], demand: [] };
  if (!evidenceRef) return out;
  for (const part of evidenceRef.split(';').map(s => s.trim()).filter(Boolean)) {
    const bench = /^harvest-benchmark:([^@]+)@(.+)$/.exec(part);
    if (bench) {
      const numeric = Number(bench[2]);
      out.benchmark.push({ suite: bench[1]!.trim(), numeric: Number.isFinite(numeric) ? numeric : null, raw: part });
      continue;
    }
    const cap = /^harvest-capability:(.+)$/.exec(part);
    if (cap) { out.capability.push(cap[1]!.trim()); continue; }
    const dem = /^harvest-demand:(.+)$/.exec(part);
    if (dem) { out.demand.push(dem[1]!.trim()); continue; }
  }
  return out;
}

/** True if the bar's evidence_ref carries ANY harvest provenance tag. */
export function hasHarvestProvenance(evidenceRef: string | undefined): boolean {
  const p = classifyBarProvenance(evidenceRef);
  return p.benchmark.length > 0 || p.capability.length > 0 || p.demand.length > 0;
}

export interface HarvestSeedResult {
  spec: FrontierSpec;
  seeded: { score: boolean; observed_capability: boolean; category_delta: boolean };
  tags: string[];
}

/** Pick the best signal of a kind: highest numeric for benchmark, most-recent fetch otherwise. */
function bestSignal(signals: HarvestedSignal[], kind: HarvestKind): HarvestedSignal | null {
  const of = signals.filter(s => s.kind === kind);
  if (of.length === 0) return null;
  if (kind === 'benchmark') {
    return of.reduce((a, b) => ((b.numeric ?? -1) > (a.numeric ?? -1) ? b : a));
  }
  return of.reduce((a, b) => (b.fetched_at > a.fetched_at ? b : a));
}

/**
 * Write the genuinely-hard leader_target fields from HARVESTED signals, when still unauthored.
 * Mirrors seedLeaderTargetFromLadder's contract: NEVER overwrites already-authored fields, and
 * stamps a provenance tag into evidence_ref so the posture gate can verify the source.
 *
 *  - leader_target.score        ← the best benchmark signal's normalized number (the world's frontier)
 *  - observed_capability        ← the best capability signal's claim (what the leader demonstrably does)
 *  - category_delta             ← the best demand signal's claim (the beyond-parity capability users want),
 *                                 falling back to a second capability signal
 */
export function seedLeaderTargetFromHarvest(spec: FrontierSpec, signals: HarvestedSignal[]): HarvestSeedResult {
  const seeded = { score: false, observed_capability: false, category_delta: false };
  const tags: string[] = [];
  const lt = spec.leader_target;

  const bench = bestSignal(signals, 'benchmark');
  if (bench && bench.numeric !== undefined) {
    lt.score = normalizeBenchmarkScore(bench.numeric);
    tags.push(harvestTag(bench));
    seeded.score = true;
  }

  if (!lt.observed_capability || TODO_RE.test(lt.observed_capability)) {
    const cap = bestSignal(signals, 'capability');
    if (cap) {
      lt.observed_capability = `[harvested — ${cap.source}] ${cap.claim}`;
      tags.push(harvestTag(cap));
      seeded.observed_capability = true;
    }
  }

  if (lt.score < spec.target_score && (!lt.category_delta || TODO_RE.test(lt.category_delta))) {
    const demand = bestSignal(signals, 'demand');
    const caps = signals.filter(s => s.kind === 'capability');
    const src = demand ?? (caps.length > 1 ? caps[caps.length - 1]! : null);
    if (src) {
      lt.category_delta = `[harvested — ${src.source}] ${src.claim}`;
      tags.push(harvestTag(src));
      seeded.category_delta = true;
    }
  }

  if (tags.length > 0) {
    const joined = [...new Set(tags)].join('; ');
    lt.evidence_ref = lt.evidence_ref ? `${lt.evidence_ref}; ${joined}` : joined;
  }

  // ATTRIBUTION teeth wiring (council unanimous 2026-06-23): set the actor fields at seed time so
  // applyFrontierGate's attribution cap actually FIRES (Grok's gap: they were schema-only/read-only).
  //   - addressed_actor: deterministic from the harvested DEMAND text — the requester's own words, NOT
  //     builder-controlled. This is the non-gameable half: a host-filed demand reads 'host' no matter what.
  //   - artifact_actor: the role this dim's ARTIFACT plays, derived from its own run_command + callsite +
  //     observed_capability. A builder-influenced default that the court's ATTRIBUTION check then verifies.
  // When a demand bar's addressed_actor != artifact_actor, the demand-9 structurally caps at 8.5.
  const demandSig = bestSignal(signals, 'demand');
  if (demandSig) spec.addressed_actor = classifyAddressedActor(demandSig.claim);
  const artifactCtx = `${spec.real_user_path.run_command} ${spec.real_user_path.required_callsite} ${lt.observed_capability}`;
  spec.artifact_actor = classifyAddressedActor(artifactCtx);

  return { spec, seeded, tags };
}

export interface HarvestProvenanceOptions {
  /** Gate is active only when enabled (default: the same DANTEFORGE_GROUNDING_GATE flag as the
   *  external-grounding gate — keeps the bar-grounding and clearance-grounding in lockstep). */
  enabled?: boolean;
  /** CH-030: when true, a signal's verified_live/ratified_by is trusted ONLY if it carries a valid
   *  kernel signature (default: the same DANTEFORGE_REQUIRE_SIGNED_EVIDENCE switch as CH-025, so
   *  signature enforcement flips on in lockstep). Off by default: signals can be migrated first. */
  requireSigned?: boolean;
  /** When provided, the anti-fabrication TEMPORAL gate fires on demand bars: every demand must have been FILED
   *  (demand_created_at) strictly BEFORE this artifact-build timestamp, else it is post-hoc (fabricated to match
   *  what was already shipped) and is rejected. Fail-closed: a demand with no parseable createdAt cannot prove it
   *  predates the build. Omit it to skip the temporal check (backward-compatible for existing callers). */
  artifactBuiltAt?: string;
}

/**
 * The HYBRID-POSTURE gate over a dimension's bar provenance. For a target above the grounding
 * threshold, the bar must trace to harvested external feedback (not self-authored ladder prose),
 * and each provenance tag must clear its posture:
 *
 *   - benchmark provenance  → accepted only when a backing signal exists AND is `verified_live`
 *                             (the number was re-fetched and matched — the leaderboard is the truth).
 *   - capability / demand   → accepted only when a backing signal exists AND carries `ratified_by`
 *                             (a human confirmed the subjective bar is honest).
 *
 * A bar with NO harvest provenance at all is the laundering hole this closes: it fails loudly. A tag
 * with no backing signal (a hand-written tag) also fails — the gate requires the real record, whose
 * verified_live/ratified_by an agent cannot honestly self-set (see the module TRUST BOUNDARY note).
 */
export function checkHarvestProvenance(
  spec: FrontierSpec,
  signals: HarvestedSignal[],
  opts: HarvestProvenanceOptions = {},
): { ok: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const enabled = opts.enabled ?? process.env['DANTEFORGE_GROUNDING_GATE'] === '1';
  const requireSigned = opts.requireSigned ?? process.env['DANTEFORGE_REQUIRE_SIGNED_EVIDENCE'] === '1';

  if (!enabled || spec.target_score <= GROUNDING_GATE_THRESHOLD) {
    return { ok: true, errors, warnings };
  }

  // CH-030: under enforcement, a trust claim (verified_live / ratified_by) counts only on a validly
  // signed signal — an agent without the kernel secret cannot forge the signature. Lazy import keeps
  // the hot module light and avoids a load-time cycle (the signer imports kernelSecret from here's sibling).
  const signed = (s: HarvestedSignal): boolean =>
    !requireSigned || verifyHarvestedSignalSignature(s);

  const prov = classifyBarProvenance(spec.leader_target.evidence_ref);
  if (prov.benchmark.length === 0 && prov.capability.length === 0 && prov.demand.length === 0) {
    errors.push(
      `frontier bar is not harvest-grounded — a >${GROUNDING_GATE_THRESHOLD} target must trace to harvested external ` +
      `feedback (a benchmark leaderboard, competitor capability, or real user demand), not self-authored Score Ladder ` +
      `prose. Seed it with seedLeaderTargetFromHarvest from collected HarvestedSignal records.`,
    );
    return { ok: false, errors, warnings };
  }

  for (const b of prov.benchmark) {
    const backing = signals.find(s => s.kind === 'benchmark' && (s.suite ?? 'suite') === b.suite);
    if (!backing) {
      errors.push(`benchmark provenance "${b.raw}" has no backing harvested signal — the tag cannot be hand-written; supply the signal record.`);
    } else if (!backing.verified_live) {
      errors.push(`benchmark bar "${b.suite}" is not verified live — re-fetch the leaderboard so the published number is confirmed before it sets the bar.`);
    } else if (!signed(backing)) {
      errors.push(`benchmark bar "${b.suite}" carries verified_live but no valid kernel signature (CH-030) — a trust claim must be signed, not self-set. Sign it via signedHarvestedSignal after a real re-fetch.`);
    }
  }

  // CAPABILITY bars stay HUMAN-ratified — only a human can confirm a subjective "this capability is honest" bar.
  for (const src of prov.capability) {
    const backing = signals.find(s => s.kind === 'capability' && s.source === src);
    if (!backing) {
      errors.push(`capability provenance "${src}" has no backing harvested signal — supply the signal record.`);
    } else if (!backing.ratified_by) {
      errors.push(`capability bar from "${src}" awaits ratification — a human must confirm this capability bar is honest (hybrid posture).`);
    } else if (!signed(backing)) {
      errors.push(`capability bar from "${src}" carries ratified_by but no valid kernel signature (CH-030) — ratification must be signed, not self-set. Sign it via signedHarvestedSignal at ratify time.`);
    }
  }
  // DEMAND bars clear AUTONOMOUSLY (council 2026-06-23 — the ENGINEERING-frontier autonomy flip). A real re-fetch
  // of the issue URLs + reaction counts IS external truth (the count is the signal, like a benchmark number), so a
  // SIGNED verified_live re-fetch suffices — NO human ratify. This is what makes the engineering frontier reachable
  // without an operator in the loop, while staying non-gameable (verified_live + the count must be re-fetched and
  // kernel-signed; an agent cannot honestly self-set them, per the module TRUST BOUNDARY note).
  for (const src of prov.demand) {
    const backing = signals.find(s => s.kind === 'demand' && s.source === src);
    if (!backing) {
      errors.push(`demand provenance "${src}" has no backing harvested signal — supply the signal record.`);
    } else if (!backing.verified_live) {
      errors.push(`demand bar from "${src}" is not verified_live — re-fetch the real issue URLs + reaction counts (the count is the external truth). Demand clears on a signed re-fetch, no human ratify needed.`);
    } else if (!signed(backing)) {
      errors.push(`demand bar from "${src}" carries verified_live but no valid kernel signature (CH-030) — sign it via signedHarvestedSignal after the re-fetch.`);
    } else if (opts.artifactBuiltAt) {
      // ANTI-FABRICATION TEMPORAL GATE (council 2026-06-23): the demand must have been FILED before the artifact
      // that claims to satisfy it — else it is post-hoc (built X, then filed "I want X" to justify the score).
      // Fires only when the caller supplies the build timestamp (e.g. the earliest validate-receipt time).
      const t = demandPredatesArtifact(backing.demand_created_at, opts.artifactBuiltAt);
      if (!t.ok) errors.push(`demand bar from "${src}": ${t.reason}`);
    }
  }

  if (errors.length === 0 && prov.benchmark.length === 0) {
    warnings.push('bar is grounded in capability/demand only — a benchmark number is the strongest anchor; add one when a registered suite applies.');
  }

  return { ok: errors.length === 0, errors, warnings };
}
