// Matrix Kernel — Conflict Radar types (PRD §16)

export type ConflictLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type ConflictType =
  | 'file_overlap'
  | 'path_overlap'
  | 'symbol_overlap'
  | 'module_overlap'
  | 'api_contract_overlap'
  | 'schema_overlap'
  | 'config_overlap'
  | 'test_overlap'
  | 'dependency_overlap'
  | 'semantic_api_conflict'
  | 'duplicate_subsystem'
  | 'protected_path_violation'
  | 'ownership_violation';

export type RecommendedAction =
  | 'block_immediately'
  | 'sequence_merge'
  | 'require_human_approval'
  | 'split_work_packets'
  | 'merge_first'
  | 'allow_with_warning'
  | 'requires_repair';

export interface ConflictRecord {
  conflictId: string;
  level: ConflictLevel;
  type: ConflictType;
  detectedAt: string;            // ISO timestamp
  /** Branches or work packet IDs in conflict. */
  branches?: string[];
  workPacketIds?: string[];
  leaseIds?: string[];
  description: string;
  recommendedAction: RecommendedAction;
  affectedPaths?: string[];
  affectedSymbols?: string[];
  /** Optional details for advanced UI rendering. */
  detail?: Record<string, unknown>;
}

export interface ConflictReport {
  generatedAt: string;
  conflicts: ConflictRecord[];
  summary: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
}

// ── Validation ──────────────────────────────────────────────────────────────

const LEVELS: readonly ConflictLevel[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const TYPES: readonly ConflictType[] = [
  'file_overlap', 'path_overlap', 'symbol_overlap', 'module_overlap',
  'api_contract_overlap', 'schema_overlap', 'config_overlap', 'test_overlap',
  'dependency_overlap', 'semantic_api_conflict', 'duplicate_subsystem',
  'protected_path_violation', 'ownership_violation',
];

export function isConflictLevel(v: unknown): v is ConflictLevel {
  return typeof v === 'string' && LEVELS.includes(v as ConflictLevel);
}

export function isConflictType(v: unknown): v is ConflictType {
  return typeof v === 'string' && TYPES.includes(v as ConflictType);
}

export function isConflictRecord(value: unknown): value is ConflictRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.conflictId === 'string'
    && isConflictLevel(v.level)
    && isConflictType(v.type)
    && typeof v.description === 'string'
    && typeof v.recommendedAction === 'string';
}

export function isBlocking(c: ConflictRecord): boolean {
  return c.level === 'HIGH' || c.level === 'CRITICAL';
}
