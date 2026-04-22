import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  publishToLibrary,
  queryLibrary,
  updatePatternRoi,
  loadLibrary,
  decayPatterns,
  computeFitness,
  PATTERN_DECAY_DAYS,
  PATTERN_STALE_DAYS,
  type GlobalPatternEntry,
  type PatternLibraryIndex,
} from '../src/core/global-pattern-library.ts';

/** Creates an in-memory _fsRead/_fsWrite pair backed by a single string variable. */
function makeMemoryStore(initial?: PatternLibraryIndex): {
  fsRead: (p: string) => Promise<string>;
  fsWrite: (p: string, d: string) => Promise<void>;
  getStored: () => PatternLibraryIndex | null;
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
    getStored: () => (stored ? (JSON.parse(stored) as PatternLibraryIndex) : null),
  };
}

const basePattern: Omit<GlobalPatternEntry, 'publishedAt' | 'useCount' | 'avgRoi' | 'fitness' | 'lastValidatedAt'> = {
  patternName: 'circuit-breaker',
  category: 'resilience',
  implementationSnippet: 'class CircuitBreaker { ... }',
  whyItWorks: 'Prevents cascade failures',
  adoptionComplexity: 'medium',
  sourceRepo: 'github.com/example/repo',
  sourceProject: 'my-project',
};

describe('publishToLibrary', () => {
  it('T1: adds new entry with useCount=1 and avgRoi=0.5', async () => {
    const store = makeMemoryStore();
    await publishToLibrary(basePattern, { _fsRead: store.fsRead, _fsWrite: store.fsWrite });

    const lib = store.getStored();
    assert.ok(lib !== null);
    assert.equal(lib.entries.length, 1);
    const entry = lib.entries[0];
    assert.equal(entry.patternName, 'circuit-breaker');
    assert.equal(entry.useCount, 1);
    assert.equal(entry.avgRoi, 0.5);
  });

  it('T2: updates existing entry (same patternName+sourceRepo), increments useCount', async () => {
    const store = makeMemoryStore();

    // Publish once
    await publishToLibrary(basePattern, { _fsRead: store.fsRead, _fsWrite: store.fsWrite });
    // Publish again with same patternName + sourceRepo
    await publishToLibrary(
      { ...basePattern, whyItWorks: 'Updated reason' },
      { _fsRead: store.fsRead, _fsWrite: store.fsWrite },
    );

    const lib = store.getStored();
    assert.ok(lib !== null);
    assert.equal(lib.entries.length, 1, 'should not create a duplicate entry');
    const entry = lib.entries[0];
    assert.equal(entry.useCount, 2);
    assert.equal(entry.whyItWorks, 'Updated reason');
    // avgRoi is preserved on update
    assert.equal(entry.avgRoi, 0.5);
  });
});

