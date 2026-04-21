// frontier-gap-engine.ts — DanteForge Frontier Gap Engine
// Turns matrix dimensions into ranked skeptic objections with required proofs.

import type { CompeteMatrix, MatrixDimension } from './compete-matrix.js';
import type {
  FrontierDimension,
  FrontierReport,
  FrontierStatus,
  GapType,
  RaiseReadinessReport,
  RaiseVerdict,
  SkepticObjection,
} from './frontier-types.js';

// ── Gap Type Classification ───────────────────────────────────────────────────

export function classifyGapType(dim: MatrixDimension): GapType {
  const self = dim.scores['self'] ?? 0;
  const gap = dim.gap_to_leader;

  // Large capability gap: self is less than half the competitor leader
  if (self < 4 && gap > 3) return 'capability';

  // Score is moderate but gap is still significant → needs proof, not more code
  if (self >= 4 && self < 7 && gap > 2) return 'proof';

  // Score is near-parity → productization (docs, onboarding, packaging)
  if (gap <= 1) return 'productization';

  // Score is decent, gap is small → reliability (needs CI, repeated runs, platforms)
  if (self >= 6 && gap <= 2) return 'reliability';

  // Default fallback for mid-range ambiguous cases
  return 'proof';
}

// ── Frontier Status ───────────────────────────────────────────────────────────

export function classifyFrontierStatus(dim: MatrixDimension): FrontierStatus {
  const self = dim.scores['self'] ?? 0;
  const gap = dim.gap_to_leader;

  if (self >= 9 && gap <= 0) return 'creativity-frontier';
  if (gap <= 0) return 'frontier-complete';
  if (gap <= 3) return 'near-frontier';
  return 'catch-up';
}

// ── Required Proof Templates ──────────────────────────────────────────────────

const PROOF_TEMPLATES: Record<GapType, (label: string) => string> = {
  capability: (label) =>
    `Implement real ${label} with a non-mocked integration test that exercises the full path end-to-end`,
  proof: (label) =>
    `Add a non-skipped integration test covering ${label} plus one flagship workflow artifact produced by the live system`,
  reliability: (label) =>
    `Run repeated CI across two platforms (Linux + macOS/Windows) with ${label} evidence in each run`,
  productization: (label) =>
    `Ship user-facing documentation + onboarding path for ${label} with a working example in the README`,
};

export function buildRequiredProof(dim: MatrixDimension, gapType: GapType): string {
  return PROOF_TEMPLATES[gapType](dim.label);
}

// ── Objection Text Templates ──────────────────────────────────────────────────

const OBJECTION_TEMPLATES: Record<GapType, (dim: MatrixDimension, leader: string) => string> = {
  capability: (dim, leader) =>
    `${dim.label} is significantly under-implemented compared to ${leader} — the core capability gap has not been closed`,
  proof: (dim, leader) =>
    `${dim.label} may be implemented, but proof is mocked or absent; ${leader} demonstrates it in real conditions`,
  reliability: (dim, leader) =>
    `${dim.label} works in development, but lacks repeated CI evidence and cross-platform validation that ${leader} provides`,
  productization: (dim) =>
    `${dim.label} is technically present but not packaged for users — no clear onboarding, docs, or adoption path`,
};

function buildObjectionText(dim: MatrixDimension, gapType: GapType): string {
  return OBJECTION_TEMPLATES[gapType](dim, dim.leader || dim.closed_source_leader || 'top competitor');
}

// ── Current Claim Generator ───────────────────────────────────────────────────

export function buildCurrentClaim(dim: MatrixDimension): string {
  const self = dim.scores['self'] ?? 0;
  if (self >= 8) return `${dim.label} is implemented and production-ready`;
  if (self >= 6) return `${dim.label} is implemented with known gaps`;
  if (self >= 4) return `${dim.label} is partially implemented`;
  return `${dim.label} is not yet meaningfully implemented`;
}

// ── Leverage Score ────────────────────────────────────────────────────────────
// Composite rank: how much this objection is worth closing right now.
// Higher = more urgent.

export function computeLeverage(dim: MatrixDimension, severity: number): number {
  const weight = dim.weight ?? 1.0;
  // Closability: inversely proportional to gap — big gaps are harder to close
  const closability = Math.max(0, 1 - dim.gap_to_leader / 10);
  return Math.round(weight * severity * (0.5 + closability) * 10) / 10;
}

// ── Severity Score ────────────────────────────────────────────────────────────

export function computeSeverity(dim: MatrixDimension): number {
  const gap = dim.gap_to_leader;
  // Severity 0–10: bigger gap → higher severity (but capped)
  return Math.min(10, Math.round(gap * 1.5 * 10) / 10);
}

// ── Next Justified Score ──────────────────────────────────────────────────────

export function computeNextJustifiedScore(dim: MatrixDimension, gapType: GapType): number {
  const self = dim.scores['self'] ?? 0;
  const increments: Record<GapType, number> = {
    capability: 1,      // closing a capability gap is a big lift → only +1 per proof
    proof: 1,           // proof gap → closing the proof earns +1
    reliability: 0.5,   // reliability is incremental → +0.5
    productization: 0.5,
  };
  return Math.min(10, Math.round((self + increments[gapType]) * 10) / 10);
}

// ── What Remains After Closing This Proof ────────────────────────────────────

