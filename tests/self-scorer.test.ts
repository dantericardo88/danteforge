import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildSelfDossier } from '../src/dossier/self-scorer.js';

const FAKE_RUBRIC = {
  version: 1,
  frozenAt: '2026-01-01T00:00:00.000Z',
  dimensions: {
    '1': { name: 'Test Dim', description: 'A test dimension', criteria: [], weight: 1.0 },
  },
};

// Returns ENOENT for dossier file (no existing dossier) — avoids snapshot path bug with undefined lastBuilt
function makeReadFile(sourceContent = '// source code') {
  return async (p: string) => {
    // Throw for .danteforge paths (existing dossier reads) to avoid snapshot path issues
    if (p.includes('.danteforge')) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return sourceContent;
  };
}

const BASE_OPTS = {
  cwd: '/tmp/test-project',
  _readFile: makeReadFile(),
  _writeFile: async () => {},
  _mkdir: async () => {},
  _glob: async () => [] as string[],
  _loadRubric: async () => FAKE_RUBRIC as any,
  _extractEvidence: async () => [] as any[],
  _scoreDimension: async () => ({ score: 5, justification: 'test' }),
};

describe('buildSelfDossier', () => {
  it('returns a dossier with specified competitor id', async () => {
    const result = await buildSelfDossier({ ...BASE_OPTS, competitorId: 'my-tool' });
    assert.equal(result.competitor, 'my-tool');
  });

  it('returns a dossier object with string competitor', async () => {
    const result = await buildSelfDossier(BASE_OPTS);
    assert.ok(typeof result.competitor === 'string');
  });

  it('returns a numeric composite score', async () => {
    const result = await buildSelfDossier(BASE_OPTS);
    assert.ok(typeof result.composite === 'number');
  });

  it('includes evidence from _extractEvidence when source files are found', async () => {
    const fakeEvidence = [{ text: 'Found test files', confidence: 0.9, source: 'test.ts', quote: 'found' }];
    const result = await buildSelfDossier({
      ...BASE_OPTS,
      sourceGlob: ['src/index.ts'],
      _readFile: makeReadFile('// source code\nfunction foo() {}'),
      _extractEvidence: async () => fakeEvidence as any,
      _scoreDimension: async () => ({ score: 7, justification: 'has tests' }),
    });
    const dims = Object.values(result.dimensions);
    assert.ok(dims.some(d => d.evidence.length > 0));
  });

  it('calls _writeFile to persist the dossier', async () => {
    const writtenPaths: string[] = [];
    await buildSelfDossier({
      ...BASE_OPTS,
      _writeFile: async (p) => { writtenPaths.push(p); },
    });
    assert.ok(writtenPaths.length > 0);
  });

  it('does not throw when _glob returns empty list', async () => {
    await assert.doesNotReject(() => buildSelfDossier(BASE_OPTS));
  });

  it('uses displayName when provided', async () => {
    const result = await buildSelfDossier({ ...BASE_OPTS, displayName: 'My Custom Tool' });
    assert.equal(result.displayName, 'My Custom Tool');
  });
});
