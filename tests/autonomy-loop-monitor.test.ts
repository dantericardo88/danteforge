import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessLoopHealth,
  buildCycleRecord,
  formatLoopHealthReport,
} from '../src/matrix/engines/autonomy-loop-monitor.js';

function makeRecord(opts: {
  cycle: number;
  dimensionId?: string;
  patternsHarvested?: number;
  forgeWaveSuccess?: boolean;
  scoreBefore?: number;
  scoreAfter?: number;
}) {
  return buildCycleRecord({
    cycle: opts.cycle,
    dimensionId: opts.dimensionId ?? 'security',
    patternsHarvested: opts.patternsHarvested ?? 5,
    forgeWaveSuccess: opts.forgeWaveSuccess ?? true,
    scoreBefore: opts.scoreBefore ?? 6.0,
    scoreAfter: opts.scoreAfter ?? 6.5,
    timestamp: '2026-05-25T00:00:00.000Z',
  });
}

describe('assessLoopHealth', () => {
  it('returns HEALTHY for empty records', () => {
    const result = assessLoopHealth([]);
    assert.equal(result.status, 'HEALTHY');
    assert.equal(result.cyclesAnalyzed, 0);
  });

  it('returns HEALTHY for successful progressing cycles', () => {
    const records = [
      makeRecord({ cycle: 1, scoreBefore: 5.0, scoreAfter: 5.5 }),
      makeRecord({ cycle: 2, scoreBefore: 5.5, scoreAfter: 6.0 }),
      makeRecord({ cycle: 3, scoreBefore: 6.0, scoreAfter: 6.5 }),
    ];
    const result = assessLoopHealth(records);
    assert.equal(result.status, 'HEALTHY');
    assert.ok(result.totalScoreDelta > 0);
  });

  it('returns STALLING for low forge success rate', () => {
    const records = [
      makeRecord({ cycle: 1, forgeWaveSuccess: false, scoreBefore: 5.0, scoreAfter: 5.0 }),
      makeRecord({ cycle: 2, forgeWaveSuccess: false, scoreBefore: 5.0, scoreAfter: 5.0 }),
      makeRecord({ cycle: 3, forgeWaveSuccess: false, scoreBefore: 5.0, scoreAfter: 5.0 }),
    ];
    const result = assessLoopHealth(records);
    assert.ok(result.status === 'STALLING' || result.status === 'STUCK', `got ${result.status}`);
    assert.equal(result.forgeSuccessRate, 0);
  });

  it('returns STUCK when 3+ cycles have no score progress on same dim', () => {
    const records = [
      makeRecord({ cycle: 1, dimensionId: 'security', scoreBefore: 6.0, scoreAfter: 6.0 }),
      makeRecord({ cycle: 2, dimensionId: 'security', scoreBefore: 6.0, scoreAfter: 6.02 }),
      makeRecord({ cycle: 3, dimensionId: 'security', scoreBefore: 6.02, scoreAfter: 6.02 }),
    ];
    const result = assessLoopHealth(records);
    assert.equal(result.status, 'STUCK');
    assert.ok(result.stalledDimensions.includes('security'));
  });

  it('computes avgPatternsPerCycle correctly', () => {
    const records = [
      makeRecord({ cycle: 1, patternsHarvested: 4 }),
      makeRecord({ cycle: 2, patternsHarvested: 6 }),
    ];
    const result = assessLoopHealth(records);
    assert.equal(result.avgPatternsPerCycle, 5);
  });

  it('does not mark STUCK for a dim with progress amid failures', () => {
    const records = [
      makeRecord({ cycle: 1, dimensionId: 'security', forgeWaveSuccess: false, scoreBefore: 5.0, scoreAfter: 5.0 }),
      makeRecord({ cycle: 2, dimensionId: 'security', forgeWaveSuccess: true, scoreBefore: 5.0, scoreAfter: 5.5 }),
      makeRecord({ cycle: 3, dimensionId: 'security', forgeWaveSuccess: true, scoreBefore: 5.5, scoreAfter: 6.0 }),
    ];
    const result = assessLoopHealth(records);
    assert.notEqual(result.status, 'STUCK');
  });
});

describe('buildCycleRecord', () => {
  it('computes scoreDelta correctly', () => {
    const r = buildCycleRecord({
      cycle: 1, dimensionId: 'autonomy',
      patternsHarvested: 3, forgeWaveSuccess: true,
      scoreBefore: 6.0, scoreAfter: 6.7,
    });
    assert.ok(Math.abs(r.scoreDelta - 0.7) < 0.001, `scoreDelta: ${r.scoreDelta}`);
  });

  it('stores negative delta when score drops', () => {
    const r = buildCycleRecord({
      cycle: 1, dimensionId: 'test',
      patternsHarvested: 0, forgeWaveSuccess: false,
      scoreBefore: 7.0, scoreAfter: 6.5,
    });
    assert.ok(r.scoreDelta < 0);
  });
});

describe('formatLoopHealthReport', () => {
  it('includes status and recommendation', () => {
    const records = [makeRecord({ cycle: 1 })];
    const assessment = assessLoopHealth(records);
    const report = formatLoopHealthReport(records, assessment);
    assert.ok(report.includes('HEALTHY') || report.includes('STALLING') || report.includes('STUCK'));
    assert.ok(report.includes('Recommendation:'));
  });

  it('shows recent cycle entries', () => {
    const records = [
      makeRecord({ cycle: 1, patternsHarvested: 3, forgeWaveSuccess: true }),
      makeRecord({ cycle: 2, patternsHarvested: 7, forgeWaveSuccess: false }),
    ];
    const assessment = assessLoopHealth(records);
    const report = formatLoopHealthReport(records, assessment);
    assert.ok(report.includes('[1]') && report.includes('[2]'));
  });
});
