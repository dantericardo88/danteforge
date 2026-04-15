import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runSharePatterns,
  type SharePatternsOptions,
  type SharedPatternBundle,
} from '../src/cli/commands/share-patterns.js';
import type { AttributionLog } from '../src/core/causal-attribution.js';
import type { RefusedPatternsStore } from '../src/core/refused-patterns.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLog(records: Partial<AttributionLog['records'][number]>[] = []): AttributionLog {
  return {
    version: '1.0.0',
    records: records.map(r => ({
      patternName: 'circuit-breaker',
      sourceRepo: 'github.com/example/repo',
      adoptedAt: new Date().toISOString(),
      preAdoptionScore: 5.0,
      postAdoptionScore: 7.0,
      scoreDelta: 2.0,
      verifyStatus: 'pass' as const,
      filesModified: ['src/main.ts'],
      ...r,
    })),
    updatedAt: new Date().toISOString(),
  };
}

function emptyRefused(): RefusedPatternsStore {
  return { version: '1.0.0', patterns: [], updatedAt: '' };
}

function makeOpts(overrides: Partial<SharePatternsOptions> = {}): SharePatternsOptions {
  let captured = '';
  return {
    cwd: '/fake',
    _loadAttributionLog: async () => makeLog([{}]),
    _loadRefusedPatterns: async () => emptyRefused(),
    _writeBundle: async (_p, c) => { captured = c; },
    _getProjectName: async () => 'danteforge',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runSharePatterns', () => {
  it('T1: exports bundle with correct structure', async () => {
    const result = await runSharePatterns(makeOpts());

    assert.equal(result.bundle.version, '1.0.0');
    assert.ok(result.bundle.exportedAt, 'exportedAt should be set');
    assert.ok(result.bundle.sourceProjectHash.length > 0, 'hash should be present');
    assert.ok(Array.isArray(result.bundle.patterns), 'patterns should be array');
  });

  it('T2: aggregates multiple records for the same pattern', async () => {
    const log = makeLog([
      { patternName: 'retry-logic', scoreDelta: 1.0 },
      { patternName: 'retry-logic', scoreDelta: 3.0 },
    ]);

    const result = await runSharePatterns(makeOpts({
      _loadAttributionLog: async () => log,
    }));

    const pattern = result.bundle.patterns.find(p => p.patternName === 'retry-logic');
    assert.ok(pattern, 'should have retry-logic pattern');
    assert.equal(pattern!.sampleCount, 2, 'should aggregate 2 records');
    assert.equal(pattern!.avgScoreDelta, 2.0, 'should average deltas');
  });

  it('T3: includes refused pattern names in bundle', async () => {
    const refused: RefusedPatternsStore = {
      version: '1.0.0',
      patterns: [{ patternName: 'bad-pattern', sourceRepo: '', refusedAt: '', reason: 'hypothesis-falsified' }],
      updatedAt: '',
    };

    const result = await runSharePatterns(makeOpts({
      _loadRefusedPatterns: async () => refused,
    }));

    assert.ok(result.bundle.refusedPatternNames.includes('bad-pattern'), 'should include refused name');
  });

  it('T4: sourceProjectHash is anonymised (not the raw project name)', async () => {
    const result = await runSharePatterns(makeOpts({
      _getProjectName: async () => 'my-secret-project',
    }));

    assert.ok(!result.bundle.sourceProjectHash.includes('my-secret'), 'should not expose project name');
    assert.equal(result.bundle.sourceProjectHash.length, 16, 'should be 16-char truncated SHA-256');
  });

  it('T5: patternCount matches exported patterns length', async () => {
    const log = makeLog([
      { patternName: 'pattern-a', scoreDelta: 1.5 },
      { patternName: 'pattern-b', scoreDelta: 0.8 },
    ]);

    const result = await runSharePatterns(makeOpts({
      _loadAttributionLog: async () => log,
    }));

    assert.equal(result.patternCount, result.bundle.patterns.length);
    assert.equal(result.patternCount, 2, 'should have 2 distinct patterns');
  });
});
