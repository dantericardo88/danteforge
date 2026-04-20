// tests/scoring-cli.test.ts — CLI command injection-seam tests

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rubricScore, rubricScoreDiff } from '../src/cli/commands/score-rubric.js';
import type { EvidenceRecord } from '../src/scoring/types.js';

function makeEvidence(dimId: string): EvidenceRecord {
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
  };
}

// ── rubricScore() ─────────────────────────────────────────────────────────────

describe('rubricScore()', () => {
  it('runs without evidence and emits summary', async () => {
    const emitted: string[] = [];
    const written: Record<string, string> = {};

    await rubricScore({
      subject: 'TestProject',
      matrix: 'product-28',
      _readFile: async () => { throw new Error('no file'); },
      _writeFile: async (p, d) => { written[p] = d; },
      _mkdir: async () => {},
      _emit: (msg) => emitted.push(msg),
    });

    assert.ok(emitted.some((m) => m.includes('TestProject')));
    assert.ok(Object.keys(written).some((p) => p.endsWith('.md')));
    assert.ok(Object.keys(written).some((p) => p.endsWith('.json')));
  });

  it('loads evidence from file when path provided', async () => {
    const evidence = [makeEvidence('security')];
    const written: Record<string, string> = {};
    const emitted: string[] = [];

    await rubricScore({
      subject: 'TestProject',
      evidence: '/fake/evidence.json',
      _readFile: async () => JSON.stringify(evidence),
      _writeFile: async (p, d) => { written[p] = d; },
      _mkdir: async () => {},
      _emit: (msg) => emitted.push(msg),
    });

    assert.ok(emitted.some((m) => m.includes('evidence records')));
  });

  it('writes markdown report with triple scores', async () => {
    const written: Record<string, string> = {};

    await rubricScore({
      subject: 'DanteCode',
      _readFile: async () => { throw new Error('no file'); },
      _writeFile: async (p, d) => { written[p] = d; },
      _mkdir: async () => {},
      _emit: () => {},
    });

    const mdFile = Object.values(written).find((v) => v.includes('## Overview'));
    assert.ok(mdFile, 'Markdown report should contain ## Overview');
    assert.ok(mdFile.includes('Internal Optimistic'));
    assert.ok(mdFile.includes('Hostile Diligence'));
  });

  it('throws on unknown rubric id', async () => {
    await assert.rejects(
      () => rubricScore({
        subject: 'Test',
        rubrics: 'invalid_rubric',
        _readFile: async () => '',
        _writeFile: async () => {},
        _mkdir: async () => {},
        _emit: () => {},
      }),
      /Unknown rubric/,
    );
  });

  it('handles missing evidence file gracefully', async () => {
    const emitted: string[] = [];
    await rubricScore({
      subject: 'Test',
      evidence: '/nonexistent/path.json',
      _readFile: async () => { throw new Error('ENOENT: no such file'); },
      _writeFile: async () => {},
      _mkdir: async () => {},
      _emit: (msg) => emitted.push(msg),
    });
    assert.ok(emitted.some((m) => m.toLowerCase().includes('warning')));
  });

  it('respects custom output path prefix', async () => {
    const written: Record<string, string> = {};
    await rubricScore({
      subject: 'Test',
      out: '/my/custom/output',
      _readFile: async () => { throw new Error('no file'); },
      _writeFile: async (p, d) => { written[p] = d; },
      _mkdir: async () => {},
      _emit: () => {},
    });
    assert.ok(Object.keys(written).some((p) => p.includes('custom')));
  });

  it('filters to single rubric when specified', async () => {
    const written: Record<string, string> = {};
    await rubricScore({
      subject: 'Test',
      rubrics: 'hostile_diligence',
      _readFile: async () => { throw new Error('no file'); },
      _writeFile: async (p, d) => { written[p] = d; },
      _mkdir: async () => {},
      _emit: () => {},
    });
    const json = Object.values(written).find((v) => v.includes('"rubricId"'));
    assert.ok(json);
    const parsed = JSON.parse(json);
    assert.equal(parsed.rubricScores.length, 1);
    assert.equal(parsed.rubricScores[0].rubricId, 'hostile_diligence');
  });
});

// ── rubricScoreDiff() ─────────────────────────────────────────────────────────

describe('rubricScoreDiff()', () => {
  it('emits a diff report', async () => {
    const { runMatrix } = await import('../src/scoring/run-matrix.js');
    const { formatJsonSnapshot } = await import('../src/scoring/report.js');
    const { DIMENSIONS_28 } = await import('../src/scoring/dimensions.js');

    const dims = DIMENSIONS_28.slice(0, 2);
    const snap1 = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence: [] });
    const snap2 = runMatrix({ matrixId: 'm', subject: 's', dimensions: dims, evidence: [] });
    const json1 = formatJsonSnapshot(snap1);
    const json2 = formatJsonSnapshot(snap2);

    const emitted: string[] = [];
    await rubricScoreDiff({
      before: '/before.json',
      after: '/after.json',
      _readFile: async (p) => p.includes('before') ? json1 : json2,
      _emit: (msg) => emitted.push(msg),
    });

    assert.ok(emitted.some((m) => m.includes('Rubric Totals') || m.includes('No dimension changes')));
  });

  it('writes diff to file when out provided', async () => {
    const { runMatrix } = await import('../src/scoring/run-matrix.js');
    const { formatJsonSnapshot } = await import('../src/scoring/report.js');

    const snap = runMatrix({ matrixId: 'm', subject: 's', dimensions: [], evidence: [] });
    const json = formatJsonSnapshot(snap);

    const written: Record<string, string> = {};
    await rubricScoreDiff({
      before: '/b.json',
      after: '/a.json',
      out: '/out/diff.md',
      _readFile: async () => json,
      _writeFile: async (p, d) => { written[p] = d; },
      _emit: () => {},
    });

    assert.ok(written['/out/diff.md']);
  });
});
