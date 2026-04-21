import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPublishCheck, type PublishCheckerDeps } from '../src/core/publish-checker.js';

function makeDeps(overrides: Partial<PublishCheckerDeps> = {}): PublishCheckerDeps {
  return {
    _cwd: () => '/tmp/fake-project',
    _readFile: async (p) => {
      if (p.endsWith('package.json')) return JSON.stringify({ name: 'test-pkg', version: '1.2.3' });
      if (p.endsWith('CHANGELOG.md') || p.endsWith('CHANGELOG')) return '## 1.2.3\n- changes';
      if (p.endsWith('LICENSE') || p.endsWith('LICENSE.md') || p.endsWith('LICENSE.txt')) return 'MIT License';
      if (p.endsWith('README.md')) return '# Test Package';
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
    _exec: async (_cmd) => ({ exitCode: 0, stdout: '', stderr: '' }),
    ...overrides,
  };
}

describe('runPublishCheck', () => {
  it('returns result with items array', async () => {
    const result = await runPublishCheck(makeDeps());
    assert.ok(Array.isArray(result.items));
    assert.ok(result.items.length > 0);
  });

  it('result has readyToPublish, passCount, failCount, warnCount', async () => {
    const result = await runPublishCheck(makeDeps());
    assert.ok(typeof result.readyToPublish === 'boolean');
    assert.ok(typeof result.passCount === 'number');
    assert.ok(typeof result.failCount === 'number');
    assert.ok(typeof result.warnCount === 'number');
  });

  it('readyToPublish is true when failCount is 0', async () => {
    const result = await runPublishCheck(makeDeps());
    if (result.failCount === 0) {
      assert.equal(result.readyToPublish, true);
    } else {
      assert.equal(result.readyToPublish, false);
    }
  });

  it('includes package-version check', async () => {
    const result = await runPublishCheck(makeDeps());
    const versionCheck = result.items.find(i => i.id === 'package-version');
    assert.ok(versionCheck !== undefined);
  });

  it('fails package-version check when version is missing', async () => {
    const deps = makeDeps({
      _readFile: async (p) => {
        if (p.endsWith('package.json')) return JSON.stringify({ name: 'test-pkg' });
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      },
    });
    const result = await runPublishCheck(deps);
    const versionCheck = result.items.find(i => i.id === 'package-version');
    assert.ok(versionCheck !== undefined);
    assert.equal(versionCheck!.status, 'fail');
  });

  it('passes when all checks have injected happy paths', async () => {
    const result = await runPublishCheck(makeDeps());
    // With all files readable and exec returning 0, shell checks pass
    // Package version, license, readme, changelog should all pass
    const passCount = result.items.filter(i => i.status === 'pass').length;
    assert.ok(passCount > 0, 'should have some passing checks');
  });

  it('checkedAt is a valid ISO timestamp', async () => {
    const result = await runPublishCheck(makeDeps());
    assert.ok(typeof result.checkedAt === 'string');
    assert.ok(new Date(result.checkedAt).getTime() > 0);
  });
});
