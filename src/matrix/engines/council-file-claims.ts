// Matrix Kernel — CouncilFileClaims
//
// Prevents two council members from touching the same files in the same round.
// When a builder's worktree changes are detected, their files are "claimed".
// Subsequent builders with overlapping files are rejected from the merge court
// for those files — their worktree changes are isolated, not merged.
//
// Claims are per-round and must be reset via clear() before each new round.
export type CouncilMemberId = 'codex' | 'gemini-cli' | 'grok-build' | 'claude-code';

export interface FileClaim {
  memberId: CouncilMemberId;
  files: ReadonlySet<string>;
}

export interface ClaimConflict {
  file: string;
  claimedBy: CouncilMemberId;
}

export interface ClaimResult {
  accepted: string[];
  rejected: string[];
  conflicts: ClaimConflict[];
}

/**
 * Per-round file-claim registry.
 * Call `clear()` at the start of each round; `claim()` as each builder's
 * worktree diff is scanned; `hasConflict()` to gate the merge court.
 */
export class FileClaims {
  private readonly claimedFiles = new Map<string, CouncilMemberId>();

  /**
   * Attempt to claim `files` on behalf of `memberId`.
   * Files already claimed by another member are returned in `rejected`.
   * Successfully claimed files are returned in `accepted`.
   */
  claim(memberId: CouncilMemberId, files: string[]): ClaimResult {
    const accepted: string[] = [];
    const rejected: string[] = [];
    const conflicts: ClaimConflict[] = [];

    for (const file of files) {
      const existing = this.claimedFiles.get(file);
      if (existing !== undefined && existing !== memberId) {
        rejected.push(file);
        conflicts.push({ file, claimedBy: existing });
      } else {
        this.claimedFiles.set(file, memberId);
        accepted.push(file);
      }
    }
    return { accepted, rejected, conflicts };
  }

  /** Returns true if any of the given files are claimed by a different member. */
  hasConflict(memberId: CouncilMemberId, files: string[]): boolean {
    return files.some(f => {
      const owner = this.claimedFiles.get(f);
      return owner !== undefined && owner !== memberId;
    });
  }

  /** List all current claims as { file, memberId } entries (debugging / logging). */
  snapshot(): Array<{ file: string; memberId: CouncilMemberId }> {
    return [...this.claimedFiles.entries()].map(([file, memberId]) => ({ file, memberId }));
  }

  /** Clear all claims for the next round. */
  clear(): void {
    this.claimedFiles.clear();
  }

  get size(): number {
    return this.claimedFiles.size;
  }
}
