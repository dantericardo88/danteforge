import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCrossSynthesize } from '../src/cli/commands/cross-synthesize.js';
import type { AttributionRecord } from '../src/core/causal-attribution.js';

function makeRecord(overrides: Partial<AttributionRecord> = {}): AttributionRecord {
  return {
    patternName: 'test-pattern',
    sourceRepo: 'acme/repo',
    adoptedAt: new Date().toISOString(),
    preAdoptionScore: 6.0,
    postAdoptionScore: 7.0,
    scoreDelta: 1.0,
    verifyStatus: 'pass',
    filesModified: [],
    ...overrides,
  };
}

describe('cross-synthesize command', () => {
  it('T1: loads attribution records and calls LLM', async () => {
    let llmCalled = false;
    const result = await runCrossSynthesize({
      _loadAttribution: async () => [makeRecord()],
      _loadUPR: async () => null,
      _callLLM: async () => { llmCalled = true; return '# Cross Synthesis\n\nContent.'; },
      _writeReport: async () => {},
    });
    assert.ok(llmCalled, 'LLM must be called');
    assert.strictEqual(result.written, true);
  });

  it('T2: writes CROSS_SYNTHESIS.md via _writeReport', async () => {
    let written = '';
    await runCrossSynthesize({
      _loadAttribution: async () => [makeRecord()],
      _loadUPR: async () => null,
      _callLLM: async () => '# Cross Synthesis\n\nContent.',
      _writeReport: async (content) => { written = content; },
    });
    assert.ok(written.length > 0, 'report content must be written');
  });

  it('T3: filters to patterns with positive scoreDelta and pass status', async () => {
    let promptReceived = '';
    const records = [
      makeRecord({ patternName: 'winner', scoreDelta: 1.5, verifyStatus: 'pass' }),
      makeRecord({ patternName: 'loser', scoreDelta: -0.5, verifyStatus: 'fail' }),
      makeRecord({ patternName: 'neutral', scoreDelta: 0, verifyStatus: 'pass' }),
    ];
    await runCrossSynthesize({
      _loadAttribution: async () => records,
      _loadUPR: async () => null,
      _callLLM: async (p) => { promptReceived = p; return '# Synthesis'; },
      _writeReport: async () => {},
    });
    assert.ok(promptReceived.includes('winner'), 'prompt must include the winner');
    assert.strictEqual(promptReceived.includes('loser') && promptReceived.includes('PATTERNS THAT DID NOT WORK'), true);
  });

  it('T4: handles empty attribution log gracefully — returns written=false', async () => {
    let llmCalled = false;
    const result = await runCrossSynthesize({
      _loadAttribution: async () => [],
      _loadUPR: async () => null,
      _callLLM: async () => { llmCalled = true; return ''; },
      _writeReport: async () => {},
    });
    assert.strictEqual(result.written, false);
    assert.strictEqual(result.patternsAnalyzed, 0);
    assert.strictEqual(llmCalled, false, 'LLM must not be called for empty attribution log');
  });

  it('T5: result includes winnersFound count', async () => {
    const records = [
      makeRecord({ patternName: 'a', scoreDelta: 0.5, verifyStatus: 'pass' }),
      makeRecord({ patternName: 'b', scoreDelta: 1.2, verifyStatus: 'pass' }),
      makeRecord({ patternName: 'c', scoreDelta: -0.1, verifyStatus: 'fail' }),
    ];
    const result = await runCrossSynthesize({
      _loadAttribution: async () => records,
      _loadUPR: async () => null,
      _callLLM: async () => '# Synthesis',
      _writeReport: async () => {},
    });
    assert.strictEqual(result.patternsAnalyzed, 3);
    assert.strictEqual(result.winnersFound, 2);
  });

  it('T6: handles missing UPR gracefully — still calls LLM', async () => {
    let llmCalled = false;
    const result = await runCrossSynthesize({
      _loadAttribution: async () => [makeRecord()],
      _loadUPR: async () => null,
      _callLLM: async () => { llmCalled = true; return '# Synthesis'; },
      _writeReport: async () => {},
    });
    assert.ok(llmCalled, 'must proceed without UPR');
    assert.strictEqual(result.written, true);
  });
});
