// Matrix Kernel — AgentRoleDefinition (Phase 14 — harvested from CrewAI)
//
// CrewAI's defining insight is rich role specification: each agent has a
// `role`, `goal`, and `backstory` that shape its behavior. matrix-kernel
// previously only carried `agentRole: string` on the Lease — opaque.
// This file introduces structured role definitions so the prompt builder
// can inject role context and so different roles can reason about the
// same Work Packet from different angles.
//
// Native implementation (not a CrewAI adapter): we own the model, the
// registry, and the prompt-time injection. Harvest receipt:
//   .danteforge/evidence/oss-harvest-crewai.json
export interface AgentRoleDefinition {
  /** Stable identifier used in leases and reports (e.g. 'dimension-engineer'). */
  id: string;

  /** Short human label ('Dimension Engineer'). */
  label: string;

  /** What this role is for. One sentence. */
  role: string;

  /** What this role is trying to accomplish. */
  goal: string;

  /** Voice/expertise framing. Two-three sentences max. */
  backstory: string;

  /** Hint for which tool categories the role typically uses. Free-form. */
  toolHints: string[];

  /**
   * Whether this role's memory should be persisted across runs.
   * Default false — memory is opt-in to avoid surprise context bleed.
   */
  persistentMemory?: boolean;
}

/** A short, durable note this role wants to remember for next time. */
export interface AgentMemoryEntry {
  /** ISO timestamp when the entry was written. */
  ts: string;
  /** The run that produced it (for provenance). */
  runId: string;
  /** Free-form one-line note. Keep concise — these accumulate. */
  note: string;
  /** Optional tag for grouping ('lesson', 'caution', 'fact'). */
  tag?: 'lesson' | 'caution' | 'fact';
}

/** On-disk shape for `.danteforge/matrix/agent-memory/<role-id>.json`. */
export interface AgentMemoryFile {
  roleId: string;
  entries: AgentMemoryEntry[];
  /** Soft cap so memory files don't grow unbounded. */
  maxEntries: number;
}