describe('queryLibrary', () => {
  async function makeLibWithMultiplePatterns() {
    const store = makeMemoryStore();

    const patterns: Array<Omit<GlobalPatternEntry, 'publishedAt' | 'useCount' | 'avgRoi'>> = [
      { ...basePattern, patternName: 'circuit-breaker', category: 'resilience', adoptionComplexity: 'medium', sourceRepo: 'repo-a', sourceProject: 'proj-a' },
      { ...basePattern, patternName: 'retry-logic', category: 'resilience', adoptionComplexity: 'low', sourceRepo: 'repo-b', sourceProject: 'proj-b' },
      { ...basePattern, patternName: 'structured-logging', category: 'observability', adoptionComplexity: 'low', sourceRepo: 'repo-c', sourceProject: 'proj-c' },
      { ...basePattern, patternName: 'tracing', category: 'observability', adoptionComplexity: 'high', sourceRepo: 'repo-d', sourceProject: 'proj-d' },
    ];

    for (const p of patterns) {
      await publishToLibrary(p, { _fsRead: store.fsRead, _fsWrite: store.fsWrite });
    }

    // Set different avgRoi values to test sorting
    const lib = store.getStored()!;
    lib.entries[0].avgRoi = 0.3; // circuit-breaker
    lib.entries[1].avgRoi = 0.9; // retry-logic
    lib.entries[2].avgRoi = 0.6; // structured-logging
    lib.entries[3].avgRoi = 0.4; // tracing

    const updatedStore = makeMemoryStore(lib);
    return updatedStore;
  }

  it('T3: filters by category', async () => {
    const store = await makeLibWithMultiplePatterns();
    const results = await queryLibrary({ category: 'resilience' }, store.fsRead);
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.category === 'resilience'));
  });

  it('T4: sorts by avgRoi descending', async () => {
    const store = await makeLibWithMultiplePatterns();
    const results = await queryLibrary({}, store.fsRead);
    for (let i = 0; i < results.length - 1; i++) {
      assert.ok(
        results[i].avgRoi >= results[i + 1].avgRoi,
        `expected descending avgRoi at index ${i}: ${results[i].avgRoi} >= ${results[i + 1].avgRoi}`,
      );
    }
  });

  it('T5: respects limit param', async () => {
    const store = await makeLibWithMultiplePatterns();
    const results = await queryLibrary({ limit: 2 }, store.fsRead);
    assert.equal(results.length, 2);
  });
});

describe('updatePatternRoi', () => {
  it('T6: applies weighted average (0.7 * existing + 0.3 * new)', async () => {
    const store = makeMemoryStore();
    await publishToLibrary(basePattern, { _fsRead: store.fsRead, _fsWrite: store.fsWrite });

    const initialLib = store.getStored()!;
    const initialRoi = initialLib.entries[0].avgRoi; // 0.5

    const newRoi = 1.0;
    await updatePatternRoi(
      basePattern.patternName,
      basePattern.sourceRepo,
      newRoi,
      { _fsRead: store.fsRead, _fsWrite: store.fsWrite },
    );

    const lib = store.getStored();
    assert.ok(lib !== null);
    const entry = lib.entries.find(
      (e) => e.patternName === basePattern.patternName && e.sourceRepo === basePattern.sourceRepo,
    );
    assert.ok(entry !== undefined);
    const expected = 0.7 * initialRoi + 0.3 * newRoi;
    assert.ok(
      Math.abs(entry.avgRoi - expected) < 1e-9,
      `expected avgRoi=${expected}, got ${entry.avgRoi}`,
    );
  });
});

describe('loadLibrary', () => {
  it('T7: returns empty index when fsRead throws', async () => {
    const throwingRead = async (_p: string): Promise<string> => {
      throw new Error('ENOENT');
    };
    const lib = await loadLibrary(throwingRead);
    assert.equal(lib.version, '1.0.0');
    assert.deepEqual(lib.entries, []);
  });
});

// ── Fitness decay tests ───────────────────────────────────────────────────────

describe('computeFitness', () => {
  it('T8: returns active for recently published pattern', () => {
    const entry: GlobalPatternEntry = {
      patternName: 'test',
      category: 'testing',
      implementationSnippet: '',
      whyItWorks: '',
      adoptionComplexity: 'low',
      sourceRepo: 'repo',
      sourceProject: 'proj',
      publishedAt: new Date().toISOString(),
      lastValidatedAt: new Date().toISOString(),
      useCount: 1,
      avgRoi: 0.5,
      fitness: 'active',
    };
    assert.equal(computeFitness(entry, Date.now()), 'active');
  });

  it('T9: returns decaying when lastValidatedAt is older than PATTERN_DECAY_DAYS', () => {
    const old = new Date(Date.now() - (PATTERN_DECAY_DAYS + 1) * 86_400_000).toISOString();
    const entry: GlobalPatternEntry = {
      patternName: 'test',
      category: 'testing',
      implementationSnippet: '',
      whyItWorks: '',
      adoptionComplexity: 'low',
      sourceRepo: 'repo',
      sourceProject: 'proj',
      publishedAt: old,
      lastValidatedAt: old,
      useCount: 1,
      avgRoi: 0.5,
      fitness: 'active', // stale fitness — computeFitness should override
    };
    assert.equal(computeFitness(entry, Date.now()), 'decaying');
  });

  it('T10: returns stale when lastValidatedAt is older than PATTERN_STALE_DAYS', () => {
    const veryOld = new Date(Date.now() - (PATTERN_STALE_DAYS + 1) * 86_400_000).toISOString();
    const entry: GlobalPatternEntry = {
      patternName: 'test',
      category: 'testing',
      implementationSnippet: '',
      whyItWorks: '',
      adoptionComplexity: 'low',
      sourceRepo: 'repo',
      sourceProject: 'proj',
      publishedAt: veryOld,
      useCount: 1,
      avgRoi: 0.5,
      fitness: 'active',
    };
    assert.equal(computeFitness(entry, Date.now()), 'stale');
  });
});

