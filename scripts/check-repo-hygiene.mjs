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

// Specific files inside forbidden directories that are intentionally tracked.
// These are canonical project artifacts that must be committed alongside source.
const allowedTrackedFiles = new Set([
  '.danteforge/compete/matrix.json',
  '.danteforge/agent-guard.json',
  '.danteforge/agent-ownership.json',
  '.danteforge/test-config.json',
  '.danteforge/protected-lines.json',
  '.danteforge/challenges.json',
  '.danteforge/challenges.md',
  '.danteforge/PRIME.md',
  '.danteforge/ADVERSARIAL_EVALUATION.md',
  '.danteforge/EXECUTION_GAP_CLOSURE.md',
  '.danteforge/agent-claims/.gitkeep',
  '.danteforge/score-proposals/.gitkeep',
  '.danteforge/dimension-claims/.gitkeep',
  '.danteforge/capability-tests/orphan_audit.sh',
  '.danteforge/capability-tests/recency_check.sh',
]);

// Canonical tracked SUBTREES — the versioned competition + proof spine. Receipts
// under outcome-evidence/ must be committed so `check:proof-integrity` can validate
// them against git history. Generated caches and run reports (reports/, research/,
// *_REPORT.md, *-report.json, FRONTIER_PROGRESS.*, ASCEND_REPORT.md, …) are
// deliberately NOT listed here, so newly-committed junk is still caught.
const allowedTrackedPrefixes = [
  '.danteforge/compete/', // matrix + universe rubrics + score ladders
  '.danteforge/outcome-evidence/', // the committed outcome-receipt spine
  '.danteforge/universe/',
];

function isAllowedTracked(path) {
  if (allowedTrackedFiles.has(path)) return true;
  return allowedTrackedPrefixes.some((prefix) => path.startsWith(prefix));
}

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

  const tracked = trackedEntries(pathname).filter(p => !isAllowedTracked(p));
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
