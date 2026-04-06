// Tests for wiki-indexer: frontmatter parsing, link graph, orphan detection
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrontmatter,
  extractBody,
  parseEntityPage,
  buildLinkGraph,
  findOrphanPages,
  computeLinkDensity,
  resolveWikiLink,
  listEntityIds,
  getEntityPage,
  rebuildIndex,
} from '../src/core/wiki-indexer.js';

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makePage(entity: string, links: string[] = [], tags: string[] = []): string {
  const linksYaml = links.length
    ? `links:\n${links.map(l => `  - ${l}`).join('\n')}`
    : 'links: []';
  const tagsYaml = tags.length
    ? `tags:\n${tags.map(t => `  - ${t}`).join('\n')}`
    : 'tags: []';
  return [
    '---',
    `entity: "${entity}"`,
    'type: module',
    'created: 2026-04-01T00:00:00.000Z',
    'updated: 2026-04-01T00:00:00.000Z',
    'sources: []',
    linksYaml,
    'constitution-refs: []',
    tagsYaml,
    '---',
    '',
    `# ${entity}`,
    '',
    `Summary of ${entity}.`,
  ].join('\n');
}

type FsMap = Record<string, string>;

function makeFs(files: FsMap) {
  const readDir = async (dir: string): Promise<string[]> =>
    Object.keys(files).filter(p => p.startsWith(dir) && p.endsWith('.md') && !p.split('/').pop()!.startsWith('.'));
  const readFile = async (p: string): Promise<string> => {
    if (!(p in files)) throw new Error(`ENOENT: ${p}`);
    return files[p];
  };
  return { readDir, readFile };
}

// ── parseFrontmatter ──────────────────────────────────────────────────────────

describe('parseFrontmatter', () => {
  it('returns null for content without frontmatter', () => {
    assert.equal(parseFrontmatter('# Just a heading\n\nNo frontmatter.'), null);
  });

  it('parses entity and type', () => {
    const content = makePage('autoforge-loop');
    const fm = parseFrontmatter(content);
    assert.ok(fm !== null);
    assert.equal(fm!.entity, 'autoforge-loop');
    assert.equal(fm!.type, 'module');
  });

  it('parses multi-line links array', () => {
    const content = makePage('wiki-engine', ['pdse', 'context-injector']);
    const fm = parseFrontmatter(content);
    assert.ok(fm !== null);
    assert.deepEqual(fm!.links, ['pdse', 'context-injector']);
  });

  it('parses inline tags array', () => {
    const content = [
      '---',
      'entity: "test-entity"',
      'type: concept',
      'created: 2026-01-01T00:00:00.000Z',
      'updated: 2026-01-01T00:00:00.000Z',
      'sources: []',
      'links: []',
      'constitution-refs: []',
      'tags: [scoring, pipeline]',
      '---',
    ].join('\n');
    const fm = parseFrontmatter(content);
    assert.ok(fm !== null);
    assert.deepEqual(fm!.tags, ['scoring', 'pipeline']);
  });

  it('defaults unknown type to concept', () => {
    const content = [
      '---',
      'entity: "x"',
      'type: unknown-type',
      'created: 2026-01-01T00:00:00.000Z',
      'updated: 2026-01-01T00:00:00.000Z',
      'sources: []',
      'links: []',
      'constitution-refs: []',
      'tags: []',
      '---',
    ].join('\n');
    const fm = parseFrontmatter(content);
    assert.equal(fm!.type, 'concept');
  });

  it('returns empty arrays for missing array fields', () => {
    const content = [
      '---',
      'entity: "x"',
      'type: module',
      'created: 2026-01-01T00:00:00.000Z',
      'updated: 2026-01-01T00:00:00.000Z',
      '---',
    ].join('\n');
    const fm = parseFrontmatter(content);
    assert.ok(fm !== null);
    assert.deepEqual(fm!.links, []);
    assert.deepEqual(fm!.tags, []);
    assert.deepEqual(fm!.sources, []);
  });
});

// ── extractBody ───────────────────────────────────────────────────────────────

describe('extractBody', () => {
  it('extracts content after frontmatter', () => {
    const content = '---\nentity: x\n---\n\n# Title\n\nBody text.';
    assert.equal(extractBody(content), '# Title\n\nBody text.');
  });

  it('returns full content when no frontmatter present', () => {
    assert.equal(extractBody('# No frontmatter'), '# No frontmatter');
  });
});

// ── buildLinkGraph ────────────────────────────────────────────────────────────

describe('buildLinkGraph', () => {
  it('returns empty map for empty directory', async () => {
    const { readDir, readFile } = makeFs({});
    const graph = await buildLinkGraph('wiki/', readDir, readFile);
    assert.equal(graph.size, 0);
  });

  it('builds inbound link map correctly', async () => {
    // A links to B, C links to B
    const files: FsMap = {
      'wiki/a.md': makePage('a', ['b']),
      'wiki/b.md': makePage('b', []),
      'wiki/c.md': makePage('c', ['b']),
    };
    const { readDir, readFile } = makeFs(files);
    const graph = await buildLinkGraph('wiki/', readDir, readFile);

    // b should have inbound from a and c
    assert.equal(graph.get('b')?.size, 2);
    assert.ok(graph.get('b')?.has('a'));
    assert.ok(graph.get('b')?.has('c'));

    // a has no inbound
    assert.equal(graph.get('a')?.size, 0);
  });

  it('handles circular links without infinite loop', async () => {
    const files: FsMap = {
      'wiki/a.md': makePage('a', ['b']),
      'wiki/b.md': makePage('b', ['a']),
    };
    const { readDir, readFile } = makeFs(files);
    const graph = await buildLinkGraph('wiki/', readDir, readFile);
    assert.equal(graph.get('a')?.size, 1);
    assert.equal(graph.get('b')?.size, 1);
  });
});

