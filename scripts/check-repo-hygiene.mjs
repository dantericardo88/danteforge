import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { execFileSync } from 'node:child_process';

const strictPresence = process.argv.includes('--strict-presence');

const forbiddenPaths = [
  'node_modules',
  'dist',
  '.danteforge',
  'coverage',
  'vscode-extension/node_modules',
  'vscode-extension/dist',
];

async function exists(pathname) {
  try {
    await access(pathname, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function trackedEntries(pathname) {
  try {
    const output = execFileSync('git', ['ls-files', '--', pathname], { encoding: 'utf8' }).trim();
    if (!output) return [];
    return output.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

const problems = [];

for (const pathname of forbiddenPaths) {
  if (strictPresence && await exists(pathname)) {
    problems.push(`Forbidden generated/vendor path exists in repo checkout: ${pathname}`);
  }

  const tracked = trackedEntries(pathname);
  if (tracked.length > 0) {
    problems.push(`Forbidden generated/vendor path is tracked by git: ${pathname}`);
  }
}

if (problems.length > 0) {
  for (const problem of problems) {
    console.error(problem);
  }
  process.exit(1);
}

console.log(`Repo hygiene check passed${strictPresence ? ' (strict presence mode)' : ''}`);
