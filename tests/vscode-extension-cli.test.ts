import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-vscode-test-'));
  tempRoots.push(root);
  return root;
}

describe('VS Code CLI discovery', () => {
  it('prefers a workspace-local DanteForge binary when present', async () => {
    const workspace = await makeWorkspace();
    const localBin = path.join(workspace, 'node_modules', '.bin', 'danteforge.cmd');
    await fs.mkdir(path.dirname(localBin), { recursive: true });
    await fs.writeFile(localBin, '@echo off', 'utf8');

    const { resolveDanteForgeCommand } = await import('../vscode-extension/src/cli-discovery.js');
    const command = resolveDanteForgeCommand(workspace, 'win32');

    assert.strictEqual(command, localBin);
  });

  it('falls back to the global DanteForge binary when no workspace-local binary exists', async () => {
    const workspace = await makeWorkspace();
    const globalBinDir = path.join(await makeWorkspace(), 'bin');
    const globalBin = path.join(globalBinDir, 'danteforge');
    await fs.mkdir(globalBinDir, { recursive: true });
    await fs.writeFile(globalBin, '#!/bin/sh\n', 'utf8');

    const { resolveDanteForgeCommand } = await import('../vscode-extension/src/cli-discovery.js');
    const command = resolveDanteForgeCommand(workspace, 'linux', globalBinDir);

    assert.strictEqual(command, 'danteforge');
  });

  it('reports a missing installation when no local or PATH binary exists', async () => {
    const workspace = await makeWorkspace();
    const { inspectDanteForgeInstallation } = await import('../vscode-extension/src/cli-discovery.js');
    const result = inspectDanteForgeInstallation(workspace, 'linux', '');

    assert.strictEqual(result.status, 'missing');
    assert.match(result.installHint, /npm link/);
  });

  it('detects a PATH-installed DanteForge binary', async () => {
    const workspace = await makeWorkspace();
    const globalBinDir = path.join(await makeWorkspace(), 'bin');
    const globalBin = path.join(globalBinDir, 'danteforge');
    await fs.mkdir(globalBinDir, { recursive: true });
    await fs.writeFile(globalBin, '#!/bin/sh\n', 'utf8');

    const { inspectDanteForgeInstallation } = await import('../vscode-extension/src/cli-discovery.js');
    const result = inspectDanteForgeInstallation(workspace, 'linux', globalBinDir);

    assert.strictEqual(result.status, 'global');
    assert.strictEqual(result.command, 'danteforge');
  });
});

describe('VS Code shell safety helpers', () => {
  it('builds a safe specify subcommand payload for extension command dispatch', async () => {
    const { buildSpecifySubcommand } = await import('../vscode-extension/src/shell-safety.js');
    const subcommand = buildSpecifySubcommand('ship "trustworthy" local mode && verify');

    assert.match(subcommand, /^specify "/);
    assert.doesNotMatch(subcommand, /&&/);
  });
});
