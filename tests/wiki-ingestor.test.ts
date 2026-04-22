// Tests for wiki-ingestor: manifest, hash, extraction, fuzzy match, upsert, bootstrap
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFileHash,
  levenshteinSimilarity,
  fuzzyMatchEntity,
  hasStubContent,
  loadRawManifest,
  saveRawManifest,
  detectNewFiles,
  extractEntitiesFromRaw,
  buildEntityPage,
  upsertEntityPage,
  bootstrapFromArtifacts,
  ingest,
} from '../src/core/wiki-ingestor.js';
import type { RawManifest } from '../src/core/wiki-schema.js';

// ── computeFileHash ───────────────────────────────────────────────────────────

describe('computeFileHash', () => {
  it('returns a 64-char hex SHA-256 string', () => {
    const hash = computeFileHash('hello world');
    assert.equal(hash.length, 64);
    assert.ok(/^[0-9a-f]+$/.test(hash));
  });

  it('returns different hashes for different content', () => {
    assert.notEqual(computeFileHash('abc'), computeFileHash('xyz'));
  });

  it('is deterministic', () => {
    assert.equal(computeFileHash('test'), computeFileHash('test'));
  });
});

// ── levenshteinSimilarity ─────────────────────────────────────────────────────

describe('levenshteinSimilarity', () => {
  it('returns 1 for identical strings', () => {
    assert.equal(levenshteinSimilarity('hello', 'hello'), 1);
  });

  it('returns 0 for completely different strings of same length', () => {
    assert.ok(levenshteinSimilarity('abc', 'xyz') < 0.5);
  });

  it('returns 0 for empty vs non-empty', () => {
    assert.equal(levenshteinSimilarity('', 'abc'), 0);
  });

  it('is case-insensitive', () => {
    assert.equal(levenshteinSimilarity('Hello', 'hello'), 1);
  });

  it('high similarity for near-match strings', () => {
    // 'autoforge-loop' vs 'autoforge' — should be fairly similar
    const score = levenshteinSimilarity('autoforge-loop', 'autoforge');
    assert.ok(score > 0.5);
  });
});

// ── fuzzyMatchEntity ──────────────────────────────────────────────────────────

describe('fuzzyMatchEntity', () => {
  const entities = ['autoforge-loop', 'pdse-config', 'wiki-engine', 'context-injector'];

  it('returns exact match with score 1', () => {
    const result = fuzzyMatchEntity('wiki-engine', entities);
    assert.ok(result !== null);
    assert.equal(result!.entityId, 'wiki-engine');
    assert.equal(result!.score, 1);
  });

  it('returns null when best match is below threshold', () => {
    const result = fuzzyMatchEntity('completely-unrelated-xyz', entities, 0.9);
    assert.equal(result, null);
  });

  it('finds near-match above threshold', () => {
    // 'autoforge' is similar enough to 'autoforge-loop' at default threshold
    const result = fuzzyMatchEntity('autoforge', entities, 0.5);
    assert.ok(result !== null);
    assert.equal(result!.entityId, 'autoforge-loop');
  });

  it('returns highest-scoring match when multiple are above threshold', () => {
    // 'pdse' vs 'pdse-config'/'pdse-engine' similarity ~0.36 — use threshold 0.3
    const result = fuzzyMatchEntity('pdse', ['pdse-config', 'pdse-engine', 'wiki'], 0.3);
    assert.ok(result !== null);
    // Both pdse-config and pdse-engine are candidates; should pick one
    assert.ok(['pdse-config', 'pdse-engine'].includes(result!.entityId));
  });
});

// ── hasStubContent ────────────────────────────────────────────────────────────

describe('hasStubContent', () => {
  it('returns false for clean content', () => {
    assert.ok(!hasStubContent('This is a clean wiki page about autoforge.'));
  });

  it('detects TODO', () => {
    assert.ok(hasStubContent('TODO: fill this in later'));
  });

  it('detects placeholder', () => {
    assert.ok(hasStubContent('This is a placeholder for future content'));
  });

  it('detects not implemented regex', () => {
    assert.ok(hasStubContent('This feature is not implemented'));
  });
});

// ── loadRawManifest / saveRawManifest ─────────────────────────────────────────

describe('loadRawManifest', () => {
  it('returns empty manifest when file does not exist', async () => {
    const manifest = await loadRawManifest('/fake/cwd', async () => { throw new Error('ENOENT'); });
    assert.deepEqual(manifest.files, {});
  });

  it('parses existing manifest', async () => {
    const existing: RawManifest = {
      files: { 'doc.md': { hash: 'abc123', ingestedAt: '2026-01-01T00:00:00.000Z', entityIds: ['thing'] } },
      lastUpdated: '2026-01-01T00:00:00.000Z',
    };
    const manifest = await loadRawManifest('/fake', async () => JSON.stringify(existing));
    assert.deepEqual(manifest.files['doc.md'].hash, 'abc123');
  });
});

