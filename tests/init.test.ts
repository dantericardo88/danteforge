import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) await fs.rm(root, { recursive: true, force: true });
  }
});

function runCli(cwd: string, home: string, args: string[]) {
  const tsxCli = path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs');
  const cliEntry = path.resolve('src', 'cli', 'index.ts');
  return spawnSync(process.execPath, [tsxCli, cliEntry, ...args], {
    cwd,
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      DANTEFORGE_HOME: home,
      NODE_ENV: 'test',
    },
    encoding: 'utf8',
    timeout: 15_000,
  });
}

describe('danteforge init', () => {
  it('exports the init function', async () => {
    const { init } = await import('../src/cli/commands/init.js');
    assert.strictEqual(typeof init, 'function');
  });

  it('detects project type and shows guidance', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-init-'));
    tempRoots.push(root);
    const cwd = path.join(root, 'project');
    const home = path.join(root, 'home');
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(home, { recursive: true });
    // Write a minimal package.json so detectProjectType has something to read
    await fs.writeFile(path.join(cwd, 'package.json'), '{"name":"test"}');

    const result = runCli(cwd, home, ['init']);
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    assert.strictEqual(result.status, 0, `Exit code: ${result.status}\n${output}`);
    assert.match(output, /Detected project type/i);
    assert.match(output, /danteforge/i); // shows some command guidance
  });

  it('warns when .danteforge/ already exists', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-init-'));
    tempRoots.push(root);
    const cwd = path.join(root, 'project');
    const home = path.join(root, 'home');
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.mkdir(home, { recursive: true });

    const result = runCli(cwd, home, ['init']);
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    assert.strictEqual(result.status, 0, `Exit code: ${result.status}\n${output}`);
    assert.match(output, /already exists/i);
  });

  it('shows step-by-step path when LLM is not available', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-init-'));
    tempRoots.push(root);
    const cwd = path.join(root, 'project');
    const home = path.join(root, 'home');
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(home, { recursive: true });

    const result = runCli(cwd, home, ['init']);
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    assert.strictEqual(result.status, 0, `Exit code: ${result.status}\n${output}`);
    // Should show some guidance commands
    assert.match(output, /danteforge (magic|spark|help)/i);
    assert.match(output, /Setup complete/i);
  });
});

describe('help grouping', () => {
  it('shows command groups in --help output', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-help-'));
    tempRoots.push(root);
    const cwd = path.join(root, 'project');
    const home = path.join(root, 'home');
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(home, { recursive: true });

    const result = runCli(cwd, home, ['--help']);
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    assert.strictEqual(result.status, 0, `Exit code: ${result.status}\n${output}`);
    assert.match(output, /Command Groups:/);
    assert.match(output, /Pipeline:/);
    assert.match(output, /Automation:/);
    assert.match(output, /Intelligence:/);
    assert.match(output, /Tools:/);
    assert.match(output, /Meta:/);
  });
});

describe('docs command', () => {
  it('exports the docs function', async () => {
    const { docs } = await import('../src/cli/commands/docs.js');
    assert.strictEqual(typeof docs, 'function');
  });

  it('generates COMMAND_REFERENCE.md in a temp workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'df-docs-'));
    tempRoots.push(root);
    const cwd = path.join(root, 'project');
    const home = path.join(root, 'home');
    await fs.mkdir(cwd, { recursive: true });
    await fs.mkdir(home, { recursive: true });

    const result = runCli(cwd, home, ['docs']);
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    assert.strictEqual(result.status, 0, `Exit code: ${result.status}\n${output}`);

    const refPath = path.join(cwd, 'docs', 'COMMAND_REFERENCE.md');
    const content = await fs.readFile(refPath, 'utf8');
    assert.match(content, /DanteForge Command Reference/);
    assert.match(content, /Pipeline/);
    assert.match(content, /danteforge init/);
    assert.match(content, /danteforge forge/);
    assert.match(content, /danteforge harvest/);
  });
});
