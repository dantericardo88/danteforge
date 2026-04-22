// Atomic Git commits — safe, focused commit operations
import { simpleGit } from 'simple-git';
import { logger } from '../core/logger.js';

const git = simpleGit();

export async function atomicCommit(
  message: string,
  options?: { _git?: { add(pattern: string): Promise<void>; commit(msg: string): Promise<void> } },
) {
  const g = options?._git ?? git;
  await g.add('.');
  await g.commit(`[DanteForge] ${message}`);
  logger.success(`Atomic commit: ${message}`);
}

/**
 * Return a list of files changed in the working tree relative to HEAD.
 * Uses `git diff --name-only HEAD` — captures both staged and unstaged changes.
 * Falls back to an empty array when git is unavailable or the directory is not a repo.
 */
export async function getChangedFiles(
  cwd: string,
  opts?: { _git?: { raw(args: string[]): Promise<string> } },
): Promise<string[]> {
  try {
    const g = opts?._git ?? simpleGit({ baseDir: cwd });
    const output = await g.raw(['diff', '--name-only', 'HEAD']);
    return output.split('\n').map(l => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}
