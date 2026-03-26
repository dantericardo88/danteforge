import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempRoots: string[] = [];
const tsxCli = path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs');
const cliEntry = path.resolve('src', 'cli', 'index.ts');

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-config-cli-test-'));
  const cwd = path.join(root, 'project');
  const home = path.join(root, 'home');
  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(home, { recursive: true });
  tempRoots.push(root);
  return { cwd, home };
}

function runCli(cwd: string, home: string, args: string[]) {
  return runCliWithEnv(cwd, home, args);
}

function runCliWithEnv(cwd: string, home: string, args: string[], extraEnv: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [tsxCli, cliEntry, ...args], {
    cwd,
    env: {
      ...process.env,
      DANTEFORGE_HOME: home,
      ...extraEnv,
    },
    encoding: 'utf8',
  });

  return {
    status: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

describe('config and assistant setup cli', () => {
  it('config --show reports the shared user-level config scope and path', async () => {
    const { cwd, home } = await makeWorkspace();

    const result = runCli(cwd, home, ['config', '--show']);
    assert.strictEqual(result.status, 0, result.stderr);

    const output = result.stdout + result.stderr;
    assert.match(output, /Config file:/);
    assert.match(output, /config\.yaml/);
    assert.match(output, /shared across Codex, Claude Code, Gemini\/Antigravity, OpenCode, Cursor, and direct CLI use/i);
  });

  it('setup assistants accepts gemini and open-code aliases and reports the shared config path', async () => {
    const { cwd, home } = await makeWorkspace();

    const result = runCli(cwd, home, ['setup', 'assistants', '--assistants', 'gemini-3.1,open-code,cursor']);
    assert.strictEqual(result.status, 0, result.stderr);

    const output = result.stdout + result.stderr;
    assert.match(output, /antigravity:/i);
    assert.match(output, /opencode:/i);
    assert.match(output, /cursor:/i);
    assert.match(output, /Shared secrets\/config:/i);
    assert.match(output, /doctor --live/i);

    await assert.doesNotReject(() => fs.access(path.join(home, '.gemini', 'antigravity', 'skills', 'test-driven-development', 'SKILL.md')));
    await assert.doesNotReject(() => fs.access(path.join(home, '.gemini', 'antigravity', 'skills', 'danteforge-cli', 'SKILL.md')));
    await assert.doesNotReject(() => fs.access(path.join(home, '.config', 'opencode', 'skills', 'test-driven-development', 'SKILL.md')));
    await assert.doesNotReject(() => fs.access(path.join(cwd, '.cursor', 'rules', 'danteforge.mdc')));
  });

  it('setup assistants defaults to user-level assistant targets and leaves Cursor project files untouched', async () => {
    const { cwd, home } = await makeWorkspace();

    const result = runCli(cwd, home, ['setup', 'assistants']);
    assert.strictEqual(result.status, 0, result.stderr);

    const output = result.stdout + result.stderr;
    assert.match(output, /claude:/i);
    assert.match(output, /codex:/i);
    assert.match(output, /antigravity:/i);
    assert.match(output, /opencode:/i);
    assert.doesNotMatch(output, /cursor:/i);
    assert.match(output, /setup assistants --assistants cursor/i);

    await assert.doesNotReject(() => fs.access(path.join(home, '.claude', 'skills', 'test-driven-development', 'SKILL.md')));
    await assert.doesNotReject(() => fs.access(path.join(home, '.codex', 'skills', 'test-driven-development', 'SKILL.md')));
    await assert.doesNotReject(() => fs.access(path.join(home, '.gemini', 'antigravity', 'skills', 'test-driven-development', 'SKILL.md')));
    await assert.doesNotReject(() => fs.access(path.join(home, '.config', 'opencode', 'skills', 'test-driven-development', 'SKILL.md')));
    await assert.rejects(() => fs.access(path.join(cwd, '.cursor', 'rules', 'danteforge.mdc')));
  });

  it('setup ollama explains host-native model usage and missing local runtime clearly', async () => {
    const { cwd, home } = await makeWorkspace();

    const result = runCliWithEnv(cwd, home, ['setup', 'ollama', '--host', 'codex'], {
      PATH: '',
    });
    assert.strictEqual(result.status, 0, result.stderr);

    const output = result.stdout + result.stderr;
    assert.match(output, /Native codex workflows already use the host model\/session/i);
    assert.match(output, /Install Ollama from https:\/\/ollama\.com\/download/i);
    assert.match(output, /Recommended spend-saver model: qwen2\.5-coder:7b/i);
  });
});
