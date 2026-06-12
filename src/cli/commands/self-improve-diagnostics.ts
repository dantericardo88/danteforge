import type { MasterplanItem } from '../../core/gap-masterplan.js';
import type { ScoringDimension } from '../../core/harsh-scorer.js';

export interface PersistentGapDiagnostic {
  dimension: ScoringDimension;
  description: string;
  verifyCondition: string;
  previousScore: number;
  currentScore: number;
  targetScore: number;
}

const SCORE_EPSILON = 0.05;

export function collectPersistentGapDiagnostics(
  beforeItems: MasterplanItem[],
  afterItems: MasterplanItem[],
  focusDimensions?: ScoringDimension[],
): PersistentGapDiagnostic[] {
  const focusSet = focusDimensions && focusDimensions.length > 0
    ? new Set<ScoringDimension>(focusDimensions)
    : undefined;
  const afterBySignature = new Map(afterItems.map((item) => [gapSignature(item), item]));
  const diagnostics: PersistentGapDiagnostic[] = [];

  for (const before of beforeItems) {
    if (focusSet && !focusSet.has(before.dimension)) continue;

    const after = afterBySignature.get(gapSignature(before));
    if (!after) continue;
    if (after.currentScore > before.currentScore + SCORE_EPSILON) continue;

    diagnostics.push({
      dimension: before.dimension,
      description: before.description,
      verifyCondition: before.verifyCondition,
      previousScore: before.currentScore,
      currentScore: after.currentScore,
      targetScore: Math.max(before.targetScore, after.targetScore),
    });
  }

  return diagnostics;
}

export function formatPersistentGapLesson(
  cycle: number,
  diagnostics: PersistentGapDiagnostic[],
): string {
  const summaries = diagnostics.slice(0, 3).map((gap) =>
    `${gap.dimension} stayed ${gap.previousScore.toFixed(1)} -> ${gap.currentScore.toFixed(1)}/10; verify: ${gap.verifyCondition}`,
  );

  return [
    `[self-improvement] Persistent gaps after cycle ${cycle}: ${summaries.join(' | ')}`,
    'Previous forge action did not move the measured gap; next cycle should change implementation strategy or tighten the verification target before retrying.',
  ].join(' ');
}

function gapSignature(item: MasterplanItem): string {
  const criterion = item.verifyCondition || item.description || item.title;
  return `${item.dimension}:${normalizeForSignature(criterion)}`;
}

function normalizeForSignature(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}
