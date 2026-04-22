import assert from 'node:assert';
import fs from 'node:fs/promises';
import { describe, it } from 'node:test';

const ACTIVE_CORE_FILES = [
  'src/core/agent-dag.ts',
  'src/core/autoforge-loop.ts',
  'src/core/autoforge.ts',
  'src/core/complexity-classifier.ts',
  'src/core/context-compressor.ts',
  'src/core/headless-spawner.ts',
  'src/core/local-transforms.ts',
  'src/core/magic-presets.ts',
  'src/core/model-profile-engine.ts',
  'src/core/pdse-config.ts',
  'src/core/subagent-isolator.ts',
] as const;

describe('release surface polish', () => {
  it('maintains a release-history index and links to it from active release docs', async () => {
    const history = await fs.readFile('docs/Release-History.md', 'utf8');
    const readme = await fs.readFile('README.md', 'utf8');
    const releaseGuide = await fs.readFile('RELEASE.md', 'utf8');
    const readiness = await fs.readFile('docs/Operational-Readiness-v0.9.2.md', 'utf8');

    assert.match(history, /Release History/i);
    assert.match(history, /Operational-Readiness-v0\.9\.2\.md/);
    assert.match(history, /Operational-Readiness-v0\.9\.1\.md/);
    assert.match(history, /Operational-Readiness-v0\.9\.0\.md/);
    assert.match(history, /Operational-Readiness-v0\.8\.0\.md/);
    assert.match(readme, /Release-History\.md/);
    assert.match(releaseGuide, /Release-History\.md/);
    assert.match(readiness, /Release-History\.md/);
  });

  it('removes stale version-era labels from active core commentary', async () => {
    for (const file of ACTIVE_CORE_FILES) {
      const content = await fs.readFile(file, 'utf8');
      assert.doesNotMatch(
        content,
        /v0\.9\.0|v0\.8\.0/,
        `${file} should not carry stale version-era commentary in active code`,
      );
    }
  });
});
