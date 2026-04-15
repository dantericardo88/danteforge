import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runImportPatterns,
  type ImportPatternsOptions,
} from '../src/cli/commands/import-patterns.js';
import type { SharedPatternBundle } from '../src/cli/commands/share-patterns.js';
import type { PatternLibraryIndex } from '../src/core/global-pattern-library.js';
import type { RefusedPatternsStore } from '../src/core/refused-patterns.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBundle(overrides: Partial<SharedPatternBundle> = {}): SharedPatternBundle {
  return {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    sourceProjectHash: 'abc123def456abcd',
    patterns: [{
      patternName: 'circuit-breaker',
      sourceRepo: 'github.com/example/repo',
      avgScoreDelta: 2.0,
      verifyPassRate: 0.9,
      sampleCount: 5,
      hypothesisValidationRate: 0.8,
    }],
    refusedPatternNames: [],
    ...overrides,
  };
}

function emptyLibrary(): PatternLibraryIndex {
  return { version: '1.0.0', entries: [], updatedAt: new Date().toISOString() };
}

function emptyRefused(): RefusedPatternsStore {
  return { version: '1.0.0', patterns: [], updatedAt: '' };
}

function makeOpts(
  bundle: SharedPatternBundle,
  libraryOverride?: PatternLibraryIndex,
  refusedOverride?: RefusedPatternsStore,
): ImportPatternsOptions {
  let savedLibrary = libraryOverride ?? emptyLibrary();
  let savedRefused = refusedOverride ?? emptyRefused();

  return {
    cwd: '/fake',
    _readBundle: async () => JSON.stringify(bundle),
    _loadLibrary: async () => savedLibrary,
    _saveLibrary: async (lib) => { savedLibrary = lib; },
    _loadRefused: async () => savedRefused,
    _saveRefused: async (store) => { savedRefused = store; },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runImportPatterns', () => {
  it('T1: imports new pattern into empty library', async () => {
    const bundle = makeBundle();
    const opts = makeOpts(bundle);

    const result = await runImportPatterns('/fake/bundle.json', opts);

    assert.equal(result.imported, 1, 'should import 1 new pattern');
    assert.equal(result.updated, 0);
    assert.equal(result.refused, 0);
  });

  it('T2: applies trust factor to sample count', async () => {
    let savedLibrary = emptyLibrary();
    const bundle = makeBundle(); // sampleCount=5, trustFactor=0.5 → useCount=max(1, floor(2.5))=2

    await runImportPatterns('/fake/bundle.json', {
      ...makeOpts(bundle, savedLibrary),
      trustFactor: 0.5,
      _saveLibrary: async (lib) => { savedLibrary = lib; },
    });

    const entry = savedLibrary.entries.find(e => e.patternName === 'circuit-breaker');
    assert.ok(entry, 'pattern should be in library');
    assert.ok(entry!.useCount >= 1 && entry!.useCount < 5, 'trust factor should reduce use count');
  });

  it('T3: skips patterns on the refused list', async () => {
    const refused: RefusedPatternsStore = {
      version: '1.0.0',
      patterns: [{ patternName: 'circuit-breaker', sourceRepo: '', refusedAt: '', reason: 'hypothesis-falsified' }],
      updatedAt: '',
    };

    const result = await runImportPatterns('/fake/bundle.json', makeOpts(makeBundle(), undefined, refused));

    assert.equal(result.refused, 1, 'refused pattern should be counted');
    assert.equal(result.imported, 0, 'refused pattern should not be imported');
  });

  it('T4: absorbs refused pattern names from bundle', async () => {
    const bundle = makeBundle({ refusedPatternNames: ['legacy-pattern', 'broken-cache'] });
    let savedRefused = emptyRefused();

    await runImportPatterns('/fake/bundle.json', {
      ...makeOpts(bundle),
      _saveRefused: async (store) => { savedRefused = store; },
    });

    const names = savedRefused.patterns.map(p => p.patternName);
    assert.ok(names.includes('legacy-pattern'), 'should absorb legacy-pattern');
    assert.ok(names.includes('broken-cache'), 'should absorb broken-cache');
  });

  it('T5: handles invalid bundle path gracefully', async () => {
    const result = await runImportPatterns('/no/such/file.json', {
      cwd: '/fake',
      _readBundle: async () => { throw new Error('ENOENT'); },
      _loadLibrary: async () => emptyLibrary(),
      _saveLibrary: async () => {},
      _loadRefused: async () => emptyRefused(),
      _saveRefused: async () => {},
    });

    assert.equal(result.imported, 0);
    assert.equal(result.updated, 0);
  });
});
