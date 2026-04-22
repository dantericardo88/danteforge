// tests/scoring-matrix.test.ts — Matrix runner and diff tests

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runMatrix, diffSnapshots, getTopOverclaimed, getTopUnderProven, getNextLifts } from '../src/scoring/run-matrix.js';
import type { EvidenceRecord, DimensionDefinition } from '../src/scoring/types.js';

function makeDim(id: string, category = 'Core'): DimensionDefinition {
  return {
    id,
    name: id,
    category,
    maxScore: 10,
    description: 'test',
    requiredEvidenceTypes: ['code'],
  };
}

function makeEvidence(dimId: string, overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    dimensionId: dimId,
    evidenceType: 'code',
    sourceKind: 'file',
    sourceRef: `src/${dimId}.ts`,
    summary: 'present',
    strength: 'moderate',
    status: 'present',
    userVisible: true,
    mainPathWired: true,
    tested: true,
    endToEndProven: true,
    benchmarkBacked: false,
    ...overrides,
  };
}

// ── runMatrix() ───────────────────────────────────────────────────────────────

describe('runMatrix()', () => {
  it('produces a snapshot with correct shape', () => {
    const snapshot = runMatrix({
      matrixId: 'test-matrix',
      subject: 'TestSubject',
      dimensions: [makeDim('dim1'), makeDim('dim2')],
      evidence: [makeEvidence('dim1')],
    });

    assert.equal(snapshot.matrixId, 'test-matrix');
    assert.equal(snapshot.subject, 'TestSubject');
    assert.ok(snapshot.generatedAt);
    assert.equal(snapshot.rubricScores.length, 3); // all three rubrics
    assert.equal(snapshot.dimensions.length, 6); // 2 dims × 3 rubrics
  });

  it('rubric totals sum correctly', () => {
    const dims = [makeDim('a'), makeDim('b')];
    const evidence = [makeEvidence('a'), makeEvidence('b')];
    const snapshot = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence });

    for (const r of snapshot.rubricScores) {
      const dimScores = snapshot.dimensions.filter((d) => d.rubricId === r.rubricId);
      const expectedTotal = dimScores.reduce((sum, d) => sum + d.score, 0);
      assert.equal(r.total, Math.round(expectedTotal * 10) / 10);
    }
  });

  it('normalized score is in [0, 100]', () => {
    const snapshot = runMatrix({
      matrixId: 'm',
      subject: 's',
      dimensions: [makeDim('a')],
      evidence: [makeEvidence('a')],
    });
    for (const r of snapshot.rubricScores) {
      assert.ok(r.normalized >= 0 && r.normalized <= 100, `normalized=${r.normalized} out of range`);
    }
  });

  it('handles empty evidence gracefully', () => {
    const snapshot = runMatrix({
      matrixId: 'm',
      subject: 's',
      dimensions: [makeDim('a'), makeDim('b')],
      evidence: [],
    });
    assert.ok(snapshot.rubricScores.every((r) => r.total === 0));
  });

  it('supports filtering to specific rubrics', () => {
    const snapshot = runMatrix({
      matrixId: 'm',
      subject: 's',
      dimensions: [makeDim('a')],
      evidence: [],
      rubricIds: ['hostile_diligence'],
    });
    assert.equal(snapshot.rubricScores.length, 1);
    assert.equal(snapshot.rubricScores[0]!.rubricId, 'hostile_diligence');
  });

  it('builds category rollups', () => {
    const dims = [makeDim('a', 'Cat1'), makeDim('b', 'Cat2')];
    const snapshot = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence: [] });
    // Each dim category × 3 rubrics in rollups
    assert.ok(snapshot.categories.length >= 2);
  });

  it('internal_optimistic >= hostile_diligence for every dimension', () => {
    const dims = [makeDim('x')];
    const evidence = [makeEvidence('x', { endToEndProven: true, tested: true })];
    const snapshot = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence });

    const internal = snapshot.dimensions.find((d) => d.rubricId === 'internal_optimistic' && d.dimensionId === 'x');
    const hostile = snapshot.dimensions.find((d) => d.rubricId === 'hostile_diligence' && d.dimensionId === 'x');
    assert.ok(internal!.score >= hostile!.score);
  });
});

// ── diffSnapshots() ───────────────────────────────────────────────────────────

describe('diffSnapshots()', () => {
  it('returns empty changes for identical snapshots', () => {
    const dims = [makeDim('a')];
    const evidence = [makeEvidence('a')];
    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence });
    const diff = diffSnapshots(snap, snap);
    assert.equal(diff.dimensionChanges.length, 0);
  });

  it('detects score delta when evidence improves', () => {
    const dims = [makeDim('a')];
    const before = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence: [] });
    const after = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence: [makeEvidence('a')] });

    const diff = diffSnapshots(before, after);
    assert.ok(diff.dimensionChanges.length > 0);
    assert.ok(diff.dimensionChanges.some((c) => c.delta > 0));
  });

  it('marks driver as new_evidence when refs change', () => {
    const dims = [makeDim('a')];
    const before = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence: [] });
    const after = runMatrix({
      matrixId: 'm',
      subject: 's',
      dimensions: dims,
      evidence: [makeEvidence('a')],
    });

    const diff = diffSnapshots(before, after);
    const changed = diff.dimensionChanges.filter((c) => c.delta !== 0 && c.driver === 'new_evidence');
    assert.ok(changed.length > 0, 'expected at least one new_evidence delta');
  });

  it('computes rubric total deltas', () => {
    const dims = [makeDim('a')];
    const before = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence: [] });
    const after = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence: [makeEvidence('a')] });

    const diff = diffSnapshots(before, after);
    assert.equal(diff.rubricTotals.length, 3);
    assert.ok(diff.rubricTotals.some((r) => r.delta > 0));
  });
});

// ── Analysis helpers ──────────────────────────────────────────────────────────

describe('getTopOverclaimed()', () => {
  it('returns dims with largest gap between internal and hostile', () => {
    const dims = [makeDim('a'), makeDim('b')];
    const evidence = [makeEvidence('a', { endToEndProven: true, benchmarkBacked: true })];
    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence });
    const overclaimed = getTopOverclaimed(snap);
    assert.ok(Array.isArray(overclaimed));
    assert.ok(overclaimed.length <= 5);
  });
});

describe('getTopUnderProven()', () => {
  it('returns dims with low public_defensible score', () => {
    const dims = [makeDim('x')];
    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence: [] });
    const underProven = getTopUnderProven(snap);
    assert.ok(Array.isArray(underProven));
    // With empty evidence, all dims should be under-proven
    assert.ok(underProven.length > 0 || snap.dimensions.every((d) => d.score >= 5));
  });
});

describe('getNextLifts()', () => {
  it('returns dims with next lift hints', () => {
    const dims = [makeDim('a'), makeDim('b')];
    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence: [] });
    const lifts = getNextLifts(snap);
    assert.ok(Array.isArray(lifts));
  });
});
