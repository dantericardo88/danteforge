// Unit tests for the filesystem detectors that drive ecosystemMcp self-bootstrapping.
// Pass 8 — ecosystemMcp Trio Closure (Phase A).

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  detectSkillCountSync,
  detectPluginManifestSync,
  detectMcpToolCountSync,
  computeEcosystemMcpScore,
} from '../src/core/harsh-scorer.js';
import type { DanteState } from '../src/core/state.js';

function makeTempRepo(): string {
  return mkdtempSync(join(tmpdir(), 'dfg-eco-'));
}

test('detectSkillCountSync — counts SKILL.md across canonical dirs', () => {
  const cwd = makeTempRepo();
  try {
    const skillsDir = join(cwd, 'src', 'harvested', 'dante-agents', 'skills');
    mkdirSync(join(skillsDir, 'alpha'), { recursive: true });
    mkdirSync(join(skillsDir, 'beta'), { recursive: true });
    writeFileSync(join(skillsDir, 'alpha', 'SKILL.md'), '---\nname: alpha\n---\n');
    writeFileSync(join(skillsDir, 'beta', 'SKILL.md'), '---\nname: beta\n---\n');
    // Empty subdir should not count
    mkdirSync(join(skillsDir, 'empty'), { recursive: true });
    assert.equal(detectSkillCountSync(cwd), 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('detectSkillCountSync — counts packages/*/SKILL.md (monorepo style)', () => {
  const cwd = makeTempRepo();
  try {
    mkdirSync(join(cwd, 'packages', 'pkg1'), { recursive: true });
    mkdirSync(join(cwd, 'packages', 'pkg2'), { recursive: true });
    writeFileSync(join(cwd, 'packages', 'pkg1', 'SKILL.md'), '---\nname: pkg1\n---\n');
    writeFileSync(join(cwd, 'packages', 'pkg2', 'SKILL.md'), '---\nname: pkg2\n---\n');
    assert.equal(detectSkillCountSync(cwd), 2);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('detectSkillCountSync — returns 0 for empty repo', () => {
  const cwd = makeTempRepo();
  try {
    assert.equal(detectSkillCountSync(cwd), 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('detectPluginManifestSync — true when .claude-plugin/plugin.json exists', () => {
  const cwd = makeTempRepo();
  try {
    mkdirSync(join(cwd, '.claude-plugin'), { recursive: true });
    writeFileSync(join(cwd, '.claude-plugin', 'plugin.json'), '{}');
    assert.equal(detectPluginManifestSync(cwd), true);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('detectPluginManifestSync — false when missing', () => {
  const cwd = makeTempRepo();
  try {
    assert.equal(detectPluginManifestSync(cwd), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('detectMcpToolCountSync — reads explicit signal file', () => {
  const cwd = makeTempRepo();
  try {
    mkdirSync(join(cwd, '.danteforge'), { recursive: true });
    writeFileSync(join(cwd, '.danteforge', 'mcp-tool-count.txt'), '42\n');
    assert.equal(detectMcpToolCountSync(cwd), 42);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('detectMcpToolCountSync — greps src/core/mcp-server.ts for name: keys', () => {
  const cwd = makeTempRepo();
  try {
    mkdirSync(join(cwd, 'src', 'core'), { recursive: true });
    const content = `
const TOOLS = [
  {
    name: 'tool_one',
    description: 'A',
  },
  {
    name: 'tool_two',
    description: 'B',
  },
  {
    name: 'tool_three',
    description: 'C',
  },
];
`;
    writeFileSync(join(cwd, 'src', 'core', 'mcp-server.ts'), content);
    assert.equal(detectMcpToolCountSync(cwd), 3);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('detectMcpToolCountSync — falls back to registerTool() count', () => {
  const cwd = makeTempRepo();
  try {
    mkdirSync(join(cwd, 'packages', 'mcp-server', 'src'), { recursive: true });
    const content = `
server.registerTool({ name: 'a' });
server.registerTool({ name: 'b' });
server.registerTool({ name: 'c' });
server.registerTool({ name: 'd' });
server.registerTool({ name: 'e' });
`;
    writeFileSync(join(cwd, 'packages', 'mcp-server', 'src', 'index.ts'), content);
    // The name: regex should find 5 matches before the fallback registerTool path runs
    assert.equal(detectMcpToolCountSync(cwd), 5);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('detectMcpToolCountSync — returns 0 for empty repo', () => {
  const cwd = makeTempRepo();
  try {
    assert.equal(detectMcpToolCountSync(cwd), 0);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('computeEcosystemMcpScore — state values take precedence over fs detection', () => {
  const cwd = makeTempRepo();
  try {
    // Filesystem says 0 / no plugin / 0 tools, but state explicitly says 20 / true / 30
    const state = {
      skillCount: 20,
      hasPluginManifest: true,
      mcpToolCount: 30,
      providerCount: 6,
    } as unknown as DanteState;
    const score = computeEcosystemMcpScore(state, cwd);
    // 30 + 25 (skills 10+) + 20 (tools 15+) + 15 (plugin) + 10 (providers 5+) = 100
    assert.equal(score, 100);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('computeEcosystemMcpScore — falls back to fs when state lacks signals', () => {
  const cwd = makeTempRepo();
  try {
    // Build a fully-equipped repo on disk
    const skillsDir = join(cwd, 'src', 'harvested', 'dante-agents', 'skills');
    for (const name of ['s1','s2','s3','s4','s5','s6','s7','s8','s9','s10','s11']) {
      mkdirSync(join(skillsDir, name), { recursive: true });
      writeFileSync(join(skillsDir, name, 'SKILL.md'), '---\nname: '+name+'\n---\n');
    }
    mkdirSync(join(cwd, '.claude-plugin'), { recursive: true });
    writeFileSync(join(cwd, '.claude-plugin', 'plugin.json'), '{}');
    mkdirSync(join(cwd, '.danteforge'), { recursive: true });
    writeFileSync(join(cwd, '.danteforge', 'mcp-tool-count.txt'), '20');

    const emptyState = {} as DanteState;
    const score = computeEcosystemMcpScore(emptyState, cwd);
    // 30 + 25 (11 skills) + 20 (20 tools) + 15 (plugin) + 10 (providers default 5) = 100
    assert.equal(score, 100);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('computeEcosystemMcpScore — empty state + empty repo returns base + provider default', () => {
  const cwd = makeTempRepo();
  try {
    const emptyState = {} as DanteState;
    const score = computeEcosystemMcpScore(emptyState, cwd);
    // 30 (base) + 0 (no skills) + 0 (no tools) + 0 (no plugin) + 10 (provider default 5) = 40
    assert.equal(score, 40);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('computeEcosystemMcpScore — explicit state.skillCount=0 honored over fs detection', () => {
  const cwd = makeTempRepo();
  try {
    // Build fs evidence
    const skillsDir = join(cwd, 'src', 'harvested', 'dante-agents', 'skills');
    mkdirSync(join(skillsDir, 'a'), { recursive: true });
    writeFileSync(join(skillsDir, 'a', 'SKILL.md'), '---\nname: a\n---\n');
    // But state explicitly says 0 → should honor state
    const state = { skillCount: 0 } as unknown as DanteState;
    const score = computeEcosystemMcpScore(state, cwd);
    // 30 + 0 (state.skillCount=0) + 0 (no mcp file) + 0 (no plugin) + 10 (provider default) = 40
    assert.equal(score, 40);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
