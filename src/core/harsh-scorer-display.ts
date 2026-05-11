import type { MaturityLevel } from './maturity-levels.js';

export function computeFakeCompletionRisk(
  overallCompletion: number,
  currentMaturityLevel: MaturityLevel,
  targetLevel: MaturityLevel,
): 'low' | 'medium' | 'high' {
  if (overallCompletion >= 95 && currentMaturityLevel < targetLevel) return 'high';
  if (overallCompletion >= 80 && currentMaturityLevel < targetLevel - 1) return 'medium';
  return 'low';
}

export function formatDimensionBar(score: number, maxWidth = 10): string {
  const filled = Math.min(maxWidth, Math.round(Math.max(0, Math.min(100, score)) / 10));
  return '█'.repeat(filled) + '░'.repeat(maxWidth - filled);
}
