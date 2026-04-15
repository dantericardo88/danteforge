import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  recordAdoptionResult,
  computePatternROI,
  getHighROICategories,
  getRollbackSha,
  loadAttributionLog,
  type AttributionRecord,
  type AttributionLog,
} from '../src/core/causal-attribution.ts';

/** Creates an in-memory _fsRead/_fsWrite pair backed by a single string variable. */
function makeMemoryStore(initial?: AttributionLog): {
  fsRead: (p: string) => Promise<string>;
  fsWrite: (p: string, d: string) => Promise<void>;
  getStored: () => AttributionLog | null;
} {
  let stored: string | null = initial ? JSON.stringify(initial, null, 2) : null;

  return {
    fsRead: async (_p: string) => {
      if (stored === null) throw new Error('ENOENT');
      return stored;
    },
    fsWrite: async (_p: string, d: string) => {
      stored = d;
    },
    getStored: () => (stored ? (JSON.parse(stored) as AttributionLog) : null),
  };
}

function makeRecord(overrides: Partial<AttributionRecord> = {}): AttributionRecord {
  return {
    patternName: 'error-handling',
    sourceRepo: 'github.com/example/repo',
    adoptedAt: new Date().toISOString(),
    preAdoptionScore: 5.0,
    postAdoptionScore: 7.0,
    scoreDelta: 2.0,
    verifyStatus: 'pass',
    filesModified: ['src/main.ts'],
    ...overrides,
  };
}

describe('recordAdoptionResult', () => {
  it('T1: appends record to empty log', async () => {
    const store = makeMemoryStore();
    const record = makeRecord();

    await recordAdoptionResult(record, '/fake/cwd', {
      _fsRead: store.fsRead,
      _fsWrite: store.fsWrite,
    });

    const log = store.getStored();
    assert.ok(log !== null);
    assert.equal(log.records.length, 1);
    assert.equal(log.records[0].patternName, 'error-handling');
    assert.equal(log.records[0].scoreDelta, 2.0);
  });

  it('T2: multiple records accumulate in order', async () => {
    const store = makeMemoryStore();

    const first = makeRecord({ patternName: 'circuit-breaker', scoreDelta: 1.5 });
    const second = makeRecord({ patternName: 'retry-logic', scoreDelta: 0.8 });
    const third = makeRecord({ patternName: 'structured-logging', scoreDelta: 0.3 });

    await recordAdoptionResult(first, '/fake/cwd', {
      _fsRead: store.fsRead,
      _fsWrite: store.fsWrite,
    });
    await recordAdoptionResult(second, '/fake/cwd', {
      _fsRead: store.fsRead,
      _fsWrite: store.fsWrite,
    });
    await recordAdoptionResult(third, '/fake/cwd', {
      _fsRead: store.fsRead,
      _fsWrite: store.fsWrite,
    });

    const log = store.getStored();
    assert.ok(log !== null);
    assert.equal(log.records.length, 3);
    assert.equal(log.records[0].patternName, 'circuit-breaker');
    assert.equal(log.records[1].patternName, 'retry-logic');
    assert.equal(log.records[2].patternName, 'structured-logging');
  });
});

describe('computePatternROI', () => {
  it('T3: returns 0 for unknown pattern', () => {
    const log: AttributionLog = { version: '1.0.0', records: [], updatedAt: new Date().toISOString() };
    const roi = computePatternROI('unknown-pattern', log);
    assert.equal(roi, 0);
  });

  it('T4: averages scoreDelta from pass records only', () => {
    const log: AttributionLog = {
      version: '1.0.0',
      records: [
        makeRecord({ patternName: 'circuit-breaker', verifyStatus: 'pass', scoreDelta: 2.0 }),
        makeRecord({ patternName: 'circuit-breaker', verifyStatus: 'pass', scoreDelta: 4.0 }),
        makeRecord({ patternName: 'circuit-breaker', verifyStatus: 'fail', scoreDelta: -1.0 }), // excluded
        makeRecord({ patternName: 'circuit-breaker', verifyStatus: 'rejected', scoreDelta: -0.5 }), // excluded
      ],
      updatedAt: new Date().toISOString(),
    };

    const roi = computePatternROI('circuit-breaker', log);
    // average of [2.0, 4.0] = 3.0
    assert.ok(Math.abs(roi - 3.0) < 1e-9, `expected 3.0, got ${roi}`);
  });
});

describe('getHighROICategories', () => {
  it('T5: returns categories sorted by avg ROI descending', () => {
    const log: AttributionLog = {
      version: '1.0.0',
      records: [
        makeRecord({ patternName: 'error-handling', verifyStatus: 'pass', scoreDelta: 1.0 }),
        makeRecord({ patternName: 'circuit-handler', verifyStatus: 'pass', scoreDelta: 3.0 }),
        makeRecord({ patternName: 'log-rotation', verifyStatus: 'pass', scoreDelta: 2.0 }),
      ],
      updatedAt: new Date().toISOString(),
    };

    // Categories derived from prefix before '-':
    // 'error-handling' → 'error' (avgRoi 1.0)
    // 'circuit-handler' → 'circuit' (avgRoi 3.0)
    // 'log-rotation' → 'log' (avgRoi 2.0)
    const categories = getHighROICategories(log, 0.5);
    assert.ok(categories.length >= 3, `expected at least 3 categories, got ${categories.length}`);
    // Sorted descending by avgRoi: circuit (3.0) > log (2.0) > error (1.0)
    const circuitIdx = categories.indexOf('circuit');
    const logIdx = categories.indexOf('log');
    const errorIdx = categories.indexOf('error');
    assert.ok(circuitIdx < logIdx, 'circuit should come before log');
    assert.ok(logIdx < errorIdx, 'log should come before error');
  });

  it('T6: excludes categories below minRoi threshold', () => {
    const log: AttributionLog = {
      version: '1.0.0',
      records: [
        makeRecord({ patternName: 'high-quality', verifyStatus: 'pass', scoreDelta: 2.0 }),
        makeRecord({ patternName: 'low-quality', verifyStatus: 'pass', scoreDelta: 0.1 }),
      ],
      updatedAt: new Date().toISOString(),
    };

    const categories = getHighROICategories(log, 0.5);
    // 'high' (2.0) passes threshold, 'low' (0.1) does not
    assert.ok(categories.includes('high'), 'high-quality category should be included');
    assert.ok(!categories.includes('low'), 'low-quality category should be excluded');
  });
});

