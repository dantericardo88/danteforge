// Matrix Kernel — Verification Court, Red Team, Taste Gate types (PRD §19, §20, §21)

export type GateStatus = 'passed' | 'failed' | 'warning' | 'skipped';

export interface GateCheckResult {
  name: string;                  // e.g. "forbidden_paths", "unit_tests", "no_stub_scan"
  status: GateStatus;
  durationMs?: number;
  before?: number;               // for score-delta checks
  after?: number;
  details?: string;
  evidencePath?: string;
}

export interface GateReport {
  id: string;
  leaseId: string;
  workPacketId: string;
  status: GateStatus;
  checks: GateCheckResult[];
  generatedAt: string;
  evidenceBundlePath?: string;
}

// ── Red Team Verifier ──────────────────────────────────────────────────────

export type RedTeamStatus = 'passed' | 'failed' | 'needs_repair' | 'needs_human_review';
export type RedTeamRisk = 'low' | 'medium' | 'high' | 'critical';

export interface RedTeamFinding {
  category: 'fake_completion' | 'hidden_regression' | 'broken_contract'
    | 'weak_tests' | 'duplicate_architecture' | 'missing_wiring'
    | 'unsafe_assumption' | 'unsupported_claim';
  severity: RedTeamRisk;
  detail: string;
  affectedFiles?: string[];
}

export interface RedTeamReport {
  id: string;
  leaseId: string;
  workPacketId: string;
  status: RedTeamStatus;
  riskLevel: RedTeamRisk;
  recommendation: 'allow_merge' | 'block_merge' | 'require_human_review' | 'request_repair';
  findings: RedTeamFinding[];
  generatedAt: string;
  modelUsed?: string;
}

// ── Taste Gate ─────────────────────────────────────────────────────────────

export type TasteGateStatus =
  | 'not_required'
  | 'requires_human_approval'
  | 'approved'
  | 'rejected'
  | 'needs_revision';

export interface TasteGateRequest {
  id: string;
  leaseId: string;
  workPacketId: string;
  status: TasteGateStatus;
  reason: string;
  affectedSurfaces: string[];    // file paths or product-surface tags
  diffPreviewPath?: string;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  decisionNotes?: string;
}

// ── Validation ──────────────────────────────────────────────────────────────

export function isGateReport(value: unknown): value is GateReport {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string'
    && typeof v.leaseId === 'string'
    && typeof v.workPacketId === 'string'
    && Array.isArray(v.checks);
}

export function isRedTeamReport(value: unknown): value is RedTeamReport {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string'
    && typeof v.leaseId === 'string'
    && Array.isArray(v.findings);
}

export function isTasteGateRequest(value: unknown): value is TasteGateRequest {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string'
    && typeof v.leaseId === 'string'
    && Array.isArray(v.affectedSurfaces);
}
