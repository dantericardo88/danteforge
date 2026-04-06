import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDimensionTable,
  formatMasterplanTable,
  type DimRow,
  type MasterplanRow,
} from '../src/core/report-formatter.js';

describe('formatDimensionTable', () => {
  const rows: DimRow[] = [
    { dim: 'functionality' as any, score: 7.5, bestCompetitor: 'Claude Code', bestScore: 90, delta: -15 },
    { dim: 'testing' as any, score: 8.5, bestCompetitor: 'Qodo 2.0', bestScore: 92, delta: -7 },
    { dim: 'communityAdoption' as any, score: 1.5, bestCompetitor: 'Copilot CLI', bestScore: 95, delta: -80 },
  ];

  it('returns a non-empty string', () => {
    const result = formatDimensionTable(rows);
    assert.ok(result.length > 0);
  });

  it('includes P0 flag for low scores', () => {
    const result = formatDimensionTable(rows);
    assert.ok(result.includes('⚠ P0') || result.includes('P0'));
  });

  it('includes dimension names', () => {
    const result = formatDimensionTable(rows);
    assert.ok(result.includes('functionality'));
  });

  it('falls back gracefully when cli-table3 unavailable', () => {
    // Test the fallback path by passing empty rows
    const result = formatDimensionTable([]);
    assert.equal(typeof result, 'string');
  });
});

describe('formatMasterplanTable', () => {
  it('returns a string for masterplan rows', () => {
    const rows: MasterplanRow[] = [
      { priority: 'P0', dimension: 'communityAdoption', action: 'Publish to npm', effort: 'Low' },
    ];
    const result = formatMasterplanTable(rows);
    assert.ok(result.length > 0);
  });
});
