// Matrix Kernel — Evidence Graph types (PRD §9.6)
// "Map what has been proven."
//
// Wraps the existing Time Machine + DecisionNode + @danteforge/evidence-chain
// substrate. The Evidence Graph is a denormalized index — the source of truth
// remains the DecisionNode JSONL store.

export interface EvidenceLink {
  evidenceId: string;
  workPacketId: string;
  leaseId: string;
  agentRunId: string;
  gateReportId?: string;
  redTeamReportId?: string;
  tasteGateRequestId?: string;
  mergeDecisionId?: string;
  /** ID of the Time Machine event anchoring this evidence. */
  timeMachineEventId?: string;
  /** ID of the DecisionNode that produced this evidence record. */
  decisionNodeId?: string;
  /** Path to the evidence bundle directory. */
  bundlePath?: string;
  /** Cryptographic anchor: SHA-256 of the bundle contents. */
  bundleSha256?: string;
  scoreDelta?: {
    dimensionId: string;
    before: number;
    after: number;
  };
  createdAt: string;
}

export interface EvidenceGraph {
  generatedAt: string;
  links: EvidenceLink[];
}

// ── Validation ──────────────────────────────────────────────────────────────

export function isEvidenceLink(value: unknown): value is EvidenceLink {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.evidenceId === 'string'
    && typeof v.workPacketId === 'string'
    && typeof v.leaseId === 'string'
    && typeof v.agentRunId === 'string'
    && typeof v.createdAt === 'string';
}

export function isEvidenceGraph(value: unknown): value is EvidenceGraph {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.links) && v.links.every(isEvidenceLink);
}

/** PRD §6 #8: no score may increase without evidence. */
export function hasScoreEvidence(link: EvidenceLink): boolean {
  return !!link.scoreDelta && !!link.gateReportId;
}
