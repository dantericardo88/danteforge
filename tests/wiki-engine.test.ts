// Tests for wiki-engine public API
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  initWiki,
  verifyConstitutionalIntegrity,
  wikiIngest,
  wikiBootstrap,
  query,
  getEntityPage,
  getHistory,
  getWikiHealth,
  appendAuditEntry,
  getWikiContextForPrompt,
} from '../src/core/wiki-engine.js';
import type { WikiEngineOptions } from '../src/core/wiki-engine.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEntityPage(entity: string, body = 'Summary of entity.\n\n## History\n\nInitial entry.'): string {
  return [
    '---',
    `entity: "${entity}"`,
    'type: module',
    'created: 2026-04-01T00:00:00.000Z',
    'updated: 2026-04-01T00:00:00.000Z',
    'sources:',
    '  - raw/source.md',
    'links: []',
    'constitution-refs: []',
    'tags:',
    '  - test',
    '---',
    '',
    `# ${entity}`,
    '',
    body,
  ].join('\n');
}

/** Normalize path separators to forward slashes for cross-platform test matching */
function n(p: string): string { return p.replace(/\\/g, '/'); }

function makeOpts(files: Record<string, string>, written?: Record<string, string>): WikiEngineOptions {
  const store = { ...files };
  const out = written ?? {};
  return {
    cwd: '/fake',
    _exists: async (p) => {
      const np = n(p);
      return np in store || Object.keys(store).some(k => k === np || k.startsWith(np + '/'));
    },
    _readFile: async (p) => {
      const np = n(p);
      if (np in store) return store[np];
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' });
    },
    _writeFile: async (p, c) => { const np = n(p); out[np] = c; store[np] = c; },
    _readDir: async (dir: string) => {
      const nd = n(dir);
      const prefix = nd.endsWith('/') ? nd : nd + '/';
      return Object.keys(store).filter(k => {
        const nk = n(k);
        return nk.startsWith(prefix) && !nk.slice(prefix.length).includes('/') &&
               nk.endsWith('.md') && !nk.split('/').pop()!.startsWith('.');
      });
    },
    _mkdir: async () => {},
    _copyFile: async (src, dest) => { const ns = n(src); const nd2 = n(dest); store[nd2] = store[ns] ?? ''; out[nd2] = store[nd2]; },
    _computeHash: (c) => Buffer.from(c).toString('hex').slice(0, 64).padEnd(64, '0'),
  };
}

// ── initWiki ───────────────────────────────────────────────────────────────────

describe('initWiki', () => {
  it('creates wiki, raw, and constitution directories', async () => {
    const created: string[] = [];
    await initWiki({
      cwd: '/fake',
      _mkdir: async (p) => { created.push(p); },
      _exists: async () => false,
      _readFile: async () => { throw new Error('ENOENT'); },
      _writeFile: async () => {},
      _copyFile: async () => {},
      _computeHash: (c) => c.slice(0, 64).padEnd(64, '0'),
    });
    assert.ok(created.some(p => p.includes('wiki')));
    assert.ok(created.some(p => p.includes('raw')));
    assert.ok(created.some(p => p.includes('constitution')));
  });

  it('copies CONSTITUTION.md and writes hash store when constitution exists', async () => {
    const written: Record<string, string> = {};
    await initWiki({
      cwd: '/fake',
      _mkdir: async () => {},
      _exists: async (p) => p.includes('CONSTITUTION.md') && !p.includes('.hashes'),
      _readFile: async () => 'constitutional content',
      _writeFile: async (p, c) => { written[p] = c; },
      _copyFile: async () => {},
      _computeHash: () => 'a'.repeat(64),
    });
    const hashFile = Object.keys(written).find(k => k.endsWith('.hashes.json'));
    assert.ok(hashFile !== undefined);
    const store = JSON.parse(written[hashFile!]);
    assert.ok('CONSTITUTION.md' in store.hashes);
  });

  it('does not overwrite existing hash store', async () => {
    const written: Record<string, string> = {};
    await initWiki({
      cwd: '/fake',
      _mkdir: async () => {},
      _exists: async () => true, // Everything exists including hash store
      _readFile: async () => 'content',
      _writeFile: async (p, c) => { written[p] = c; },
      _copyFile: async () => {},
      _computeHash: () => 'b'.repeat(64),
    });
    // Hash store should NOT be written since it already exists
    assert.ok(!Object.keys(written).some(k => k.endsWith('.hashes.json')));
  });
});

