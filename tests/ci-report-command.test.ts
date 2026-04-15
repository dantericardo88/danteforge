// ci-report command tests — runCIReportCommand

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { runCIReportCommand } from '../src/cli/commands/ci-report.js';
import type { CIAttributionReport } from '../src/core/ci-attribution.js';

after(() => { process.exitCode = 0; });

function makeReport(overrides: Partial<CIAttributionReport> = {}): CIAttributionReport {
  return {
    summary: ['All checks passed', 'GATE: PASS'],
    regressions: [],
    suspectPatterns: [],
    shouldFail: false,
    ...overrides,
  };
}

describe('runCIReportCommand', () => {
  it('runs without throwing when report passes', async () => {
    await assert.doesNotReject(() =>
      runCIReportCommand({
        cwd: process.cwd(),
        _ciAttribution: async () => makeReport(),
      })
    );
  });

  it('sets exitCode=1 when report shouldFail is true', async () => {
    process.exitCode = 0;
    await runCIReportCommand({
      _ciAttribution: async () => makeReport({
        shouldFail: true,
        summary: ['GATE: FAIL', 'Regressions detected'],
        suspectPatterns: [{ patternName: 'bad-pattern', adoptedAt: '2026-01-01', scoreDelta: -1.5 }],
      }),
    });
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  });

  it('does not set exitCode=1 when report passes', async () => {
    process.exitCode = 0;
    await runCIReportCommand({
      _ciAttribution: async () => makeReport({ shouldFail: false }),
    });
    assert.equal(process.exitCode, 0);
  });

  it('passes through window option to attribution', async () => {
    let receivedOpts: Record<string, unknown> = {};
    await runCIReportCommand({
      window: 14,
      _ciAttribution: async (opts) => {
        receivedOpts = opts as Record<string, unknown>;
        return makeReport();
      },
    });
    assert.equal(receivedOpts['attributionWindow'], 14);
  });

  it('passes through threshold option', async () => {
    let receivedOpts: Record<string, unknown> = {};
    await runCIReportCommand({
      threshold: 1.0,
      _ciAttribution: async (opts) => {
        receivedOpts = opts as Record<string, unknown>;
        return makeReport();
      },
    });
    assert.equal(receivedOpts['regressionThreshold'], 1.0);
  });

  it('sets updateBaseline=false when noUpdate is true', async () => {
    let receivedOpts: Record<string, unknown> = {};
    await runCIReportCommand({
      noUpdate: true,
      _ciAttribution: async (opts) => {
        receivedOpts = opts as Record<string, unknown>;
        return makeReport();
      },
    });
    assert.equal(receivedOpts['updateBaseline'], false);
  });

  it('sets updateBaseline=true by default', async () => {
    let receivedOpts: Record<string, unknown> = {};
    await runCIReportCommand({
      _ciAttribution: async (opts) => {
        receivedOpts = opts as Record<string, unknown>;
        return makeReport();
      },
    });
    assert.equal(receivedOpts['updateBaseline'], true);
  });
});
