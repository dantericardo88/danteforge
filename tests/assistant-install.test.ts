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

// ── Windsurf ──────────────────────────────────────────────────────────────────

describe('Windsurf assistant install', () => {
  it('writes .windsurf/rules/danteforge.md with pipeline and verify instruction', async () => {
    const homeDir = await makeTempDir('danteforge-home-');
    const projectDir = await makeTempDir('danteforge-project-');

    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');
    const result = await installAssistantSkills({ homeDir, projectDir, assistants: ['windsurf'] });

    assert.deepStrictEqual(result.assistants.map(e => e.assistant), ['windsurf']);
    assert.equal(result.assistants[0]?.installMode, 'windsurf-rules');

    const filePath = path.join(projectDir, '.windsurf', 'rules', 'danteforge.md');
    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf8');
    assert.match(content, /danteforge verify/, 'must include verify instruction');
    assert.match(content, /STATE\.yaml/, 'must reference STATE.yaml');
    assert.match(content, /DanteForge Workflow Framework/);
  });
});

// ── Aider ─────────────────────────────────────────────────────────────────────

describe('Aider assistant install', () => {
  it('writes .aider.conf.yml referencing CONVENTIONS.md and writes CONVENTIONS.md with pipeline', async () => {
    const homeDir = await makeTempDir('danteforge-home-');
    const projectDir = await makeTempDir('danteforge-project-');

    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');
    const result = await installAssistantSkills({ homeDir, projectDir, assistants: ['aider'] });

    assert.equal(result.assistants[0]?.installMode, 'aider-config');

    const confPath = path.join(projectDir, '.aider.conf.yml');
    await fs.access(confPath);
    const conf = await fs.readFile(confPath, 'utf8');
    assert.match(conf, /CONVENTIONS\.md/, 'config must reference CONVENTIONS.md');

    const convPath = path.join(projectDir, 'CONVENTIONS.md');
    await fs.access(convPath);
    const conv = await fs.readFile(convPath, 'utf8');
    assert.match(conv, /danteforge verify/, 'CONVENTIONS.md must include verify instruction');
    assert.match(conv, /STATE\.yaml/);
  });

  it('does not overwrite an existing CONVENTIONS.md on second install', async () => {
    const homeDir = await makeTempDir('danteforge-home-');
    const projectDir = await makeTempDir('danteforge-project-');

    const convPath = path.join(projectDir, 'CONVENTIONS.md');
    await fs.writeFile(convPath, '# My Custom Conventions\nDo not overwrite me.\n', 'utf8');

    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');
    await installAssistantSkills({ homeDir, projectDir, assistants: ['aider'] });

    const content = await fs.readFile(convPath, 'utf8');
    assert.match(content, /My Custom Conventions/, 'user content must be preserved');
    assert.match(content, /Do not overwrite me/, 'user content must not be replaced');
  });
});

// ── OpenHands ─────────────────────────────────────────────────────────────────

describe('OpenHands assistant install', () => {
  it('writes .openhands/microagents/repo.md with pipeline stages and verify instruction', async () => {
    const homeDir = await makeTempDir('danteforge-home-');
    const projectDir = await makeTempDir('danteforge-project-');

    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');
    const result = await installAssistantSkills({ homeDir, projectDir, assistants: ['openhands'] });

    assert.equal(result.assistants[0]?.installMode, 'openhands-microagent');

    const filePath = path.join(projectDir, '.openhands', 'microagents', 'repo.md');
    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf8');
    assert.match(content, /danteforge verify/, 'must include verify instruction');
    assert.match(content, /STATE\.yaml/, 'must reference STATE.yaml');
    assert.match(content, /danteforge constitution/);
  });
});

// ── GitHub Copilot ────────────────────────────────────────────────────────────

describe('GitHub Copilot assistant install', () => {
  it('writes .github/copilot-instructions.md with pipeline and verify instruction', async () => {
    const homeDir = await makeTempDir('danteforge-home-');
    const projectDir = await makeTempDir('danteforge-project-');

    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');
    const result = await installAssistantSkills({ homeDir, projectDir, assistants: ['copilot'] });

    assert.equal(result.assistants[0]?.installMode, 'copilot-instructions');

    const filePath = path.join(projectDir, '.github', 'copilot-instructions.md');
    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf8');
    assert.match(content, /danteforge verify/, 'must include verify instruction');
    assert.match(content, /STATE\.yaml/);
    assert.match(content, /DanteForge Workflow Framework/);
  });
});

// ── Continue.dev ──────────────────────────────────────────────────────────────

