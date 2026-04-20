// src/scoring/report.ts — Markdown and JSON report formatter

import type { MatrixSnapshot, SnapshotDiff, RubricId } from './types.js';
import { getTopOverclaimed, getTopUnderProven, getNextLifts } from './run-matrix.js';

const RUBRIC_LABELS: Record<RubricId, string> = {
  internal_optimistic: 'Internal Optimistic',
  public_defensible: 'Public Defensible',
  hostile_diligence: 'Hostile Diligence',
};

// ── Markdown report ───────────────────────────────────────────────────────────

export function formatMarkdownReport(snapshot: MatrixSnapshot): string {
  const lines: string[] = [];

  lines.push(`# Scoring Report: ${snapshot.subject}`);
  lines.push(`_Generated: ${snapshot.generatedAt}_`);
  lines.push(`_Matrix: ${snapshot.matrixId}_`);
  lines.push('');

  // Overview table
  lines.push('## Overview');
  lines.push('');
  lines.push('| Rubric | Score | Max | Normalized |');
  lines.push('|--------|-------|-----|-----------|');
  for (const r of snapshot.rubricScores) {
    lines.push(`| ${RUBRIC_LABELS[r.rubricId]} | ${r.total} | ${r.maxTotal} | ${r.normalized}% |`);
  }
  lines.push('');

  // Rubric spread explanation
  lines.push('### Why scores differ by rubric');
  lines.push('');
  lines.push('- **Internal Optimistic**: Credits implemented + tested code, even without end-to-end proof.');
  lines.push('- **Public Defensible**: Only counts user-visible, main-path features with sufficient external proof.');
  lines.push('- **Hostile Diligence**: Requires end-to-end proof for scores above 4.5. Benchmarks required for performance dims.');
  lines.push('');

  // Category rollup
  lines.push('## Category Scores');
  lines.push('');
  const categories = [...new Set(snapshot.categories.map((c) => c.category))];
  lines.push('| Category | Int. Opt. | Pub. Def. | Hostile |');
  lines.push('|----------|-----------|-----------|---------|');
  for (const cat of categories) {
    const opt = snapshot.categories.find((c) => c.category === cat && c.rubricId === 'internal_optimistic');
    const pub = snapshot.categories.find((c) => c.category === cat && c.rubricId === 'public_defensible');
    const hos = snapshot.categories.find((c) => c.category === cat && c.rubricId === 'hostile_diligence');
    lines.push(`| ${cat} | ${opt?.normalized ?? 0}% | ${pub?.normalized ?? 0}% | ${hos?.normalized ?? 0}% |`);
  }
  lines.push('');

  // Per-dimension triple matrix
  lines.push('## Dimension Scores');
  lines.push('');
  lines.push('| Dimension | Int. Opt. | Pub. Def. | Hostile | Confidence | Next Lift |');
  lines.push('|-----------|-----------|-----------|---------|-----------|-----------|');

  const dimIds = [...new Set(snapshot.dimensions.map((d) => d.dimensionId))];
  for (const dimId of dimIds) {
    const opt = snapshot.dimensions.find((d) => d.dimensionId === dimId && d.rubricId === 'internal_optimistic');
    const pub = snapshot.dimensions.find((d) => d.dimensionId === dimId && d.rubricId === 'public_defensible');
    const hos = snapshot.dimensions.find((d) => d.dimensionId === dimId && d.rubricId === 'hostile_diligence');
    const conf = hos?.confidence ?? opt?.confidence ?? '—';
    const nextLift = opt?.nextLift?.slice(0, 60) ?? '—';
    lines.push(`| ${dimId} | ${opt?.score ?? 0} | ${pub?.score ?? 0} | ${hos?.score ?? 0} | ${conf} | ${nextLift} |`);
  }
  lines.push('');

  // Top overclaimed
  const overclaimed = getTopOverclaimed(snapshot);
  if (overclaimed.length > 0) {
    lines.push('## Top Overclaimed Dimensions');
    lines.push('_Largest gap between Internal Optimistic and Hostile Diligence:_');
    lines.push('');
    for (const d of overclaimed) {
      const hostile = snapshot.dimensions.find((s) => s.dimensionId === d.dimensionId && s.rubricId === 'hostile_diligence');
      const gap = hostile ? (d.score - hostile.score).toFixed(1) : '?';
      lines.push(`- **${d.dimensionId}**: internal=${d.score}, hostile=${hostile?.score ?? '?'}, gap=${gap}`);
      if (d.rationale) lines.push(`  - ${d.rationale}`);
    }
    lines.push('');
  }

  // Top under-proven
  const underProven = getTopUnderProven(snapshot);
  if (underProven.length > 0) {
    lines.push('## Top Under-Proven Dimensions');
    lines.push('_Lowest public-defensible scores:_');
    lines.push('');
    for (const d of underProven) {
      lines.push(`- **${d.dimensionId}**: public=${d.score} — ${d.rationale}`);
    }
    lines.push('');
  }

  // Next lifts
  const lifts = getNextLifts(snapshot);
  if (lifts.length > 0) {
    lines.push('## Recommended Next Lifts');
    lines.push('_By score impact potential:_');
    lines.push('');
    for (const d of lifts) {
      lines.push(`- **${d.dimensionId}** (gap: ${d.maxScore - d.score}): ${d.nextLift}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Diff report ───────────────────────────────────────────────────────────────

export function formatDiffReport(diff: SnapshotDiff): string {
  const lines: string[] = [];

  lines.push(`# Score Diff: ${diff.subject}`);
  lines.push(`_Before: ${diff.beforeGeneratedAt}_`);
  lines.push(`_After: ${diff.afterGeneratedAt}_`);
  lines.push('');

  lines.push('## Rubric Totals');
  lines.push('');
  lines.push('| Rubric | Before | After | Delta |');
  lines.push('|--------|--------|-------|-------|');
  for (const r of diff.rubricTotals) {
    const arrow = r.delta > 0 ? '▲' : r.delta < 0 ? '▼' : '—';
    lines.push(`| ${RUBRIC_LABELS[r.rubricId]} | ${r.totalBefore} | ${r.totalAfter} | ${arrow} ${Math.abs(r.delta)} |`);
  }
  lines.push('');

  if (diff.dimensionChanges.length === 0) {
    lines.push('_No dimension changes detected._');
    lines.push('');
    return lines.join('\n');
  }

  lines.push('## Dimension Changes');
  lines.push('');
  lines.push('| Dimension | Rubric | Before | After | Delta | Driver |');
  lines.push('|-----------|--------|--------|-------|-------|--------|');
  const sorted = [...diff.dimensionChanges].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  for (const c of sorted) {
    const arrow = c.delta > 0 ? '▲' : '▼';
    lines.push(`| ${c.dimensionId} | ${RUBRIC_LABELS[c.rubricId]} | ${c.scoreBefore} | ${c.scoreAfter} | ${arrow} ${Math.abs(c.delta)} | ${c.driver} |`);
  }
  lines.push('');

  return lines.join('\n');
}

// ── JSON snapshot ─────────────────────────────────────────────────────────────

export function formatJsonSnapshot(snapshot: MatrixSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function parseJsonSnapshot(json: string): MatrixSnapshot {
  return JSON.parse(json) as MatrixSnapshot;
}
