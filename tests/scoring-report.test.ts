// tests/scoring-report.test.ts — Report generation golden tests

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatMarkdownReport, formatDiffReport, formatJsonSnapshot, parseJsonSnapshot } from '../src/scoring/report.js';
import { runMatrix, diffSnapshots } from '../src/scoring/run-matrix.js';
import type { EvidenceRecord, DimensionDefinition } from '../src/scoring/types.js';

function makeDim(id: string): DimensionDefinition {
  return { id, name: id, category: 'Core', maxScore: 10, description: 'test', requiredEvidenceTypes: ['code'] };
}

function makeEvidence(dimId: string): EvidenceRecord {
  return {
    dimensionId: dimId,
    evidenceType: 'code',
    sourceKind: 'file',
    sourceRef: `src/${dimId}.ts`,
    summary: 'present',
    strength: 'strong',
    status: 'present',
    userVisible: true,
    mainPathWired: true,
    tested: true,
    endToEndProven: true,
    benchmarkBacked: true,
  };
}

// ── formatMarkdownReport() ────────────────────────────────────────────────────

describe('formatMarkdownReport()', () => {
  it('includes subject name in heading', () => {
    const snap = runMatrix({
      matrixId: 'm', subject: 'DanteCode',
      dimensions: [makeDim('a')], evidence: [],
    });
    const report = formatMarkdownReport(snap);
    assert.ok(report.includes('DanteCode'));
  });

  it('includes all three rubric names', () => {
    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: [makeDim('a')], evidence: [] });
    const report = formatMarkdownReport(snap);
    assert.ok(report.includes('Internal Optimistic'));
    assert.ok(report.includes('Public Defensible'));
    assert.ok(report.includes('Hostile Diligence'));
  });

  it('includes Overview and Dimension Scores sections', () => {
    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: [makeDim('a')], evidence: [] });
    const report = formatMarkdownReport(snap);
    assert.ok(report.includes('## Overview'));
    assert.ok(report.includes('## Dimension Scores'));
  });

  it('explains why scores differ by rubric', () => {
    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: [makeDim('a')], evidence: [] });
    const report = formatMarkdownReport(snap);
    assert.ok(report.includes('Why scores differ'));
  });

  it('includes category scores table', () => {
    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: [makeDim('a')], evidence: [] });
    const report = formatMarkdownReport(snap);
    assert.ok(report.includes('## Category Scores'));
  });

  it('includes recommended next lifts section', () => {
    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: [makeDim('a')], evidence: [] });
    const report = formatMarkdownReport(snap);
    assert.ok(report.includes('Next Lift') || report.includes('Recommended'));
  });

  it('shows overclaimed dimensions when gap exists', () => {
    const dims = [makeDim('partialDim')];
    const evidence: EvidenceRecord[] = [{
      dimensionId: 'partialDim',
      evidenceType: 'code',
      sourceKind: 'file',
      sourceRef: 'src/x.ts',
      summary: 'partial',
      strength: 'weak',
      status: 'partial',
      userVisible: true,
      mainPathWired: true,
      tested: true,
      endToEndProven: false,
      benchmarkBacked: false,
    }];
    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence });
    const report = formatMarkdownReport(snap);
    assert.ok(report.includes('Overclaimed') || report.includes('partialDim'));
  });

  it('is stable — same input produces same output', () => {
    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: [makeDim('a')], evidence: [] });
    const r1 = formatMarkdownReport(snap);
    const r2 = formatMarkdownReport(snap);
    // Remove generatedAt line which includes ISO timestamp embedded in report header
    const strip = (s: string) => s.replace(/_Generated:.*_/, '');
    assert.equal(strip(r1), strip(r2));
  });
});

// ── formatDiffReport() ────────────────────────────────────────────────────────

describe('formatDiffReport()', () => {
  it('shows "No dimension changes" for identical snapshots', () => {
    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: [makeDim('a')], evidence: [] });
    const diff = diffSnapshots(snap, snap);
    const report = formatDiffReport(diff);
    assert.ok(report.includes('No dimension changes'));
  });

  it('includes Rubric Totals table', () => {
    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: [makeDim('a')], evidence: [] });
    const diff = diffSnapshots(snap, snap);
    const report = formatDiffReport(diff);
    assert.ok(report.includes('Rubric Totals'));
  });

  it('shows dimension changes with arrows when scores change', () => {
    const dims = [makeDim('a')];
    const before = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence: [] });
    const after = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence: [makeEvidence('a')] });
    const diff = diffSnapshots(before, after);
    const report = formatDiffReport(diff);
    assert.ok(report.includes('▲') || report.includes('▼'));
  });

  it('includes subject name in heading', () => {
    const snap = runMatrix({ matrixId: 'm', subject: 'DanteCode', dimensions: [makeDim('a')], evidence: [] });
    const diff = diffSnapshots(snap, snap);
    const report = formatDiffReport(diff);
    assert.ok(report.includes('DanteCode'));
  });
});

// ── formatJsonSnapshot() / parseJsonSnapshot() ────────────────────────────────

describe('JSON round-trip', () => {
  it('serializes and deserializes a snapshot', () => {
    const snap = runMatrix({
      matrixId: 'm', subject: 'DanteCode',
      dimensions: [makeDim('a'), makeDim('b')],
      evidence: [makeEvidence('a')],
    });

    const json = formatJsonSnapshot(snap);
    const parsed = parseJsonSnapshot(json);

    assert.equal(parsed.subject, 'DanteCode');
    assert.equal(parsed.matrixId, 'm');
    assert.equal(parsed.dimensions.length, snap.dimensions.length);
    assert.equal(parsed.rubricScores.length, snap.rubricScores.length);
  });

  it('JSON output is valid JSON', () => {
    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: [makeDim('a')], evidence: [] });
    const json = formatJsonSnapshot(snap);
    assert.doesNotThrow(() => JSON.parse(json));
  });

  it('parsed snapshot preserves dimension scores', () => {
    const snap = runMatrix({
      matrixId: 'm', subject: 's',
      dimensions: [makeDim('a')],
      evidence: [makeEvidence('a')],
    });
    const json = formatJsonSnapshot(snap);
    const parsed = parseJsonSnapshot(json);

    const original = snap.dimensions.find((d) => d.rubricId === 'hostile_diligence' && d.dimensionId === 'a');
    const restored = parsed.dimensions.find((d) => d.rubricId === 'hostile_diligence' && d.dimensionId === 'a');
    assert.equal(original!.score, restored!.score);
    assert.equal(original!.confidence, restored!.confidence);
  });
});
