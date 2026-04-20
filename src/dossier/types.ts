// src/dossier/types.ts — TypeScript interfaces for the Competitive Dossier System

export interface EvidenceItem {
  claim: string;   // one-sentence claim
  quote: string;   // verbatim quote from source (must be non-empty to count as verified)
  source: string;  // URL or "filePath#symbolName" for self-dossier
  dim: number;     // rubric dimension number (1–28)
}

export interface DossierDimension {
  score: number;               // 1–10 (rubric-derived)
  scoreJustification: string;  // one sentence citing specific evidence
  evidence: EvidenceItem[];
  humanOverride: number | null;
  humanOverrideReason: string | null;
  unverified?: boolean;        // true when all evidence has empty quote fields
}

export interface DossierSource {
  url: string;        // HTTP URL or file path (self-dossier)
  fetchedAt: string;  // ISO 8601
  title: string;
  contentHash: string; // "sha256:<hex>"
}

export interface Dossier {
  competitor: string;      // id e.g. "cursor"
  displayName: string;     // e.g. "Cursor"
  type: 'closed-source' | 'open-source';
  lastBuilt: string;       // ISO 8601
  sources: DossierSource[];
  dimensions: Record<string, DossierDimension>; // key = dim number "1"–"28"
  composite: number;       // weighted mean of all dimension scores
  compositeMethod: string; // "mean_28_dims"
  rubricVersion: number;   // from rubric.json version field
}

export interface RubricDimension {
  name: string;
  scoreCriteria: {
    '9': string[];
    '7': string[];
    '5': string[];
    '3': string[];
    '1': string[];
  };
}

export interface Rubric {
  version: number;
  frozenAt: string; // date string e.g. "2026-04-20"
  dimensions: Record<string, RubricDimension>; // key = dim number "1"–"28"
}

export interface CompetitorEntry {
  id: string;
  displayName: string;
  type: 'closed-source' | 'open-source';
  license?: string;
  primarySources: string[];
  githubRepo: string | null;
}

export interface CompetitorRegistry {
  competitors: CompetitorEntry[];
}

export interface LandscapeRanking {
  competitor: string;
  displayName: string;
  composite: number;
  type: string;
}

export interface LandscapeGap {
  dim: string;
  dimName: string;
  dcScore: number;
  leader: string;
  leaderScore: number;
  gap: number;
}

export interface LandscapeMatrix {
  generatedAt: string;      // ISO 8601
  rubricVersion: number;    // from rubric.json version
  competitors: string[];    // ordered by composite score desc
  rankings: LandscapeRanking[];
  dimScores: Record<string, Record<string, number>>; // dimKey → {competitorId → score}
  gapAnalysis?: LandscapeGap[];
}

export interface DossierDimDelta {
  dim: string;             // dim number as string key
  dimName: string;
  before: number;
  after: number;
  delta: number;
  newEvidence: EvidenceItem[];
}

export interface DossierDelta {
  competitor: string;
  previousBuilt: string;
  currentBuilt: string;
  dimensionDeltas: DossierDimDelta[];
  compositeChange: number;
}