describe('decayPatterns', () => {
  it('T11: marks old patterns as decaying and counts correctly', async () => {
    const old = new Date(Date.now() - (PATTERN_DECAY_DAYS + 5) * 86_400_000).toISOString();
    const fresh = new Date().toISOString();
    const initial: PatternLibraryIndex = {
      version: '1.0.0',
      updatedAt: fresh,
      entries: [
        {
          patternName: 'old-pattern',
          category: 'testing',
          implementationSnippet: '',
          whyItWorks: '',
          adoptionComplexity: 'low',
          sourceRepo: 'repo',
          sourceProject: 'proj',
          publishedAt: old,
          lastValidatedAt: old,
          useCount: 2,
          avgRoi: 0.6,
          fitness: 'active',
        },
        {
          patternName: 'fresh-pattern',
          category: 'testing',
          implementationSnippet: '',
          whyItWorks: '',
          adoptionComplexity: 'low',
          sourceRepo: 'repo2',
          sourceProject: 'proj',
          publishedAt: fresh,
          lastValidatedAt: fresh,
          useCount: 1,
          avgRoi: 0.7,
          fitness: 'active',
        },
      ],
    };

    const store = makeMemoryStore(initial);
    const counts = await decayPatterns({ _fsRead: store.fsRead, _fsWrite: store.fsWrite });

    assert.equal(counts.active, 1, 'fresh pattern should be active');
    assert.equal(counts.decaying, 1, 'old pattern should be decaying');
    assert.equal(counts.stale, 0);

    const lib = store.getStored()!;
    const oldEntry = lib.entries.find(e => e.patternName === 'old-pattern');
    assert.equal(oldEntry?.fitness, 'decaying');
  });

  it('T12: active patterns sort before decaying in queryLibrary', async () => {
    const old = new Date(Date.now() - (PATTERN_DECAY_DAYS + 5) * 86_400_000).toISOString();
    const fresh = new Date().toISOString();
    const initial: PatternLibraryIndex = {
      version: '1.0.0',
      updatedAt: fresh,
      entries: [
        {
          patternName: 'decaying-high-roi', category: 'testing', implementationSnippet: '', whyItWorks: '',
          adoptionComplexity: 'low', sourceRepo: 'repo', sourceProject: 'proj',
          publishedAt: old, lastValidatedAt: old, useCount: 1, avgRoi: 0.95, fitness: 'decaying',
        },
        {
          patternName: 'active-low-roi', category: 'testing', implementationSnippet: '', whyItWorks: '',
          adoptionComplexity: 'low', sourceRepo: 'repo2', sourceProject: 'proj',
          publishedAt: fresh, lastValidatedAt: fresh, useCount: 1, avgRoi: 0.3, fitness: 'active',
        },
      ],
    };

    const store = makeMemoryStore(initial);
    const results = await queryLibrary({}, store.fsRead);

    assert.equal(results[0]?.patternName, 'active-low-roi', 'active pattern should rank first even with lower ROI');
    assert.equal(results[1]?.patternName, 'decaying-high-roi');
  });
});
