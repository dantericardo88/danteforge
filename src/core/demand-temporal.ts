// demand-temporal.ts — the DATED-BEFORE-BUILD anti-fabrication gate.
//
// Council unanimous (Grok + Codex + Claude, 2026-06-23): operator/dogfood feedback CAN ground a demand-validated
// engineering-9 — it flows through the demand loop identically to competitor demand — but ONLY if the demand was
// filed BEFORE the artifact that claims to satisfy it. Without this, the agent (or a future loop) reverse-fabricates
// "demand" to match what it already shipped. attribution-gate checks WHO the demand addresses; demand-reverify
// checks it is STILL-LIVE; this checks the demand CAME FIRST. It is the demand-side mirror of the contamination-
// resistance the whole lattice rests on, and the council flagged it as the #1 missing teeth (it was doctrine, not
// code). FAIL-CLOSED: a demand or build with no parseable date cannot prove ordering, so it does not ground a 9.

export interface TemporalVerdict {
  ok: boolean;
  reason: string;
}

/** ok IFF the demand was created STRICTLY before the artifact was built. Missing/unparseable dates fail closed. */
export function demandPredatesArtifact(
  demandCreatedAt: string | undefined,
  artifactBuiltAt: string | undefined,
): TemporalVerdict {
  const d = Date.parse(demandCreatedAt ?? '');
  const a = Date.parse(artifactBuiltAt ?? '');
  if (!Number.isFinite(d)) return { ok: false, reason: 'demand has no parseable createdAt — cannot prove it predates the build (fail-closed)' };
  if (!Number.isFinite(a)) return { ok: false, reason: 'artifact has no parseable build time — cannot prove the demand predates it (fail-closed)' };
  if (d < a) return { ok: true, reason: '' };
  return {
    ok: false,
    reason: `demand (createdAt ${demandCreatedAt}) was filed at/after the artifact build (${artifactBuiltAt}) — post-hoc demand cannot ground a frontier score (anti-fabrication)`,
  };
}

/** The LATEST createdAt across a set of demand records (the binding one for a cluster), or undefined if none parse. */
export function latestDemandDate(createdAts: Array<string | undefined>): string | undefined {
  const parsed = createdAts
    .map(s => ({ s, t: Date.parse(s ?? '') }))
    .filter(x => Number.isFinite(x.t));
  if (parsed.length === 0) return undefined;
  return parsed.sort((a, b) => b.t - a.t)[0]!.s;
}

/**
 * A demand CLUSTER grounds a frontier score only if EVERY demand in it predates the artifact — so the strictest
 * (binding) check is the LATEST demand vs the build time. If the latest demand predates the build, all of them do.
 */
export function demandClusterPredatesArtifact(
  demandCreatedAts: Array<string | undefined>,
  artifactBuiltAt: string | undefined,
): TemporalVerdict {
  const latest = latestDemandDate(demandCreatedAts);
  if (!latest) return { ok: false, reason: 'no demand record has a parseable createdAt — cannot prove the cluster predates the build (fail-closed)' };
  return demandPredatesArtifact(latest, artifactBuiltAt);
}
