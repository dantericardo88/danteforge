import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const skippedRoots = new Set([
  'node_modules',
  'dist',
  '.danteforge',
  'coverage',
]);

const skippedNestedPaths = new Set([
  path.join('vscode-extension', 'node_modules'),
  path.join('vscode-extension', 'dist'),
  path.join('vscode-extension', '.artifacts'),
]);

export async function createReleaseSandbox(repoRoot, prefix) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const checkoutDir = path.join(tempRoot, 'checkout');
  const homeDir = path.join(tempRoot, 'home');
  const xdgConfigHome = path.join(tempRoot, 'xdg-config');

  await fs.mkdir(checkoutDir, { recursive: true });
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(xdgConfigHome, { recursive: true });
  await copyDirectory(repoRoot, checkoutDir, '');

  return {
    tempRoot,
    checkoutDir,
    homeDir,
    xdgConfigHome,
  };
}

export function releaseEnv(homeDir, xdgConfigHome) {
  const env = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    DANTEFORGE_HOME: homeDir,
  };

  if (process.platform !== 'win32') {
    env.XDG_CONFIG_HOME = xdgConfigHome;
  }

  return env;
}

export function run(command, args, cwd, env) {
  const npmExecPath = process.env.npm_execpath;
  const executable = command === 'npm'
    ? (npmExecPath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm'))
    : process.platform === 'win32'
      ? `${command}.cmd`
      : command;
  const resolvedArgs = command === 'npm'
    ? (npmExecPath ? [npmExecPath, ...args] : args)
    : args;
  const result = spawnSync(executable, resolvedArgs, {
    cwd,
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32' && !npmExecPath,
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit code ${result.status ?? 'unknown'}${
        result.error ? ` (${result.error.message})` : ''
      }`,
    );
  }
}

export async function cleanupSandbox(tempRoot) {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

async function copyDirectory(sourceDir, targetDir, relativeDir) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    if (shouldSkip(relativePath)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(targetPath, { recursive: true });
      await copyDirectory(sourcePath, targetPath, relativePath);
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath);
    }
  }
}

function shouldSkip(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const topLevel = normalized.split('/')[0];
  if (skippedRoots.has(topLevel)) {
    return true;
  }

  for (const skippedPath of skippedNestedPaths) {
    const normalizedSkipped = skippedPath.replaceAll('\\', '/');
    if (normalized === normalizedSkipped || normalized.startsWith(`${normalizedSkipped}/`)) {
      return true;
    }
  }

  return false;
}
