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
