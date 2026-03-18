import fs from 'node:fs';
import path from 'node:path';

export interface DanteForgeInstallation {
  status: 'workspace' | 'global' | 'missing';
  command: string;
  installHint: string;
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

function getExecutableCandidates(platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return ['danteforge.cmd', 'danteforge.exe', 'danteforge.bat'];
  }
  return ['danteforge'];
}

function findWorkspaceBinary(workspaceRoot: string | undefined, platform: NodeJS.Platform): string | undefined {
  if (!workspaceRoot) {
    return undefined;
  }

  for (const candidate of getExecutableCandidates(platform)) {
    const localBinary = path.join(workspaceRoot, 'node_modules', '.bin', candidate);
    if (fs.existsSync(localBinary)) {
      return localBinary;
    }
  }

  return undefined;
}

function pathContainsBinary(envPath: string, platform: NodeJS.Platform): boolean {
  if (!envPath) {
    return false;
  }

  const pathEntries = envPath
    .split(path.delimiter)
    .map(entry => entry.trim())
    .filter(Boolean);

  for (const entry of pathEntries) {
    for (const candidate of getExecutableCandidates(platform)) {
      if (fs.existsSync(path.join(entry, candidate))) {
        return true;
      }
    }
  }

  return false;
}

export function inspectDanteForgeInstallation(
  workspaceRoot?: string,
  platform: NodeJS.Platform = process.platform,
  envPath = process.env.PATH ?? '',
): DanteForgeInstallation {
  const workspaceBinary = findWorkspaceBinary(workspaceRoot, platform);
  if (workspaceBinary) {
    return {
      status: 'workspace',
      command: quoteIfNeeded(workspaceBinary),
      installHint: 'Workspace-local DanteForge binary found.',
    };
  }

  if (pathContainsBinary(envPath, platform)) {
    return {
      status: 'global',
      command: 'danteforge',
      installHint: 'Global DanteForge binary found on PATH.',
    };
  }

  return {
    status: 'missing',
    command: 'danteforge',
    installHint: [
      'Install DanteForge first.',
      'From this repo: npm ci && npm run verify:all && npm link',
      'Or install it in the workspace so the extension can use node_modules/.bin/danteforge.',
    ].join(' '),
  };
}

export function resolveDanteForgeCommand(
  workspaceRoot?: string,
  platform: NodeJS.Platform = process.platform,
  envPath = process.env.PATH ?? '',
): string {
  return inspectDanteForgeInstallation(workspaceRoot, platform, envPath).command;
}
