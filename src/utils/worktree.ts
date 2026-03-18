// Git Worktree management — isolated parallel workspaces for agent execution
import { simpleGit } from 'simple-git';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../core/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve from the module location, not cwd — works in both dev (src/utils/) and bundled (dist/) mode
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const WORKTREE_BASE = path.resolve(PROJECT_ROOT, '..', '.danteforge-worktrees');

const git = simpleGit();

/**
 * Create an isolated worktree for an agent
 */
export async function createAgentWorktree(agentName: string): Promise<string> {
  const worktreePath = path.join(WORKTREE_BASE, agentName);
  const branchName = `danteforge/${agentName}`;

  // Ensure the worktrees base directory exists
  await fs.mkdir(WORKTREE_BASE, { recursive: true });

  // Ensure worktrees directory is gitignored
  await ensureWorktreesIgnored();

  logger.info(`Creating worktree for agent "${agentName}" at ${worktreePath}...`);

  try {
    await git.raw(['worktree', 'add', worktreePath, '-b', branchName]);
    logger.success(`Worktree created: ${worktreePath} (branch: ${branchName})`);
    return worktreePath;
  } catch (err) {
    // Branch may already exist — try without -b
    try {
      await git.raw(['worktree', 'add', worktreePath, branchName]);
      logger.success(`Worktree created (existing branch): ${worktreePath}`);
      return worktreePath;
    } catch (innerErr) {
      throw new Error(`Failed to create worktree for "${agentName}": ${innerErr instanceof Error ? innerErr.message : String(innerErr)}`);
    }
  }
}

/**
 * Remove an agent's worktree after completion
 */
export async function removeAgentWorktree(agentName: string): Promise<void> {
  const worktreePath = path.join(WORKTREE_BASE, agentName);

  try {
    await git.raw(['worktree', 'remove', worktreePath, '--force']);
    logger.success(`Worktree removed: ${worktreePath}`);
  } catch (err) {
    logger.warn(`Could not remove worktree "${agentName}": ${err instanceof Error ? err.message : String(err)}`);
  }

  // Try to delete the branch
  const branchName = `danteforge/${agentName}`;
  try {
    await git.raw(['branch', '-d', branchName]);
  } catch {
    // Branch may have unmerged changes — leave it
  }
}

/**
 * List all active DanteForge worktrees
 */
export async function listWorktrees(): Promise<{ path: string; branch: string }[]> {
  try {
    const result = await git.raw(['worktree', 'list', '--porcelain']);
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

/**
 * Ensure the worktrees directory is in .gitignore
 */
export async function ensureWorktreesIgnored(): Promise<void> {
  const gitignorePath = path.join(PROJECT_ROOT, '.gitignore');
  const ignoreEntry = '../.danteforge-worktrees/';

  try {
    const content = await fs.readFile(gitignorePath, 'utf8');
    if (content.includes('.danteforge-worktrees')) return;

    await fs.appendFile(gitignorePath, `\n# DanteForge agent worktrees\n${ignoreEntry}\n`);
    logger.info('Added .danteforge-worktrees/ to .gitignore');
  } catch {
    // .gitignore doesn't exist or can't be read — skip
  }
}

/**
 * Ensure intermediate .op files from agent worktrees are gitignored.
 * Only the final, verifier-approved DESIGN.op should be committed to main.
 * Intermediate artifacts (*.op.raw, *.op.wip, agent-generated .op files outside
 * .danteforge/) are excluded to prevent repository bloat from large JSON diffs.
 */
export async function ensureOPIntermediatesIgnored(): Promise<void> {
  const gitignorePath = path.join(PROJECT_ROOT, '.gitignore');
  const marker = '# DanteForge .op intermediates';

  try {
    const content = await fs.readFile(gitignorePath, 'utf8');
    if (content.includes(marker)) return;

    const entries = [
      '',
      marker,
      '*.op.raw',
      '*.op.wip',
      '.danteforge/design-preview.html',
    ].join('\n') + '\n';

    await fs.appendFile(gitignorePath, entries);
    logger.info('Added .op intermediate patterns to .gitignore');
  } catch {
    // .gitignore doesn't exist or can't be read — skip
  }
}
