import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOssReposDir,
  getRepoStoragePath,
  filterNewRepos,
  upsertEntry,
  type OSSRegistry,
  type OSSRegistryEntry,
} from '../src/core/oss-registry.js';

function makeRegistry(repos: Partial<OSSRegistryEntry>[] = []): OSSRegistry {
  return {
    version: '1',
    repos: repos.map(r => ({
      url: r.url ?? 'https://github.com/example/repo',
      name: r.name ?? 'repo',
      stars: r.stars ?? 0,
      description: r.description ?? '',
      language: r.language ?? 'typescript',
      harvestedAt: r.harvestedAt ?? new Date().toISOString(),
      patterns: r.patterns ?? [],
      lastAnalyzedAt: r.lastAnalyzedAt,
      analysisScore: r.analysisScore,
    })),
    updatedAt: new Date().toISOString(),
  };
}

describe('getOssReposDir', () => {
  it('returns a path ending with oss-repos directory name', () => {
    const dir = getOssReposDir('/tmp/project');
    assert.ok(dir.includes('oss-repos'));
  });

  it('is rooted under .danteforge', () => {
    const dir = getOssReposDir('/tmp/project');
    assert.ok(dir.includes('.danteforge'));
  });
});

describe('getRepoStoragePath', () => {
  it('converts repo name to lowercase safe name', () => {
    const p = getRepoStoragePath('MyRepo-Name', '/tmp');
    assert.ok(p.toLowerCase().includes('myrepo-name'));
  });

  it('replaces non-alphanumeric chars with dashes', () => {
    const p = getRepoStoragePath('user/my.repo', '/tmp');
    const safeName = p.split(/[\\/]/).pop()!;
    assert.ok(!safeName.includes('.'));
    assert.ok(!safeName.includes('/'));
  });

  it('is contained in oss-repos directory', () => {
    const p = getRepoStoragePath('my-repo', '/tmp');
    assert.ok(p.includes('oss-repos'));
  });
});

describe('filterNewRepos', () => {
  it('returns all repos when registry is empty', () => {
    const candidates = [
      { url: 'https://github.com/a/b' },
      { url: 'https://github.com/c/d' },
    ];
    const result = filterNewRepos(candidates, makeRegistry());
    assert.equal(result.length, 2);
  });

  it('filters out repos already in registry', () => {
    const registry = makeRegistry([{ url: 'https://github.com/a/b' }]);
    const candidates = [
      { url: 'https://github.com/a/b' },
      { url: 'https://github.com/c/d' },
    ];
    const result = filterNewRepos(candidates, registry);
    assert.equal(result.length, 1);
    assert.equal(result[0].url, 'https://github.com/c/d');
  });

  it('comparison is case-insensitive', () => {
    const registry = makeRegistry([{ url: 'https://GitHub.com/A/B' }]);
    const candidates = [{ url: 'https://github.com/a/b' }];
    const result = filterNewRepos(candidates, registry);
    assert.equal(result.length, 0);
  });

  it('strips trailing slashes in comparison', () => {
    const registry = makeRegistry([{ url: 'https://github.com/a/b/' }]);
    const candidates = [{ url: 'https://github.com/a/b' }];
    const result = filterNewRepos(candidates, registry);
    assert.equal(result.length, 0);
  });

  it('returns empty array when all repos already registered', () => {
    const registry = makeRegistry([
      { url: 'https://github.com/a/b' },
      { url: 'https://github.com/c/d' },
    ]);
    const candidates = [
      { url: 'https://github.com/a/b' },
      { url: 'https://github.com/c/d' },
    ];
    const result = filterNewRepos(candidates, registry);
    assert.equal(result.length, 0);
  });
});

describe('upsertEntry', () => {
  function makeEntry(url: string): OSSRegistryEntry {
    return {
      url,
      name: 'test-repo',
      stars: 100,
      description: 'A test repo',
      language: 'typescript',
      harvestedAt: new Date().toISOString(),
      patterns: [],
    };
  }

  it('inserts new entry when not present', () => {
    const registry = makeRegistry();
    upsertEntry(registry, makeEntry('https://github.com/new/repo'));
    assert.equal(registry.repos.length, 1);
  });

  it('updates existing entry when URL matches', () => {
    const registry = makeRegistry([{ url: 'https://github.com/a/b', stars: 10 }]);
    const updated = makeEntry('https://github.com/a/b');
    updated.stars = 999;
    upsertEntry(registry, updated);
    assert.equal(registry.repos.length, 1);
    assert.equal(registry.repos[0].stars, 999);
  });

  it('returns the registry for chaining', () => {
    const registry = makeRegistry();
    const result = upsertEntry(registry, makeEntry('https://github.com/a/b'));
    assert.equal(result, registry);
  });

  it('is case-insensitive for URL matching', () => {
    const registry = makeRegistry([{ url: 'https://GitHub.com/A/B', stars: 5 }]);
    const updated = makeEntry('https://github.com/a/b');
    updated.stars = 42;
    upsertEntry(registry, updated);
    assert.equal(registry.repos.length, 1);
    assert.equal(registry.repos[0].stars, 42);
  });
});
