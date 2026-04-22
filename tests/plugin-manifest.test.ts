// plugin-manifest — Validates the Claude Code plugin manifest and command coverage.
// Ensures:
//   1. plugin.json is valid JSON with required fields (name, version, mcpServers)
//   2. mcpServers wires the danteforge MCP server with ${CLAUDE_PLUGIN_ROOT}
//   3. All 11 core commands exist in .claude-plugin/commands/ with correct frontmatter
//   4. Every core command has a name: danteforge-<cmd> prefix (namespace safety)
//   5. Every core command has a non-empty description field
//   6. CLI parity line present in each core command

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const PLUGIN_DIR = path.resolve('.claude-plugin');
const MANIFEST_PATH = path.join(PLUGIN_DIR, 'plugin.json');
const COMMANDS_DIR = path.join(PLUGIN_DIR, 'commands');

// The 11 core commands that MUST exist in .claude-plugin/commands/
const CORE_PLUGIN_COMMANDS = [
  'score',
  'forge',
  'assess',
  'plan',
  'verify',
  'specify',
  'tasks',
  'retro',
  'lessons',
  'magic',
  'inferno',
];

// Minimal YAML frontmatter parser — extracts key: value pairs from ---\n...\n---
function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = value;
  }
  return result;
}

// ── Manifest validation ───────────────────────────────────────────────────────

describe('plugin.json manifest', () => {
  it('plugin.json exists and is valid JSON', async () => {
    const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
    let parsed: unknown;
    assert.doesNotThrow(() => { parsed = JSON.parse(raw); }, 'plugin.json must be valid JSON');
    assert.ok(parsed !== null && typeof parsed === 'object');
  });

  it('manifest has required name field', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8')) as Record<string, unknown>;
    assert.ok(typeof manifest['name'] === 'string' && manifest['name'].length > 0,
      'plugin.json must have a non-empty name field');
  });

  it('manifest has version field', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8')) as Record<string, unknown>;
    assert.ok(typeof manifest['version'] === 'string', 'plugin.json must have a version field');
  });

  it('manifest has mcpServers section with danteforge server', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8')) as Record<string, unknown>;
    assert.ok(
      manifest['mcpServers'] !== null && typeof manifest['mcpServers'] === 'object',
      'plugin.json must have a mcpServers section',
    );
    const servers = manifest['mcpServers'] as Record<string, unknown>;
    assert.ok('danteforge' in servers, 'mcpServers must include a "danteforge" server entry');
  });

  it('danteforge MCP server uses node command', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8')) as Record<string, unknown>;
    const servers = manifest['mcpServers'] as Record<string, Record<string, unknown>>;
    const server = servers['danteforge'];
    assert.ok(server, 'danteforge server must be defined');
    assert.equal(server['command'], 'node', 'MCP server command must be "node"');
  });

  it('danteforge MCP server args reference ${CLAUDE_PLUGIN_ROOT}/dist/index.js', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8')) as Record<string, unknown>;
    const servers = manifest['mcpServers'] as Record<string, Record<string, unknown>>;
    const server = servers['danteforge'];
    const args = server['args'] as string[];
    assert.ok(Array.isArray(args), 'MCP server args must be an array');
    assert.ok(
      args.some(a => a.includes('dist/index.js')),
      `MCP server args must reference dist/index.js, got: ${JSON.stringify(args)}`,
    );
    assert.ok(
      args.some(a => a.includes('${CLAUDE_PLUGIN_ROOT}')),
      `MCP server args must use \${CLAUDE_PLUGIN_ROOT} for portability, got: ${JSON.stringify(args)}`,
    );
  });

  it('danteforge MCP server args include mcp-server subcommand', async () => {
    const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8')) as Record<string, unknown>;
    const servers = manifest['mcpServers'] as Record<string, Record<string, unknown>>;
    const server = servers['danteforge'];
    const args = server['args'] as string[];
    assert.ok(
      args.includes('mcp-server'),
      `MCP server args must include "mcp-server" subcommand, got: ${JSON.stringify(args)}`,
    );
  });
});

// ── Core command file existence ───────────────────────────────────────────────

describe('.claude-plugin/commands/ — core command files', () => {
  it('commands directory exists', async () => {
    const stat = await fs.stat(COMMANDS_DIR);
    assert.ok(stat.isDirectory(), '.claude-plugin/commands/ must be a directory');
  });

  for (const cmd of CORE_PLUGIN_COMMANDS) {
    it(`${cmd}.md exists in .claude-plugin/commands/`, async () => {
      const filePath = path.join(COMMANDS_DIR, `${cmd}.md`);
      const exists = await fs.access(filePath).then(() => true).catch(() => false);
      assert.ok(exists, `.claude-plugin/commands/${cmd}.md must exist`);
    });
  }
});

// ── Command frontmatter validation ────────────────────────────────────────────

describe('.claude-plugin/commands/ — frontmatter validation', () => {
  for (const cmd of CORE_PLUGIN_COMMANDS) {
    it(`${cmd}.md has name: danteforge-${cmd} frontmatter`, async () => {
      const filePath = path.join(COMMANDS_DIR, `${cmd}.md`);
      const content = await fs.readFile(filePath, 'utf8').catch(() => '');
      const fm = parseFrontmatter(content);
      assert.equal(
        fm['name'],
        `danteforge-${cmd}`,
        `${cmd}.md must have frontmatter name: danteforge-${cmd} (got: ${fm['name']})`,
      );
    });

    it(`${cmd}.md has a non-empty description in frontmatter`, async () => {
      const filePath = path.join(COMMANDS_DIR, `${cmd}.md`);
      const content = await fs.readFile(filePath, 'utf8').catch(() => '');
      const fm = parseFrontmatter(content);
      assert.ok(
        typeof fm['description'] === 'string' && fm['description'].length > 10,
        `${cmd}.md must have a meaningful description in frontmatter`,
      );
    });

    it(`${cmd}.md has CLI parity line`, async () => {
      const filePath = path.join(COMMANDS_DIR, `${cmd}.md`);
      const content = await fs.readFile(filePath, 'utf8').catch(() => '');
      assert.ok(
        content.includes('CLI parity:') || content.includes('danteforge '),
        `${cmd}.md must reference CLI parity (danteforge ${cmd} command)`,
      );
    });
  }
});

// ── Namespace safety ──────────────────────────────────────────────────────────

describe('.claude-plugin/commands/ — namespace safety', () => {
  it('all plugin commands use danteforge- prefix to avoid conflicts', async () => {
    const files = await fs.readdir(COMMANDS_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    for (const file of mdFiles) {
      const content = await fs.readFile(path.join(COMMANDS_DIR, file), 'utf8');
      const fm = parseFrontmatter(content);
      if (!fm['name']) continue; // skip files without frontmatter
      assert.ok(
        fm['name'].startsWith('danteforge-'),
        `${file}: name "${fm['name']}" must start with "danteforge-" to avoid Claude Code namespace collisions`,
      );
    }
  });

  it('plugin command count meets minimum threshold (11 core + existing)', async () => {
    const files = await fs.readdir(COMMANDS_DIR);
    const mdFiles = files.filter(f => f.endsWith('.md'));
    assert.ok(
      mdFiles.length >= 11,
      `Expected at least 11 plugin commands, found ${mdFiles.length}`,
    );
  });
});
