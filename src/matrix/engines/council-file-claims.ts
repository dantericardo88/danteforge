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
  slotId?: string;
  files: ReadonlySet<string>;
}

export interface ClaimConflict {
  file: string;
  claimedBy: CouncilMemberId;
  claimedBySlotId?: string;
}

export interface ClaimResult {
  accepted: string[];
  rejected: string[];
  conflicts: ClaimConflict[];
}

interface ClaimEntry {
  memberId: CouncilMemberId;
  slotId?: string;
}

/** True when an existing claim conflicts with a new claim from (memberId, slotId). */
function isSlotConflict(existing: ClaimEntry, memberId: CouncilMemberId, slotId?: string): boolean {
  if (existing.memberId !== memberId) return true; // always conflict across members
  // Slot mode: same member, different slot → conflict (independent branches can diverge)
  if (slotId !== undefined && existing.slotId !== undefined && existing.slotId !== slotId) return true;
  return false;
}

/**
 * Per-round file-claim registry.
 * Call `clear()` at the start of each round; `claim()` as each builder's
 * worktree diff is scanned; `hasConflict()` to gate the merge court.
 *
 * Slot-aware conflict rule: in slot mode (both caller and existing claim have
 * slotId), ANY different slot — including same-member — constitutes a conflict.
 * Independent branches from the same member can still diverge and conflict.
 * Without slotId (non-slot mode), only cross-member conflicts are flagged.
 */
export class FileClaims {
  private readonly claimedFiles = new Map<string, ClaimEntry>();

  /**
   * Attempt to claim `files` on behalf of `memberId` / `slotId`.
   * Conflict = different member OR (slot mode AND different slot).
   */
  claim(memberId: CouncilMemberId, files: string[], slotId?: string): ClaimResult {
    const accepted: string[] = [];
    const rejected: string[] = [];
    const conflicts: ClaimConflict[] = [];

    for (const file of files) {
      const existing = this.claimedFiles.get(file);
      if (existing !== undefined && isSlotConflict(existing, memberId, slotId)) {
        rejected.push(file);
        conflicts.push({ file, claimedBy: existing.memberId, claimedBySlotId: existing.slotId });
      } else {
        this.claimedFiles.set(file, { memberId, slotId });
        accepted.push(file);
      }
    }
    return { accepted, rejected, conflicts };
  }

  /**
   * Returns true if any of the given files are claimed by a conflicting slot.
   * In slot mode: same-member different-slot IS a conflict.
   * In non-slot mode: only cross-member conflicts are flagged.
   */
  hasConflict(memberId: CouncilMemberId, files: string[], slotId?: string): boolean {
    return files.some(f => {
      const owner = this.claimedFiles.get(f);
      return owner !== undefined && isSlotConflict(owner, memberId, slotId);
    });
  }

  /** List all current claims as { file, memberId, slotId } entries (debugging / logging). */
  snapshot(): Array<{ file: string; memberId: CouncilMemberId; slotId?: string }> {
    return [...this.claimedFiles.entries()].map(([file, entry]) => ({
      file, memberId: entry.memberId, slotId: entry.slotId,
    }));
  }

  /** Clear all claims for the next round. */
  clear(): void {
    this.claimedFiles.clear();
  }

  get size(): number {
    return this.claimedFiles.size;
  }
}
