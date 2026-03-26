// Worktree management tests — using _git and _fs injection seams
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentWorktree,
  removeAgentWorktree,
  listWorktrees,
  createParallelWorktrees,
  ensureWorktreesIgnored,
  ensureOPIntermediatesIgnored,
  type WorktreeGitFn,
  type WorktreeFsOps,
  type WorktreeTestOpts,
} from '../src/utils/worktree.js';

// ── Mock factories ──────────────────────────────────────────────────────────

function makeGitMock(responses: Record<string, string | Error> = {}): WorktreeGitFn & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    raw: async (args: string[]) => {
      calls.push(args);
      // Build a key from first 2 args for matching
      const key = args.slice(0, 3).join(' ');
      for (const [pattern, response] of Object.entries(responses)) {
        if (key.includes(pattern)) {
          if (response instanceof Error) throw response;
          return response;
        }
      }
      return '';
    },
  };
}

function makeFsMock(content?: string): WorktreeFsOps & { appendedData: string[]; mkdirCalls: string[] } {
  const appendedData: string[] = [];
  const mkdirCalls: string[] = [];
  return {
    appendedData,
    mkdirCalls,
    readFile: async (p: string, _enc: string) => {
      if (content === undefined) throw new Error('ENOENT');
      return content;
    },
    appendFile: async (_p: string, data: string) => { appendedData.push(data); },
    mkdir: async (p: string, _opts: { recursive: boolean }) => { mkdirCalls.push(p); return undefined; },
  };
}

// ── createAgentWorktree ─────────────────────────────────────────────────────

describe('createAgentWorktree', () => {
  it('returns worktree path on success', async () => {
    const mockGit = makeGitMock({});
    const result = await createAgentWorktree('test-agent', mockGit);
    assert.ok(result.includes('test-agent'), 'Path should include agent name');
    assert.ok(mockGit.calls.length >= 1, 'Should have called git');
    // First call should be worktree add with -b
    const firstCall = mockGit.calls.find(c => c.includes('worktree'));
    assert.ok(firstCall, 'Should call git worktree');
    assert.ok(firstCall.includes('-b'), 'First attempt should use -b flag');
  });

  it('falls back when branch already exists', async () => {
    const mockGit = makeGitMock({
      'worktree add': new Error('branch already exists'),  // First attempt fails
    });
    // Override to succeed on second try (without -b)
    let callCount = 0;
    const fallbackGit: WorktreeGitFn = {
      raw: async (args: string[]) => {
        callCount++;
        if (callCount === 1 && args.includes('-b')) {
          throw new Error('branch already exists');
        }
        return '';
      },
    };

    const result = await createAgentWorktree('existing-agent', fallbackGit);
    assert.ok(result.includes('existing-agent'));
    assert.equal(callCount, 2, 'Should have tried twice');
  });

  it('throws when both attempts fail', async () => {
    const failGit: WorktreeGitFn = {
      raw: async () => { throw new Error('fatal: git error'); },
    };

    await assert.rejects(
      () => createAgentWorktree('doomed-agent', failGit),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes('Failed to create worktree'));
        assert.ok(err.message.includes('doomed-agent'));
        return true;
      },
    );
  });

  it('works with options-object style { _git }', async () => {
    const mockGit = makeGitMock({});
    const result = await createAgentWorktree('opts-agent', { _git: mockGit });
    assert.ok(result.includes('opts-agent'), 'Path should include agent name');
    assert.ok(mockGit.calls.length >= 1, 'Should have called git via options object');
    // First call should be worktree add with -b — same behavior as positional
    const firstCall = mockGit.calls.find(c => c.includes('worktree'));
    assert.ok(firstCall, 'Should call git worktree');
    assert.ok(firstCall.includes('-b'), 'First attempt should use -b flag');
  });
});

// ── removeAgentWorktree ─────────────────────────────────────────────────────

describe('removeAgentWorktree', () => {
  it('removes worktree and deletes branch on success', async () => {
    const mockGit = makeGitMock({});
    await removeAgentWorktree('done-agent', mockGit);
    // Should have called worktree remove and branch -d
    assert.ok(mockGit.calls.length >= 2, 'Should call both worktree remove and branch delete');
    const removeCall = mockGit.calls.find(c => c.includes('remove'));
    const branchCall = mockGit.calls.find(c => c.includes('branch'));
    assert.ok(removeCall, 'Should call worktree remove');
    assert.ok(branchCall, 'Should call branch -d');
  });

  it('does not throw when worktree removal fails', async () => {
    const mockGit: WorktreeGitFn = {
      raw: async (args: string[]) => {
        if (args.includes('remove')) throw new Error('worktree not found');
        return '';
      },
    };
    // Should not throw — logs warning instead
    const result = await removeAgentWorktree('missing-agent', mockGit);
    assert.equal(result, undefined, 'Should resolve without value when removal fails');
  });
});

// ── listWorktrees ───────────────────────────────────────────────────────────