// ── findOrphanPages ───────────────────────────────────────────────────────────

describe('findOrphanPages', () => {
  it('returns all pages when no links exist', () => {
    const graph = new Map([
      ['a', new Set<string>()],
      ['b', new Set<string>()],
    ]);
    const orphans = findOrphanPages(graph);
    assert.deepEqual(orphans, ['a', 'b']);
  });

  it('excludes pages with inbound links', () => {
    const graph = new Map([
      ['a', new Set<string>()],        // orphan
      ['b', new Set<string>(['a'])],   // has inbound from a
    ]);
    const orphans = findOrphanPages(graph);
    assert.deepEqual(orphans, ['a']);
  });

  it('returns empty array when no orphans', () => {
    const graph = new Map([
      ['a', new Set<string>(['b'])],
      ['b', new Set<string>(['a'])],
    ]);
    assert.deepEqual(findOrphanPages(graph), []);
  });
});

// ── computeLinkDensity ────────────────────────────────────────────────────────

describe('computeLinkDensity', () => {
  it('returns 0 for empty graph', () => {
    assert.equal(computeLinkDensity(new Map()), 0);
  });

  it('returns 0 when no links', () => {
    const graph = new Map([['a', new Set<string>()], ['b', new Set<string>()]]);
    assert.equal(computeLinkDensity(graph), 0);
  });

  it('computes average correctly', () => {
    // a has 2 inbound, b has 1 inbound, c has 0 — avg = (2+1+0)/3 ≈ 1
    const graph = new Map([
      ['a', new Set<string>(['x', 'y'])],
      ['b', new Set<string>(['x'])],
      ['c', new Set<string>()],
    ]);
    assert.equal(computeLinkDensity(graph), 1);
  });
});

// ── resolveWikiLink ───────────────────────────────────────────────────────────

describe('resolveWikiLink', () => {
  const entities = new Set(['autoforge-loop', 'pdse-config', 'wiki-engine']);

  it('resolves exact match', () => {
    assert.ok(resolveWikiLink('autoforge-loop', entities));
  });

  it('resolves case-insensitive', () => {
    assert.ok(resolveWikiLink('Autoforge-Loop', entities));
  });

  it('resolves with [[wikilink]] notation', () => {
    assert.ok(resolveWikiLink('[[wiki-engine]]', entities));
  });

  it('returns false for unknown entity', () => {
    assert.ok(!resolveWikiLink('unknown-entity', entities));
  });
});

// ── listEntityIds ─────────────────────────────────────────────────────────────

describe('listEntityIds', () => {
  it('returns sorted entity IDs', async () => {
    const files: FsMap = {
      'wiki/z.md': makePage('z-entity'),
      'wiki/a.md': makePage('a-entity'),
      'wiki/m.md': makePage('m-entity'),
    };
    const { readDir, readFile } = makeFs(files);
    const ids = await listEntityIds('wiki/', readDir, readFile);
    assert.deepEqual(ids, ['a-entity', 'm-entity', 'z-entity']);
  });

  it('returns empty array for empty directory', async () => {
    const { readDir, readFile } = makeFs({});
    const ids = await listEntityIds('wiki/', readDir, readFile);
    assert.deepEqual(ids, []);
  });
});

// ── getEntityPage ─────────────────────────────────────────────────────────────

describe('getEntityPage', () => {
  it('finds a page by entity ID', async () => {
    const files: FsMap = {
      'wiki/autoforge.md': makePage('autoforge-loop'),
      'wiki/pdse.md': makePage('pdse-engine'),
    };
    const { readDir, readFile } = makeFs(files);
    const page = await getEntityPage('pdse-engine', 'wiki/', readDir, readFile);
    assert.ok(page !== null);
    assert.equal(page!.frontmatter.entity, 'pdse-engine');
  });

  it('returns null for unknown entity', async () => {
    const files: FsMap = { 'wiki/a.md': makePage('a') };
    const { readDir, readFile } = makeFs(files);
    const page = await getEntityPage('does-not-exist', 'wiki/', readDir, readFile);
    assert.equal(page, null);
  });
});

// ── rebuildIndex ──────────────────────────────────────────────────────────────

describe('rebuildIndex', () => {
  it('creates index.md with entity count', async () => {
    const files: FsMap = {
      'wiki/a.md': makePage('entity-a', ['entity-b']),
      'wiki/b.md': makePage('entity-b'),
    };
    const { readDir, readFile } = makeFs(files);
    const written: Record<string, string> = {};

    const idx = await rebuildIndex(
      'wiki/',
      readDir,
      readFile,
      async (p, c) => { written[p] = c; },
      async () => {},
    );

    assert.equal(idx.entities.length, 2);
    assert.ok(idx.totalLinks >= 0);
    assert.ok(Object.values(written).some(c => c.includes('entity-a')));
  });

  it('reports orphan count correctly', async () => {
    const files: FsMap = {
      'wiki/a.md': makePage('a', ['b']),  // a links to b
      'wiki/b.md': makePage('b', []),     // b has inbound from a, no outbound
      'wiki/c.md': makePage('c', []),     // c is orphan (no inbound)
    };
    const { readDir, readFile } = makeFs(files);
    const written: Record<string, string> = {};

    const idx = await rebuildIndex(
      'wiki/',
      readDir,
      readFile,
      async (p, c) => { written[p] = c; },
      async () => {},
    );

    // a and c are orphans (no inbound links)
    assert.equal(idx.orphanCount, 2);
  });
});
