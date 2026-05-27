// ascend-reporting.ts — Report-building helpers for the Ascend engine.
// Split from ascend-engine.ts to keep files under the 750-LOC hard cap.
import { computeGapPriority, computeUnweightedComposite } from './compete-matrix.js';
import type { CompeteMatrix, MatrixDimension, AdversarialCalibration } from './compete-matrix.js';
import type { CeilingReport, AscendResult } from './ascend-engine.js';
import type { ScoringDimension } from './harsh-scorer.js';

const ALL_SCORING_DIMENSIONS = new Set<string>([
  'functionality', 'testing', 'errorHandling', 'security', 'uxPolish',
  'documentation', 'performance', 'maintainability', 'developerExperience',
  'autonomy', 'planningQuality', 'selfImprovement', 'specDrivenPipeline',
  'convergenceSelfHealing', 'tokenEconomy', 'contextEconomy', 'causalCoherence', 'ecosystemMcp',
  'enterpriseReadiness', 'communityAdoption',
]);

export function mapDimIdToScoringDimension(id: string): ScoringDimension | null {
  const camel = id.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
  return ALL_SCORING_DIMENSIONS.has(camel) ? (camel as ScoringDimension) : null;
}

export function isDimensionRecentlyInflated(matrix: CompeteMatrix, dimensionId: string): boolean {
  const calibrations: AdversarialCalibration[] = matrix.adversarialCalibrations ?? [];
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  return calibrations.some(
    c => c.dimensionId === dimensionId &&
      c.verdict === 'inflated' &&
      new Date(c.date).getTime() > cutoff,
  );
}

// ── Ceiling report builder ────────────────────────────────────────────────────

export function buildManualAction(dim: MatrixDimension): string {
  if (dim.manualActionHint) return dim.manualActionHint;
  const reason = dim.ceilingReason ?? '';
  if (reason.includes('npm downloads') || reason.includes('GitHub stars')) {
    return 'Publish to npm, promote the project, and attract contributors via README + examples.';
  }
  if (reason.includes('production deployments') || reason.includes('customer validation')) {
    return 'Deploy to real production environments and collect customer feedback/case studies.';
  }
  return reason
    ? `Manual effort required: ${reason}`
    : `Update manually: danteforge compete --amend ${dim.id}=<score>`;
}

export function buildCeilingReports(dims: MatrixDimension[]): CeilingReport[] {
  return dims.map(d => ({
    dimension: d.id,
    label: d.label,
    currentScore: d.scores['self'] ?? 0,
    ceiling: d.ceiling!,
    reason: d.ceilingReason ?? 'automation ceiling reached',
    manualAction: buildManualAction(d),
  }));
}

// ── ASCEND_REPORT.md writer ───────────────────────────────────────────────────

export function buildAscendReport(
  matrix: CompeteMatrix,
  result: AscendResult,
  target: number,
  beforeScores: Record<string, number>,
): string {
  const unweighted = computeUnweightedComposite(matrix);
  const lines: string[] = [
    '# Ascend Report',
    '',
    `**Composite score (${matrix.dimensions.length}-dim, unweighted):** ${unweighted.toFixed(1)}/10`,
    `**Weighted strategy score:** ${result.finalScore.toFixed(1)}/10`,
    `**Cycles run:** ${result.cyclesRun}`,
    `**Dimensions improved:** ${result.dimensionsImproved}`,
    `**Dimensions at target (${target}/10):** ${result.dimensionsAtTarget}`,
    `**Success:** ${result.success ? 'YES — all achievable dimensions at target' : 'PARTIAL — see below'}`,
    '',
    '## Dimension Results',
    '',
    '| Dimension | Before | After | Status |',
    '|-----------|--------|-------|--------|',
  ];

  for (const dim of matrix.dimensions) {
    const before = (beforeScores[dim.id] ?? dim.scores['self'] ?? 0).toFixed(1);
    const after = (dim.scores['self'] ?? 0).toFixed(1);
    const status = dim.status === 'closed'
      ? '✅ closed'
      : (dim.scores['self'] ?? 0) >= target
        ? '🎯 at target'
        : dim.ceiling !== undefined
          ? `⚠️ ceiling ${dim.ceiling}/10`
          : '🔄 in progress';
    lines.push(`| ${dim.label} | ${before} | ${after} | ${status} |`);
  }

  if (result.ceilingReports.length > 0) {
    lines.push('', '## Ceiling Dimensions — Manual Action Required', '');
    for (const r of result.ceilingReports) {
      lines.push(
        `### ${r.label}`,
        '',
        `**Current score:** ${r.currentScore.toFixed(1)}/10 (ceiling: ${r.ceiling}/10)`,
        `**Why:** ${r.reason}`,
        `**What to do:** ${r.manualAction}`,
        '',
      );
    }
  }

  const marketDimsNeeded = matrix.dimensions
    .filter(d => mapDimIdToScoringDimension(d.id) === null && (d.scores['self'] ?? 0) < target);
  if (marketDimsNeeded.length > 0) {
    lines.push('', '## Market Dims Needing Manual Update', '');
    lines.push(`These ${marketDimsNeeded.length} dim(s) have no auto-scorer. Run \`danteforge compete --amend <id>=<score>\` when ready:`, '');
    for (const d of marketDimsNeeded) {
      const self = (d.scores['self'] ?? 0).toFixed(1);
      lines.push(`- **${d.label}** (${self}/${target}) → \`danteforge compete --amend ${d.id}=<score>\``);
    }
    lines.push('');
  }

  lines.push(
    '---',
    `*Generated by \`danteforge ascend\` at ${new Date().toISOString()}*`,
    '',
  );

  return lines.join('\n');
}

export function buildAscendReportWithWiring(
  matrix: CompeteMatrix,
  result: AscendResult,
  target: number,
  beforeScores: Record<string, number>,
  unwiredModules: string[],
): string {
  const base = buildAscendReport(matrix, result, target, beforeScores);
  if (unwiredModules.length === 0) return base;

  const wiringSection = [
    '',
    '## Integration Wiring Gaps',
    '',
    'The following modules exist in the codebase but are **not called** from the execution path.',
    'These gaps cannot be fixed by ascend alone — they require manual wiring work:',
    '',
    ...unwiredModules.map(m => `- ${m}`),
    '',
    '> Run `danteforge wiring-check` to re-evaluate after wiring.',
    '',
  ].join('\n');

  // Insert before the final --- separator
  return base.replace('\n---\n', `\n${wiringSection}\n---\n`);
}

