// DanteForge SDK — programmatic API for use as a library
// Usage: import { assess, computeHarshScore } from 'danteforge/sdk'

// Core assessment and scoring
export { assess } from './cli/commands/assess.js';
export type { AssessOptions, AssessResult } from './cli/commands/assess.js';

export { computeHarshScore, formatDimensionBar } from './core/harsh-scorer.js';
export type { HarshScoreResult, HarshScorerOptions, ScoringDimension } from './core/harsh-scorer.js';

export { assessMaturity } from './core/maturity-engine.js';
export type { MaturityAssessment } from './core/maturity-engine.js';

export { generateMasterplan } from './core/gap-masterplan.js';
export type { Masterplan, GenerateMasterplanOptions } from './core/gap-masterplan.js';

// State management
export { loadState, saveState } from './core/state.js';
export type { DanteState, WorkflowStage } from './core/state.js';

// Competitor analysis
export { scanCompetitors, formatCompetitorReport } from './core/competitor-scanner.js';
export type { CompetitorComparison, CompetitorScanOptions } from './core/competitor-scanner.js';

// LLM
export { callLLM } from './core/llm.js';

// Feature universe
export { buildFeatureUniverse, scoreProjectAgainstUniverse } from './core/feature-universe.js';
export type { FeatureUniverseAssessment } from './core/feature-universe.js';

// Version
export const SDK_VERSION = '0.10.0';
