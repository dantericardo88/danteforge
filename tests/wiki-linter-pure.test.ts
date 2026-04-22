import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  scanContradictions,
  scanStaleness,
  scanLinkIntegrity,
} from '../src/core/wiki-linter.js';

function makePage(entity: string, extra: Record<string, string> = {}, body = ''): string {
  const updated = extra.updated ?? new Date().toISOString();
  const sources = extra.sources ?? '[]';
  const links = extra.links ?? '[]';
  return [
    '---',
    `entity: "${entity}"`,
    'type: concept',
    `created: 2026-01-01T00:00:00.000Z`,
    `updated: ${updated}`,
    `sources: ${sources}`,
    `links: ${links}`,
    'constitution-refs: []',
    'tags: []',
    '---',
    '',
    `# ${entity}`,
    '',
    body,
  ].join('\n');
}

// ── scanContradictions ────────────────────────────────────────────────────────

describe('scanContradictions', () => {
  it('returns empty array when no files', async () => {
    const result = await scanContradictions(
      '/fake/wiki',
      async () => [],
      async () => '',
    );
    assert.deepEqual(result, []);
  });

  it('skips index.md files', async () => {
    const result = await scanContradictions(
      '/fake/wiki',
      async () => ['/fake/wiki/index.md'],
      async () => makePage('index', {}, ''),
    );
    assert.deepEqual(result, []);
  });

  it('skips LINT_REPORT.md files', async () => {
    const result = await scanContradictions(
      '/fake/wiki',
      async () => ['/fake/wiki/LINT_REPORT.md'],
      async () => makePage('lint', {}, ''),
    );
    assert.deepEqual(result, []);
  });

  it('returns empty array for pages with fewer than 2 sources', async () => {
    const content = makePage('module-a', { sources: '["src/a.ts"]' }, '');
    const result = await scanContradictions(
      '/fake/wiki',
      async () => ['/fake/wiki/module-a.md'],
      async () => content,
    );
    assert.deepEqual(result, []);
  });

  it('skips unreadable files without throwing', async () => {
    const result = await scanContradictions(
      '/fake/wiki',
      async () => ['/fake/wiki/bad.md'],
      async () => { throw new Error('read error'); },
    );
    assert.deepEqual(result, []);
  });

  it('skips files with no frontmatter', async () => {
    const result = await scanContradictions(
      '/fake/wiki',
      async () => ['/fake/wiki/plain.md'],
      async () => '# Just a plain markdown file\n\nNo frontmatter here.',
    );
    assert.deepEqual(result, []);
  });
});

// ── scanStaleness ─────────────────────────────────────────────────────────────

