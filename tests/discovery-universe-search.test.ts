// discovery-universe-search.test.ts — the real gh-backed competitor search (the council's
// formerly-stubbed defaultGithubSearch). The network call is seamed: a fake runner returns canned
// `gh search repos --json` output, so this is deterministic and offline.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ghSearchRepos, type ExecRunner } from '../src/matrix-orchestration/discovery/universe.js';

const GH_JSON = JSON.stringify([
  { fullName: 'cli/cli', url: 'https://github.com/cli/cli', description: 'GitHub CLI', stargazersCount: 35000, license: { key: 'mit', name: 'MIT License' } },
  { fullName: 'sharkdp/bat', url: 'https://github.com/sharkdp/bat', description: 'A cat clone', stargazersCount: 48000, license: { key: 'apache-2.0', name: 'Apache License 2.0' } },
  { fullName: 'no-url-repo', url: '', description: 'should be dropped' }, // missing url → filtered
]);

describe('ghSearchRepos — real gh CLI search, fully seamed', () => {
  test('parses gh JSON into hits (name, url, description, stars, license name)', async () => {
    const run: ExecRunner = async (cmd, args) => {
      assert.equal(cmd, 'gh');
      assert.deepEqual(args.slice(0, 3), ['search', 'repos', 'github cli alternative']);
      assert.ok(args.includes('--json'));
      return { stdout: GH_JSON };
    };
    const hits = await ghSearchRepos('github cli alternative', run);
    assert.equal(hits.length, 2, 'the url-less row is dropped');
    assert.equal(hits[0]!.name, 'cli/cli');
    assert.equal(hits[0]!.stars, 35000);
    assert.equal(hits[0]!.license, 'MIT License');
    assert.equal(hits[1]!.name, 'sharkdp/bat');
  });

  test('empty query short-circuits to [] (no shell call)', async () => {
    let called = false;
    const run: ExecRunner = async () => { called = true; return { stdout: '[]' }; };
    assert.deepEqual(await ghSearchRepos('   ', run), []);
    assert.equal(called, false);
  });

  test('a runner failure (gh absent / unauthenticated) degrades to [] — never throws', async () => {
    const run: ExecRunner = async () => { throw new Error('gh: command not found'); };
    assert.deepEqual(await ghSearchRepos('anything', run), []);
  });

  test('non-array / garbage stdout degrades to []', async () => {
    const run: ExecRunner = async () => ({ stdout: 'not json at all' });
    assert.deepEqual(await ghSearchRepos('x', run), []);
    const run2: ExecRunner = async () => ({ stdout: '{"message":"API rate limit"}' });
    assert.deepEqual(await ghSearchRepos('x', run2), []);
  });
});
