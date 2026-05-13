// Matrix Kernel — Ownership Map types (PRD §9.5 substrate, §22 Merge Court input)
// Wraps the existing .danteforge/agent-ownership.json schema.

export type OwnershipMode =
  | 'exclusive'        // only one workstream may write
  | 'shared'           // multiple workstreams may write with conflict tracking
  | 'frozen'           // platform-kernel only
  | 'protected'        // requires human approval
  | 'public';          // any workstream may write (rare)

export interface OwnershipClaim {
  workstream: string;            // e.g. "scoring", "autonomy-loop", "platform-kernel"
  ownedPaths: string[];          // glob-style
  sharedPaths?: string[];        // shared with other workstreams; warn on overlap
  description?: string;
}

export interface OwnershipMap {
  version: number;
  generatedAt: string;
  globalAllowed: string[];       // paths anyone may touch
  workstreams: Record<string, OwnershipClaim>;
  frozenFiles: string[];         // mirror of agent-guard.json frozenFiles
}

// ── Validation ──────────────────────────────────────────────────────────────

export function isOwnershipClaim(value: unknown): value is OwnershipClaim {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.workstream === 'string' && Array.isArray(v.ownedPaths);
}

export function isOwnershipMap(value: unknown): value is OwnershipMap {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.workstreams !== 'object' || v.workstreams === null) return false;
  if (!Array.isArray(v.frozenFiles)) return false;
  for (const claim of Object.values(v.workstreams as Record<string, unknown>)) {
    if (!isOwnershipClaim(claim)) return false;
  }
  return true;
}