describe('outcomeHypothesis field', () => {
  it('T9: outcomeHypothesis is stored and retrieved with the record', async () => {
    const store = makeMemoryStore();
    const record = makeRecord({
      outcomeHypothesis: 'Expects error-handling dimension to improve by reducing unhandled exceptions',
    });

    await recordAdoptionResult(record, '/fake/cwd', {
      _fsRead: store.fsRead,
      _fsWrite: store.fsWrite,
    });

    const log = store.getStored();
    assert.ok(log !== null);
    assert.equal(log.records[0].outcomeHypothesis, 'Expects error-handling dimension to improve by reducing unhandled exceptions');
  });

  it('T10: records without outcomeHypothesis remain valid (field is optional)', async () => {
    const store = makeMemoryStore();
    const record = makeRecord(); // no outcomeHypothesis

    await recordAdoptionResult(record, '/fake/cwd', {
      _fsRead: store.fsRead,
      _fsWrite: store.fsWrite,
    });

    const log = store.getStored();
    assert.ok(log !== null);
    assert.equal(log.records[0].outcomeHypothesis, undefined);
  });
});

describe('getRollbackSha', () => {
  it('T7: returns most recent gitSha for pattern', () => {
    const log: AttributionLog = {
      version: '1.0.0',
      records: [
        makeRecord({ patternName: 'circuit-breaker', gitSha: 'abc123' }),
        makeRecord({ patternName: 'circuit-breaker', gitSha: 'def456' }),
      ],
      updatedAt: new Date().toISOString(),
    };

    const sha = getRollbackSha('circuit-breaker', log);
    // Should return the most recent (last) record's SHA
    assert.equal(sha, 'def456');
  });

  it('T8: returns undefined when no record exists', () => {
    const log: AttributionLog = {
      version: '1.0.0',
      records: [
        makeRecord({ patternName: 'other-pattern', gitSha: 'abc123' }),
      ],
      updatedAt: new Date().toISOString(),
    };

    const sha = getRollbackSha('nonexistent-pattern', log);
    assert.equal(sha, undefined);
  });
});

// ── Mutation-killing boundary tests ──────────────────────────────────────────

describe('getRollbackSha + computePatternROI — mutation boundaries', () => {
  it('Tmut1: getRollbackSha with exactly 1 matching record returns its sha', () => {
    // Kills: loop `i >= 0` mutated to `i > 0` — would skip index 0 (first/only element)
    const log: AttributionLog = {
      version: '1.0.0',
      records: [makeRecord({ patternName: 'single-pattern', gitSha: 'sha-only' })],
      updatedAt: new Date().toISOString(),
    };
    const sha = getRollbackSha('single-pattern', log);
    assert.equal(sha, 'sha-only', 'single record at index 0 must be found (i >= 0, not i > 0)');
  });

  it('Tmut2: computePatternROI excludes "fail" and "rejected" — all three statuses tested', () => {
    // Kills: `verifyStatus === "pass"` mutated to `!== "fail"` (would include "rejected")
    const log: AttributionLog = {
      version: '1.0.0',
      records: [
        makeRecord({ patternName: 'p', scoreDelta: 2.0, verifyStatus: 'pass' }),
        makeRecord({ patternName: 'p', scoreDelta: 5.0, verifyStatus: 'fail' }),
        makeRecord({ patternName: 'p', scoreDelta: 5.0, verifyStatus: 'rejected' }),
      ],
      updatedAt: new Date().toISOString(),
    };
    // Only the 'pass' record (delta=2.0) should count
    const roi = computePatternROI('p', log);
    assert.equal(roi, 2.0, '"fail" and "rejected" must be excluded from ROI calculation');
  });

  it('Tmut3: computePatternROI divides by passing.length exactly', () => {
    // Kills: `total / passing.length` mutated to `total / passing.length + 1`
    const log: AttributionLog = {
      version: '1.0.0',
      records: [
        makeRecord({ patternName: 'q', scoreDelta: 1.0, verifyStatus: 'pass' }),
        makeRecord({ patternName: 'q', scoreDelta: 3.0, verifyStatus: 'pass' }),
      ],
      updatedAt: new Date().toISOString(),
    };
    // (1.0 + 3.0) / 2 = 2.0 exactly
    const roi = computePatternROI('q', log);
    assert.equal(roi, 2.0, 'ROI = sum/count; for deltas [1, 3] with 2 records = 2.0 exactly');
  });
});
