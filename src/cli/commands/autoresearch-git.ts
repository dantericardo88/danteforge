// autoresearch-git — the git/working-tree plumbing for the autoresearch loop. Every hard-won fix from
// the fleet's collateral saga lives here: trim-robust porcelain parsing (DanteCode off-by-one),
// scoped untracked cleanup (no --allow-dirty over-deletion), pre-existing-untracked snapshot/restore
// (agent deletions), and experiment-only commit staging with --no-verify (no commit pollution, no hook
// rejection). Extracted from autoresearch.ts to keep the command under the file-size standard.

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { runGit } from '../../core/git-safe.js';

export type GitFn = (args: string[], cwd: string) => Promise<string>;

// All git operations route through the shared git-safe helper: mutating verbs are serialized
// cross-process and clear a stale index.lock, fixing the harden-crusade --parallel index-lock
// deadlock (concurrent workers racing the shared .git). Read-only verbs run directly.
export const git: GitFn = (args, cwd) => runGit(args, cwd);

// ── Isolation pinning (the fleet-run-2 leak) ─────────────────────────────────
// In --isolate mode the worktree is where ALL git must run — but a git seam captured BEFORE
// isolation was threaded into the setup/loop/rollback/commit closures, and on DanteCode a closure
// addressing the ORIGINAL cwd ran `git reset --hard` against the OPERATOR'S MAIN TREE while the
// experiment edits happened in the worktree: two uncommitted fixes wiped, and a surviving child
// kept re-reverting their edits for minutes. Two structural defenses live here:
//   1. bindGitToCwd — every invocation is pinned to the worktree no matter what cwd a caller
//      passes, so a misbound closure can no longer address the user's tree at all.
//   2. assertGitTargetNotUserTree — a loud assertion at the reset/rollback call sites: mutating
//      the user's tree under isolation is the bug itself, worth crashing on, never executing.

/** Wrap a GitFn so EVERY invocation runs in `boundCwd` (the isolated worktree), regardless of the
 *  cwd the caller passes. A caller that asks for a different cwd gets repinned with a warning that
 *  names the leak; constructing the pin against the user's own tree is refused outright. */
export function bindGitToCwd(baseGit: GitFn, boundCwd: string, userCwd: string): GitFn {
  const bound = path.resolve(boundCwd);
  const user = path.resolve(userCwd);
  if (bound === user) {
    throw new Error(
      `[autoresearch] isolation pin refused: the worktree path resolves to the user's tree (${user}) — ` +
      'isolation would be a no-op and git mutations would hit the operator\'s checkout.',
    );
  }
  return (args, requestedCwd) => {
    if (path.resolve(requestedCwd) !== bound) {
      logger.warn(
        `[autoresearch] isolation pin: \`git ${args.join(' ')}\` requested cwd ${requestedCwd} — ` +
        `repinned to the worktree ${bound} (a pre-isolation git closure survived; see the fleet-run-2 leak).`,
      );
    }
    return baseGit(args, bound);
  };
}

/** Defense in depth at the destructive call sites: when isolation is active (`userCwd` set), a git
 *  mutation aimed at the user's original cwd throws loudly instead of resetting the wrong tree. */
export function assertGitTargetNotUserTree(targetCwd: string, userCwd: string | undefined, operation: string): void {
  if (!userCwd) return; // isolation off — the user's tree IS the legitimate target
  if (path.resolve(targetCwd) === path.resolve(userCwd)) {
    throw new Error(
      `[autoresearch] ISOLATION LEAK: refused to run \`${operation}\` against the user's tree (${userCwd}) ` +
      'while --isolate is active. This is the fleet-run-2 bug where a pre-isolation git closure reset the ' +
      'operator\'s checkout and re-reverted their uncommitted work.',
    );
  }
}

export async function gitIsDirty(cwd: string, gitFn: GitFn = git): Promise<boolean> {
  try {
    const status = await gitFn(['status', '--porcelain'], cwd);
    return status.trim().length > 0;
  } catch {
    return false;
  }
}

