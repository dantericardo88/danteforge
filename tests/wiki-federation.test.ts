import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  federateHighConfidenceEntities,
  queryGlobalWiki,
  type FederateOptions,
  type QueryGlobalWikiOptions,
} from '../src/core/wiki-federation.js';

function noopOpts(): FederateOptions {
  return {
    _readDir: async () => [],
    _readFile: async () => { throw new Error('not found'); },
    _writeFile: async () => {},
    _mkdir: async () => {},
  };
}

describe('federateHighConfidenceEntities', () => {
  it('returns empty federated list when wiki dir is empty', async () => {
    const result = await federateHighConfidenceEntities('/tmp/wiki', '/tmp/global', noopOpts());
    assert.deepEqual(result.federated, []);
  });

  it('skips files that cannot be read', async () => {
    const opts: FederateOptions = {
      _readDir: async () => ['/tmp/wiki/broken.md'],
      _readFile: async () => { throw new Error('read error'); },
      _writeFile: async () => {},
      _mkdir: async () => {},
    };
    const result = await federateHighConfidenceEntities('/tmp/wiki', '/tmp/global', opts);
    assert.equal(result.federated.length, 0);
  });

  it('skips files below federation threshold', async () => {
    const lowConfidenceFile = `---\nentity: test\nconfidence: 0.1\ntype: pattern\n---\ncontent`;
    const opts: FederateOptions = {
      _readDir: async () => ['/tmp/wiki/test.md'],
      _readFile: async () => lowConfidenceFile,
      _writeFile: async () => {},
      _mkdir: async () => {},
    };
    const result = await federateHighConfidenceEntities('/tmp/wiki', '/tmp/global', opts);
    assert.equal(result.federated.length, 0);
    assert.ok(result.skipped.length > 0);
  });

  it('returns federated and skipped arrays in result', async () => {
    const file = `---\nentity: MyPattern\ntype: pattern\n---\nThe pattern content`;
    const opts: FederateOptions = {
      _readDir: async () => ['/tmp/wiki/pattern.md'],
      _readFile: async () => file,
      _writeFile: async () => {},
      _mkdir: async () => {},
    };
    const result = await federateHighConfidenceEntities('/tmp/wiki', '/tmp/global', opts);
    assert.ok(Array.isArray(result.federated));
    assert.ok(Array.isArray(result.skipped));
  });
});

describe('queryGlobalWiki', () => {
  it('returns empty array when global wiki is empty', async () => {
    const results = await queryGlobalWiki('anything', '/tmp/global', 1000, { _readDir: async () => [] });
    assert.deepEqual(results, []);
  });

  it('returns empty array when no files match query', async () => {
    const unrelated = `---\nentity: UnrelatedThing\ntype: pattern\nconfidence: 0.9\n---\nContent about databases`;
    const opts = {
      _readDir: async () => ['/tmp/global/unrelated.md'],
      _readFile: async () => unrelated,
    };
    const results = await queryGlobalWiki('authentication', '/tmp/global', 1000, opts);
    assert.deepEqual(results, []);
  });

  it('finds matching entities by entity field', async () => {
    const content = `---\nentity: AuthPattern\ntype: pattern\nconfidence: 0.9\n---\nJWT authentication flow`;
    const opts = {
      _readDir: async () => ['/tmp/global/auth-pattern.md'],
      _readFile: async () => content,
    };
    const results = await queryGlobalWiki('auth', '/tmp/global', 1000, opts);
    assert.ok(results.length > 0);
  });

  it('respects maxResults limit', async () => {
    const files = Array.from({ length: 10 }, (_, i) => `/tmp/global/p${i}.md`);
    const content = `---\nentity: AuthPattern\ntype: pattern\nconfidence: 0.9\n---\nauth content`;
    const opts: QueryGlobalWikiOptions = {
      _readDir: async () => files,
      _readFile: async () => content,
      maxResults: 3,
    };
    const results = await queryGlobalWiki('auth', '/tmp/global', 1000, opts);
    assert.ok(results.length <= 3);
  });
});
