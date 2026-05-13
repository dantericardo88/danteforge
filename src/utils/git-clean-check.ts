// git-clean-check.ts — Pre-flight dirty-tree probe shared across CLIs.
//
// Reuses the `git status --porcelain` pattern from autoresearch.ts but
// returns a structured result so callers can print the dirty file list
// directly to the user instead of just saying "dirty".

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface CleanTreeReport {
  /** True when working tree has no modified, staged, or untracked files. */
  clean: boolean;
  /** Files with un-staged or staged modifications (porcelain `M`/`A`/`D`/`R`). */
  modified: string[];
  /** Files untracked by git (porcelain `?`). */
  untracked: string[];
  /**
   * `null` when git itself failed (no repo, missing binary, etc). Callers
   * treat this as non-blocking — the matrix flow doesn't require git, it
   * just refuses to dispatch *against* a dirty git tree if one exists.
   */
  error: string | null;
}

export type GitPorcelainFn = (cwd: string) => Promise<string>;

const defaultGit: GitPorcelainFn = async (cwd) => {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], {
    cwd,
    timeout: 30_000,
    env: process.env,
  });
  return stdout;
};

/**
 * Probe the working tree at `cwd` and return what (if anything) is dirty.
 * Never throws — git failures collapse to `{ clean: true, error }` so a
 * caller in a non-git context can decide whether to proceed.
 */
export async function isCleanWorkTree(
  cwd: string,
  _git: GitPorcelainFn = defaultGit,
): Promise<CleanTreeReport> {
  let raw: string;
  try {
    raw = await _git(cwd);
  } catch (err) {
    return {
      clean: true,
      modified: [],
      untracked: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return { clean: true, modified: [], untracked: [], error: null };
  }
  const modified: string[] = [];
  const untracked: string[] = [];
  for (const line of lines) {
    // Porcelain format: XY <space> path. X = staged, Y = unstaged.
    // `??` = untracked. Everything else counts as modified.
    const code = line.slice(0, 2);
    const path = line.slice(3).trim();
    if (code === '??') untracked.push(path);
    else modified.push(path);
  }
  return {
    clean: false,
    modified,
    untracked,
    error: null,
  };
}
