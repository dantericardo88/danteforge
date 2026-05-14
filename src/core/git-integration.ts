// git-integration.ts — Stage/commit, branch, and PR helpers with injection seams
import path from 'path';
import type { DanteState } from './state.js';
import { logGitOperation, generateCorrelationId } from './structured-audit.js';

// ─── PR Activity & Issue Detection ────────────────────────────────────────────

export interface PRActivityEntry {
  branch: string;
  commits: number;
  lastCommit: string;
}

export interface ReferencedIssue {
  issueNumber: number;
  commitHash: string;
  commitMessage: string;
}

type ExecFn = (cmd: string, args: string[], cwd: string) => Promise<string>;

async function defaultExec(cmd: string, args: string[], cwd: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    const { stdout } = await execFileAsync(cmd, args, { cwd });
    return stdout.trim();
  } catch {
    return '';
  }
}

/**
 * Read local branch activity by inspecting recent git log entries per branch.
 * Uses pure local git — no GitHub API key required.
 * @param repoPath - directory to run git commands in (defaults to cwd)
 * @param _exec - injection seam for testing
 */
export async function getRecentPRActivity(
  repoPath?: string,
  _exec?: ExecFn,
): Promise<PRActivityEntry[]> {
  const dir = repoPath ?? process.cwd();
  const exec = _exec ?? defaultExec;

  // List all local branches
  const branchOutput = await exec('git', ['branch', '--format=%(refname:short)'], dir);
  if (!branchOutput) return [];

  const branches = branchOutput
    .split('\n')
    .map(b => b.trim())
    .filter(Boolean);

  const results: PRActivityEntry[] = [];

  for (const branch of branches) {
    // Count commits on this branch not on main/master
    const countOutput = await exec(
      'git',
      ['rev-list', '--count', `main..${branch}`, '--'],
      dir,
    ).catch(() => '');

    const altCountOutput = countOutput
      ? countOutput
      : await exec('git', ['rev-list', '--count', `master..${branch}`, '--'], dir).catch(() => '');

    const commits = parseInt(altCountOutput || '0', 10);

    // Get the last commit message on this branch
    const lastCommit = await exec(
      'git',
      ['log', '-1', '--format=%s', branch, '--'],
      dir,
    ).catch(() => '');

    results.push({
      branch,
      commits: Number.isFinite(commits) ? commits : 0,
      lastCommit: lastCommit || '',
    });
  }

  return results;
}

/**
 * Detect GitHub issue references in recent commits using git log.
 * Parses "Fixes #NNN", "Closes #NNN", "Refs #NNN" patterns from commit messages.
 * @param repoPath - directory to run git commands in (defaults to cwd)
 * @param _exec - injection seam for testing
 */
export async function getOpenIssues(
  repoPath?: string,
  _exec?: ExecFn,
): Promise<ReferencedIssue[]> {
  const dir = repoPath ?? process.cwd();
  const exec = _exec ?? defaultExec;

  // Read last 20 commits that mention issue references
  const logOutput = await exec(
    'git',
    ['log', '--oneline', '-n', '20', '--'],
    dir,
  );

  if (!logOutput) return [];

  const lines = logOutput.split('\n').filter(Boolean);
  const issuePattern = /(?:fixes?|closes?|refs?)\s+#(\d+)/gi;
  const results: ReferencedIssue[] = [];

  for (const line of lines) {
    const parts = line.split(' ');
    const commitHash = parts[0] ?? '';
    const commitMessage = parts.slice(1).join(' ');

    let match: RegExpExecArray | null;
    issuePattern.lastIndex = 0;
    while ((match = issuePattern.exec(commitMessage)) !== null) {
      const issueNumber = parseInt(match[1], 10);
      if (Number.isFinite(issueNumber)) {
        results.push({ issueNumber, commitHash, commitMessage });
      }
    }
  }

  return results;
}

// ─── Git Stats & Health ────────────────────────────────────────────────────────

export interface GitIntegrationStats {
  remoteUrl: string;
  branch: string;
  hasUncommittedChanges: boolean;
  commitCount: number;
  lastCommitHash: string;
  lastCommitDate: string;
}

/**
 * Gather repository statistics by shelling out to git.
 * Returns safe defaults when git is unavailable or cwd is not a repository.
 */
