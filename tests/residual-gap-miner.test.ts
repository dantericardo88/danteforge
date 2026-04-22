// Residual Gap Miner tests — analyzeResidualGaps, generateGapReport

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { analyzeResidualGaps, generateGapReport } from '../src/core/residual-gap-miner.js';
import type { EvidenceBundle } from '../src/core/run-ledger.js';
import type { DanteState } from '../src/core/state.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  return {
    run: { runId: 'test', command: 'forge', startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), exitCode: 0 } as never,
    events: [],
    inputs: {},
    plan: { tasks: ['task-1'] },
    reads: [{ timestamp: new Date().toISOString(), path: '/fake/file.ts', operation: 'read' }],
    writes: [{ timestamp: new Date().toISOString(), path: '/fake/out.ts', operation: 'write' }],
    commands: [{ exitCode: 0, command: 'npm test', stdout: '', stderr: '', durationMs: 100, timestamp: new Date().toISOString() } as never],
    tests: [{ name: 'test-1', status: 'pass', durationMs: 10 } as never],
    gates: [{ gate: 'constitution', status: 'pass' } as never],
    receipts: [],
    verdict: 'complete' as never,
    summary: '',
    ...overrides,
  };
}

const EMPTY_STATE: DanteState = {
  project: 'test',
  version: '1.0.0',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  tasks: {},
} as never;

// ── analyzeResidualGaps ───────────────────────────────────────────────────────

describe('analyzeResidualGaps', () => {
  it('returns a ResidualGapReport with timestamp and analysis', () => {
    const report = analyzeResidualGaps(makeBundle(), EMPTY_STATE);
    assert.ok(typeof report.timestamp === 'string');
    assert.ok(!isNaN(Date.parse(report.timestamp)));
    assert.ok(typeof report.analysis === 'object');
    assert.ok(Array.isArray(report.recommendations));
    assert.ok(Array.isArray(report.nextWavePriority));
  });

  it('adds confirmedGap when no reads', () => {
    const bundle = makeBundle({ reads: [] });
    const report = analyzeResidualGaps(bundle, EMPTY_STATE);
    assert.ok(report.analysis.confirmedGaps.some(g => g.includes('file reads')));
  });

  it('adds confirmedGap when no writes', () => {
    const bundle = makeBundle({ writes: [] });
    const report = analyzeResidualGaps(bundle, EMPTY_STATE);
    assert.ok(report.analysis.confirmedGaps.some(g => g.includes('writes')));
  });

  it('adds confirmedGap when no commands', () => {
    const bundle = makeBundle({ commands: [] });
    const report = analyzeResidualGaps(bundle, EMPTY_STATE);
    assert.ok(report.analysis.confirmedGaps.some(g => g.includes('commands')));
  });

  it('records missingTests when tests array is empty', () => {
    const bundle = makeBundle({ tests: [] });
    const report = analyzeResidualGaps(bundle, EMPTY_STATE);
    assert.ok(report.analysis.missingTests.length > 0);
  });

  it('records confirmedGap for low test pass rate', () => {
    const bundle = makeBundle({
      tests: [
        { name: 'pass-1', status: 'pass', durationMs: 10 } as never,
        { name: 'fail-1', status: 'fail', durationMs: 10 } as never,
        { name: 'fail-2', status: 'fail', durationMs: 10 } as never,
      ],
    });
    const report = analyzeResidualGaps(bundle, EMPTY_STATE);
    assert.ok(report.analysis.confirmedGaps.some(g => g.includes('test pass rate') || g.includes('Low test')));
  });

  it('records missingWiring when gates array is empty', () => {
    const bundle = makeBundle({ gates: [] });
    const report = analyzeResidualGaps(bundle, EMPTY_STATE);
    assert.ok(report.analysis.missingWiring.length > 0);
  });

  it('records confirmedGap for failed gates', () => {
    const bundle = makeBundle({
      gates: [
        { gate: 'constitution', status: 'pass' } as never,
        { gate: 'spec', status: 'fail' } as never,
      ],
    });
    const report = analyzeResidualGaps(bundle, EMPTY_STATE);
    assert.ok(report.analysis.confirmedGaps.some(g => g.includes('gate')));
  });

  it('records regression when commands have non-zero exit codes', () => {
    const bundle = makeBundle({
      commands: [
        { exitCode: 1, command: 'npm test', stdout: '', stderr: 'error', durationMs: 100, timestamp: new Date().toISOString() } as never,
      ],
    });
    const report = analyzeResidualGaps(bundle, EMPTY_STATE);
    assert.ok(report.analysis.regressions.length > 0);
  });

  it('adds confirmedGap when no plan', () => {
    const bundle = makeBundle({ plan: null });
    const report = analyzeResidualGaps(bundle, EMPTY_STATE);
    assert.ok(report.analysis.confirmedGaps.some(g => g.includes('plan')));
  });

  it('analysis score is a number', () => {
    const report = analyzeResidualGaps(makeBundle(), EMPTY_STATE);
    assert.ok(typeof report.analysis.score === 'number');
  });

  it('healthy bundle gets higher score than empty bundle', () => {
    const healthyReport = analyzeResidualGaps(makeBundle(), EMPTY_STATE);
    const emptyBundle = makeBundle({ reads: [], writes: [], commands: [], tests: [], gates: [], plan: {} });
    const emptyReport = analyzeResidualGaps(emptyBundle, EMPTY_STATE);
    assert.ok(healthyReport.analysis.score >= emptyReport.analysis.score);
  });
});

// ── generateGapReport ─────────────────────────────────────────────────────────

describe('generateGapReport', () => {
  it('returns the same report as analyzeResidualGaps', async () => {
    const bundle = makeBundle();
    const report = await generateGapReport(bundle, EMPTY_STATE);
    assert.ok(typeof report.timestamp === 'string');
    assert.ok(Array.isArray(report.analysis.confirmedGaps));
  });

  it('writes report to file when outputPath is provided', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gap-report-'));
    const outputPath = path.join(tmpDir, 'report.json');
    const bundle = makeBundle();
    await generateGapReport(bundle, EMPTY_STATE, outputPath);
    const written = await fs.readFile(outputPath, 'utf8');
    const parsed = JSON.parse(written);
    assert.ok(typeof parsed.timestamp === 'string');
    await fs.rm(tmpDir, { recursive: true }).catch(() => {});
  });

  it('does not throw when outputPath is not provided', async () => {
    const bundle = makeBundle();
    await assert.doesNotReject(() => generateGapReport(bundle, EMPTY_STATE));
  });
});
