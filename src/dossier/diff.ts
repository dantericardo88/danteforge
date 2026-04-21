// src/dossier/diff.ts - Compare two dossier versions, produce per-dimension delta

import type { Dossier, DossierDelta, DossierDimDelta, EvidenceItem } from './types.js';

function newEvidenceItems(
  previousEvidence: EvidenceItem[],
  currentEvidence: EvidenceItem[],
): EvidenceItem[] {
  const previousQuotes = new Set(previousEvidence.map((evidence) => evidence.quote));
  return currentEvidence.filter((evidence) => !previousQuotes.has(evidence.quote));
}

export function diffDossiers(previous: Dossier, current: Dossier): DossierDelta {
  const allDimKeys = new Set([
    ...Object.keys(previous.dimensions),
    ...Object.keys(current.dimensions),
  ]);

  const dimensionDeltas: DossierDimDelta[] = [];

  for (const dimKey of allDimKeys) {
    const previousDim = previous.dimensions[dimKey];
    const currentDim = current.dimensions[dimKey];

    const before = previousDim ? (previousDim.humanOverride ?? previousDim.score) : 0;
    const after = currentDim ? (currentDim.humanOverride ?? currentDim.score) : 0;
    const delta = Math.round((after - before) * 10) / 10;
    const newEvidence = newEvidenceItems(
      previousDim?.evidence ?? [],
      currentDim?.evidence ?? [],
    );

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
    `Previous: ${delta.previousBuilt.slice(0, 10)}  ->  Current: ${delta.currentBuilt.slice(0, 10)}`,
    `Composite change: ${delta.compositeChange >= 0 ? '+' : ''}${delta.compositeChange}`,
    '',
  ];

  if (delta.dimensionDeltas.length === 0) {
    lines.push('No changes detected.');
    return lines.join('\n');
  }

  lines.push('Dimension changes:');
  for (const dimensionDelta of delta.dimensionDeltas) {
    const arrow = dimensionDelta.delta >= 0 ? 'UP' : 'DOWN';
    const sign = dimensionDelta.delta >= 0 ? '+' : '';
    lines.push(
      `  ${dimensionDelta.dim}. ${dimensionDelta.dimName}: ${dimensionDelta.before} -> ${dimensionDelta.after} (${arrow} ${sign}${dimensionDelta.delta})`,
    );
    if (dimensionDelta.newEvidence.length > 0) {
      lines.push(`     +${dimensionDelta.newEvidence.length} new evidence item(s)`);
    }
  }

  return lines.join('\n');
}