export async function getGitStats(cwd?: string): Promise<GitIntegrationStats> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const dir = cwd ?? process.cwd();

  const run = async (args: string[]): Promise<string> => {
    try {
      const { stdout } = await execFileAsync('git', args, { cwd: dir });
      return stdout.trim();
    } catch {
      return '';
    }
  };

  const [remoteUrl, branch, statusOutput, countOutput, hashOutput, dateOutput] =
    await Promise.all([
      run(['remote', 'get-url', 'origin']),
      run(['rev-parse', '--abbrev-ref', 'HEAD']),
      run(['status', '--porcelain']),
      run(['rev-list', '--count', 'HEAD']),
      run(['rev-parse', '--short', 'HEAD']),
      run(['log', '-1', '--format=%cI']),
    ]);

  const commitCount = countOutput ? parseInt(countOutput, 10) : 0;

  return {
    remoteUrl: remoteUrl || '',
    branch: branch || 'unknown',
    hasUncommittedChanges: statusOutput.length > 0,
    commitCount: Number.isFinite(commitCount) ? commitCount : 0,
    lastCommitHash: hashOutput || '',
    lastCommitDate: dateOutput || '',
  };
}

/**
 * Validate that the repository is in a healthy state for integration purposes.
 * Checks for: clean working tree, remote configured, and recent commits.
 */
export async function validateGitHealth(
  cwd?: string,
): Promise<{ ok: boolean; issues: string[] }> {
  const stats = await getGitStats(cwd);
  const issues: string[] = [];

  if (stats.hasUncommittedChanges) {
    issues.push('Working tree has uncommitted changes');
  }
  if (!stats.remoteUrl) {
    issues.push('No remote "origin" configured');
  }
  if (stats.commitCount === 0) {
    issues.push('Repository has no commits');
  }
  if (stats.branch === 'unknown' || stats.branch === 'HEAD') {
    issues.push('Not on a named branch (detached HEAD or unborn branch)');
  }

  return { ok: issues.length === 0, issues };
}

export interface CommitMessageOptions {
  state: DanteState;
  changedFiles?: string[];
  prefix?: string; // override auto-detected type
}

export interface PRBodyOptions {
  spec?: string;   // content of SPEC.md
  plan?: string;   // content of PLAN.md
  tasks?: string;  // content of TASKS.md
  project: string;
  phase: number;
}

export interface SimpleGitLike {
  add(files: string[]): Promise<unknown>;
  commit(message: string): Promise<{ commit: string }>;
  checkoutLocalBranch(name: string): Promise<void>;
  status(): Promise<{ files: Array<{ path: string }> }>;
}

export interface GitIntegrationOptions {
  cwd?: string;
  _git?: SimpleGitLike;
  _readFile?: (p: string) => Promise<string>;
  _exists?: (p: string) => Promise<boolean>;
  filesToStage?: string[];
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string, maxLen: number): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLen)
    .replace(/-+$/, '');
}

// ─── Pure functions ────────────────────────────────────────────────────────────

/**
 * Generate a conventional-commit message from current DanteForge state.
 * Pure function — no I/O.
 */
export function generateCommitMessage(opts: CommitMessageOptions): string {
  const { state } = opts;

  let type: string;
  if (opts.prefix) {
    type = opts.prefix;
  } else {
    switch (state.workflowStage) {
      case 'forge':
        type = 'feat';
        break;
      case 'verify':
        type = 'test';
        break;
      case 'plan':
      case 'tasks':
      case 'specify':
      case 'clarify':
        type = 'docs';
        break;
      default:
        type = 'chore';
    }
  }

  const scope = slugify(state.project, 20);
  const taskName = state.tasks?.[state.currentPhase]?.[0]?.name ?? state.workflowStage;
  const taskSlug = slugify(taskName, 50);

  return `${type}(${scope}): ${taskSlug}`;
}

/**
 * Generate a git branch name from current DanteForge state.
 * Pure function — no I/O.
 */
export function generateBranchName(state: DanteState): string {
  const projectSlug = slugify(state.project, 30);
  const phase = state.currentPhase;
  const taskName = state.tasks?.[state.currentPhase]?.[0]?.name ?? 'task';
  const taskSlug = slugify(taskName, 40);

  // Build each segment separately so double-dashes don't cross boundaries
  const segments = [projectSlug, `${phase}-${taskSlug}`].map(s =>
    s.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, ''),
  );

  return `danteforge/${segments[0]}/${segments[1]}`;
}

