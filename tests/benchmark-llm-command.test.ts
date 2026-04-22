import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { benchmarkLLM } from '../src/cli/commands/benchmark-llm.js';
import type { BenchmarkResult } from '../src/core/llm-benchmark.js';

function makeResult(): BenchmarkResult {
  const metrics = { testLinesRatio: 0.5, errorHandlingRatio: 0.3, typeSafetyScore: 0.8, completenessScore: 0.9, docCoverageRatio: 0.2 };
  return {
    task: { id: '1', description: 'test task', successCriteria: [] },
    raw: { name: 'raw', prompt: 'raw prompt', response: 'raw response', durationMs: 100, metrics },
    danteforge: { name: 'danteforge', prompt: 'df prompt', response: 'df response', durationMs: 120, metrics },
    improvement: { testLinesRatio: 0.1, errorHandlingRatio: 0.1, typeSafetyScore: 0.1, completenessScore: 0.1, docCoverageRatio: 0.1, overallDeltaPercent: 10 },
    verdict: 'moderate',
    savedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('benchmarkLLM', () => {
  it('prints usage when no task provided', async () => {
    const lines: string[] = [];
    await benchmarkLLM({ _stdout: (l) => lines.push(l) });
    assert.ok(lines.some(l => l.includes('Usage')));
  });

  it('runs benchmark and emits report when task provided', async () => {
    const lines: string[] = [];
    await benchmarkLLM({
      task: 'write a function',
      _runBenchmark: async () => makeResult(),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.length > 0);
  });

  it('includes verdict in output', async () => {
    const lines: string[] = [];
    await benchmarkLLM({
      task: 'write a function',
      _runBenchmark: async () => makeResult(),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.toLowerCase().includes('moderate') || l.toLowerCase().includes('verdict')));
  });

  it('shows historical trend when --compare and history exists', async () => {
    const lines: string[] = [];
    await benchmarkLLM({
      task: 'write a function',
      compare: true,
      _runBenchmark: async () => makeResult(),
      _loadHistory: async () => [makeResult(), makeResult()],
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('HISTORICAL TREND') || l.includes('last 3')));
  });

  it('does not show historical trend when history is empty', async () => {
    const lines: string[] = [];
    await benchmarkLLM({
      task: 'write a function',
      compare: true,
      _runBenchmark: async () => makeResult(),
      _loadHistory: async () => [],
      _stdout: (l) => lines.push(l),
    });
    assert.ok(!lines.some(l => l.includes('HISTORICAL TREND')));
  });

  it('mentions save when save not disabled', async () => {
    const lines: string[] = [];
    await benchmarkLLM({
      task: 'write a function',
      _runBenchmark: async () => makeResult(),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(lines.some(l => l.includes('saved') || l.includes('benchmark-results')));
  });
});
