// src/scoring/run-matrix.ts — Full matrix runner with aggregation

import type {
  MatrixSnapshot,
  DimensionScore,
  CategoryRollup,
  RubricTotal,
  RubricId,
  EvidenceRecord,
  SnapshotDiff,
} from './types.js';
import type { DimensionDefinition } from './types.js';
import { scoreAllDimensions } from './score-dimension.js';
import { ALL_RUBRIC_IDS } from './rubrics.js';
import { getDimensionsByCategory } from './dimensions.js';

// ── Matrix runner ─────────────────────────────────────────────────────────────

export interface RunMatrixOptions {
  matrixId: string;
  subject: string;
  dimensions: DimensionDefinition[];
  evidence: EvidenceRecord[];
  rubricIds?: RubricId[];
}

export function runMatrix(opts: RunMatrixOptions): MatrixSnapshot {
  const rubricIds = opts.rubricIds ?? ALL_RUBRIC_IDS;
  const scores = scoreAllDimensions(opts.evidence, opts.dimensions, rubricIds);

  const rubricScores = computeRubricTotals(scores, rubricIds);
  const categories = computeCategoryRollups(scores, opts.dimensions, rubricIds);

  return {
    matrixId: opts.matrixId,
    subject: opts.subject,
    generatedAt: new Date().toISOString(),
    rubricScores,
    categories,
    dimensions: scores,
  };
}

function computeRubricTotals(scores: DimensionScore[], rubricIds: RubricId[]): RubricTotal[] {
  return rubricIds.map((rubricId) => {
    const rubricScores = scores.filter((s) => s.rubricId === rubricId);
    const total = rubricScores.reduce((sum, s) => sum + s.score, 0);
    const maxTotal = rubricScores.reduce((sum, s) => sum + s.maxScore, 0);
    return {
      rubricId,
      total: Math.round(total * 10) / 10,
      maxTotal,
      normalized: maxTotal > 0 ? Math.round((total / maxTotal) * 1000) / 10 : 0,
    };
  });
}

function computeCategoryRollups(
  scores: DimensionScore[],
  dimensions: DimensionDefinition[],
  rubricIds: RubricId[],
): CategoryRollup[] {
  const byCategory = getDimensionsByCategory();
  const rollups: CategoryRollup[] = [];

  for (const [category, dims] of byCategory) {
    const dimIds = new Set(dims.map((d) => d.id));
    for (const rubricId of rubricIds) {
      const catScores = scores.filter((s) => dimIds.has(s.dimensionId) && s.rubricId === rubricId);
      const total = catScores.reduce((sum, s) => sum + s.score, 0);
      const maxTotal = catScores.reduce((sum, s) => sum + s.maxScore, 0);
      rollups.push({
        category,
        rubricId,
        total: Math.round(total * 10) / 10,
        maxTotal,
        normalized: maxTotal > 0 ? Math.round((total / maxTotal) * 1000) / 10 : 0,
        dimensionIds: dims.map((d) => d.id),
      });
    }
  }

  return rollups;
}

// ── Analysis helpers ──────────────────────────────────────────────────────────

export function getTopOverclaimed(snapshot: MatrixSnapshot, limit = 5): DimensionScore[] {
  const opt = snapshot.dimensions.filter((s) => s.rubricId === 'internal_optimistic');
  const hostile = snapshot.dimensions.filter((s) => s.rubricId === 'hostile_diligence');

  return opt
    .map((o) => {
      const h = hostile.find((x) => x.dimensionId === o.dimensionId);
      return { score: o, gap: h ? o.score - h.score : 0 };
    })
    .sort((a, b) => b.gap - a.gap)
    .slice(0, limit)
    .map((x) => x.score);
}

export function getTopUnderProven(snapshot: MatrixSnapshot, limit = 5): DimensionScore[] {
  return snapshot.dimensions
    .filter((s) => s.rubricId === 'public_defensible' && s.score < 5)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
}

export function getNextLifts(snapshot: MatrixSnapshot, limit = 5): DimensionScore[] {
  return snapshot.dimensions
    .filter((s) => s.rubricId === 'internal_optimistic' && s.nextLift)
    .sort((a, b) => (b.maxScore - b.score) - (a.maxScore - a.score))
    .slice(0, limit);
}

// ── Snapshot diff ─────────────────────────────────────────────────────────────

export function diffSnapshots(before: MatrixSnapshot, after: MatrixSnapshot): SnapshotDiff {
  const beforeMap = new Map(before.dimensions.map((s) => [`${s.dimensionId}:${s.rubricId}`, s]));
  const afterMap = new Map(after.dimensions.map((s) => [`${s.dimensionId}:${s.rubricId}`, s]));

  const allKeys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes: SnapshotDiff['dimensionChanges'] = [];

  for (const key of allKeys) {
    const b = beforeMap.get(key);
    const a = afterMap.get(key);
    if (!b || !a) continue;

    const delta = Math.round((a.score - b.score) * 10) / 10;
    const refsChanged = JSON.stringify(b.evidenceRefs.sort()) !== JSON.stringify(a.evidenceRefs.sort());
    const driver =
      delta === 0 ? 'no_change'
      : refsChanged ? 'new_evidence'
      : 'rubric_interpretation';

    changes.push({
      dimensionId: b.dimensionId,
      rubricId: b.rubricId as RubricId,
      scoreBefore: b.score,
      scoreAfter: a.score,
      delta,
      driver,
    });
  }

  const rubricTotals = ALL_RUBRIC_IDS.map((rubricId) => {
    const bTotal = before.rubricScores.find((r) => r.rubricId === rubricId)?.total ?? 0;
    const aTotal = after.rubricScores.find((r) => r.rubricId === rubricId)?.total ?? 0;
    return {
      rubricId,
      totalBefore: bTotal,
      totalAfter: aTotal,
      delta: Math.round((aTotal - bTotal) * 10) / 10,
    };
  });

  return {
    subject: after.subject,
    beforeGeneratedAt: before.generatedAt,
    afterGeneratedAt: after.generatedAt,
    dimensionChanges: changes.filter((c) => c.driver !== 'no_change'),
    rubricTotals,
  };
}
