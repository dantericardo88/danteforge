// Ship Engine - release planning, changelog drafting, commit grouping, and PR content.
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { formatReviewSummary, runParanoidReview, type ReviewResult } from './paranoid-review.js';

const execFileAsync = promisify(execFile);

export type BumpLevel = 'micro' | 'patch' | 'minor' | 'major';

export interface ShipPlan {
  bumpLevel: BumpLevel;
  currentVersion: string;
  newVersion: string;
  changelogEntry: string;
  commitGroups: CommitGroup[];
  reviewResult: ReviewResult;
  prTitle: string;
  prBody: string;
}

export interface CommitGroup {
  message: string;
  files: string[];
  type: 'infrastructure' | 'models' | 'controllers' | 'version-changelog';
}

export interface ShipOptions {
  cwd: string;
  dryRun?: boolean;
  skipReview?: boolean;
  branch?: string;
}

export async function buildShipPlan(cwd: string, _dryRun: boolean): Promise<ShipPlan> {
  const diffScope = await getReleaseDiffScope(cwd);
  const linesChanged = countChangedLines(diffScope.diffText);
  const reviewResult = runParanoidReview(diffScope.diffText);
  const bumpLevel = autoDecideBumpLevel(linesChanged);
  const currentVersion = await getCurrentVersion(cwd);
  const newVersion = computeNewVersion(currentVersion, bumpLevel);
  const changelogEntry = await generateChangelog(cwd, diffScope.baseRef);
  const commitGroups = await splitCommits(cwd, diffScope.baseRef);
  const prTitle = `Release ${newVersion}`;
  const prBody = buildPRBody(newVersion, changelogEntry, reviewResult);

  return {
    bumpLevel,
    currentVersion,
    newVersion,
    changelogEntry,
    commitGroups,
    reviewResult,
    prTitle,
    prBody,
  };
}

export function autoDecideBumpLevel(linesChanged: number): BumpLevel {
  if (linesChanged < 50) return 'micro';
  return 'patch';
}

function computeNewVersion(current: string, bump: BumpLevel): string {
  const parts = current.replace(/^v/, '').split('.').map(Number);
  const [major = 0, minor = 0, patch = 0] = parts;

  switch (bump) {
    case 'major': return `${major + 1}.0.0`;
    case 'minor': return `${major}.${minor + 1}.0`;
    case 'patch': return `${major}.${minor}.${patch + 1}`;
    case 'micro': return `${major}.${minor}.${patch + 1}`;
  }
}

export async function generateChangelog(cwd: string, baseRef?: string | null): Promise<string> {
  try {
    const args = baseRef
      ? ['log', '--oneline', '--no-merges', '--format=%h %s', `${baseRef}..HEAD`]
      : ['log', '--oneline', '--no-merges', '-20', '--format=%h %s'];
    const { stdout } = await execFileAsync('git', args, { cwd });
    const lines = stdout.trim().split('\n').filter(line => line.trim());

    if (lines.length === 0) return 'No changes to report.';

    const categories: Record<string, string[]> = {
      features: [],
      fixes: [],
      other: [],
    };

    for (const line of lines) {
      const msg = line.substring(9);
      if (/^feat|^add|^new/i.test(msg)) {
        categories.features.push(msg);
      } else if (/^fix|^bug|^patch/i.test(msg)) {
        categories.fixes.push(msg);
      } else {
        categories.other.push(msg);
      }
    }

    const sections: string[] = [];
    if (categories.features.length > 0) {
      sections.push('### Features');
      for (const entry of categories.features) sections.push(`- ${entry}`);
    }
    if (categories.fixes.length > 0) {
      sections.push('### Fixes');
      for (const entry of categories.fixes) sections.push(`- ${entry}`);
    }
    if (categories.other.length > 0) {
      sections.push('### Other');
      for (const entry of categories.other) sections.push(`- ${entry}`);
    }

    return sections.join('\n');
  } catch {
    return 'Unable to generate changelog from git history.';
  }
}

