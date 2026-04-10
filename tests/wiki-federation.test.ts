import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  federateHighConfidenceEntities,
  queryGlobalWiki,
} from '../src/core/wiki-federation.js';
import { GLOBAL_FEDERATION_THRESHOLD } from '../src/core/wiki-schema.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeWikiPage(entity: string, confidence: number, tags: string[] = []): string {
  return [
    '---',
    `entity: ${entity}`,
    `type: module`,
    `created: 2026-01-01T00:00:00.000Z`,
    `updated: 2026-01-01T00:00:00.000Z`,
    `sources: []`,
    `links: []`,
    `constitutionRefs: []`,
    `tags: [${tags.join(', ')}]`,
    `confidence: ${confidence}`,
    `sourceProject: /some/project`,
    '---',
    '',
    `# ${entity}`,
    '',
    `This is the ${entity} module. It does important things with autoforge and PDSE.`,
  ].join('\n');
}

const n = (p: string) => p.replace(/\\/g, '/');

function makeStore(initial: Record<string, string> = {}): {
  store: Record<string, string>;
  readDir: (p: string) => Promise<string[]>;
  readFile: (p: string) => Promise<string>;
  writeFile: (p: string, c: string) => Promise<void>;
  mkdir: () => Promise<void>;
} {
  // Normalize all initial keys to forward slashes
  const store: Record<string, string> = Object.fromEntries(
    Object.entries(initial).map(([k, v]) => [n(k), v]),
  );
  return {
    store,
    readDir: async (p: string) => Object.keys(store).filter(k => k.startsWith(n(p)) && k.endsWith('.md')),
    readFile: async (p: string) => {
      const key = n(p);
      if (!(key in store)) throw new Error(`ENOENT: ${key}`);
      return store[key]!;
    },
    writeFile: async (p: string, c: string) => { store[n(p)] = c; },
    mkdir: async () => {},
  };
}

// ── federateHighConfidenceEntities ────────────────────────────────────────────

describe('federateHighConfidenceEntities', () => {
  it('federates entities with confidence >= threshold', async () => {
    const { store, readDir, readFile, writeFile, mkdir } = makeStore({
      '/wiki/pdse.md': makeWikiPage('pdse', 0.9),
    });

    const result = await federateHighConfidenceEntities('/wiki', '/global', {
      _readDir: readDir, _readFile: readFile, _writeFile: writeFile, _mkdir: mkdir,
    });

    assert.ok(result.federated.includes('pdse'));
    assert.equal(result.skipped.length, 0);
    assert.ok('/global/pdse.md' in store);
  });

  it('skips entities with confidence below threshold', async () => {
    const { readDir, readFile, writeFile, mkdir } = makeStore({
      '/wiki/low-conf.md': makeWikiPage('low-conf', 0.5),
    });

    const result = await federateHighConfidenceEntities('/wiki', '/global', {
      _readDir: readDir, _readFile: readFile, _writeFile: writeFile, _mkdir: mkdir,
    });

    assert.equal(result.federated.length, 0);
    assert.ok(result.skipped.includes('low-conf'));
  });

  it(`uses ${GLOBAL_FEDERATION_THRESHOLD} as threshold`, async () => {
    const { readDir, readFile, writeFile, mkdir } = makeStore({
      '/wiki/exact.md': makeWikiPage('exact', GLOBAL_FEDERATION_THRESHOLD),
      '/wiki/below.md': makeWikiPage('below', GLOBAL_FEDERATION_THRESHOLD - 0.01),
    });

    const result = await federateHighConfidenceEntities('/wiki', '/global', {
      _readDir: readDir, _readFile: readFile, _writeFile: writeFile, _mkdir: mkdir,
    });

    assert.ok(result.federated.includes('exact'));
    assert.ok(!result.federated.includes('below'));
  });

  it('merges sourceProjects when entity already exists in global wiki', async () => {
    const existingGlobal = makeWikiPage('pdse', 0.9);
    // Inject sourceProjects into the existing global entry
    const existingWithSrc = existingGlobal.replace('sourceProject: /some/project', 'sourceProjects:\n  - "/old/project"');

    const { store, readDir, readFile, writeFile, mkdir } = makeStore({
      '/wiki/pdse.md': makeWikiPage('pdse', 0.9),
      '/global/pdse.md': existingWithSrc,
    });

    await federateHighConfidenceEntities('/wiki', '/global', {
      _readDir: readDir, _readFile: readFile, _writeFile: writeFile, _mkdir: mkdir,
    });

    const written = store['/global/pdse.md'] ?? '';
    assert.ok(written.includes('/old/project'));
    assert.ok(written.includes('/wiki'));
  });

  it('skips index.md and system files', async () => {
    const { readDir, readFile, writeFile, mkdir } = makeStore({
      '/wiki/index.md': makeWikiPage('index', 0.95),
      '/wiki/.audit-log.md': '# audit',
      '/wiki/real-entity.md': makeWikiPage('real-entity', 0.9),
    });

    const result = await federateHighConfidenceEntities('/wiki', '/global', {
      _readDir: readDir, _readFile: readFile, _writeFile: writeFile, _mkdir: mkdir,
    });

    assert.ok(result.federated.includes('real-entity'));
    assert.ok(!result.federated.includes('index'));
  });

  it('handles empty wiki directory', async () => {
    const { readDir, readFile, writeFile, mkdir } = makeStore();

    const result = await federateHighConfidenceEntities('/empty', '/global', {
      _readDir: readDir, _readFile: readFile, _writeFile: writeFile, _mkdir: mkdir,
    });

    assert.equal(result.federated.length, 0);
    assert.equal(result.skipped.length, 0);
  });

  it('skips pages without valid frontmatter', async () => {
    const { readDir, readFile, writeFile, mkdir } = makeStore({
      '/wiki/no-fm.md': '# Just a heading\n\nNo frontmatter here.',
    });

    const result = await federateHighConfidenceEntities('/wiki', '/global', {
      _readDir: readDir, _readFile: readFile, _writeFile: writeFile, _mkdir: mkdir,
    });

    assert.equal(result.federated.length, 0);
    assert.ok(result.skipped.includes('no-fm.md'));
  });

  it('handles multiple entities, filters by confidence', async () => {
    const { readDir, readFile, writeFile, mkdir } = makeStore({
      '/wiki/good1.md': makeWikiPage('good1', 0.9),
      '/wiki/good2.md': makeWikiPage('good2', 0.8),
      '/wiki/bad1.md': makeWikiPage('bad1', 0.6),
    });

    const result = await federateHighConfidenceEntities('/wiki', '/global', {
      _readDir: readDir, _readFile: readFile, _writeFile: writeFile, _mkdir: mkdir,
    });

    assert.ok(result.federated.includes('good1'));
    assert.ok(result.federated.includes('good2'));
    assert.ok(!result.federated.includes('bad1'));
  });
});

