import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { listDriftScanFiles, resolveCommandCheckLaunch } from '../src/cli/commands/verify.js';
import {
  inspectCommandCheckReceiptFreshness,
  writeCommandCheckReceipt,
} from '../src/core/command-check-receipts.js';

async function withTempRepo(fn: (cwd: string) => Promise<void>): Promise<void> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'df-command-check-'));
  try {
    await fs.writeFile(
      path.join(cwd, 'package.json'),
      JSON.stringify({
        name: 'df-command-check-test',
        version: '1.0.0',
        type: 'module',
        scripts: {
          test: 'node -e "process.exit(0)"',
          build: 'node -e "process.exit(0)"',
        },
      }, null, 2),
      'utf8',
    );
    await fs.writeFile(path.join(cwd, '.gitignore'), '.danteforge/\n', 'utf8');
    execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'DanteForge Tests'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'tests@example.com'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['add', '.'], { cwd, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'seed'], { cwd, stdio: 'ignore' });
    await fn(cwd);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

describe('resolveCommandCheckLaunch', () => {
  it('uses npm_execpath when available on non-Windows hosts', () => {
    const launch = resolveCommandCheckLaunch('npm test', {
      platform: 'linux',
      env: { npm_execpath: 'C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\npm\\bin\\npm-cli.js' } as NodeJS.ProcessEnv,
      nodeExecPath: 'C:\\Program Files\\nodejs\\node.exe',
    });

    assert.deepStrictEqual(launch, {
      executable: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\npm\\bin\\npm-cli.js', 'test'],
      shell: false,
    });
  });

  it('uses the PowerShell wrapper for npm commands on Windows', () => {
    const launch = resolveCommandCheckLaunch('npm run build', {
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows' } as NodeJS.ProcessEnv,
      nodeExecPath: 'C:\\Program Files\\nodejs\\node.exe',
    });

    assert.strictEqual(launch.executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.deepStrictEqual(launch.args.slice(0, 5), [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
    ]);
    assert.match(launch.args[6] ?? '', /npm run build/);
    assert.match(launch.args[6] ?? '', /\*>\s*\$null/);
    assert.strictEqual(launch.shell, false);
  });
});

describe('inspectCommandCheckReceiptFreshness', () => {
  it('reports a worktree mismatch when tracked files changed after the receipt was written', async () => {
    await withTempRepo(async (cwd) => {
      await writeCommandCheckReceipt({
        id: 'test',
        command: 'npm test',
        status: 'pass',
      }, cwd);

      await fs.writeFile(
        path.join(cwd, 'package.json'),
        JSON.stringify({
          name: 'df-command-check-test',
          version: '1.0.1',
          type: 'module',
          scripts: {
            test: 'node -e "process.exit(0)"',
            build: 'node -e "process.exit(0)"',
          },
        }, null, 2),
        'utf8',
      );

      const freshness = await inspectCommandCheckReceiptFreshness('test', 'npm test', cwd);
      assert.equal(freshness.freshReceipt, null);
      assert.equal(freshness.reason, 'worktree_mismatch');
    });
  });
});

describe('listDriftScanFiles', () => {
  it('uses HEAD as the drift baseline and returns current worktree paths only', async () => {
    let receivedArgs: string[] | null = null;
    const files = await listDriftScanFiles('C:\\Projects\\DanteForge', async (_cwd, args) => {
      receivedArgs = args;
      return 'src/core/drift-detector.ts\nsrc/cli/commands/verify.ts\n';
    });

    assert.deepStrictEqual(receivedArgs, ['diff', '--name-only', 'HEAD', '--', 'src/']);
    assert.deepStrictEqual(files, [
      'src/core/drift-detector.ts',
      'src/cli/commands/verify.ts',
    ]);
  });
});