export async function splitCommits(cwd: string, baseRef?: string | null): Promise<CommitGroup[]> {
  try {
    const files = await listChangedFiles(cwd, baseRef);

    const infra: string[] = [];
    const models: string[] = [];
    const controllers: string[] = [];
    const versionFiles: string[] = [];

    for (const file of files) {
      if (/package\.json|tsconfig|eslint|\.config/i.test(file)) {
        infra.push(file);
      } else if (/model|schema|migration|prisma|entity/i.test(file)) {
        models.push(file);
      } else if (/controller|route|view|page|component/i.test(file)) {
        controllers.push(file);
      } else if (/version|changelog/i.test(file)) {
        versionFiles.push(file);
      } else {
        models.push(file);
      }
    }

    const groups: CommitGroup[] = [];
    if (infra.length > 0) groups.push({ message: 'chore: infrastructure and config updates', files: infra, type: 'infrastructure' });
    if (models.length > 0) groups.push({ message: 'feat: models and services', files: models, type: 'models' });
    if (controllers.length > 0) groups.push({ message: 'feat: controllers and views', files: controllers, type: 'controllers' });
    if (versionFiles.length > 0) groups.push({ message: 'chore: version bump and changelog', files: versionFiles, type: 'version-changelog' });

    return groups;
  } catch {
    return [];
  }
}

export async function createPR(plan: ShipPlan, cwd: string, branch = 'main'): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'create', '--title', plan.prTitle, '--body', plan.prBody, '--base', branch],
      { cwd },
    );
    return stdout.trim();
  } catch (error) {
    throw new Error(`Failed to create PR: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function getDiff(cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', 'HEAD'], { cwd });
    return stdout;
  } catch {
    return '';
  }
}

async function getReleaseDiffScope(cwd: string): Promise<{ baseRef: string | null; diffText: string }> {
  const baseRef = await resolveReleaseBase(cwd);
  const committedDiff = baseRef ? await getRangeDiff(cwd, `${baseRef}..HEAD`) : '';
  const workingTreeDiff = await getDiff(cwd);
  const parts = [committedDiff.trim(), workingTreeDiff.trim()].filter(Boolean);

  return {
    baseRef,
    diffText: parts.join('\n'),
  };
}

async function resolveReleaseBase(cwd: string): Promise<string | null> {
  const latestTag = await getGitOutput(cwd, ['describe', '--tags', '--abbrev=0']);
  if (latestTag) {
    return latestTag;
  }

  const previousCommit = await getGitOutput(cwd, ['rev-parse', '--verify', 'HEAD~1']);
  if (previousCommit) {
    return 'HEAD~1';
  }

  return null;
}

async function listChangedFiles(cwd: string, baseRef?: string | null): Promise<string[]> {
  const files = new Set<string>();

  if (baseRef) {
    const committedFiles = await getGitOutput(cwd, ['diff', '--name-only', `${baseRef}..HEAD`]);
    for (const file of committedFiles.split(/\r?\n/).filter(Boolean)) {
      files.add(file);
    }
  }

  const workingFiles = await getGitOutput(cwd, ['diff', '--name-only', 'HEAD']);
  for (const file of workingFiles.split(/\r?\n/).filter(Boolean)) {
    files.add(file);
  }

  return [...files];
}

async function getRangeDiff(cwd: string, range: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', ['diff', range], { cwd });
    return stdout;
  } catch {
    return '';
  }
}

async function getGitOutput(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd });
    return stdout.trim();
  } catch {
    return '';
  }
}

function countChangedLines(diffText: string): number {
  let count = 0;
  for (const line of diffText.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) count++;
    if (line.startsWith('-') && !line.startsWith('---')) count++;
  }
  return count;
}

async function getCurrentVersion(cwd: string): Promise<string> {
  try {
    const pkgPath = path.join(cwd, 'package.json');
    const content = await fs.readFile(pkgPath, 'utf8');
    const pkg = JSON.parse(content) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function buildPRBody(version: string, changelog: string, review: ReviewResult): string {
  const lines: string[] = [
    `## Release ${version}`,
    '',
    '### Summary',
    changelog,
    '',
    formatReviewSummary(review),
    '',
    '### Test Plan',
    '- [ ] `npm run verify` passes',
    '- [ ] `npm run build` succeeds',
    '- [ ] All new tests pass',
    '- [ ] No anti-stub patterns in source',
    '',
    '---',
    '*Generated by DanteForge Ship Engine*',
  ];
  return lines.join('\n');
}