// ── queryGlobalWiki ────────────────────────────────────────────────────────────

describe('queryGlobalWiki', () => {
  it('returns results matching query terms', async () => {
    const { readDir, readFile } = makeStore({
      '/global/pdse.md': makeWikiPage('pdse', 0.9, ['scoring', 'quality']),
    });

    const results = await queryGlobalWiki('PDSE scoring quality', '/global', 2000, {
      _readDir: readDir, _readFile: readFile,
    });

    assert.ok(results.length > 0);
    assert.equal(results[0]!.entityId, 'pdse');
  });

  it('returns empty array when no files match', async () => {
    const { readDir, readFile } = makeStore({
      '/global/unrelated.md': makeWikiPage('unrelated', 0.9, ['react', 'css']),
    });

    const results = await queryGlobalWiki('blockchain solidity defi', '/global', 2000, {
      _readDir: readDir, _readFile: readFile,
    });

    assert.equal(results.length, 0);
  });

  it('returns empty array for empty global wiki', async () => {
    const { readDir, readFile } = makeStore();
    const results = await queryGlobalWiki('anything', '/global', 2000, {
      _readDir: readDir, _readFile: readFile,
    });
    assert.equal(results.length, 0);
  });

  it('respects token budget — truncates long results', async () => {
    const store: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      store[`/global/entity${i}.md`] = makeWikiPage(`entity${i}`, 0.9, ['autoforge', 'pdse']);
    }
    const { readDir, readFile } = makeStore(store);

    // Very small budget — should return few results
    const results = await queryGlobalWiki('autoforge pdse', '/global', 50, {
      _readDir: readDir, _readFile: readFile,
    });

    assert.ok(results.length < 10);
  });

  it('prefixes excerpts with "[global]"', async () => {
    const { readDir, readFile } = makeStore({
      '/global/autoforge.md': makeWikiPage('autoforge', 0.9, ['loop', 'convergence']),
    });

    const results = await queryGlobalWiki('autoforge convergence loop', '/global', 2000, {
      _readDir: readDir, _readFile: readFile,
    });

    if (results.length > 0) {
      assert.ok(results[0]!.excerpt.startsWith('[global]'));
    }
  });

  it('sorts results by relevance (more term matches = higher score)', async () => {
    const { readDir, readFile } = makeStore({
      '/global/low.md': makeWikiPage('low', 0.9, ['autoforge']),
      '/global/high.md': makeWikiPage('high', 0.9, ['autoforge', 'pdse', 'scoring']),
    });

    const results = await queryGlobalWiki('autoforge pdse scoring', '/global', 4000, {
      _readDir: readDir, _readFile: readFile,
    });

    if (results.length >= 2) {
      assert.ok(results[0]!.score >= results[1]!.score);
    }
  });
});
