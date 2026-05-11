import assert from 'node:assert';
import fs from 'node:fs/promises';
import { describe, it } from 'node:test';

describe('build isolation', () => {
  it('keeps the default build path free of postbuild side effects', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    assert.strictEqual(pkg.scripts?.build, 'tsup');
    assert.ok(pkg.scripts?.['sync:dantecode'], 'explicit maintainer sync script must exist');
    assert.ok(pkg.scripts?.['build:local-sync'], 'explicit local-sync build script must exist');
    // postbuild is allowed only for local operations (plugin cache sync); must never call sync:dantecode
    const postbuild = pkg.scripts?.postbuild ?? '';
    assert.ok(
      !postbuild.includes('sync:dantecode') && !postbuild.includes('sync-dantecode'),
      'default builds must not trigger sibling-repo (DanteCode) sync',
    );
  });

  it('documents sibling-repo sync as an explicit maintainer action instead of default build behavior', async () => {
    const readme = await fs.readFile('README.md', 'utf8');
    const releaseGuide = await fs.readFile('RELEASE.md', 'utf8');

    assert.match(readme, /sync:dantecode/);
    assert.match(releaseGuide, /sync:dantecode/);
    assert.doesNotMatch(readme, /SKIP_DANTECODE_SYNC/);
  });
});
