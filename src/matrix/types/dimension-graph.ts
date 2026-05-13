// Matrix Kernel — Dimension Graph types (PRD §9.2, §10, §11)
// "Map what excellence requires."

export type CompetitorCategory =
  | 'oss'
  | 'closed_source'
  | 'hybrid'
  | 'research'
  | 'internal'
  | 'unknown';

export type InspectionMode =
  | 'source_available'
  | 'observational'
  | 'documented_only'
  | 'unknown';

export interface CompetitorProvenance {
  type: 'repo' | 'docs' | 'manual_note' | 'demo_video' | 'paper' | 'release_notes';
  capturedAt: string;            // ISO timestamp
  note?: string;
  url?: string;
}

export interface Competitor {
  id: string;
  name: string;
  category: CompetitorCategory;
  inspectionMode: InspectionMode;
  repoUrl?: string;              // only if oss/hybrid
  license?: string;              // only if oss/hybrid
  homeUrl?: string;
  /** Confidence in our score for this competitor (0–1). */
  confidence: number;
  provenance: CompetitorProvenance[];
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  cleanRoomNotes?: string;       // if OSS, document clean-room implementation plan
}

export interface DimensionRubricLevel {
  score: number;                 // 0..10
  descriptor: string;
  evidenceExamples?: string[];
}

export interface DimensionContract {
  dimensionId: string;
  name: string;
  category?: string;             // e.g. "editor", "context", "workflow"
  targetScore: number;           // typically 9
  currentScore: number;          // computed
  /** ProjectGraphNode IDs this dimension is wired into. */
  touches: string[];
  /** Other dimension IDs this depends on. */
  dependsOnDimensions: string[];
  evidenceRequired: string[];    // human-readable requirements
  rubric?: DimensionRubricLevel[];
  /** Frontier-leader competitorId per inspection mode, optional. */
  frontierLeaderId?: string;
}

export interface DimensionGraphNode extends DimensionContract {
  // Computed augmentations
  ossFrontierScore?: number;     // achievable by copying OSS leaders
  closedFrontierScore?: number;  // observational; needs evidence
  gapVsTarget: number;           // targetScore - currentScore
  gapVsOssFrontier?: number;
  gapVsClosedFrontier?: number;
}

export interface DimensionGraph {
  generatedAt: string;
  nodes: DimensionGraphNode[];
  competitors: Competitor[];
}

// ── Validation ──────────────────────────────────────────────────────────────

export function isCompetitor(value: unknown): value is Competitor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === 'string'
    && typeof v.name === 'string'
    && typeof v.category === 'string'
    && typeof v.confidence === 'number'
    && Array.isArray(v.provenance);
}

export function isDimensionContract(value: unknown): value is DimensionContract {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.dimensionId === 'string'
    && typeof v.name === 'string'
    && typeof v.targetScore === 'number'
    && typeof v.currentScore === 'number'
    && Array.isArray(v.touches)
    && Array.isArray(v.evidenceRequired);
}

export function isDimensionGraph(value: unknown): value is DimensionGraph {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.nodes)
    && Array.isArray(v.competitors)
    && (v.competitors as unknown[]).every(isCompetitor);
}

/** Closed-source competitor scores MUST be marked observational. PRD §6 #11. */
export function violatesClosedSourceRule(c: Competitor): boolean {
  return c.category === 'closed_source' && c.inspectionMode !== 'observational';
}