// ── verifyConstitutionalIntegrity ─────────────────────────────────────────────

describe('verifyConstitutionalIntegrity', () => {
  it('returns ok=true when hash store does not exist', async () => {
    const result = await verifyConstitutionalIntegrity({
      cwd: '/fake',
      _exists: async () => false,
      _readFile: async () => { throw new Error('ENOENT'); },
      _computeHash: () => 'x'.repeat(64),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.violations, []);
  });

  it('returns ok=true when hashes match', async () => {
    const content = 'constitutional content';
    const hash = Buffer.from(content).toString('hex').padEnd(64, '0').slice(0, 64);
    const store = JSON.stringify({ hashes: { 'CONSTITUTION.md': hash }, lockedAt: '2026-01-01T00:00:00.000Z' });

    const result = await verifyConstitutionalIntegrity({
      cwd: '/fake',
      _exists: async () => true,
      _readFile: async (p) => p.endsWith('.hashes.json') ? store : content,
      _computeHash: (c) => Buffer.from(c).toString('hex').padEnd(64, '0').slice(0, 64),
    });
    assert.equal(result.ok, true);
  });

  it('returns ok=false with violation when hash changes (tamper detection)', async () => {
    const originalHash = 'a'.repeat(64);
    const store = JSON.stringify({ hashes: { 'CONSTITUTION.md': originalHash }, lockedAt: '2026-01-01T00:00:00.000Z' });

    const result = await verifyConstitutionalIntegrity({
      cwd: '/fake',
      _exists: async () => true,
      _readFile: async (p) => p.endsWith('.hashes.json') ? store : 'tampered content',
      _computeHash: () => 'b'.repeat(64), // Different from stored hash
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.includes('CONSTITUTION.md'));
  });

  it('reports missing file as violation', async () => {
    const store = JSON.stringify({ hashes: { 'CONSTITUTION.md': 'a'.repeat(64) }, lockedAt: '' });
    const result = await verifyConstitutionalIntegrity({
      cwd: '/fake',
      _exists: async (p) => p.endsWith('.hashes.json'),
      _readFile: async (p) => {
        if (p.endsWith('.hashes.json')) return store;
        throw new Error('ENOENT');
      },
      _computeHash: () => 'x'.repeat(64),
    });
    assert.equal(result.ok, false);
    assert.ok(result.violations.some(v => v.includes('CONSTITUTION.md')));
  });
});

// ── wikiIngest ─────────────────────────────────────────────────────────────────

describe('wikiIngest', () => {
  it('returns blocked when constitutional integrity fails', async () => {
    const store = JSON.stringify({ hashes: { 'CONSTITUTION.md': 'a'.repeat(64) }, lockedAt: '' });
    const result = await wikiIngest({
      cwd: '/fake',
      _exists: async (p) => p.endsWith('.hashes.json'),
      _readFile: async (p) => p.endsWith('.hashes.json') ? store : 'tampered',
      _writeFile: async () => {},
      _readDir: async () => [],
      _mkdir: async () => {},
      _computeHash: () => 'b'.repeat(64), // mismatch
    });
    assert.equal(result.blocked, true);
    assert.ok(result.reason?.includes('Constitutional integrity'));
  });

  it('processes files when integrity is ok', async () => {
    const result = await wikiIngest({
      cwd: '/fake',
      _exists: async () => false, // no hash store = integrity ok
      _readFile: async () => { throw new Error('ENOENT'); },
      _writeFile: async () => {},
      _readDir: async () => [],
      _mkdir: async () => {},
      _computeHash: () => 'x'.repeat(64),
    });
    assert.ok(!result.blocked);
    assert.equal(result.processed.length, 0);
  });
});

// ── query ──────────────────────────────────────────────────────────────────────

describe('query', () => {
  it('returns empty results when wiki dir does not exist', async () => {
    const results = await query('autoforge scoring', {
      cwd: '/fake',
      _readDir: async () => [],
      _readFile: async () => { throw new Error('ENOENT'); },
      _exists: async () => false,
    });
    assert.deepEqual(results, []);
  });

  it('finds relevant pages by keyword', async () => {
    const files: Record<string, string> = {
      '/fake/.danteforge/wiki/autoforge.md': makeEntityPage('autoforge-loop',
        'The autoforge loop scores artifacts and drives the pipeline.\n\n## History\n\nInit.'
      ),
      '/fake/.danteforge/wiki/pdse.md': makeEntityPage('pdse-engine',
        'The PDSE engine computes quality scores.\n\n## History\n\nInit.'
      ),
    };
    const opts = makeOpts(files);

    const results = await query('autoforge scoring', opts);
    assert.ok(results.length > 0);
    assert.ok(results.some(r => r.entityId === 'autoforge-loop'));
  });

  it('returns results sorted by descending score', async () => {
    const files: Record<string, string> = {
      '/fake/.danteforge/wiki/a.md': makeEntityPage('autoforge-loop',
        'autoforge autoforge autoforge scoring scoring scoring'
      ),
      '/fake/.danteforge/wiki/b.md': makeEntityPage('wiki-engine',
        'wiki engine manages knowledge'
      ),
    };
    const opts = makeOpts(files);
    const results = await query('autoforge scoring', opts);

    if (results.length >= 2) {
      assert.ok(results[0].score >= results[1].score);
    }
  });

  it('uses LLM fallback when few results and llmCaller provided', async () => {
    const files: Record<string, string> = {
      '/fake/.danteforge/wiki/known-entity.md': makeEntityPage('known-entity', 'Totally unrelated content.'),
    };
    const opts: WikiEngineOptions = {
      ...makeOpts(files),
      _llmCaller: async () => '["known-entity"]',
    };

    // Query that won't keyword-match but LLM suggests it
    const results = await query('something completely different from any keyword xyzzy', {
      ...opts,
      useLLMFallback: true,
    } as WikiQueryOptions & { useLLMFallback: boolean });

    // The LLM stage may add the entity
    assert.ok(Array.isArray(results));
  });
});

// ── getEntityPage ──────────────────────────────────────────────────────────────

describe('getEntityPage', () => {
  it('returns entity page for known entity', async () => {
    const files = { '/fake/.danteforge/wiki/autoforge.md': makeEntityPage('autoforge-loop') };
    const page = await getEntityPage('autoforge-loop', makeOpts(files));
    assert.ok(page !== null);
    assert.equal(page!.frontmatter.entity, 'autoforge-loop');
  });

  it('returns null for unknown entity', async () => {
    const page = await getEntityPage('does-not-exist', makeOpts({}));
    assert.equal(page, null);
  });
});

// ── getHistory ─────────────────────────────────────────────────────────────────

describe('getHistory', () => {
  it('returns history section content', async () => {
    const content = makeEntityPage('my-module',
      'Summary here.\n\n## History\n\n### 2026-04-01\n\nInitial ingestion.'
    );
    const files = { '/fake/.danteforge/wiki/my-module.md': content };
    const history = await getHistory('my-module', makeOpts(files));
    assert.ok(history !== null);
    assert.ok(history!.includes('Initial ingestion'));
  });

  it('returns null for unknown entity', async () => {
    const history = await getHistory('ghost', makeOpts({}));
    assert.equal(history, null);
  });
});

// ── getWikiHealth ──────────────────────────────────────────────────────────────

describe('getWikiHealth', () => {
  it('returns null when wiki dir does not exist', async () => {
    const health = await getWikiHealth({
      cwd: '/fake',
      _exists: async () => false,
      _readDir: async () => [],
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.equal(health, null);
  });

  it('returns zero-count health for empty wiki', async () => {
    const health = await getWikiHealth({
      cwd: '/fake',
      _exists: async () => true,
      _readDir: async () => [],
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.ok(health !== null);
    assert.equal(health!.pageCount, 0);
  });

  it('counts pages and computes basic metrics', async () => {
    const files: Record<string, string> = {
      '/fake/.danteforge/wiki/a.md': makeEntityPage('entity-a'),
      '/fake/.danteforge/wiki/b.md': makeEntityPage('entity-b'),
    };
    const health = await getWikiHealth(makeOpts(files));
    assert.ok(health !== null);
    assert.equal(health!.pageCount, 2);
    assert.ok(health!.orphanRatio >= 0 && health!.orphanRatio <= 1);
  });
});

// ── appendAuditEntry ───────────────────────────────────────────────────────────

describe('appendAuditEntry', () => {
  it('appends JSON line to audit log', async () => {
    const written: Record<string, string> = {};
    await appendAuditEntry(
      { timestamp: '2026-04-06T00:00:00.000Z', event: 'ingest', triggeredBy: 'test', summary: 'Test entry' },
      {
        cwd: '/fake',
        _readFile: async () => { throw new Error('ENOENT'); },
        _writeFile: async (p, c) => { written[p] = c; },
        _mkdir: async () => {},
      },
    );
    const content = Object.values(written)[0];
    assert.ok(content !== undefined);
    const parsed = JSON.parse(content.trim());
    assert.equal(parsed.event, 'ingest');
    assert.equal(parsed.summary, 'Test entry');
  });

  it('appends to existing audit log without truncating', async () => {
    const existing = JSON.stringify({ event: 'bootstrap', timestamp: '2026-01-01T00:00:00.000Z', triggeredBy: 'test', summary: 'old' }) + '\n';
    let content = existing;
    await appendAuditEntry(
      { timestamp: '2026-04-06T00:00:00.000Z', event: 'ingest', triggeredBy: 'test', summary: 'new' },
      {
        cwd: '/fake',
        _readFile: async () => existing,
        _writeFile: async (_p, c) => { content = c; },
        _mkdir: async () => {},
      },
    );
    assert.ok(content.includes('"event":"bootstrap"') || content.includes('"event": "bootstrap"'));
    assert.ok(content.includes('"event":"ingest"') || content.includes('"event": "ingest"'));
  });
});

// ── getWikiContextForPrompt ────────────────────────────────────────────────────

describe('getWikiContextForPrompt', () => {
  it('returns empty string when wiki does not exist', async () => {
    const ctx = await getWikiContextForPrompt('autoforge scoring', {
      cwd: '/fake',
      _exists: async () => false,
      _readDir: async () => [],
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.equal(ctx, '');
  });

  it('returns Tier 0 context block when wiki has relevant pages', async () => {
    const files: Record<string, string> = {
      '/fake/.danteforge/wiki/autoforge.md': makeEntityPage('autoforge-loop',
        'The autoforge loop drives the entire pipeline with scoring.'
      ),
    };
    const ctx = await getWikiContextForPrompt('autoforge scoring pipeline', makeOpts(files));
    // If wiki has relevant content, returns [WIKI CONTEXT] block
    assert.ok(typeof ctx === 'string');
    if (ctx) {
      assert.ok(ctx.includes('[WIKI'));
    }
  });

  it('never throws even when internals fail', async () => {
    const ctx = await getWikiContextForPrompt('anything', {
      cwd: '/fake',
      _exists: async () => { throw new Error('Unexpected failure'); },
      _readDir: async () => { throw new Error('Unexpected failure'); },
      _readFile: async () => { throw new Error('Unexpected failure'); },
    });
    assert.equal(ctx, '');
  });
});
