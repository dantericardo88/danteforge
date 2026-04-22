import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadPluginsManifest,
  savePluginsManifest,
  installPlugin,
  removePlugin,
  PluginNoSkillsDirError,
  type PluginRegistryOptions,
  type PluginsManifest,
} from '../src/core/plugin-registry.js';

function noopOpts(overrides: Partial<PluginRegistryOptions> = {}): PluginRegistryOptions {
  return {
    cwd: '/tmp/plugin-test',
    _readFile: async () => { throw new Error('not found'); },
    _writeFile: async () => {},
    _mkdir: async () => {},
    _exists: async () => false,
    _execNpm: async () => ({ stdout: '{}', stderr: '' }),
    ...overrides,
  };
}

describe('loadPluginsManifest', () => {
  it('returns empty plugins list when manifest not found', async () => {
    const manifest = await loadPluginsManifest(noopOpts());
    assert.deepEqual(manifest, { plugins: [] });
  });

  it('parses valid YAML manifest', async () => {
    const yaml = 'plugins:\n  - name: my-plugin\n    version: 1.0.0\n    skillsDir: /skills\n    installedAt: 2026-01-01T00:00:00.000Z\n';
    const opts = noopOpts({ _readFile: async () => yaml });
    const manifest = await loadPluginsManifest(opts);
    assert.equal(manifest.plugins.length, 1);
    assert.equal(manifest.plugins[0].name, 'my-plugin');
  });

  it('returns empty list on malformed YAML', async () => {
    const opts = noopOpts({ _readFile: async () => ': bad: yaml: !!!' });
    const manifest = await loadPluginsManifest(opts);
    assert.ok(Array.isArray(manifest.plugins));
  });
});

describe('savePluginsManifest', () => {
  it('writes manifest to disk', async () => {
    let written = '';
    const opts = noopOpts({
      _writeFile: async (_p, c) => { written = c; },
    });
    const manifest: PluginsManifest = { plugins: [] };
    await savePluginsManifest(manifest, opts);
    assert.ok(written.length > 0);
  });

  it('includes plugin entries in written content', async () => {
    let written = '';
    const opts = noopOpts({
      _writeFile: async (_p, c) => { written = c; },
    });
    const manifest: PluginsManifest = {
      plugins: [{
        name: 'test-plugin',
        version: '1.0.0',
        skillsDir: '/path/to/skills',
        installedAt: new Date().toISOString(),
      }],
    };
    await savePluginsManifest(manifest, opts);
    assert.ok(written.includes('test-plugin'));
  });
});

describe('installPlugin', () => {
  it('returns alreadyInstalled=true when plugin exists in manifest', async () => {
    const existingYaml = `plugins:
  - name: existing-pkg
    version: 1.0.0
    skillsDir: /skills
    installedAt: 2026-01-01T00:00:00.000Z
`;
    const opts = noopOpts({
      _readFile: async () => existingYaml,
      _exists: async () => true,
    });
    const result = await installPlugin('existing-pkg', opts);
    assert.equal(result.alreadyInstalled, true);
    assert.equal(result.entry.name, 'existing-pkg');
  });

  it('throws PluginNoSkillsDirError when skills/ dir missing after install', async () => {
    const opts = noopOpts({
      _readFile: async () => { throw new Error('not found'); },
      _exists: async () => false,
      _execNpm: async () => ({ stdout: JSON.stringify({ version: '1.0.0' }), stderr: '' }),
    });
    await assert.rejects(
      () => installPlugin('no-skills-pkg', opts),
      PluginNoSkillsDirError,
    );
  });
});

describe('removePlugin', () => {
  it('removes plugin from manifest', async () => {
    const existingYaml = `plugins:
  - name: to-remove
    version: 1.0.0
    skillsDir: /skills
    installedAt: 2026-01-01T00:00:00.000Z
  - name: keep-me
    version: 2.0.0
    skillsDir: /other
    installedAt: 2026-01-01T00:00:00.000Z
`;
    let written = '';
    const opts = noopOpts({
      _readFile: async () => existingYaml,
      _writeFile: async (_p, c) => { written = c; },
    });
    await removePlugin('to-remove', opts);
    assert.ok(!written.includes('to-remove'));
    assert.ok(written.includes('keep-me'));
  });

  it('no-ops when plugin not found in manifest', async () => {
    let written = '';
    const opts = noopOpts({
      _readFile: async () => { throw new Error('not found'); },
      _writeFile: async (_p, c) => { written = c; },
    });
    await removePlugin('nonexistent', opts);
    // Should write back the empty manifest without error
    assert.ok(typeof written === 'string');
  });
});

describe('PluginNoSkillsDirError', () => {
  it('has correct name and message', () => {
    const err = new PluginNoSkillsDirError('my-pkg', '/path/skills');
    assert.equal(err.name, 'PluginNoSkillsDirError');
    assert.ok(err.message.includes('my-pkg'));
    assert.equal(err.packageName, 'my-pkg');
    assert.equal(err.checkedPath, '/path/skills');
  });
});
