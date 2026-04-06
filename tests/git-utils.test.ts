// Git utils tests — atomicCommit structural + injection tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { atomicCommit, getChangedFiles } from '../src/utils/git.js';

function makeRawGit(output: string | Error) {
  return {
    raw: async (_args: string[]) => {
      if (output instanceof Error) throw output;
      return output;
    },
  };
}

describe('git utils — atomicCommit', () => {
  it('exports atomicCommit function', async () => {
    const mod = await import('../src/utils/git.js');
    assert.equal(typeof mod.atomicCommit, 'function');
  });

  it('atomicCommit is async (returns a promise-like)', async () => {
    const mod = await import('../src/utils/git.js');
    assert.equal(mod.atomicCommit.constructor.name, 'AsyncFunction');
  });

  it('module loads without error', async () => {
    const mod = await import('../src/utils/git.js');
    assert.ok(mod);
  });
});

describe('git utils — _git injection', () => {
  it('calls git.add and git.commit with correct args', async () => {
    let addPattern = '';
    let commitMsg = '';
    const fakeGit = {
      add: async (p: string) => { addPattern = p; },
      commit: async (m: string) => { commitMsg = m; },
    };

    await atomicCommit('test message', { _git: fakeGit });
    assert.equal(addPattern, '.');
    assert.equal(commitMsg, '[DanteForge] test message');
  });

  it('prefixes commit message with [DanteForge]', async () => {
    let commitMsg = '';
    const fakeGit = {
      add: async () => {},
      commit: async (m: string) => { commitMsg = m; },
    };

    await atomicCommit('deploy v2', { _git: fakeGit });
    assert.ok(commitMsg.startsWith('[DanteForge]'));
    assert.ok(commitMsg.includes('deploy v2'));
  });

  it('propagates git errors', async () => {
    const fakeGit = {
      add: async () => { throw new Error('git add failed'); },
      commit: async () => {},
    };

    await assert.rejects(
      () => atomicCommit('will fail', { _git: fakeGit }),
      (err: Error) => { assert.ok(err.message.includes('git add failed')); return true; },
    );
  });
});

// ── getChangedFiles ──────────────────────────────────────────────────────────

describe('getChangedFiles', () => {
  it('returns empty array when diff output is empty string', async () => {
    const result = await getChangedFiles('/tmp', { _git: makeRawGit('') });
    assert.deepEqual(result, []);
  });

  it('returns single file from single-line diff', async () => {
    const result = await getChangedFiles('/tmp', { _git: makeRawGit('src/core/llm.ts\n') });
    assert.deepEqual(result, ['src/core/llm.ts']);
  });

  it('returns multiple files from multi-line diff', async () => {
    const result = await getChangedFiles('/tmp', {
      _git: makeRawGit('src/core/state.ts\nsrc/cli/index.ts\ntests/foo.test.ts\n'),
    });
    assert.deepEqual(result, ['src/core/state.ts', 'src/cli/index.ts', 'tests/foo.test.ts']);
  });

  it('filters out empty lines in diff output', async () => {
    const result = await getChangedFiles('/tmp', {
      _git: makeRawGit('\nsrc/core/llm.ts\n\ntests/bar.test.ts\n\n'),
    });
    assert.deepEqual(result, ['src/core/llm.ts', 'tests/bar.test.ts']);
  });

  it('returns empty array when git throws (not a git repo)', async () => {
    const result = await getChangedFiles('/tmp/no-git-here', {
      _git: makeRawGit(new Error('not a git repository')),
    });
    assert.deepEqual(result, []);
  });

  it('trims whitespace from each file path', async () => {
    const result = await getChangedFiles('/tmp', {
      _git: makeRawGit('  src/core/llm.ts  \n  tests/foo.test.ts  \n'),
    });
    assert.deepEqual(result, ['src/core/llm.ts', 'tests/foo.test.ts']);
  });
});
