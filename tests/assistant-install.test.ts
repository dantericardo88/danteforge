import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

async function makeTempDir(prefix: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}

describe('assistant skill install', () => {
  it('installs packaged skills into Codex, Claude, Antigravity, and OpenCode registries', async () => {
    const homeDir = await makeTempDir('danteforge-home-');
    const skillsDir = await makeTempDir('danteforge-skills-');

    await fs.mkdir(path.join(skillsDir, 'example-skill'), { recursive: true });
    await fs.writeFile(
      path.join(skillsDir, 'example-skill', 'SKILL.md'),
      '---\nname: example-skill\ndescription: Example skill\n---\n\nBody\n',
      'utf8',
    );

    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');
    const result = await installAssistantSkills({ homeDir, skillsDir });

    assert.deepStrictEqual(result.assistants.map(entry => entry.assistant).sort(), ['antigravity', 'claude', 'codex', 'opencode']);
    await fs.access(path.join(homeDir, '.codex', 'skills', 'example-skill', 'SKILL.md'));
    await fs.access(path.join(homeDir, '.claude', 'skills', 'example-skill', 'SKILL.md'));
    await fs.access(path.join(homeDir, '.gemini', 'antigravity', 'skills', 'example-skill', 'SKILL.md'));
    await fs.access(path.join(homeDir, '.config', 'opencode', 'skills', 'example-skill', 'SKILL.md'));

    const codexConfig = await fs.readFile(path.join(homeDir, '.codex', 'config.toml'), 'utf8');
    assert.match(codexConfig, /setup-assistants = "npx danteforge setup assistants --assistants codex"/);
    assert.match(codexConfig, /df-verify = "npx danteforge verify"/);
    assert.doesNotMatch(codexConfig, /^autoforge\s*=/m);
    const codexBootstrap = await fs.readFile(path.join(homeDir, '.codex', 'AGENTS.md'), 'utf8');
    assert.match(codexBootstrap, /DanteForge Codex Bootstrap/);
    assert.match(codexBootstrap, /native Codex workflow command/i);
    await fs.access(path.join(homeDir, '.codex', 'commands', 'autoforge.md'));
  });

  it('syncs the Claude plugin cache to the current package version when a Claude install exists', async () => {
    const homeDir = await makeTempDir('danteforge-home-');
    const skillsDir = await makeTempDir('danteforge-skills-');
    const projectDir = await makeTempDir('danteforge-project-');

    await fs.mkdir(path.join(skillsDir, 'example-skill'), { recursive: true });
    await fs.writeFile(
      path.join(skillsDir, 'example-skill', 'SKILL.md'),
      '---\nname: example-skill\ndescription: Example skill\n---\n\nBody\n',
      'utf8',
    );

    await fs.mkdir(path.join(projectDir, '.claude-plugin'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'dist'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'commands'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'dist', 'index.js'), 'console.log("0.9.2");\n', 'utf8');
    await fs.writeFile(
      path.join(projectDir, 'package.json'),
      JSON.stringify({
        name: 'danteforge',
        version: '0.9.2',
        files: ['dist', 'commands', '.claude-plugin', 'README.md'],
      }, null, 2),
      'utf8',
    );
    await fs.writeFile(path.join(projectDir, 'README.md'), '# DanteForge\n', 'utf8');
    await fs.writeFile(path.join(projectDir, 'commands', 'autoforge.md'), '---\nname: autoforge\ndescription: Test\n---\n', 'utf8');
    await fs.writeFile(path.join(projectDir, '.claude-plugin', 'plugin.json'), '{"version":"0.9.2"}\n', 'utf8');
    await fs.writeFile(path.join(projectDir, '.claude-plugin', 'marketplace.json'), '{"plugins":[{"version":"0.9.2"}]}\n', 'utf8');

    const priorCacheDir = path.join(homeDir, '.claude', 'plugins', 'cache', 'danteforge-dev', 'danteforge', '0.9.1');
    await fs.mkdir(path.join(priorCacheDir, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(priorCacheDir, 'package.json'), '{"version":"0.9.1"}\n', 'utf8');
    await fs.writeFile(path.join(priorCacheDir, 'node_modules', 'keep.txt'), 'keep\n', 'utf8');
    await fs.mkdir(path.join(homeDir, '.claude', 'plugins'), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: {
          'danteforge@danteforge-dev': [
            {
              scope: 'user',
              installPath: priorCacheDir,
              version: '0.9.1',
              installedAt: '2026-03-25T00:00:00.000Z',
              lastUpdated: '2026-03-25T00:00:00.000Z',
            },
          ],
        },
      }, null, 2),
      'utf8',
    );

    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');
    await installAssistantSkills({
      homeDir,
      skillsDir,
      projectDir,
      assistants: ['claude'],
    });

    const nextCacheDir = path.join(homeDir, '.claude', 'plugins', 'cache', 'danteforge-dev', 'danteforge', '0.9.2');
    await fs.access(path.join(nextCacheDir, 'dist', 'index.js'));
    await fs.access(path.join(nextCacheDir, 'node_modules', 'keep.txt'));
    const cachedPackage = await fs.readFile(path.join(nextCacheDir, 'package.json'), 'utf8');
    assert.match(cachedPackage, /0\.9\.2/);

    const installedPlugins = JSON.parse(await fs.readFile(path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')) as {
      plugins: Record<string, Array<{ installPath: string; version: string }>>;
    };
    const install = installedPlugins.plugins['danteforge@danteforge-dev']?.[0];
    assert.ok(install, 'Claude install entry should exist');
    assert.equal(install?.version, '0.9.2');
    assert.equal(install?.installPath, nextCacheDir);
  });

  it('can install a Cursor bootstrap rule into the current project', async () => {
    const homeDir = await makeTempDir('danteforge-home-');
    const skillsDir = await makeTempDir('danteforge-skills-');
    const projectDir = await makeTempDir('danteforge-project-');

    await fs.mkdir(path.join(skillsDir, 'example-skill'), { recursive: true });
    await fs.writeFile(
      path.join(skillsDir, 'example-skill', 'SKILL.md'),
      '---\nname: example-skill\ndescription: Example skill\n---\n\nBody\n',
      'utf8',
    );

    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');
    const result = await installAssistantSkills({
      homeDir,
      skillsDir,
      projectDir,
      assistants: ['cursor'],
    });

    assert.deepStrictEqual(result.assistants.map(entry => entry.assistant), ['cursor']);
    const cursorRulePath = path.join(projectDir, '.cursor', 'rules', 'danteforge.mdc');
    await fs.access(cursorRulePath);
    const cursorRule = await fs.readFile(cursorRulePath, 'utf8');
    assert.match(cursorRule, /danteforge inferno/);
    assert.match(cursorRule, /danteforge harvest/);
  });

  it('exports a setupAssistants command', async () => {
    const { setupAssistants } = await import('../src/cli/commands/setup-assistants.js');
    assert.strictEqual(typeof setupAssistants, 'function');
  });

  it('merges Codex utility aliases into an existing user config without dropping existing settings or native workflow commands', async () => {
    const homeDir = await makeTempDir('danteforge-home-');
    const skillsDir = await makeTempDir('danteforge-skills-');

    await fs.mkdir(path.join(skillsDir, 'example-skill'), { recursive: true });
    await fs.writeFile(
      path.join(skillsDir, 'example-skill', 'SKILL.md'),
      '---\nname: example-skill\ndescription: Example skill\n---\n\nBody\n',
      'utf8',
    );

    await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, '.codex', 'config.toml'),
      [
        'model = "gpt-5.4"',
        '',
        '[commands]',
        'custom = "echo hello"',
        'autoforge = "npx danteforge autoforge"',
        'inferno = "npx danteforge inferno"',
        '',
        '[windows]',
        'sandbox = "elevated"',
        '',
      ].join('\n'),
      'utf8',
    );

    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');
    await installAssistantSkills({
      homeDir,
      skillsDir,
      assistants: ['codex'],
    });

    const codexConfig = await fs.readFile(path.join(homeDir, '.codex', 'config.toml'), 'utf8');
    assert.match(codexConfig, /model = "gpt-5\.4"/);
    assert.match(codexConfig, /\[windows\]\nsandbox = "elevated"/);
    assert.match(codexConfig, /\[commands\][\s\S]*custom = "echo hello"/);
    assert.match(codexConfig, /\[commands\][\s\S]*setup-assistants = "npx danteforge setup assistants --assistants codex"/);
    assert.doesNotMatch(codexConfig, /^autoforge\s*=/m);
    assert.doesNotMatch(codexConfig, /^inferno\s*=/m);
  });

  it('merges the Codex global bootstrap into an existing AGENTS.md without dropping user content', async () => {
    const homeDir = await makeTempDir('danteforge-home-');
    const skillsDir = await makeTempDir('danteforge-skills-');

    await fs.mkdir(path.join(skillsDir, 'example-skill'), { recursive: true });
    await fs.writeFile(
      path.join(skillsDir, 'example-skill', 'SKILL.md'),
      '---\nname: example-skill\ndescription: Example skill\n---\n\nBody\n',
      'utf8',
    );

    await fs.mkdir(path.join(homeDir, '.codex'), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, '.codex', 'AGENTS.md'),
      '# Personal Codex Notes\n\nKeep my personal shortcuts.\n',
      'utf8',
    );

    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');
    await installAssistantSkills({
      homeDir,
      skillsDir,
      assistants: ['codex'],
    });

    const codexBootstrap = await fs.readFile(path.join(homeDir, '.codex', 'AGENTS.md'), 'utf8');
    assert.match(codexBootstrap, /Personal Codex Notes/);
    assert.match(codexBootstrap, /DanteForge Codex Bootstrap/);
    assert.match(codexBootstrap, /danteforge setup assistants --assistants codex/);
  });
});
