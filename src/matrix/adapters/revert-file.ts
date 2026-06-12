// revert-file.ts — the ONE shared lease-violation revert used by all council adapters.
//
// Previously each adapter carried an identical private copy with a fatal fallback: when
// `git checkout -- <file>` failed for ANY reason, the file was unlinked. The fallback was
// designed for untracked files (nothing to restore → delete the new file), but checkout can
// also fail transiently (index lock held by a concurrent writer, mid-edit file locks). In run
// 3i that deleted a COMMITTED source file (src/core/frontier-plan.ts) from the working tree.
// Deletion is now gated on the file being PROVABLY untracked; a tracked file that cannot be
// checked out is reported, never destroyed.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function defaultRevertFile(cwd: string, file: string): Promise<void> {
  try {
    await execFileAsync('git', ['checkout', '--', file], { cwd, timeout: 5000 });
    return;
  } catch { /* fall through: untracked file, or a transient git failure */ }
  const tracked = await execFileAsync('git', ['ls-files', '--error-unmatch', '--', file], { cwd, timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (tracked) {
    throw new Error(`revert of TRACKED file "${file}" failed (transient git error?) — refusing to delete it; restore manually with: git checkout -- ${file}`);
  }
  try { await fs.unlink(path.join(cwd, file)); } catch { /* best-effort for untracked files */ }
}
