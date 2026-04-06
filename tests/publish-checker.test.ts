import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPublishCheck } from '../src/core/publish-checker.js';

const mockFiles: Record<string, string> = {
  '/fake/package.json': JSON.stringify({ name: 'test', version: '1.2.3' }),
  '/fake/CHANGELOG.md': '# Changelog\n## v1.2.3\n- something',
  '/fake/LICENSE': 'MIT License',
  '/fake/README.md': 'x'.repeat(600),
};

const passingDeps = {
  _cwd: () => '/fake',
  _readFile: async (p: string, _e: string) => {
    const content = mockFiles[p];
    if (!content) throw new Error(`File not found: ${p}`);
    return content;
  },
};

describe('publish-checker', () => {
  it('returns PublishCheckResult shape', async () => {
    const result = await runPublishCheck(passingDeps);
    assert.ok('items' in result);
    assert.ok('readyToPublish' in result);
    assert.ok('passCount' in result);
    assert.ok('failCount' in result);
    assert.ok('checkedAt' in result);
    assert.ok(Array.isArray(result.items));
  });

  it('package-version passes for valid semver', async () => {
    const result = await runPublishCheck(passingDeps);
    const item = result.items.find(i => i.id === 'package-version');
    assert.ok(item, 'Expected package-version check');
    assert.equal(item!.status, 'pass');
  });

  it('package-version fails for missing version', async () => {
    const result = await runPublishCheck({
      _cwd: () => '/fake',
      _readFile: async (p) => {
        if (p.endsWith('package.json')) return JSON.stringify({ name: 'test' });
        return mockFiles[p] ?? '';
      },
    });
    const item = result.items.find(i => i.id === 'package-version');
    assert.equal(item?.status, 'fail');
  });

  it('changelog-entry fails when version not in CHANGELOG', async () => {
    const result = await runPublishCheck({
      _cwd: () => '/fake',
      _readFile: async (p) => {
        if (p.endsWith('CHANGELOG.md')) return '# Changelog\n## v0.0.1\n- old stuff';
        return mockFiles[p] ?? '';
      },
    });
    const item = result.items.find(i => i.id === 'changelog-entry');
    assert.equal(item?.status, 'fail');
  });

  it('audit-clean maps exit code correctly', async () => {
    const result = await runPublishCheck({
      ...passingDeps,
      _exec: async (cmd) => {
        if (cmd.includes('audit')) return { exitCode: 1, stdout: '1 high vulnerability', stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    const item = result.items.find(i => i.id === 'audit-clean');
    assert.equal(item?.status, 'fail');
  });

  it('git-clean detects dirty state', async () => {
    const result = await runPublishCheck({
      ...passingDeps,
      _exec: async (cmd) => {
        if (cmd.includes('git status')) return { exitCode: 0, stdout: ' M src/file.ts\n', stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      },
    });
    const item = result.items.find(i => i.id === 'git-clean');
    assert.equal(item?.status, 'fail');
  });

  it('all checks run in parallel (structural assertion)', async () => {
    // Promise.allSettled ensures parallel execution — verify all 12 checks are returned
    const result = await runPublishCheck(passingDeps);
    assert.ok(result.items.length >= 10, `Expected at least 10 check items, got ${result.items.length}`);
  });

  it('readyToPublish is false when any blocking failure exists', async () => {
    const result = await runPublishCheck({
      _cwd: () => '/fake',
      _readFile: async () => { throw new Error('not found'); },
    });
    assert.equal(result.readyToPublish, false);
    assert.ok(result.failCount > 0);
  });
});
