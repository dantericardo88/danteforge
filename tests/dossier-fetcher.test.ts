// tests/dossier-fetcher.test.ts — Tests for src/dossier/fetcher.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchSource, stripHtml, cacheKeyFor, extractDomain } from '../src/dossier/fetcher.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFetchFn(responseText: string, ok = true) {
  return async (_url: string, _opts: unknown) => ({
    ok,
    text: async () => responseText,
  }) as unknown as Response;
}

function makeStatFn(fresh = true) {
  return async (_p: string) => ({
    mtimeMs: fresh ? Date.now() - 100 : Date.now() - 25 * 60 * 60 * 1000,
  });
}

function makeCacheStore(): { files: Record<string, string> } {
  return { files: {} };
}

function makeWriteFile(store: { files: Record<string, string> }) {
  return async (p: string, d: string) => { store.files[p] = d; };
}

function makeReadFile(store: { files: Record<string, string> }) {
  return async (p: string, _enc: BufferEncoding): Promise<string> => {
    const content = store.files[p];
    if (content === undefined) throw new Error(`ENOENT: ${p}`);
    return content;
  };
}

// ── Tests: stripHtml() ────────────────────────────────────────────────────────

describe('stripHtml()', () => {
  it('removes script tags and their content', () => {
    const result = stripHtml('<script>alert("xss")</script>hello');
    assert.ok(!result.includes('alert'));
    assert.ok(result.includes('hello'));
  });

  it('removes HTML tags leaving text', () => {
    const result = stripHtml('<p>Hello <strong>world</strong></p>');
    assert.ok(result.includes('Hello'));
    assert.ok(result.includes('world'));
    assert.ok(!result.includes('<p>'));
  });

  it('decodes HTML entities', () => {
    const result = stripHtml('&amp; &lt; &gt; &quot;');
    assert.ok(result.includes('&'));
    assert.ok(result.includes('<'));
  });

  it('truncates to 50000 chars', () => {
    const long = 'a'.repeat(60_000);
    const result = stripHtml(long);
    assert.equal(result.length, 50_000);
  });
});

// ── Tests: cacheKeyFor() ──────────────────────────────────────────────────────

describe('cacheKeyFor()', () => {
  it('returns consistent sha256 hex for same url', () => {
    const k1 = cacheKeyFor('https://example.com');
    const k2 = cacheKeyFor('https://example.com');
    assert.equal(k1, k2);
  });

  it('returns different keys for different urls', () => {
    const k1 = cacheKeyFor('https://a.com');
    const k2 = cacheKeyFor('https://b.com');
    assert.notEqual(k1, k2);
  });
});

// ── Tests: extractDomain() ────────────────────────────────────────────────────

describe('extractDomain()', () => {
  it('extracts hostname from URL', () => {
    assert.equal(extractDomain('https://cursor.com/changelog'), 'cursor.com');
  });

  it('returns raw string on invalid URL', () => {
    const result = extractDomain('not-a-url');
    assert.equal(result, 'not-a-url');
  });
});

// ── Tests: fetchSource() ─────────────────────────────────────────────────────

describe('fetchSource()', () => {
  it('returns cached content without fetching when cache is fresh', async () => {
    const store = makeCacheStore();
    const urlKey = cacheKeyFor('https://cursor.com/changelog');
    const cachePath = `\\fake\\cwd\\.danteforge\\dossier-cache\\cursor\\${urlKey}.txt`;
    store.files[cachePath] = 'cached content';

    let fetchCalled = false;
    const result = await fetchSource('https://cursor.com/changelog', 'cursor', '\\fake\\cwd', {
      _fetch: async () => { fetchCalled = true; return {} as unknown as Response; },
      _stat: makeStatFn(true), // fresh cache
      _readFile: makeReadFile(store),
      _writeFile: makeWriteFile(store),
      _mkdir: async () => {},
      _sleep: async () => {},
    });

    assert.equal(result.fromCache, true);
    assert.equal(result.content, 'cached content');
    assert.equal(fetchCalled, false);
  });

  it('fetches and stores content when cache is stale', async () => {
    const store = makeCacheStore();

    const result = await fetchSource('https://cursor.com/changelog', 'cursor', '\\fake\\cwd', {
      _fetch: makeFetchFn('<html><body>fresh content</body></html>'),
      _stat: makeStatFn(false), // stale cache
      _readFile: makeReadFile(store),
      _writeFile: makeWriteFile(store),
      _mkdir: async () => {},
      _sleep: async () => {},
    });

    assert.equal(result.fromCache, false);
    assert.ok(result.content.includes('fresh content'));
    // Content should have been written to cache
    assert.ok(Object.keys(store.files).length > 0);
  });

  it('throws when fetch fails', async () => {
    await assert.rejects(
      () => fetchSource('https://bad.example', 'bad', '\\fake\\cwd', {
        _fetch: async () => { throw new Error('network error'); },
        _stat: makeStatFn(false),
        _readFile: async () => { throw new Error('ENOENT'); },
        _writeFile: async () => {},
        _mkdir: async () => {},
        _sleep: async () => {},
      }),
      (err: Error) => {
        assert.ok(err.message.includes('network error') || err.message.includes('Failed to fetch'));
        return true;
      },
    );
  });

  it('strips HTML from fetched content', async () => {
    const store = makeCacheStore();
    const result = await fetchSource('https://cursor.com', 'cursor', '\\fake\\cwd', {
      _fetch: makeFetchFn('<nav>nav stuff</nav><p>real content</p><script>bad()</script>'),
      _stat: makeStatFn(false),
      _readFile: makeReadFile(store),
      _writeFile: makeWriteFile(store),
      _mkdir: async () => {},
      _sleep: async () => {},
    });

    assert.ok(!result.content.includes('<p>'));
    assert.ok(!result.content.includes('bad()'));
    assert.ok(result.content.includes('real content'));
  });
});