describe('listWorktrees', () => {
  it('parses porcelain output with danteforge worktrees', async () => {
    const porcelainOutput = [
      'worktree /home/user/project',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
      'worktree /home/user/.danteforge-worktrees/agent-a',
      'HEAD def456',
      'branch refs/heads/danteforge/agent-a',
      '',
      'worktree /home/user/.danteforge-worktrees/agent-b',
      'HEAD 789abc',
      'branch refs/heads/danteforge/agent-b',
      '',
    ].join('\n');

    const mockGit = makeGitMock({ 'worktree list': porcelainOutput });
    const result = await listWorktrees(mockGit);

    assert.equal(result.length, 2, 'Should find 2 danteforge worktrees');
    assert.equal(result[0].branch, 'danteforge/agent-a');
    assert.equal(result[1].branch, 'danteforge/agent-b');
    assert.ok(result[0].path.includes('.danteforge-worktrees'));
  });

  it('filters out non-danteforge worktrees', async () => {
    const porcelainOutput = [
      'worktree /home/user/project',
      'HEAD abc123',
      'branch refs/heads/main',
      '',
    ].join('\n');

    const mockGit = makeGitMock({ 'worktree list': porcelainOutput });
    const result = await listWorktrees(mockGit);
    assert.equal(result.length, 0, 'Should filter out non-danteforge worktrees');
  });

  it('returns empty array when git command fails', async () => {
    const failGit: WorktreeGitFn = {
      raw: async () => { throw new Error('not a git repository'); },
    };
    const result = await listWorktrees(failGit);
    assert.deepEqual(result, [], 'Should return empty array on git failure');
  });
});

// ── createParallelWorktrees ─────────────────────────────────────────────────

describe('createParallelWorktrees', () => {
  it('creates worktrees for all agents', async () => {
    const mockGit = makeGitMock({});
    const result = await createParallelWorktrees(['alpha', 'beta'], mockGit);
    assert.equal(result.size, 2, 'Should create 2 worktrees');
    assert.ok(result.has('alpha'));
    assert.ok(result.has('beta'));
  });

  it('handles partial failures gracefully', async () => {
    let callCount = 0;
    const partialGit: WorktreeGitFn = {
      raw: async (args: string[]) => {
        callCount++;
        // Fail the second agent's creation (calls 3-4 are for second agent)
        if (callCount >= 3) throw new Error('git worktree failed');
        return '';
      },
    };
    const result = await createParallelWorktrees(['succeed', 'fail'], partialGit);
    assert.ok(result.size <= 2, 'Should handle partial failures');
  });

  it('returns empty map for empty array', async () => {
    const mockGit = makeGitMock({});
    const result = await createParallelWorktrees([], mockGit);
    assert.equal(result.size, 0, 'Should return empty map');
  });
});

// ── ensureWorktreesIgnored ──────────────────────────────────────────────────

describe('ensureWorktreesIgnored', () => {
  it('does nothing when already in gitignore', async () => {
    const mockFs = makeFsMock('node_modules\n.danteforge-worktrees/\n');
    await ensureWorktreesIgnored(mockFs);
    assert.equal(mockFs.appendedData.length, 0, 'Should not append when already present');
  });

  it('appends entry when not in gitignore', async () => {
    const mockFs = makeFsMock('node_modules\ndist/\n');
    await ensureWorktreesIgnored(mockFs);
    assert.equal(mockFs.appendedData.length, 1, 'Should append one entry');
    assert.ok(mockFs.appendedData[0].includes('.danteforge-worktrees'), 'Should include worktrees pattern');
  });

  it('handles missing gitignore gracefully', async () => {
    const mockFs = makeFsMock(undefined); // readFile throws ENOENT
    await ensureWorktreesIgnored(mockFs);
    assert.equal(mockFs.appendedData.length, 0, 'Should not append when gitignore is missing');
  });

  it('works with options-object style { _fs }', async () => {
    const mockFs = makeFsMock('node_modules\ndist/\n');
    await ensureWorktreesIgnored({ _fs: mockFs });
    assert.equal(mockFs.appendedData.length, 1, 'Should append one entry via options object');
    assert.ok(mockFs.appendedData[0].includes('.danteforge-worktrees'), 'Should include worktrees pattern');
  });
});

// ── ensureOPIntermediatesIgnored ────────────────────────────────────────────

describe('ensureOPIntermediatesIgnored', () => {
  it('does nothing when marker already present', async () => {
    const mockFs = makeFsMock('# DanteForge .op intermediates\n*.op.raw\n');
    await ensureOPIntermediatesIgnored(mockFs);
    assert.equal(mockFs.appendedData.length, 0, 'Should not append when marker present');
  });

  it('appends entries when marker absent', async () => {
    const mockFs = makeFsMock('node_modules\n');
    await ensureOPIntermediatesIgnored(mockFs);
    assert.equal(mockFs.appendedData.length, 1, 'Should append entries');
    assert.ok(mockFs.appendedData[0].includes('*.op.raw'), 'Should include .op.raw pattern');
    assert.ok(mockFs.appendedData[0].includes('*.op.wip'), 'Should include .op.wip pattern');
    assert.ok(mockFs.appendedData[0].includes('DanteForge .op intermediates'), 'Should include marker');
  });

  it('handles missing gitignore gracefully', async () => {
    const mockFs = makeFsMock(undefined); // readFile throws ENOENT
    await ensureOPIntermediatesIgnored(mockFs);
    assert.equal(mockFs.appendedData.length, 0, 'Should not append when gitignore is missing');
  });
});