function buildWhatRemains(dim: MatrixDimension, gapType: GapType): string {
  const nextScore = computeNextJustifiedScore(dim, gapType);
  const remaining = dim.gap_to_leader - (nextScore - (dim.scores['self'] ?? 0));
  if (remaining <= 0) return 'Parity gap effectively closed — move to creativity frontier';
  if (gapType === 'capability') return `${remaining.toFixed(1)}-point gap remains — proof and reliability work still needed`;
  if (gapType === 'proof') return `${remaining.toFixed(1)}-point gap remains — reliability and productization still needed`;
  return `${remaining.toFixed(1)}-point gap remains — further hardening or packaging needed`;
}

// ── Build FrontierDimension from MatrixDimension ──────────────────────────────

export function buildFrontierDimension(dim: MatrixDimension): FrontierDimension {
  const gapType = classifyGapType(dim);
  const status = classifyFrontierStatus(dim);
  const severity = computeSeverity(dim);
  const leverage = computeLeverage(dim, severity);
  const self = dim.scores['self'] ?? 0;
  const bestScore = Math.max(
    ...Object.entries(dim.scores).filter(([k]) => k !== 'self').map(([, v]) => v),
    self,
  );

  const objection: SkepticObjection = {
    text: buildObjectionText(dim, gapType),
    gapType,
    severity,
    requiredProof: buildRequiredProof(dim, gapType),
    nextJustifiedScore: computeNextJustifiedScore(dim, gapType),
    whatRemainsAfter: buildWhatRemains(dim, gapType),
  };

  return {
    id: dim.id,
    label: dim.label,
    currentClaim: buildCurrentClaim(dim),
    currentScore: self,
    competitorBestScore: bestScore,
    competitorBestName: dim.leader || dim.closed_source_leader || 'unknown',
    objection,
    status,
    leverage,
  };
}

// ── Full Report from Matrix ───────────────────────────────────────────────────

export function buildFrontierReport(matrix: CompeteMatrix): FrontierReport {
  const dimensions = matrix.dimensions.map(buildFrontierDimension);

  // Sort by leverage descending
  const sorted = [...dimensions].sort((a, b) => b.leverage - a.leverage);
  const topObjections = sorted.slice(0, 5);
  // "Do not work on" = bottom 5 by leverage (exclude frontier-complete and creativity-frontier)
  const workable = sorted.filter(
    (d) => d.status !== 'frontier-complete' && d.status !== 'creativity-frontier',
  );
  const doNotWorkOn = workable.slice(-5).reverse();

  return {
    timestamp: new Date().toISOString(),
    projectName: matrix.project,
    overallSelfScore: matrix.overallSelfScore,
    dimensions,
    topObjections,
    doNotWorkOn,
  };
}

// ── Single Dimension Lookup ───────────────────────────────────────────────────

export function findDimension(matrix: CompeteMatrix, query: string): FrontierDimension | null {
  const q = query.toLowerCase().trim();
  const found = matrix.dimensions.find(
    (d) =>
      d.id.toLowerCase() === q ||
      d.label.toLowerCase().includes(q) ||
      d.id.toLowerCase().replace(/_/g, '').includes(q.replace(/[^a-z0-9]/g, '')),
  );
  return found ? buildFrontierDimension(found) : null;
}

// ── Raise-Readiness Synthesis ─────────────────────────────────────────────────

export function buildRaiseReadinessReport(matrix: CompeteMatrix): RaiseReadinessReport {
  const dimensions = matrix.dimensions.map(buildFrontierDimension);

  const breakdown: Record<GapType, number> = {
    capability: 0,
    proof: 0,
    reliability: 0,
    productization: 0,
  };

  const killerObjections: RaiseReadinessReport['killerObjections'] = [];
  const fixIn3to7Days: RaiseReadinessReport['fixIn3to7Days'] = [];

  for (const d of dimensions) {
    if (d.status === 'frontier-complete' || d.status === 'creativity-frontier') continue;
    breakdown[d.objection.gapType]++;
    // High-leverage gaps with short proof timelines are "fixable in 3-7 days"
    if (d.leverage >= 5 && d.objection.gapType === 'proof') {
      fixIn3to7Days.push({ label: d.label, proof: d.objection.requiredProof });
    }
    // Capability gaps with high severity are investor killers
    if (d.objection.gapType === 'capability' && d.objection.severity >= 6) {
      killerObjections.push({
        label: d.label,
        objection: d.objection.text,
        gapType: d.objection.gapType,
      });
    }
  }

  const verdict = computeRaiseVerdict(breakdown, matrix.overallSelfScore, killerObjections.length);
  const isRaiseReady = verdict === 'package story and raise';

  return {
    verdict,
    isRaiseReady,
    overallSelfScore: matrix.overallSelfScore,
    killerObjections,
    fixIn3to7Days,
    gapTypeBreakdown: breakdown,
  };
}

function computeRaiseVerdict(
  breakdown: Record<GapType, number>,
  selfScore: number,
  killerCount: number,
): RaiseVerdict {
  if (killerCount > 2 || breakdown['capability'] > breakdown['proof'] + breakdown['reliability']) {
    return 'build more';
  }
  if (selfScore < 7 || breakdown['proof'] > 3) {
    return 'validate more';
  }
  if (breakdown['reliability'] >= breakdown['productization']) {
    return 'harden more';
  }
  return 'package story and raise';
}
