import { simpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';
import { ensureProjectIgnores } from '../core/project-ignores.js';

const git = simpleGit();

export interface WorktreeGitFn {
  raw: (args: string[]) => Promise<string>;
}

export interface WorktreeFsOps {
  readFile: (p: string, enc: BufferEncoding) => Promise<string>;
  appendFile: (p: string, data: string) => Promise<void>;
  mkdir: (p: string, opts: { recursive: boolean }) => Promise<string | undefined>;
}

export interface WorktreeTestOpts {
  _git?: WorktreeGitFn;
  _fs?: WorktreeFsOps;
  cwd?: string;
  _ensureProjectIgnores?: typeof ensureProjectIgnores;
}

const nodeFsOps: WorktreeFsOps = {
  readFile: (p, enc) => fs.readFile(p, enc) as Promise<string>,
  appendFile: (p, data) => fs.appendFile(p, data),
  mkdir: (p, opts) => fs.mkdir(p, opts),
};

function isGitFn(opts: WorktreeTestOpts | WorktreeGitFn | undefined): opts is WorktreeGitFn {
  return Boolean(opts && 'raw' in opts);
}

function isFsOps(opts: WorktreeTestOpts | WorktreeFsOps | undefined): opts is WorktreeFsOps {
  return Boolean(opts && 'readFile' in opts);
}

function resolveCwd(opts: WorktreeTestOpts | WorktreeGitFn | undefined): string {
  return isGitFn(opts) ? process.cwd() : opts?.cwd ?? process.cwd();
}

function resolveWorktreeBase(cwd: string): string {
  return path.join(cwd, '.danteforge-worktrees');
}

export interface CreateAgentWorktreeOptions extends WorktreeTestOpts {
  /**
   * Explicit branch name. When omitted, `danteforge/<agentName>` is used.
   * Matrix-kernel callers pass the lease's branch (e.g. `matrix/<dim>/<provider>-<short>`)
   * so merge-court can later target the same branch the worktree was created on.
   */
  branch?: string;
  /**
   * Explicit worktree path. When omitted, `<cwd>/.danteforge-worktrees/<agentName>` is used.
   * Use this when the caller (e.g. matrix-kernel `createWorktreeForLease`) already has
   * a stable path for the lease — keeps `lease.worktreePath` and the actual git
   * worktree in sync.
   */
  worktreePath?: string;
}

export async function createAgentWorktree(
  agentName: string,
  opts?: CreateAgentWorktreeOptions | WorktreeGitFn,
): Promise<string> {
  const g = isGitFn(opts) ? opts : opts?._git ?? git;
  const f = isGitFn(opts) ? nodeFsOps : opts?._fs ?? nodeFsOps;
  const cwd = resolveCwd(opts);
  const ensureIgnores = isGitFn(opts) ? null : opts?._ensureProjectIgnores ?? ensureProjectIgnores;
  const worktreeBase = resolveWorktreeBase(cwd);
  const explicit = !isGitFn(opts) ? opts : undefined;
  const worktreePath = explicit?.worktreePath ?? path.join(worktreeBase, agentName);
  const branchName = explicit?.branch ?? `danteforge/${agentName}`;

  await f.mkdir(worktreeBase, { recursive: true });
  if (ensureIgnores) {
    try { await ensureIgnores(cwd); } catch { /* best effort */ }
  }
  await ensureWorktreesIgnored({ _fs: f, cwd });

  logger.info(`Creating worktree for agent "${agentName}" at ${worktreePath} on branch ${branchName}...`);

  try {
    await g.raw(['worktree', 'add', worktreePath, '-b', branchName]);
    logger.success(`Worktree created: ${worktreePath} (branch: ${branchName})`);
    return worktreePath;
  } catch {
    try {
      await g.raw(['worktree', 'add', worktreePath, branchName]);
      logger.success(`Worktree created (existing branch): ${worktreePath}`);
      return worktreePath;
    } catch (innerErr) {
      throw new Error(`Failed to create worktree for "${agentName}": ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`);
    }
  }
}

export async function removeAgentWorktree(
  agentName: string,
  opts?: CreateAgentWorktreeOptions | WorktreeGitFn,
): Promise<void> {
  const g = isGitFn(opts) ? opts : opts?._git ?? git;
  const cwd = resolveCwd(opts);
  const explicit = !isGitFn(opts) ? opts : undefined;
  const worktreePath = explicit?.worktreePath ?? path.join(resolveWorktreeBase(cwd), agentName);
  const branchName = explicit?.branch ?? `danteforge/${agentName}`;

  try {
    await g.raw(['worktree', 'remove', worktreePath, '--force']);
    logger.success(`Worktree removed: ${worktreePath}`);
  } catch (err) {
    logger.warn(`Could not remove worktree "${agentName}": ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    await g.raw(['branch', '-d', branchName]);
  } catch {
    // Branch may have unmerged changes; leave it.
  }
}

export async function listWorktrees(opts?: WorktreeTestOpts | WorktreeGitFn): Promise<{ path: string; branch: string }[]> {
  const g = isGitFn(opts) ? opts : opts?._git ?? git;
  try {
    const result = await g.raw(['worktree', 'list', '--porcelain']);
    const worktrees: { path: string; branch: string }[] = [];
    let currentPath = '';

    for (const line of result.split('\n')) {
      if (line.startsWith('worktree ')) {
        currentPath = line.replace('worktree ', '').trim();
      }
      if (line.startsWith('branch ') && currentPath.includes('.danteforge-worktrees')) {
        worktrees.push({
          path: currentPath,
          branch: line.replace('branch refs/heads/', '').trim(),
        });
      }
    }

    return worktrees;
  } catch {
    return [];
  }
}

export async function createParallelWorktrees(
  agentNames: string[],
  opts?: WorktreeTestOpts | WorktreeGitFn,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const settled = await Promise.allSettled(
    agentNames.map(async (name) => {
      const worktreePath = await createAgentWorktree(name, opts);
      return { name, path: worktreePath };
    }),
  );
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.set(result.value.name, result.value.path);
    } else {
      logger.warn(`[Worktree] Failed to create worktree for ${result.reason}`);
    }
  }
  return results;
}

export async function ensureWorktreesIgnored(opts?: WorktreeTestOpts | WorktreeFsOps): Promise<void> {
  const f = isFsOps(opts) ? opts : opts?._fs ?? nodeFsOps;
  const cwd = isFsOps(opts) ? process.cwd() : opts?.cwd ?? process.cwd();
  const gitignorePath = path.join(cwd, '.gitignore');
  const ignoreEntry = '.danteforge-worktrees/';

  try {
    const content = await f.readFile(gitignorePath, 'utf8');
    if (content.includes('.danteforge-worktrees')) return;

    await f.appendFile(gitignorePath, `\n# DanteForge agent worktrees\n${ignoreEntry}\n`);
    logger.info('Added .danteforge-worktrees/ to .gitignore');
  } catch {
    // .gitignore does not exist or cannot be read; skip.
  }
}

export async function ensureOPIntermediatesIgnored(opts?: WorktreeTestOpts | WorktreeFsOps): Promise<void> {
  const f = isFsOps(opts) ? opts : opts?._fs ?? nodeFsOps;
  const cwd = isFsOps(opts) ? process.cwd() : opts?.cwd ?? process.cwd();
  const gitignorePath = path.join(cwd, '.gitignore');
  const marker = '# DanteForge .op intermediates';

  try {
    const content = await f.readFile(gitignorePath, 'utf8');
    if (content.includes(marker)) return;

    const entries = [
      '',
      marker,
      '*.op.raw',
      '*.op.wip',
      '.danteforge/design-preview.html',
    ].join('\n') + '\n';

    await f.appendFile(gitignorePath, entries);
    logger.info('Added .op intermediate patterns to .gitignore');
  } catch {
    // .gitignore does not exist or cannot be read; skip.
  }
}
