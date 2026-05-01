// DanteForge SDK — programmatic API for use as a library
// Usage: import { assess, computeHarshScore } from 'danteforge/sdk'
import { DANTEFORGE_VERSION } from './core/version.js';

// Core assessment and scoring
export { assess } from './cli/commands/assess.js';
export type { AssessOptions, AssessResult } from './cli/commands/assess.js';

export { computeHarshScore, computeCanonicalScore, formatDimensionBar } from './core/harsh-scorer.js';
export type { CanonicalScore, HarshScoreResult, HarshScorerOptions, ScoringDimension } from './core/harsh-scorer.js';

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

// Canvas quality scoring
export { scoreCanvasQuality } from './core/canvas-quality-scorer.js';
export type { CanvasQualityResult, CanvasQualityDimensions } from './core/canvas-quality-scorer.js';

// Canvas seed defaults
export { getCanvasSeedDocument } from './core/canvas-defaults.js';
export type { CanvasSeedOptions } from './core/canvas-defaults.js';

// Canvas admin cockpit seed
export { getAdminCockpitDocument } from './core/canvas-admin-seed.js';
export type { AdminSeedOptions } from './core/canvas-admin-seed.js';

// Enterprise policy gate
export { runPolicyGate, loadPolicyConfig, evaluatePolicy, writePolicyReceipt } from './core/policy-gate.js';
export type { PolicyConfig, PolicyDecision } from './core/policy-gate.js';

// Context Economy runtime
export {
  filterShellResult,
  getEconomizedArtifactForContext,
  scoreContextEconomy,
  scoreContextEconomySync,
  filterLedgerRecords,
} from './core/context-economy/runtime.js';
export { summarizeLedger } from './core/context-economy/economy-ledger.js';
export type {
  ContextEconomyScoreOptions,
  ContextEconomyScoreReport,
  ContextEconomySubscores,
  EconomizedArtifactContext,
  EconomizedArtifactInput,
  FilterShellResultInput,
  FilterShellResultOutput,
} from './core/context-economy/runtime.js';
export type { FilterResult, FilterStatus, LedgerRecord, LedgerSummary } from './core/context-economy/types.js';

// Time Machine decision-node schema and store
export * from './core/decision-node.js';

// Time Machine counterfactual replay engine
export * from './core/time-machine-replay.js';

// Time Machine causal attribution classifier
export * from './core/time-machine-causal-attribution.js';
export * from './core/time-machine-attribution-eval.js';

// Time Machine ecosystem adapter interfaces (Phase 4 integration contract)
export * from './core/decision-node-adapters.js';

// Time Machine DanteAgents bridge — ForgeOrchestrator → DecisionNode store
export * from './core/decision-node-danteagents-bridge.js';

// Version
export const SDK_VERSION = DANTEFORGE_VERSION;
