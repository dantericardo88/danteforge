import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  detectAssistant,
  harnessStatus,
  generateBrief,
  mcpHealth,
  type Assistant,
} from '../src/cli/commands/harness.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFs(present: Set<string>) {
  return {
    _exists: async (p: string) => present.has(p),
    _readFile: async (p: string) => {
      if (p.endsWith('STATE.yaml')) {
        return 'project: testproj\nworkflowStage: tasks\n';
      }
      throw new Error(`ENOENT: ${p}`);
    },
    _stdout: () => {},
    _writeFile: async () => {},
  };
}

// ── detectAssistant ───────────────────────────────────────────────────────────

describe('detectAssistant', () => {
  it('detects claude-code from ~/.claude/settings.json', async () => {
    const home = '/h';
    const cwd = '/p';
    const present = new Set([path.join(home, '.claude', 'settings.json')]);
    const result = await detectAssistant('claude-code', home, cwd, async (p) => present.has(p));
    assert.equal(result.detected, true);
    assert.ok(result.evidencePath?.includes('.claude'));
  });

  it('detects codex from ~/.codex/config.toml', async () => {
    const home = '/h';
    const cwd = '/p';
    const present = new Set([path.join(home, '.codex', 'config.toml')]);
    const result = await detectAssistant('codex', home, cwd, async (p) => present.has(p));
    assert.equal(result.detected, true);
    assert.equal(result.configPath, path.join(home, '.codex', 'config.toml'));
  });

  it('returns detected=false when no probes match', async () => {
    const result = await detectAssistant('claude-code', '/h', '/p', async () => false);
    assert.equal(result.detected, false);
    assert.equal(result.evidencePath, undefined);
  });

  it('records all matching probes in notes', async () => {
    const home = '/h';
    const cwd = '/p';
    const present = new Set([
      path.join(home, '.claude', 'settings.json'),
      path.join(home, '.claude', 'skills'),
    ]);
    const result = await detectAssistant('claude-code', home, cwd, async (p) => present.has(p));
    assert.equal(result.notes.length, 2);
  });
});

// ── harnessStatus ─────────────────────────────────────────────────────────────

describe('harnessStatus', () => {
  it('returns 0 detected for empty filesystem', async () => {
    const fs = makeFs(new Set());
    const result = await harnessStatus({ cwd: '/p', homeDir: '/h', ...fs });
    assert.equal(result.detectedCount, 0);
    assert.equal(result.forgePresent, false);
    assert.equal(result.detected.length, 3);
  });

  it('detects DanteForge presence', async () => {
    const fs = makeFs(new Set([path.join('/p', '.danteforge')]));
    const result = await harnessStatus({ cwd: '/p', homeDir: '/h', ...fs });
    assert.equal(result.forgePresent, true);
  });

  it('detects all three assistants when present', async () => {
    const present = new Set([
      path.join('/h', '.claude', 'settings.json'),
      path.join('/h', '.codex', 'config.toml'),
      path.join('/h', '.dantecode'),
    ]);
    const fs = makeFs(present);
    const result = await harnessStatus({ cwd: '/p', homeDir: '/h', ...fs });
    assert.equal(result.detectedCount, 3);
    for (const a of result.detected) {
      assert.equal(a.detected, true, `${a.assistant} should be detected`);
    }
  });
});

// ── generateBrief ─────────────────────────────────────────────────────────────

