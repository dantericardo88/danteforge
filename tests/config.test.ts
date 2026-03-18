import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import type { DanteConfig } from '../src/core/config.js';
import { loadConfig, saveConfig, resolveConfigPaths } from '../src/core/config.js';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

async function makeTempPair() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-config-test-'));
  const cwd = path.join(root, 'project');
  const home = path.join(root, 'user-home');
  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  tempDirs.push(root);
  return { root, cwd, home };
}

function baseConfig(): DanteConfig {
  return {
    defaultProvider: 'openai',
    ollamaModel: 'llama3',
    providers: {
      openai: { apiKey: 'sk-test', model: 'gpt-4o' },
    },
  };
}

describe('config storage paths', () => {
  it('resolves secrets to a user-level config dir and keeps project legacy path separate', () => {
    const paths = resolveConfigPaths({
      cwd: '/work/repo',
      homeDir: '/users/alice',
    });

    assert.strictEqual(paths.configDir, path.join('/users/alice', '.danteforge'));
    assert.strictEqual(paths.configFile, path.join('/users/alice', '.danteforge', 'config.yaml'));
    assert.strictEqual(paths.legacyProjectConfigFile, path.join('/work/repo', '.danteforge', 'config.yaml'));
  });

  it('loads legacy project config and migrates it to the user config location', async () => {
    const { cwd, home } = await makeTempPair();
    const paths = resolveConfigPaths({ cwd, homeDir: home });

    await fs.mkdir(path.dirname(paths.legacyProjectConfigFile), { recursive: true });
    await fs.writeFile(
      paths.legacyProjectConfigFile,
      'defaultProvider: openai\nollamaModel: llama3\nproviders:\n  openai:\n    apiKey: sk-legacy\n',
      'utf8',
    );

    const config = await loadConfig({ cwd, homeDir: home });
    assert.strictEqual(config.defaultProvider, 'openai');
    assert.strictEqual(config.providers.openai?.apiKey, 'sk-legacy');

    const migrated = await fs.readFile(paths.configFile, 'utf8');
    assert.ok(migrated.includes('sk-legacy'));
  });

  it('saves config to the user config location instead of the project state folder', async () => {
    const { cwd, home } = await makeTempPair();
    const paths = resolveConfigPaths({ cwd, homeDir: home });

    await saveConfig(baseConfig(), { cwd, homeDir: home });

    const userConfig = await fs.readFile(paths.configFile, 'utf8');
    assert.ok(userConfig.includes('sk-test'));

    let legacyExists = true;
    try {
      await fs.access(paths.legacyProjectConfigFile);
    } catch {
      legacyExists = false;
    }
    assert.strictEqual(legacyExists, false);
  });
});
