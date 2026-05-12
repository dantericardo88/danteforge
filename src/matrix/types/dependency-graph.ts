// Matrix Kernel — Dependency Graph types (PRD §9.4)
// "Determine what can run now, what must wait, and what can never overlap."

export type DependencyStatus =
  | 'READY'
  | 'BLOCKED_BY_DEPENDENCY'
  | 'WAITING_FOR_CONTRACT'
  | 'WAITING_FOR_MERGE'
  | 'CONFLICTING'
  | 'NEEDS_HUMAN_DECISION'
  | 'MERGE_AFTER'
  | 'SEQUENTIAL_ONLY';

export interface DependencyEdge {
  fromPacketId: string;
  toPacketId: string;
  /** Strength: 'hard' must complete before, 'soft' is a preference. */
  strength: 'hard' | 'soft';
  /** Why this edge exists (e.g. "contract change", "shared file"). */
  reason: string;
}

export interface DependencyNode {
  workPacketId: string;
  status: DependencyStatus;
  blockedBy: string[];                // work packet IDs
  canRunInParallelWith: string[];     // work packet IDs
  cannotRunWith: string[];            // work packet IDs
  mergeAfter: string[];               // work packet IDs whose merge must precede
  /** Optional human-readable explanation when status is NEEDS_HUMAN_DECISION. */
  humanDecisionRequired?: string;
}

export interface DependencyGraph {
  generatedAt: string;
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

// ── Validation ──────────────────────────────────────────────────────────────

const STATUSES: readonly DependencyStatus[] = [
  'READY', 'BLOCKED_BY_DEPENDENCY', 'WAITING_FOR_CONTRACT', 'WAITING_FOR_MERGE',
  'CONFLICTING', 'NEEDS_HUMAN_DECISION', 'MERGE_AFTER', 'SEQUENTIAL_ONLY',
];

export function isDependencyStatus(value: unknown): value is DependencyStatus {
  return typeof value === 'string' && STATUSES.includes(value as DependencyStatus);
}

export function isDependencyEdge(value: unknown): value is DependencyEdge {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.fromPacketId === 'string'
    && typeof v.toPacketId === 'string'
    && (v.strength === 'hard' || v.strength === 'soft')
    && typeof v.reason === 'string';
}

export function isDependencyNode(value: unknown): value is DependencyNode {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.workPacketId === 'string'
    && isDependencyStatus(v.status)
    && Array.isArray(v.blockedBy)
    && Array.isArray(v.canRunInParallelWith)
    && Array.isArray(v.cannotRunWith);
}

export function isDependencyGraph(value: unknown): value is DependencyGraph {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.nodes) && v.nodes.every(isDependencyNode)
    && Array.isArray(v.edges) && v.edges.every(isDependencyEdge);
}