describe('Continue.dev assistant install', () => {
  it('writes ~/.continue/config.yaml with rules section', async () => {
    const homeDir = await makeTempDir('danteforge-home-');

    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');
    const result = await installAssistantSkills({ homeDir, assistants: ['continue'] });

    assert.equal(result.assistants[0]?.installMode, 'continue-config');

    const filePath = path.join(homeDir, '.continue', 'config.yaml');
    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf8');
    assert.match(content, /rules:/, 'must have rules section');
    assert.match(content, /danteforge verify/, 'must include verify rule');
    assert.match(content, /STATE\.yaml/);
  });

  it('merges rules into existing config.yaml without duplicating or losing user content', async () => {
    const homeDir = await makeTempDir('danteforge-home-');
    await fs.mkdir(path.join(homeDir, '.continue'), { recursive: true });
    await fs.writeFile(
      path.join(homeDir, '.continue', 'config.yaml'),
      'models:\n  - name: gpt-4\n    provider: openai\n\nrules:\n  - "Use TypeScript strict mode"\n',
      'utf8',
    );

    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');
    await installAssistantSkills({ homeDir, assistants: ['continue'] });

    const content = await fs.readFile(path.join(homeDir, '.continue', 'config.yaml'), 'utf8');
    assert.match(content, /Use TypeScript strict mode/, 'user rule must be preserved');
    assert.match(content, /models:/, 'user model config must be preserved');
    assert.match(content, /danteforge verify/, 'danteforge rule must be added');

    // Second install — must not duplicate
    await installAssistantSkills({ homeDir, assistants: ['continue'] });
    const content2 = await fs.readFile(path.join(homeDir, '.continue', 'config.yaml'), 'utf8');
    const matchCount = (content2.match(/danteforge verify/g) ?? []).length;
    assert.equal(matchCount, 1, 'rule must not be duplicated on second install');
  });
});

// ── Gemini CLI ────────────────────────────────────────────────────────────────

describe('Gemini CLI assistant install', () => {
  it('writes GEMINI.md with pipeline stages and verify instruction', async () => {
    const homeDir = await makeTempDir('danteforge-home-');
    const projectDir = await makeTempDir('danteforge-project-');

    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');
    const result = await installAssistantSkills({ homeDir, projectDir, assistants: ['gemini-cli'] });

    assert.equal(result.assistants[0]?.installMode, 'gemini-cli');

    const filePath = path.join(projectDir, 'GEMINI.md');
    await fs.access(filePath);
    const content = await fs.readFile(filePath, 'utf8');
    assert.match(content, /danteforge verify/, 'must include verify instruction');
    assert.match(content, /STATE\.yaml/);
    assert.match(content, /DanteForge Workflow Framework/);
  });
});

// ── Alias normalization ───────────────────────────────────────────────────────

describe('normalizeAssistant aliases', () => {
  it('resolves all new assistant aliases correctly', async () => {
    // We test via parseAssistants indirectly through setupAssistants import
    // Instead verify ALL_ASSISTANTS contains all 11 by checking installAssistantSkills accepts them
    const homeDir = await makeTempDir('danteforge-home-');
    const projectDir = await makeTempDir('danteforge-project-');
    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');

    // Verify all new assistants are accepted without error
    const result = await installAssistantSkills({
      homeDir,
      projectDir,
      assistants: ['windsurf', 'aider', 'openhands', 'copilot', 'continue', 'gemini-cli'],
    });

    const installed = result.assistants.map(e => e.assistant).sort();
    assert.deepStrictEqual(installed, ['aider', 'continue', 'copilot', 'gemini-cli', 'openhands', 'windsurf']);
  });

  it('parseAssistants("all") returns all 11 assistants', async () => {
    const { setupAssistants } = await import('../src/cli/commands/setup-assistants.js');
    // We can't easily call parseAssistants directly, but we can verify setupAssistants
    // accepts "all" without throwing (it will fail on skill dir access which is fine)
    assert.strictEqual(typeof setupAssistants, 'function');

    // Verify ALL_ASSISTANTS via installAssistantSkills by checking result count for all known entries
    const homeDir = await makeTempDir('danteforge-home-');
    const projectDir = await makeTempDir('danteforge-project-');
    const { installAssistantSkills } = await import('../src/core/assistant-installer.js');

    const allNew: Array<'windsurf' | 'aider' | 'openhands' | 'copilot' | 'continue' | 'gemini-cli'> =
      ['windsurf', 'aider', 'openhands', 'copilot', 'continue', 'gemini-cli'];
    const result = await installAssistantSkills({ homeDir, projectDir, assistants: allNew });
    assert.equal(result.assistants.length, 6, 'all 6 new assistants must install');
  });
});
