// Matrix Kernel — Work Graph types (PRD §9.3)
// "Map what needs to be done."

import type { RiskLevel } from './project-graph.js';

export interface WorkPacketPaths {
  /** Paths this packet is permitted to write to (glob-style). */
  ownedPaths: string[];
  /** Paths this packet may read but not modify. */
  readOnlyPaths: string[];
  /** Paths this packet must NEVER touch (enforced by Verification Court). */
  forbiddenPaths: string[];
}

export interface WorkPacketProof {
  /** Human-readable proof requirements. */
  proofRequired: string[];
  /** Required CLI commands that must exit 0 (e.g. ["npm test", "npm run typecheck"]). */
  requiredCommands?: string[];
}

export interface WorkPacket {
  id: string;
  title: string;
  objective: string;
  dimensionId: string;
  paths: WorkPacketPaths;

  /** Other work packet IDs this depends on (blocks). */
  dependsOn: string[];
  /** Other work packet IDs this may conflict with if run in parallel. */
  mayConflictWith: string[];
  /** Other work packet IDs whose merge must precede this one. */
  mergeAfter?: string[];

  acceptanceCriteria: string[];
  proof: WorkPacketProof;

  tasteGateRequired: boolean;
  redTeamRequired: boolean;

  rollbackPlan: string;
  riskLevel: RiskLevel;

  /** Estimated effort in LOC (rough; informs parallelism). */
  estimatedLoc?: number;
  /** Estimated wall-clock minutes per attempt. */
  estimatedMinutes?: number;

  createdAt: string;
  createdBy?: string;            // workstream or human
}

export interface WorkGraph {
  generatedAt: string;
  packets: WorkPacket[];
}

// ── Validation ──────────────────────────────────────────────────────────────

export function isWorkPacket(value: unknown): value is WorkPacket {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string') return false;
  if (typeof v.title !== 'string') return false;
  if (typeof v.objective !== 'string') return false;
  if (typeof v.dimensionId !== 'string') return false;
  if (typeof v.paths !== 'object' || v.paths === null) return false;
  const paths = v.paths as Record<string, unknown>;
  if (!Array.isArray(paths.ownedPaths)) return false;
  if (!Array.isArray(paths.forbiddenPaths)) return false;
  if (!Array.isArray(v.acceptanceCriteria)) return false;
  if (typeof v.rollbackPlan !== 'string') return false;
  return true;
}

export function isWorkGraph(value: unknown): value is WorkGraph {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.packets) && v.packets.every(isWorkPacket);
}

/** PRD §6 #3: no agent may work without a Work Packet. */
export function hasMandatoryFields(packet: WorkPacket): boolean {
  return packet.acceptanceCriteria.length > 0
    && packet.proof.proofRequired.length > 0
    && packet.rollbackPlan.length > 0;
}