describe('scanStaleness', () => {
  it('returns empty array when no files', async () => {
    const result = await scanStaleness('/fake/wiki', 30, async () => [], async () => '');
    assert.deepEqual(result, []);
  });

  it('skips index.md, LINT_REPORT.md, pdse-history.md', async () => {
    const skipFiles = ['index.md', 'LINT_REPORT.md', 'pdse-history.md'].map(
      f => `/fake/wiki/${f}`,
    );
    const result = await scanStaleness(
      '/fake/wiki',
      30,
      async () => skipFiles,
      async (f) => makePage(f.replace('/fake/wiki/', '').replace('.md', '')),
    );
    assert.deepEqual(result, []);
  });

  it('flags pages older than threshold days', async () => {
    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(); // 60 days ago
    const content = makePage('old-module', { updated: oldDate });

    const result = await scanStaleness(
      '/fake/wiki',
      30,
      async () => ['/fake/wiki/old-module.md'],
      async () => content,
    );

    assert.equal(result.length, 1);
    assert.equal(result[0].entityId, 'old-module');
    assert.ok(result[0].daysSinceUpdate >= 59);
  });

  it('does not flag pages within threshold', async () => {
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 days ago
    const content = makePage('new-module', { updated: recentDate });

    const result = await scanStaleness(
      '/fake/wiki',
      30,
      async () => ['/fake/wiki/new-module.md'],
      async () => content,
    );

    assert.deepEqual(result, []);
  });

  it('skips pages with no updated field', async () => {
    const content = [
      '---',
      'entity: "no-date"',
      'type: concept',
      'created: 2026-01-01T00:00:00.000Z',
      'sources: []',
      'links: []',
      'constitution-refs: []',
      'tags: []',
      '---',
      '',
      '# no-date',
    ].join('\n');

    const result = await scanStaleness(
      '/fake/wiki',
      30,
      async () => ['/fake/wiki/no-date.md'],
      async () => content,
    );

    assert.deepEqual(result, []);
  });

  it('skips unreadable files without throwing', async () => {
    const result = await scanStaleness(
      '/fake/wiki',
      30,
      async () => ['/fake/wiki/bad.md'],
      async () => { throw new Error('file error'); },
    );
    assert.deepEqual(result, []);
  });

  it('skips files with no frontmatter', async () => {
    const result = await scanStaleness(
      '/fake/wiki',
      30,
      async () => ['/fake/wiki/plain.md'],
      async () => '# Just markdown\n\nNo frontmatter.',
    );
    assert.deepEqual(result, []);
  });

  it('uses default threshold of 30 days when not specified', async () => {
    // 5 days old — should NOT be stale under 30-day default threshold
    const recentDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const content = makePage('recent-module', { updated: recentDate });

    const result = await scanStaleness(
      '/fake/wiki',
      undefined as unknown as number,
      async () => ['/fake/wiki/recent-module.md'],
      async () => content,
    );

    assert.deepEqual(result, []);
  });
});

// ── scanLinkIntegrity ─────────────────────────────────────────────────────────

describe('scanLinkIntegrity', () => {
  it('returns empty brokenLinks and orphanPages when no files', async () => {
    const result = await scanLinkIntegrity(
      '/fake/wiki',
      async () => [],
      async () => '',
      async () => {},
      async () => {},
    );
    assert.deepEqual(result.brokenLinks, []);
    assert.deepEqual(result.orphanPages, []);
  });

  it('skips index.md and LINT_REPORT.md in link checking', async () => {
    const files = ['/fake/wiki/index.md', '/fake/wiki/LINT_REPORT.md'];
    const result = await scanLinkIntegrity(
      '/fake/wiki',
      async () => files,
      async (f) => makePage(f.includes('index') ? 'index' : 'lint-report'),
      async () => {},
      async () => {},
    );
    assert.deepEqual(result.brokenLinks, []);
  });

  it('reports no broken links when all linked entities exist', async () => {
    const files = [
      '/fake/wiki/module-a.md',
      '/fake/wiki/module-b.md',
    ];
    const pages: Record<string, string> = {
      '/fake/wiki/module-a.md': makePage('module-a', { links: '["module-b"]' }),
      '/fake/wiki/module-b.md': makePage('module-b'),
    };
    const result = await scanLinkIntegrity(
      '/fake/wiki',
      async () => files,
      async (f) => pages[f] ?? '',
      async () => {},
      async () => {},
    );
    assert.equal(result.brokenLinks.length, 0);
  });

  it('reports broken links when linked entity is missing', async () => {
    const files = ['/fake/wiki/module-a.md'];
    const pages: Record<string, string> = {
      '/fake/wiki/module-a.md': makePage('module-a', { links: '["nonexistent-entity"]' }),
    };
    const result = await scanLinkIntegrity(
      '/fake/wiki',
      async () => files,
      async (f) => pages[f] ?? '',
      async () => {},
      async () => {},
    );
    assert.equal(result.brokenLinks.length, 1);
    assert.equal(result.brokenLinks[0].sourceEntityId, 'module-a');
    assert.ok(result.brokenLinks[0].stubCreated);
  });

  it('handles unreadable files gracefully', async () => {
    const result = await scanLinkIntegrity(
      '/fake/wiki',
      async () => ['/fake/wiki/bad.md'],
      async () => { throw new Error('read error'); },
      async () => {},
      async () => {},
    );
    assert.deepEqual(result.brokenLinks, []);
  });
});