/**
 * Generate a PR body markdown string.
 * Pure async function — no I/O.
 */
export async function generatePRBody(opts: PRBodyOptions): Promise<string> {
  const specContent = opts.spec ? opts.spec.slice(0, 500) : 'No spec available';
  const planContent = opts.plan ? opts.plan.slice(0, 500) : 'No plan available';
  const tasksContent = opts.tasks ? opts.tasks.slice(0, 500) : 'No tasks available';

  return [
    `## Summary\n${specContent}`,
    `## Changes\n${planContent}`,
    `## Tasks\n${tasksContent}`,
    `## Quality\nPhase: ${opts.phase}\nProject: ${opts.project}`,
    `\n---\n🤖 Generated by DanteForge`,
  ].join('\n\n');
}

// ─── Async operations ──────────────────────────────────────────────────────────

async function resolveGit(opts: GitIntegrationOptions | undefined): Promise<SimpleGitLike> {
  if (opts?._git) return opts._git;
  const { simpleGit } = await import('simple-git');
  return simpleGit({ baseDir: opts?.cwd ?? process.cwd() }) as unknown as SimpleGitLike;
}

/**
 * Stage all changed files and commit with a task-derived message.
 */
export async function stageAndCommit(
  state: DanteState,
  opts?: GitIntegrationOptions,
): Promise<{ committed: boolean; message: string; filesStaged: number }> {
  const correlationId = generateCorrelationId();
  try {
    const git = await resolveGit(opts);
    let changedFiles: string[];
    if (opts?.filesToStage && opts.filesToStage.length > 0) {
      changedFiles = opts.filesToStage;
    } else {
      const statusResult = await git.status();
      changedFiles = statusResult.files.map(f => f.path);
    }
    await git.add(changedFiles);
    const message = generateCommitMessage({ state, changedFiles });
    await git.commit(message);
    logGitOperation('commit', correlationId, 'success', opts?.cwd);
    return { committed: true, message, filesStaged: changedFiles.length };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logGitOperation('commit', correlationId, 'failure', opts?.cwd);
    return { committed: false, message, filesStaged: 0 };
  }
}

/**
 * Create a new git branch named after the current task.
 */
export async function createTaskBranch(
  state: DanteState,
  opts?: GitIntegrationOptions,
): Promise<{ created: boolean; branchName: string }> {
  const branchName = generateBranchName(state);
  try {
    const git = await resolveGit(opts);
    await git.checkoutLocalBranch(branchName);
    return { created: true, branchName };
  } catch {
    return { created: false, branchName };
  }
}

/**
 * Open a PR via the `gh` CLI, generating the body from DanteForge artifacts.
 * Falls back gracefully when `gh` is not available.
 */
export async function openPullRequest(
  state: DanteState,
  opts?: GitIntegrationOptions & { baseBranch?: string; draft?: boolean },
): Promise<{ url: string; prNumber: number }> {
  const cwd = opts?.cwd ?? process.cwd();

  // Read artifacts best-effort
  const readFile = opts?._readFile ?? (async (p: string) => {
    const { readFile: fsReadFile } = await import('node:fs/promises');
    return fsReadFile(p, 'utf-8');
  });

  const tryRead = async (relativePath: string): Promise<string | undefined> => {
    try {
      return await readFile(path.join(cwd, relativePath));
    } catch {
      return undefined;
    }
  };

  const [spec, plan, tasks] = await Promise.all([
    tryRead('.danteforge/SPEC.md'),
    tryRead('.danteforge/PLAN.md'),
    tryRead('.danteforge/TASKS.md'),
  ]);

  const body = await generatePRBody({
    spec,
    plan,
    tasks,
    project: state.project,
    phase: state.currentPhase,
  });

  const branchName = generateBranchName(state);
  const title = generateCommitMessage({ state });

  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    const args = ['pr', 'create', '--title', title, '--body', body];
    if (opts?.baseBranch) args.push('--base', opts.baseBranch);
    if (opts?.draft) args.push('--draft');
    args.push('--head', branchName);

    const { stdout } = await execFileAsync('gh', args, { cwd });
    const url = stdout.trim().split('\n').find(l => l.startsWith('http')) ?? stdout.trim();
    const match = url.match(/\/pull\/(\d+)/);
    const prNumber = match ? parseInt(match[1], 10) : 0;
    return { url, prNumber };
  } catch {
    return { url: 'not-created', prNumber: 0 };
  }
}