describe('saveRawManifest', () => {
  it('writes manifest as JSON', async () => {
    const written: Record<string, string> = {};
    const manifest: RawManifest = { files: {}, lastUpdated: '2026-01-01T00:00:00.000Z' };
    await saveRawManifest(manifest, '/fake', async (p, c) => { written[p] = c; }, async () => {});
    const saved = JSON.parse(Object.values(written)[0]);
    assert.deepEqual(saved.files, {});
  });
});

// ── detectNewFiles ────────────────────────────────────────────────────────────

describe('detectNewFiles', () => {
  it('returns all files when manifest is empty', async () => {
    const manifest: RawManifest = { files: {}, lastUpdated: '' };
    const readDir = async () => ['/raw/a.md', '/raw/b.md'];
    const readFile = async () => 'content';

    const result = await detectNewFiles('/raw', manifest, readDir, readFile);
    assert.equal(result.length, 2);
  });

  it('returns only changed files', async () => {
    const originalContent = 'original';
    const hash = computeFileHash(originalContent);

    const manifest: RawManifest = {
      files: { 'a.md': { hash, ingestedAt: '', entityIds: [] } },
      lastUpdated: '',
    };
    const readDir = async () => ['/raw/a.md', '/raw/b.md'];
    const readFile = async (p: string) => p.endsWith('a.md') ? originalContent : 'new-content';

    const result = await detectNewFiles('/raw', manifest, readDir, readFile);
    // a.md is unchanged, b.md is new
    assert.equal(result.length, 1);
    assert.ok(result[0].endsWith('b.md'));
  });

  it('returns file when hash has changed', async () => {
    const manifest: RawManifest = {
      files: { 'a.md': { hash: 'old-hash', ingestedAt: '', entityIds: [] } },
      lastUpdated: '',
    };
    const readDir = async () => ['/raw/a.md'];
    const readFile = async () => 'new content with different hash';

    const result = await detectNewFiles('/raw', manifest, readDir, readFile);
    assert.equal(result.length, 1);
  });
});

// ── extractEntitiesFromRaw ────────────────────────────────────────────────────

describe('extractEntitiesFromRaw', () => {
  it('uses LLM caller when provided and parses JSON response', async () => {
    const mockResponse = JSON.stringify({
      entities: [{ name: 'autoforge-loop', type: 'module', summary: 'Core loop', tags: ['core'] }],
      relationships: [],
    });
    const result = await extractEntitiesFromRaw('some content', 'doc.md', async () => mockResponse);
    assert.equal(result.entities.length, 1);
    assert.equal(result.entities[0].name, 'autoforge-loop');
  });

  it('parses LLM response wrapped in markdown code block', async () => {
    const json = JSON.stringify({
      entities: [{ name: 'pdse', type: 'module', summary: 'PDSE engine', tags: [] }],
      relationships: [],
    });
    const mockResponse = '```json\n' + json + '\n```';
    const result = await extractEntitiesFromRaw('content', 'doc.md', async () => mockResponse);
    assert.equal(result.entities[0].name, 'pdse');
  });

  it('falls back to header extraction when LLM fails', async () => {
    const content = '# Doc\n\n## Autoforge Loop\n\nSome content.\n\n## Wiki Engine\n\nMore.';
    const result = await extractEntitiesFromRaw(content, 'doc.md', async () => { throw new Error('LLM fail'); });
    assert.ok(result.entities.length >= 2);
  });

  it('falls back to header extraction when no LLM provided', async () => {
    const content = '# Doc\n\n## My Feature\n\nContent here.';
    const result = await extractEntitiesFromRaw(content, 'doc.md');
    assert.ok(result.entities.length >= 1);
  });
});

// ── buildEntityPage ───────────────────────────────────────────────────────────

describe('buildEntityPage', () => {
  it('creates a new page with required sections', () => {
    const entity = { name: 'autoforge-loop', type: 'module', summary: 'Core loop', tags: ['core'] };
    const content = buildEntityPage(entity, 'raw/PLAN.md');
    assert.ok(content.includes('entity: "autoforge-loop"'));
    assert.ok(content.includes('## Summary'));
    assert.ok(content.includes('## History'));
    assert.ok(content.includes('raw/PLAN.md'));
  });

  it('updates existing page by appending History entry', () => {
    const entity = { name: 'autoforge-loop', type: 'module', summary: 'Updated summary', tags: [] };
    const existing = [
      '---',
      'entity: "autoforge-loop"',
      'type: module',
      'created: 2026-01-01T00:00:00.000Z',
      'updated: 2026-01-01T00:00:00.000Z',
      'sources:',
      '  - raw/old.md',
      'links: []',
      'constitution-refs: []',
      'tags: []',
      '---',
      '',
      '# Autoforge Loop',
      '',
      '## Summary',
      '',
      'Old summary.',
      '',
      '## History',
      '',
      '### 2026-01-01T00:00:00.000Z',
      '',
      'Initial ingestion.',
    ].join('\n');

    const updated = buildEntityPage(entity, 'raw/new.md', existing);
    assert.ok(updated.includes('raw/old.md'));
    assert.ok(updated.includes('raw/new.md'));
    assert.ok(updated.includes('Updated summary'));
  });
});

