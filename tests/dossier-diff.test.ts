// tests/dossier-diff.test.ts - Tests for src/dossier/diff.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { diffDossiers, formatDeltaReport } from '../src/dossier/diff.js';
import type { Dossier, DossierDimension, EvidenceItem } from '../src/dossier/types.js';

function makeDim(score: number, evidence: EvidenceItem[] = []): DossierDimension {
  return {
    score,
    scoreJustification: 'test',
    evidence,
    humanOverride: null,
    humanOverrideReason: null,
  };
}

function makeEvidence(quote: string): EvidenceItem {
  return { claim: 'claim', quote, source: 'https://x.com', dim: 1 };
}

function makeDossier(
  competitor: string,
  dims: Record<string, DossierDimension>,
  lastBuilt: string,
  composite = 7.0,
): Dossier {
  return {
    competitor,
    displayName: competitor,
    type: 'closed-source',
    lastBuilt,
    sources: [],
    dimensions: dims,
    composite,
    compositeMethod: 'mean_28_dims',
    rubricVersion: 1,
  };
}

describe('diffDossiers()', () => {
  it('returns no deltas when dossier unchanged', () => {
    const dim1 = makeDim(8);
    const prev = makeDossier('cursor', { '1': dim1 }, '2026-04-01T00:00:00Z', 8);
    const curr = makeDossier('cursor', { '1': makeDim(8) }, '2026-04-10T00:00:00Z', 8);

    const delta = diffDossiers(prev, curr);
    assert.equal(delta.dimensionDeltas.length, 0);
    assert.equal(delta.compositeChange, 0);
  });

  it('detects score improvement', () => {
    const prev = makeDossier('cursor', { '1': makeDim(6) }, '2026-04-01T00:00:00Z', 6);
    const curr = makeDossier('cursor', { '1': makeDim(9) }, '2026-04-10T00:00:00Z', 9);

    const delta = diffDossiers(prev, curr);
    assert.equal(delta.dimensionDeltas.length, 1);
    assert.equal(delta.dimensionDeltas[0]!.dim, '1');
    assert.equal(delta.dimensionDeltas[0]!.before, 6);
    assert.equal(delta.dimensionDeltas[0]!.after, 9);
    assert.equal(delta.dimensionDeltas[0]!.delta, 3);
    assert.equal(delta.compositeChange, 3);
  });

  it('detects score regression', () => {
    const prev = makeDossier('cursor', { '1': makeDim(9) }, '2026-04-01T00:00:00Z', 9);
    const curr = makeDossier('cursor', { '1': makeDim(6) }, '2026-04-10T00:00:00Z', 6);

    const delta = diffDossiers(prev, curr);
    assert.equal(delta.dimensionDeltas[0]!.delta, -3);
    assert.equal(delta.compositeChange, -3);
  });

  it('detects new evidence items', () => {
    const oldEvidence = [makeEvidence('old quote')];
    const newEvidence = [makeEvidence('old quote'), makeEvidence('new quote')];

    const prev = makeDossier('cursor', { '1': makeDim(8, oldEvidence) }, '2026-04-01T00:00:00Z');
    const curr = makeDossier('cursor', { '1': makeDim(8, newEvidence) }, '2026-04-10T00:00:00Z');

    const delta = diffDossiers(prev, curr);
    assert.equal(delta.dimensionDeltas.length, 1);
    assert.equal(delta.dimensionDeltas[0]!.newEvidence.length, 1);
    assert.equal(delta.dimensionDeltas[0]!.newEvidence[0]!.quote, 'new quote');
  });

  it('handles dimension present in current but not previous', () => {
    const prev = makeDossier('cursor', { '1': makeDim(8) }, '2026-04-01T00:00:00Z');
    const curr = makeDossier('cursor', { '1': makeDim(8), '2': makeDim(7) }, '2026-04-10T00:00:00Z');

    const delta = diffDossiers(prev, curr);
    const newDim = delta.dimensionDeltas.find((dimensionDelta) => dimensionDelta.dim === '2');
    assert.ok(newDim !== undefined);
    assert.equal(newDim.before, 0);
    assert.equal(newDim.after, 7);
  });

  it('populates competitor and timestamps', () => {
    const prev = makeDossier('cursor', { '1': makeDim(8) }, '2026-04-01T00:00:00Z');
    const curr = makeDossier('cursor', { '1': makeDim(9) }, '2026-04-10T00:00:00Z');

    const delta = diffDossiers(prev, curr);
    assert.equal(delta.competitor, 'cursor');
    assert.equal(delta.previousBuilt, '2026-04-01T00:00:00Z');
    assert.equal(delta.currentBuilt, '2026-04-10T00:00:00Z');
  });

  it('sorts dimension deltas by absolute delta desc', () => {
    const prev = makeDossier('cursor', { '1': makeDim(5), '2': makeDim(3) }, '2026-04-01T00:00:00Z', 4);
    const curr = makeDossier('cursor', { '1': makeDim(9), '2': makeDim(7) }, '2026-04-10T00:00:00Z', 8);

    const delta = diffDossiers(prev, curr);
    assert.equal(delta.dimensionDeltas.length, 2);
    assert.ok(Math.abs(delta.dimensionDeltas[0]!.delta) >= Math.abs(delta.dimensionDeltas[1]!.delta));
  });
});

describe('formatDeltaReport()', () => {
  it('shows "No changes detected" for empty delta', () => {
    const prev = makeDossier('cursor', { '1': makeDim(8) }, '2026-04-01T00:00:00Z');
    const curr = makeDossier('cursor', { '1': makeDim(8) }, '2026-04-10T00:00:00Z');
    const delta = diffDossiers(prev, curr);
    const report = formatDeltaReport(delta);
    assert.ok(report.includes('No changes detected'));
  });

  it('shows dimension change with direction marker', () => {
    const prev = makeDossier('cursor', { '1': makeDim(6) }, '2026-04-01T00:00:00Z', 6);
    const curr = makeDossier('cursor', { '1': makeDim(9) }, '2026-04-10T00:00:00Z', 9);
    const delta = diffDossiers(prev, curr);
    const report = formatDeltaReport(delta);
    assert.ok(report.includes('UP'));
    assert.ok(report.includes('+3'));
  });
});
