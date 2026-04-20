// src/dossier/diff.ts — Compare two dossier versions, produce per-dimension delta

import type { Dossier, DossierDelta, DossierDimDelta, EvidenceItem } from './types.js';

function newEvidenceItems(
  previousEvidence: EvidenceItem[],
  currentEvidence: EvidenceItem[],
): EvidenceItem[] {
  const prevQuotes = new Set(previousEvidence.map((e) => e.quote));
  return currentEvidence.filter((e) => !prevQuotes.has(e.quote));
}

export function diffDossiers(previous: Dossier, current: Dossier): DossierDelta {
  const allDimKeys = new Set([
    ...Object.keys(previous.dimensions),
    ...Object.keys(current.dimensions),
  ]);

  const dimensionDeltas: DossierDimDelta[] = [];

  for (const dimKey of allDimKeys) {
    const prevDim = previous.dimensions[dimKey];
    const currDim = current.dimensions[dimKey];

    const before = prevDim ? (prevDim.humanOverride ?? prevDim.score) : 0;
    const after = currDim ? (currDim.humanOverride ?? currDim.score) : 0;
    const delta = Math.round((after - before) * 10) / 10;

    const newEvidence = newEvidenceItems(
      prevDim?.evidence ?? [],
      currDim?.evidence ?? [],
    );

    // Only include dims that changed or gained new evidence
    if (delta !== 0 || newEvidence.length > 0) {
      dimensionDeltas.push({
        dim: dimKey,
        dimName: `Dimension ${dimKey}`,
        before,
        after,
        delta,
        newEvidence,
      });
    }
  }

  // Sort by absolute delta desc
  dimensionDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    competitor: current.competitor,
    previousBuilt: previous.lastBuilt,
    currentBuilt: current.lastBuilt,
    dimensionDeltas,
    compositeChange: Math.round((current.composite - previous.composite) * 10) / 10,
  };
}

export function formatDeltaReport(delta: DossierDelta): string {
  const lines: string[] = [
    `Dossier diff: ${delta.competitor}`,
    `Previous: ${delta.previousBuilt.slice(0, 10)}  →  Current: ${delta.currentBuilt.slice(0, 10)}`,
    `Composite change: ${delta.compositeChange >= 0 ? '+' : ''}${delta.compositeChange}`,
    '',
  ];

  if (delta.dimensionDeltas.length === 0) {
    lines.push('No changes detected.');
    return lines.join('\n');
  }

  lines.push('Dimension changes:');
  for (const d of delta.dimensionDeltas) {
    const arrow = d.delta >= 0 ? '▲' : '▼';
    const sign = d.delta >= 0 ? '+' : '';
    lines.push(`  ${d.dim}. ${d.dimName}: ${d.before} → ${d.after} (${arrow}${sign}${d.delta})`);
    if (d.newEvidence.length > 0) {
      lines.push(`     +${d.newEvidence.length} new evidence item(s)`);
    }
  }

  return lines.join('\n');
}
