import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';

// Every workflow command that MUST have a commands/*.md slash command file.
const WORKFLOW_COMMANDS = [
  'autoforge',
  'awesome-scan',
  'blaze',
  'brainstorm',
  'browse',
  'canvas',
  'clarify',
  'constitution',
  'debug',
  'design',
  'ember',
  'forge',
  'harvest',
  'inferno',
  'lessons',
  'local-harvest',
  'magic',
  'assess',
  'define-done',
  'maturity',
  'nova',
  'self-improve',
  'universe',
  'oss',
  'party',
  'plan',
  'qa',
  'retro',
  'review',
  'spark',
  'ship',
  'specify',
  'synthesize',
  'tasks',
  'tech-decide',
  'ux-refine',
  'verify',
  'wiki-export',
  'wiki-ingest',
  'wiki-lint',
  'wiki-query',
  'wiki-status',
];

// Commands intentionally NOT registered as slash commands (utilities/config).
const UTILITY_COMMANDS = [
  'compact',
  'config',
  'dashboard',
  'doctor',
  'feedback',
  'help',
  'import',
  'setup',
  'update-mcp',
];

describe('command-skill-coverage', () => {
  it('every workflow command has a commands/*.md file', async () => {
    const commandsDir = path.resolve('commands');
    const entries = await fs.readdir(commandsDir);
    const commandFiles = entries.filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));

    for (const cmd of WORKFLOW_COMMANDS) {
      assert.ok(
        commandFiles.includes(cmd),
        `Missing commands/${cmd}.md — workflow command "${cmd}" needs a slash command file`,
      );
    }
  });

  it('has exactly the expected number of command files', async () => {
    const commandsDir = path.resolve('commands');
    const entries = await fs.readdir(commandsDir);
    const commandFiles = entries.filter(f => f.endsWith('.md'));

    assert.strictEqual(
      commandFiles.length,
      WORKFLOW_COMMANDS.length,
      `Expected ${WORKFLOW_COMMANDS.length} command files, found ${commandFiles.length}: ${commandFiles.sort().join(', ')}`,
    );
  });

  it('every commands/*.md file has valid YAML frontmatter with name and description', async () => {
    const commandsDir = path.resolve('commands');
    const entries = await fs.readdir(commandsDir);
    const commandFiles = entries.filter(f => f.endsWith('.md'));

    for (const file of commandFiles) {
      const content = (await fs.readFile(path.join(commandsDir, file), 'utf8')).replace(/\r\n/g, '\n');
      assert.match(
        content,
        /^---\n/,
        `${file} must start with YAML frontmatter (---) delimiter`,
      );
      assert.match(
        content,
        /\nname:\s*.+/,
        `${file} must have a "name:" field in frontmatter`,
      );
      assert.match(
        content,
        /\ndescription:\s*.+/,
        `${file} must have a "description:" field in frontmatter`,
      );
    }
  });

  it('frontmatter name matches filename for every command file', async () => {
    const commandsDir = path.resolve('commands');
    const entries = await fs.readdir(commandsDir);
    const commandFiles = entries.filter(f => f.endsWith('.md'));

    for (const file of commandFiles) {
      const content = (await fs.readFile(path.join(commandsDir, file), 'utf8')).replace(/\r\n/g, '\n');
      const nameMatch = content.match(/\nname:\s*(.+)/);
      assert.ok(nameMatch, `${file} must have a name: field`);

      const expectedName = file.replace('.md', '');
      assert.strictEqual(
        nameMatch![1]!.trim(),
        expectedName,
        `${file} frontmatter name "${nameMatch![1]!.trim()}" does not match filename "${expectedName}"`,
      );
    }
  });

  it('no utility commands have slash command files', async () => {
    const commandsDir = path.resolve('commands');
    const entries = await fs.readdir(commandsDir);
    const commandFiles = entries.filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''));

    for (const cmd of UTILITY_COMMANDS) {
      assert.ok(
        !commandFiles.includes(cmd),
        `Utility command "${cmd}" should NOT have a commands/${cmd}.md file`,
      );
    }
  });

  it('session-start hook lists all workflow commands', async () => {
    const hook = await fs.readFile('hooks/session-start.mjs', 'utf8');

    for (const cmd of WORKFLOW_COMMANDS) {
      assert.match(
        hook,
        new RegExp(`/${cmd.replace('-', '\\-')}`),
        `Session-start hook must list /${cmd}`,
      );
    }
  });

  it('AGENTS.md lists all workflow commands', async () => {
    const agents = await fs.readFile('AGENTS.md', 'utf8');

    // Slash-command-only entries (no CLI equivalent) are exempt from AGENTS.md check
    const SLASH_ONLY = ['brainstorm'];

    for (const cmd of WORKFLOW_COMMANDS) {
      if (SLASH_ONLY.includes(cmd)) continue;
      assert.match(
        agents,
        new RegExp(`danteforge ${cmd.replace('-', '\\-')}`),
        `AGENTS.md must reference "danteforge ${cmd}"`,
      );
    }
  });

  it('Codex config.toml avoids workflow command alias collisions with native slash commands', async () => {
    const config = await fs.readFile('.codex/config.toml', 'utf8');

    const SLASH_ONLY = ['brainstorm'];

    for (const cmd of WORKFLOW_COMMANDS) {
      if (SLASH_ONLY.includes(cmd)) continue;
      assert.doesNotMatch(
        config,
        new RegExp(`^${cmd.replace('-', '\\-')}\\s*=`, 'm'),
        `.codex/config.toml should not hijack native /${cmd} with a shell alias`,
      );
    }

    assert.match(config, /setup-assistants = "npx danteforge setup assistants --assistants codex"/);
    assert.match(config, /doctor-live = "npx danteforge doctor --live"/);
    assert.match(config, /df-verify = "npx danteforge verify"/);
  });

  it('Codex config.toml includes the latest verification and release aliases', async () => {
    const config = await fs.readFile('.codex/config.toml', 'utf8');

    assert.match(config, /npm run verify:all/);
    assert.match(config, /npm run check:anti-stub/);
    assert.match(config, /npm run release:check\b/);
    assert.match(config, /npm run release:check:strict/);
    assert.match(config, /npx danteforge doctor --live/);
    assert.match(config, /npx danteforge setup assistants --assistants codex/);
  });

  it('Cursor rules file lists all workflow commands', async () => {
    const cursor = await fs.readFile('.cursor/rules/danteforge.mdc', 'utf8');

    for (const cmd of WORKFLOW_COMMANDS) {
      if (cmd === 'brainstorm') continue; // brainstorm is a facilitative command, not in cursor pipeline
      assert.match(
        cursor,
        new RegExp(`danteforge ${cmd.replace('-', '\\-')}`),
        `.cursor/rules/danteforge.mdc must reference "danteforge ${cmd}"`,
      );
    }
  });
});