describe('generateBrief', () => {
  it('generates claude-code brief with project + stage from STATE.yaml', async () => {
    const fs = makeFs(new Set([path.join('/p', '.danteforge', 'STATE.yaml')]));
    const result = await generateBrief('claude-code', { cwd: '/p', ...fs });
    assert.ok(result.brief.includes('Claude Code Session Brief'));
    assert.ok(result.brief.includes('testproj'));
    assert.ok(result.brief.includes('tasks'));
  });

  it('generates codex-flavored brief with /spark + /df-verify hints', async () => {
    const fs = makeFs(new Set([path.join('/p', '.danteforge', 'STATE.yaml')]));
    const result = await generateBrief('codex', { cwd: '/p', ...fs });
    assert.ok(result.brief.includes('Codex'));
    assert.ok(result.brief.includes('/spark') || result.brief.includes('/df-verify'));
  });

  it('generates dantecode brief with markdown-link format guidance', async () => {
    const fs = makeFs(new Set([path.join('/p', '.danteforge', 'STATE.yaml')]));
    const result = await generateBrief('dantecode', { cwd: '/p', ...fs });
    assert.ok(result.brief.includes('DanteCode'));
    assert.ok(result.brief.includes('markdown link'));
  });

  it('writes brief to output file when path supplied', async () => {
    const written = new Map<string, string>();
    const present = new Set([path.join('/p', '.danteforge', 'STATE.yaml')]);
    const result = await generateBrief('claude-code', {
      cwd: '/p',
      output: '/p/BRIEF.md',
      _exists: async (p) => present.has(p),
      _readFile: async () => 'project: testproj\nworkflowStage: forge\n',
      _writeFile: async (p, d) => { written.set(p, d); },
      _stdout: () => {},
    });
    assert.equal(result.outputPath, '/p/BRIEF.md');
    assert.ok(written.get('/p/BRIEF.md')?.includes('Claude Code'));
  });

  it('falls back to "initialized" stage when no STATE.yaml', async () => {
    const result = await generateBrief('claude-code', {
      cwd: '/p',
      _exists: async () => false,
      _readFile: async () => { throw new Error('ENOENT'); },
      _stdout: () => {},
    });
    assert.ok(result.brief.includes('initialized'));
  });
});

// ── mcpHealth ─────────────────────────────────────────────────────────────────

describe('mcpHealth', () => {
  it('reports unreachable when no mcp-server file', async () => {
    const result = await mcpHealth({
      cwd: '/p',
      homeDir: '/h',
      _exists: async () => false,
      _readFile: async () => { throw new Error('ENOENT'); },
      _stdout: () => {},
    });
    assert.equal(result.serverReachable, false);
    assert.equal(result.toolCount, 0);
  });

  it('counts server.tool() calls when source readable', async () => {
    const fakeSource = `
      server.tool('a', ...);
      server.tool('b', ...);
      server.tool ( 'c', ...);
    `;
    const result = await mcpHealth({
      cwd: '/p',
      homeDir: '/h',
      _exists: async (p) => p.endsWith('mcp-server.ts'),
      _readFile: async () => fakeSource,
      _stdout: () => {},
    });
    assert.equal(result.serverReachable, true);
    assert.equal(result.toolCount, 3);
  });

  it('detects per-assistant mcp configuration', async () => {
    const present = new Set([
      path.join('/p', 'src', 'core', 'mcp-server.ts'),
      path.join('/p', '.claude', 'mcp.json'),
      path.join('/h', '.codex', 'config.toml'),
    ]);
    const result = await mcpHealth({
      cwd: '/p',
      homeDir: '/h',
      _exists: async (p) => present.has(p),
      _readFile: async () => '',
      _stdout: () => {},
    });
    const claudeCfg = result.perAssistant.find(a => a.assistant === 'claude-code');
    const codexCfg = result.perAssistant.find(a => a.assistant === 'codex');
    const danteCfg = result.perAssistant.find(a => a.assistant === 'dantecode');
    assert.equal(claudeCfg?.mcpConfigured, true);
    assert.equal(codexCfg?.mcpConfigured, true);
    assert.equal(danteCfg?.mcpConfigured, false);
  });
});

// ── per-assistant brief differentiation ───────────────────────────────────────

describe('brief differentiation', () => {
  const assistants: Assistant[] = ['claude-code', 'codex', 'dantecode'];

  it('produces distinct briefs per assistant', async () => {
    const fs = makeFs(new Set([path.join('/p', '.danteforge', 'STATE.yaml')]));
    const briefs = await Promise.all(
      assistants.map(a => generateBrief(a, { cwd: '/p', ...fs })),
    );
    const texts = briefs.map(b => b.brief);
    const uniqueTexts = new Set(texts);
    assert.equal(uniqueTexts.size, 3, 'each assistant must get a distinct brief');
  });
});