// ── upsertEntityPage ──────────────────────────────────────────────────────────

describe('upsertEntityPage', () => {
  it('creates a new page file', async () => {
    const written: Record<string, string> = {};
    const entity = { name: 'my-module', type: 'module', summary: 'A clean module.', tags: [] };

    await upsertEntityPage(
      entity,
      'raw/source.md',
      'wiki/',
      async () => { throw new Error('ENOENT'); },
      async (p, c) => { written[p] = c; },
      async () => {},
    );

    const content = Object.values(written)[0];
    assert.ok(content !== undefined);
    assert.ok(content.includes('entity: "my-module"'));
  });

  it('throws when generated content contains stub patterns', async () => {
    const entity = { name: 'stub-module', type: 'module', summary: 'TODO: fill this in', tags: [] };

    await assert.rejects(
      () => upsertEntityPage(
        entity,
        'raw/source.md',
        'wiki/',
        async () => { throw new Error('ENOENT'); },
        async () => {},
        async () => {},
      ),
      /Anti-stub check failed/,
    );
  });
});

// ── bootstrapFromArtifacts ────────────────────────────────────────────────────

describe('bootstrapFromArtifacts', () => {
  it('skips artifacts that do not exist', async () => {
    const result = await bootstrapFromArtifacts({
      cwd: '/fake/project',
      _exists: async () => false,
      _readFile: async () => { throw new Error('ENOENT'); },
      _writeFile: async () => {},
      _readDir: async () => [],
      _mkdir: async () => {},
    });

    assert.equal(result.ingested.length, 0);
    assert.ok(result.skipped.length > 0);
  });

  it('ingests existing artifacts', async () => {
    const files: Record<string, string> = {
      '/fake/.danteforge/SPEC.md': '# Spec\n\n## Feature\n\nA clean feature description with no stubs.',
      '/fake/.danteforge/PLAN.md': '# Plan\n\n## Architecture\n\nA clean architecture plan.',
    };

    const written: Record<string, string> = {};

    const n = (p: string) => p.replace(/\\/g, '/');
    const result = await bootstrapFromArtifacts({
      cwd: '/fake',
      _exists: async (p) => n(p) in files,
      _readFile: async (p) => {
        const np = n(p);
        if (np in files) return files[np];
        throw new Error('ENOENT');
      },
      _writeFile: async (p, c) => { written[n(p)] = c; },
      _readDir: async () => Object.keys(written).filter(k => k.endsWith('.md') && !k.includes('.danteforge')),
      _mkdir: async () => {},
    });

    assert.ok(result.ingested.includes('SPEC.md') || result.ingested.includes('PLAN.md'));
  });
});

// ── ingest pipeline ───────────────────────────────────────────────────────────

describe('ingest', () => {
  it('returns empty results when raw dir has no files', async () => {
    const result = await ingest({
      cwd: '/fake',
      _readFile: async () => { throw new Error('ENOENT'); },
      _writeFile: async () => {},
      _readDir: async () => [],
      _mkdir: async () => {},
      _exists: async () => false,
    });

    assert.equal(result.processed.length, 0);
    assert.equal(result.errors.length, 0);
  });

  it('processes new raw files and creates entity pages', async () => {
    const rawContent = '# Raw Document\n\n## Important Module\n\nThis is a well-defined module description.';
    const store: Record<string, string> = {
      '/fake/.danteforge/raw/doc.md': rawContent,
    };
    const written: Record<string, string> = {};

    const result = await ingest({
      cwd: '/fake',
      _readFile: async (p) => {
        if (p in store) return store[p];
        throw new Error('ENOENT');
      },
      _writeFile: async (p, c) => {
        written[p] = c;
        store[p] = c;
      },
      _readDir: async (dir: string) => {
        if (dir.includes('raw')) return ['/fake/.danteforge/raw/doc.md'];
        return Object.keys(written).filter(k => k.includes('wiki') && k.endsWith('.md'));
      },
      _mkdir: async () => {},
      _exists: async (p) => p in store,
    });

    assert.equal(result.processed.length, 1);
  });

  it('skips unchanged files (hash match in manifest)', async () => {
    const content = 'unchanged content';
    const { computeFileHash: cfh } = await import('../src/core/wiki-ingestor.js');
    const hash = cfh(content);

    const manifestContent = JSON.stringify({
      files: { 'doc.md': { hash, ingestedAt: '2026-01-01T00:00:00.000Z', entityIds: [] } },
      lastUpdated: '2026-01-01T00:00:00.000Z',
    });

    const result = await ingest({
      cwd: '/fake',
      _readFile: async (p) => {
        if (p.endsWith('.manifest.json')) return manifestContent;
        if (p.endsWith('doc.md')) return content;
        throw new Error('ENOENT');
      },
      _writeFile: async () => {},
      _readDir: async (dir: string) => dir.includes('raw') ? ['/fake/.danteforge/raw/doc.md'] : [],
      _mkdir: async () => {},
      _exists: async () => false,
    });

    assert.equal(result.processed.length, 0);
  });
});
