// src/scoring/types.ts — All interfaces for the triple-rubric scoring system

export type EvidenceType =
  | 'code'
  | 'test'
  | 'manual_verification'
  | 'benchmark'
  | 'doc'
  | 'external_source';

export type SourceKind =
  | 'file'
  | 'test_file'
  | 'command_output'
  | 'web_source'
  | 'note';

export type EvidenceStrength = 'weak' | 'moderate' | 'strong';

export type EvidenceStatus = 'present' | 'partial' | 'missing' | 'unknown';

export type Confidence = 'low' | 'medium' | 'high';

export type RubricId =
  | 'internal_optimistic'
  | 'public_defensible'
  | 'hostile_diligence';

export interface DimensionDefinition {
  id: string;
  name: string;
  category: string;
  maxScore: number;
  description: string;
  requiredEvidenceTypes: EvidenceType[];
  hardCeiling?: number;
}

export interface EvidenceRecord {
  dimensionId: string;
  evidenceType: EvidenceType;
  sourceKind: SourceKind;
  sourceRef: string;
  summary: string;
  strength: EvidenceStrength;
  status: EvidenceStatus;
  userVisible: boolean;
  mainPathWired: boolean;
  tested: boolean;
  endToEndProven: boolean;
  benchmarkBacked: boolean;
  notes?: string;
}

export interface DimensionScore {
  dimensionId: string;
  rubricId: RubricId;
  score: number;
  maxScore: number;
  confidence: Confidence;
  rationale: string;
  ceilingReason?: string;
  nextLift?: string;
  evidenceRefs: string[];
}

export interface CategoryRollup {
  category: string;
  rubricId: RubricId;
  total: number;
  maxTotal: number;
  normalized: number;
  dimensionIds: string[];
}

export interface RubricTotal {
  rubricId: RubricId;
  total: number;
  maxTotal: number;
  normalized: number;
}

export interface MatrixSnapshot {
  matrixId: string;
  subject: string;
  generatedAt: string;
  rubricScores: RubricTotal[];
  categories: CategoryRollup[];
  dimensions: DimensionScore[];
}

export interface SnapshotDiff {
  subject: string;
  beforeGeneratedAt: string;
  afterGeneratedAt: string;
  dimensionChanges: Array<{
    dimensionId: string;
    rubricId: RubricId;
    scoreBefore: number;
    scoreAfter: number;
    delta: number;
    driver: 'new_evidence' | 'rubric_interpretation' | 'no_change';
    notes?: string;
  }>;
  rubricTotals: Array<{
    rubricId: RubricId;
    totalBefore: number;
    totalAfter: number;
    delta: number;
  }>;
}

export interface RubricPolicy {
  id: RubricId;
  displayName: string;
  description: string;
  score(
    evidence: EvidenceRecord[],
    dim: DimensionDefinition,
  ): { score: number; confidence: Confidence; rationale: string; nextLift?: string };
}