export async function gitBranchExists(branch: string, cwd: string, gitFn: GitFn = git): Promise<boolean> {
  try {
    await gitFn(['rev-parse', '--verify', branch], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function gitCurrentHash(cwd: string, gitFn: GitFn = git): Promise<string> {
  return gitFn(['rev-parse', 'HEAD'], cwd);
}

export async function gitCreateBranch(branch: string, cwd: string, gitFn: GitFn = git): Promise<void> {
  if (await gitBranchExists(branch, cwd, gitFn)) {
    logger.warn(`Branch ${branch} already exists — checking it out.`);
    await gitFn(['checkout', branch], cwd);
  } else {
    await gitFn(['checkout', '-b', branch], cwd);
  }
}

export async function gitResetHard(hash: string, cwd: string, gitFn: GitFn = git): Promise<void> {
  await gitFn(['reset', '--hard', hash], cwd);
}

// Strip a porcelain-v1 status prefix to get the path. Format is "XY path" (2 status cols + 1 space =
// 3 chars). BUT runGit returns stdout.trim(), so the FIRST line loses its leading space when status
// col-0 is a space (" M path" -> "M path"), shifting its prefix to 2 chars; a blind .slice(3) then
// eats one path char ("packages/x" -> "ackages/x") and the parse-gate reads a wrong path (DanteCode).
// Detect the prefix length per-line from where the single separator space actually sits.
export function stripPorcelainPrefix(line: string): string {
  if (line[2] === ' ') return line.slice(3); // normal "XY path"
  if (line[1] === ' ') return line.slice(2); // first line, leading space trimmed: "Y path"
  return line.slice(3);
}

// The set of untracked paths right now (porcelain `??` lines), excluding our own .danteforge/ artifacts.
export async function gitUntracked(cwd: string, gitFn: GitFn = git): Promise<Set<string>> {
  try {
    const out = await gitFn(['status', '--porcelain'], cwd);
    const set = new Set<string>();
    for (const raw of out.split('\n')) {
      const l = raw.replace(/\r$/, '');
      if (!l.startsWith('??')) continue;
      const p = stripPorcelainPrefix(l).replace(/^"|"$/g, '');
      if (p && !p.startsWith('.danteforge/')) set.add(p);
    }
    return set;
  } catch { return new Set(); }
}

// Remove ONLY the untracked files THIS experiment created — never pre-existing ones. `git reset --hard`
// reverts tracked files only, so a discarded experiment that CREATED files leaves untracked junk
// (DanteSecurity: 18 hallucinated .py files). But a blanket `git clean -fd` deletes ALL untracked
// files, which under --allow-dirty wiped 19 unrelated files outside .danteforge (DanteCode). So diff
// the post-rollback untracked set against the pre-experiment snapshot and clean only the new paths.
export async function gitCleanCreatedUntracked(cwd: string, preUntracked: Set<string>, gitFn: GitFn = git): Promise<void> {
  const created = [...await gitUntracked(cwd, gitFn)].filter(p => !preUntracked.has(p));
  if (created.length === 0) return;
  try { await gitFn(['clean', '-fd', '--', ...created], cwd); } catch { /* best-effort */ }
}

// Roll a discarded/broken experiment fully back: revert tracked changes AND remove only the untracked
// junk IT created, leaving everything that existed before the experiment exactly as it was.
export async function rollbackExperiment(hash: string, preUntracked: Set<string>, cwd: string, gitFn: GitFn = git): Promise<void> {
  try { await gitResetHard(hash, cwd, gitFn); } catch (err) { logger.warn(`Rollback reset failed: ${err instanceof Error ? err.message : String(err)}`); }
  await gitCleanCreatedUntracked(cwd, preUntracked, gitFn);
}

const UNTRACKED_BACKUP_MAX_BYTES = 256 * 1024;
const UNTRACKED_BACKUP_MAX_FILES = 200;

// Best-effort content backup of the user's PRE-EXISTING untracked files. A coding agent has a shell and
// will delete conspicuous untracked files (proven: a root sentinel removed mid-experiment), and
// `git reset --hard` cannot restore an untracked deletion — so without a backup it is lost forever.
// Capped so a tree littered with many/large untracked files doesn't blow up I/O. (.danteforge/ is
// already excluded by gitUntracked.) The real guarantee is worktree isolation; this is the interim net.
export async function snapshotUntracked(cwd: string, untracked: Set<string>): Promise<Map<string, string>> {
  const backup = new Map<string, string>();
  if (untracked.size > UNTRACKED_BACKUP_MAX_FILES) {
    logger.warn(`[autoresearch] ${untracked.size} pre-existing untracked files — too many to back up; agent deletions of them cannot be auto-restored. Consider --no-agent or a clean tree.`);
    return backup;
  }
  for (const rel of untracked) {
    try {
      const abs = path.resolve(cwd, rel);
      const st = await fs.stat(abs);
      if (!st.isFile() || st.size > UNTRACKED_BACKUP_MAX_BYTES) continue;
      backup.set(rel, await fs.readFile(abs, 'utf8'));
    } catch { /* symlink/dir/unreadable — skip */ }
  }
  return backup;
}

// Re-create any backed-up pre-existing untracked file the experiment deleted. Only restores MISSING
// files — never clobbers one still present (so a kept experiment's own edits are untouched).
export async function restoreDeletedUntracked(cwd: string, backup: Map<string, string>): Promise<void> {
  for (const [rel, content] of backup) {
    const abs = path.resolve(cwd, rel);
    try { await fs.access(abs); } catch {
      try { await fs.mkdir(path.dirname(abs), { recursive: true }); await fs.writeFile(abs, content, 'utf8'); }
      catch { /* best-effort */ }
    }
  }
}

// Commit ONLY the experiment's own paths. `git add -A` swept all pre-existing untracked files into a
// kept commit — a 1-line fix produced a 156-file / +10k-line commit (DanteAgents). Stage an explicit
// pathspec of what the experiment actually changed instead.
//
// --no-verify is intentional: this is a scratch experiment commit on a throwaway autoresearch branch,
// validated by the capability_test (the real gate), not the target repo's pre-commit hook. Without it,
// a repo with an anti-stub/format hook silently REJECTS the commit and the kept win is lost (DanteCode).
// A winning experiment promoted to a real branch later re-runs the hooks normally.
export async function gitCommitPaths(message: string, paths: string[], cwd: string, gitFn: GitFn = git): Promise<string> {
  if (paths.length > 0) await gitFn(['add', '--', ...paths], cwd);
  await gitFn(['commit', '--allow-empty', '--no-verify', '-m', message], cwd);
  return gitCurrentHash(cwd, gitFn);
}

// What an experiment ACTUALLY changed in the working tree — the single source of truth for the guards.
// The coding agent (Tier 2) picks its own files, so we can't trust a declared `fileToChange`; we read
// `git status` instead. Renames take the new path; our own .danteforge/ artifacts are ignored.
export async function gitChangedFiles(cwd: string, gitFn: GitFn = git): Promise<string[]> {
  try {
    const out = await gitFn(['status', '--porcelain'], cwd);
    return out.split('\n')
      .map(l => l.replace(/\r$/, ''))
      .filter(l => l.trim().length > 0)
      .map(l => stripPorcelainPrefix(l).replace(/^"|"$/g, '')) // trim-robust prefix strip
      .map(l => (l.includes(' -> ') ? l.split(' -> ')[1]! : l))
      .filter(f => f && !f.startsWith('.danteforge/'));
  } catch { return []; }
}
