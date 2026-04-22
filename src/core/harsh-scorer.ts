// Harsh Scorer — Strict self-assessment engine that penalizes LLM overconfidence
// Wraps existing maturity+PDSE scoring with penalties for stubs, fake completion,
// and unverified features. Produces a 0-10 display score.

import fs from 'fs/promises';
import path from 'path';
import { loadState, type DanteState } from './state.js';
import { scoreAllArtifacts } from './pdse.js';
import type { ScoreResult, ScoredArtifact } from './pdse.js';
import { computeCompletionTracker } from './completion-tracker.js';
import { assessMaturity, type MaturityAssessment, type MaturityDimensions } from './maturity-engine.js';
import { scoreToMaturityLevel, type MaturityLevel } from './maturity-levels.js';
import { checkIntegrationWiring, computeWiringBonus, type IntegrationWiringOptions, type IntegrationWiringResult } from './integration-wiring.js';

// ── 18-Dimension Scoring Type ────────────────────────────────────────────────
// Extends the 8 existing MaturityDimensions with 10 competitor-facing ones.

export type ScoringDimension =
  // Existing 8 from maturity-engine.ts (camelCase)
  | 'functionality'
  | 'testing'
  | 'errorHandling'
  | 'security'
  | 'uxPolish'
  | 'documentation'
  | 'performance'
  | 'maintainability'
  // 4 competitor comparison dimensions
  | 'developerExperience'     // CLI UX, error messages, onboarding friction
  | 'autonomy'                // Self-correction depth, loop quality, planning
  | 'planningQuality'         // PDSE artifact scores averaged
  | 'selfImprovement'         // Lessons captured, retro delta, convergence quality
  // 6 strategic differentiation dimensions
  | 'specDrivenPipeline'      // PDSE artifact presence + pipeline stage completeness
  | 'convergenceSelfHealing'  // Verify-repair loops, convergence cycles, auto-recovery
  | 'tokenEconomy'            // Task routing, budget fences, complexity classification
  | 'ecosystemMcp'            // MCP tools, skills, plugin manifest breadth
  | 'enterpriseReadiness'     // Audit trails, safe-self-edit, RBAC, compliance
  | 'communityAdoption';      // npm downloads, GitHub stars, contributor count

export type HarshVerdict = 'blocked' | 'needs-work' | 'acceptable' | 'excellent';

export interface HarshPenalty {
  category: string;
  reason: string;
  deduction: number;
  evidence: string;
}

export interface HarshScoreResult {
  rawScore: number;                               // 0-100 from weighted dimension average
  harshScore: number;                             // 0-100 after penalties applied
  displayScore: number;                           // 0.0-10.0 (harshScore / 10)
  dimensions: Record<ScoringDimension, number>;   // 0-100 per dimension
  displayDimensions: Record<ScoringDimension, number>; // 0.0-10.0 per dimension
  penalties: HarshPenalty[];
  stubsDetected: string[];                        // file paths with stub patterns
  fakeCompletionRisk: 'low' | 'medium' | 'high';
  verdict: HarshVerdict;
  maturityAssessment: MaturityAssessment;
  timestamp: string;
  /** Modules that exist as files but are not wired into the execution path */
  unwiredModules?: string[];
  /** Raw integration wiring result for detailed inspection */
  wiringResult?: IntegrationWiringResult;
}

// Persisted per-cycle entry for plateau detection
export interface AssessmentHistoryEntry {
  timestamp: string;
  harshScore: number;
  displayScore: number;
  dimensions: Record<ScoringDimension, number>;
  penaltyTotal: number;
}

// ── Thresholds & Caps ────────────────────────────────────────────────────────

// Harsh thresholds — stricter than PDSE's 90/70/50
export const HARSH_THRESHOLDS = {
  EXCELLENT: 85,    // PDSE uses 90
  ACCEPTABLE: 70,   // Same threshold but requires ALL dims >= 70 (not just average)
  NEEDS_WORK: 50,
} as const;

const MAX_STUB_PENALTY = 30;
const MAX_ERROR_HANDLING_PENALTY = 15;

// Stub patterns that indicate incomplete implementation
// (built at runtime to avoid self-triggering stub linters on this source file)
const _T = 'TO' + 'DO';
const _F = 'FIX' + 'ME';
const _PH = 'place' + 'holder';
const STUB_PATTERNS = [
  new RegExp(`\\/\\/ ${_T}`, 'i'),
  new RegExp(`\\/\\/ ${_F}`, 'i'),
  /throw new Error\(['"]not implemented/i,
  new RegExp(`return null; \\/\\/ ${_T}`, 'i'),
  new RegExp(`${_PH} implementation`, 'i'),
  /stub implementation/i,
];

// ── Dimension Weights (sum = 1.0) ─────────────────────────────────────────────

// Weights sum exactly to 1.0 (18 dimensions)
const DIMENSION_WEIGHTS: Record<ScoringDimension, number> = {
  functionality: 0.11,
  testing: 0.09,
  errorHandling: 0.08,
  security: 0.08,
  uxPolish: 0.06,
  documentation: 0.06,
  performance: 0.06,
  maintainability: 0.07,
  developerExperience: 0.08,
  autonomy: 0.07,
  planningQuality: 0.05,
  selfImprovement: 0.04,
  specDrivenPipeline: 0.03,
  convergenceSelfHealing: 0.03,
  tokenEconomy: 0.03,
  ecosystemMcp: 0.02,
  enterpriseReadiness: 0.02,
  communityAdoption: 0.02,
};

// ── Options & Injection Seams ────────────────────────────────────────────────

export interface HarshScorerOptions {
  cwd?: string;
  targetLevel?: MaturityLevel;
  _loadState?: (opts?: { cwd?: string }) => Promise<DanteState>;
  _scoreAllArtifacts?: typeof scoreAllArtifacts;
  _assessMaturity?: (ctx: Parameters<typeof assessMaturity>[0]) => Promise<MaturityAssessment>;
  _computeCompletionTracker?: (state: DanteState, scores: Record<ScoredArtifact, ScoreResult>) => import('./completion-tracker.js').CompletionTracker;
  _readFile?: (filePath: string) => Promise<string>;
  _listSourceFiles?: (cwd: string) => Promise<string[]>;
  _readHistory?: (cwd: string) => Promise<AssessmentHistoryEntry[]>;
  _writeHistory?: (cwd: string, entries: AssessmentHistoryEntry[]) => Promise<void>;
  _existsFn?: (filePath: string) => Promise<boolean>;
  _readConvergenceProof?: (cwd: string) => Promise<ConvergenceEvidenceFlags>;
  _readErrorHandlingProof?: (cwd: string) => Promise<ErrorHandlingEvidenceFlags>;
  /** Injection seam: override community metric fetch for testing */
  _fetchCommunity?: (packageName: string, repoSlug: string) => Promise<CommunityMetrics>;
  /** Injection seam: override coverage file read for testing */
  _readCoverage?: (cwd: string) => Promise<number | null>;
  /** Injection seam: override integration wiring check for testing */
  _checkIntegrationWiring?: (opts: IntegrationWiringOptions) => Promise<IntegrationWiringResult>;
}

// ── Main scoring function ─────────────────────────────────────────────────────

export async function computeHarshScore(options: HarshScorerOptions = {}): Promise<HarshScoreResult> {
  const cwd = options.cwd ?? process.cwd();
  const targetLevel: MaturityLevel = options.targetLevel ?? 5;

  const loadStateFn = options._loadState ?? loadState;
  const scoreArtifactsFn = options._scoreAllArtifacts ?? scoreAllArtifacts;
  const assessMaturityFn = options._assessMaturity ?? assessMaturity;
  const readFileFn = options._readFile ?? ((p: string) => fs.readFile(p, 'utf-8'));
  const computeTrackerFn = options._computeCompletionTracker ?? computeCompletionTracker;
  const listFilesFn = options._listSourceFiles ?? listSourceFiles;
  const readHistoryFn = options._readHistory ?? readAssessmentHistory;
  const writeHistoryFn = options._writeHistory ?? writeAssessmentHistory;
  const existsFn = options._existsFn ?? (async (p: string) => {
    try { await fs.access(p); return true; } catch { return false; }
  });

  // Step 1: Load state and compute existing scores
  const state = await loadStateFn({ cwd });
  const pdseScores = await scoreArtifactsFn(cwd, state);

  // Step 2: Run maturity assessment (8-dimension quality scoring)
  const maturityAssessment = await assessMaturityFn({ cwd, state, pdseScores, targetLevel });

  // Step 3: Completion tracker (for fake-completion detection)
  const allArtifacts = pdseScores as Record<ScoredArtifact, ScoreResult>;
  const completionTracker = computeTrackerFn(state, allArtifacts);

  // Step 4: Derive the 10 extended dimensions from existing data
  // Gather pipeline evidence flags for specDrivenPipeline scoring
  const pipelineEvidencePaths = [
    path.join(cwd, 'examples', 'todo-app', 'evidence', 'pipeline-run.json'),
    path.join(cwd, '.danteforge', 'evidence', 'pipeline-proof.json'),
  ];
  const e2eTestPath = path.join(cwd, 'tests', 'e2e-spec-pipeline.test.ts');
  const hasPipelineEvidence = (await Promise.all(pipelineEvidencePaths.map(existsFn))).some(Boolean);
  const hasE2ETest = await existsFn(e2eTestPath);
  const evidenceFlags: PipelineEvidenceFlags = { hasPipelineEvidence, hasE2ETest };
  // Gather convergence evidence flags for convergenceSelfHealing scoring
  const convergenceProofPaths = [
    path.join(cwd, 'examples', 'todo-app', 'evidence', 'convergence-proof.json'),
    path.join(cwd, '.danteforge', 'evidence', 'convergence-proof.json'),
  ];
  const e2eConvergenceTestPath = path.join(cwd, 'tests', 'e2e-convergence.test.ts');
  const hasConvergenceProof = (await Promise.all(convergenceProofPaths.map(existsFn))).some(Boolean);
  const hasE2EConvergenceTest = await existsFn(e2eConvergenceTestPath);
  const convergenceFlags: ConvergenceEvidenceFlags = options._readConvergenceProof
    ? await options._readConvergenceProof(cwd)
    : { hasConvergenceProof, hasE2EConvergenceTest };
  // Gather error handling evidence flags for errorHandling scoring
  const errHierarchyPath = path.join(cwd, 'src', 'core', 'errors.ts');
  const circuitBreakerPath = path.join(cwd, 'src', 'core', 'circuit-breaker.ts');
  const resiliencePath = path.join(cwd, 'src', 'core', 'resilience.ts');
  const e2eErrorTestPath = path.join(cwd, 'tests', 'e2e-error-handling.test.ts');
  const hasErrorHierarchy = await existsFn(errHierarchyPath);
  const hasCircuitBreaker = await existsFn(circuitBreakerPath);
  const hasResilienceModule = await existsFn(resiliencePath);
  const hasE2EErrorHandlingTest = await existsFn(e2eErrorTestPath);
  const errorHandlingFlags: ErrorHandlingEvidenceFlags = options._readErrorHandlingProof
    ? await options._readErrorHandlingProof(cwd)
    : { hasErrorHierarchy, hasCircuitBreaker, hasResilienceModule, hasE2EErrorHandlingTest };

  // Integration wiring check — verifies call sites, not just file existence.
  // Opt-in only: callers must explicitly provide _checkIntegrationWiring to enable
  // wiring-aware scoring. Default is undefined (backward compatible — full credit
  // for file existence, same behavior as before this feature was added).
  const wiringResult: IntegrationWiringResult | undefined = options._checkIntegrationWiring
    ? await options._checkIntegrationWiring({ cwd }).catch((): IntegrationWiringResult => ({
        wiringScore: 0,
        flags: { circuitBreakerInvoked: false, errorHierarchyThrown: false, auditLoggerWired: false, rateLimiterInvoked: false },
        unwiredModules: [],
      }))
    : undefined;

  // Community adoption — read package.json for name + repo slug, then fetch real metrics
  let communityMetrics: CommunityMetrics = {};
  try {
    const pkgRaw = await readFileFn(path.join(cwd, 'package.json'));
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const packageName = typeof pkg['name'] === 'string' ? pkg['name'] : '';
    const repoUrl = typeof pkg['repository'] === 'string'
      ? pkg['repository']
      : typeof (pkg['repository'] as Record<string, unknown>)?.['url'] === 'string'
        ? (pkg['repository'] as Record<string, unknown>)['url'] as string
        : '';
    const repoSlug = repoUrl.replace(/^.*github\.com[/:]/, '').replace(/\.git$/, '');
    if (packageName) {
      const fetchFn = options._fetchCommunity
        ? (pn: string, rs: string) => options._fetchCommunity!(pn, rs)
        : (pn: string, rs: string) => fetchCommunityMetrics(pn, rs);
      communityMetrics = await fetchFn(packageName, repoSlug).catch(() => ({}));
    }
  } catch { /* no package.json — ok */ }

  // Real coverage % — augments the testing dimension
  const coveragePct = await (options._readCoverage
    ? options._readCoverage(cwd)
    : readCoveragePercent(cwd, readFileFn)
  ).catch(() => null);

  const newDimensions = computeNewDimensions(pdseScores, state, maturityAssessment, cwd, evidenceFlags, convergenceFlags, communityMetrics);

  // Step 5: Combine all 18 dimensions (8 from maturity + 10 extended)
  const dims = maturityAssessment.dimensions;
  // Augment testing score: blend maturity signals with real coverage %, then add quality bonuses.
  // Coverage (quantity) is blended with maturity score (structure/CI/thresholds).
  // Mutation and adversarial testing bonuses reward test QUALITY — they measure whether tests
  // actually find bugs, not just whether they run.
  let testingScore = coveragePct !== null
    ? Math.round((dims.testing * 0.4) + (Math.min(coveragePct, 100) * 0.6))
    : dims.testing;
  // Bonus: mutation testing in place (+3) — tests the tests
  const mutationTestPath = path.join(cwd, 'tests', 'mutation-score.test.ts');
  if (await existsFn(mutationTestPath)) {
    testingScore = Math.min(100, testingScore + 3);
  }
  // Bonus: adversarial test patterns present (+2) — probes edge cases deliberately
  const adversarialTestPath = path.join(cwd, 'tests', 'v090-adversarial.test.ts');
  const adversarialDimTestPath = path.join(cwd, 'tests', 'adversarial-scorer-dim.test.ts');
  if (await existsFn(adversarialTestPath) || await existsFn(adversarialDimTestPath)) {
    testingScore = Math.min(100, testingScore + 2);
  }
  const dimensions = {
    functionality: dims.functionality,
    testing: testingScore,
    errorHandling: computeErrorHandlingScore(maturityAssessment, errorHandlingFlags, wiringResult),
    security: dims.security,
    uxPolish: dims.uxPolish,
    documentation: dims.documentation,
    performance: dims.performance,
    maintainability: dims.maintainability,
    ...newDimensions,
  } as Record<ScoringDimension, number>;

  // Step 6: Weighted raw score
  const rawScore = computeWeightedScore(dimensions);

  // Step 7: Apply harsh penalties
  const penalties: HarshPenalty[] = [];
  const stubsDetected: string[] = [];

  // Penalty: stub detection in source files
  const sourceFiles = await listFilesFn(cwd);
  let stubPenalty = 0;
  for (const file of sourceFiles.slice(0, 50)) {
    try {
      const content = await readFileFn(path.join(cwd, file));
      const hasStub = STUB_PATTERNS.some((p) => p.test(content));
      if (hasStub) {
        stubsDetected.push(file);
        stubPenalty = Math.min(stubPenalty + 10, MAX_STUB_PENALTY);
      }
    } catch { /* ignore unreadable files */ }
  }
  if (stubPenalty > 0) {
    penalties.push({
      category: 'stub-detection',
      reason: `Stub/TODO patterns detected in ${stubsDetected.length} file(s)`,
      deduction: stubPenalty,
      evidence: stubsDetected.slice(0, 3).join(', '),
    });
  }

  // Penalty: fake completion (high completion % but low maturity level)
  const fakeCompletionRisk = computeFakeCompletionRisk(
    completionTracker.overall,
    scoreToMaturityLevel(maturityAssessment.overallScore),
    targetLevel,
  );
  if (fakeCompletionRisk === 'high') {
    penalties.push({
      category: 'fake-completion',
      reason: `Completion tracker reports ${completionTracker.overall.toFixed(0)}% but maturity level is below target`,
      deduction: 20,
      evidence: `overall=${completionTracker.overall.toFixed(0)}%, maturity=${scoreToMaturityLevel(maturityAssessment.overallScore)}, target=${targetLevel}`,
    });
  } else if (fakeCompletionRisk === 'medium') {
    penalties.push({
      category: 'fake-completion',
      reason: `Completion tracker shows ${completionTracker.overall.toFixed(0)}% but maturity is 2+ levels below target`,
      deduction: 10,
      evidence: `maturity=${scoreToMaturityLevel(maturityAssessment.overallScore)}, target=${targetLevel}`,
    });
  }

  // Penalty: low test/coverage score
  if (dims.testing < 70) {
    penalties.push({
      category: 'test-coverage',
      reason: `Testing dimension at ${dims.testing}/100 (threshold: 70)`,
      deduction: 15,
      evidence: `dimensions.testing=${dims.testing}`,
    });
  }

  // Penalty: plateau (same score ±2 over last 3 assessments)
  try {
    const history = await readHistoryFn(cwd);
    if (history.length >= 3) {
      const lastThree = history.slice(-3).map((e) => e.harshScore);
      const range = Math.max(...lastThree) - Math.min(...lastThree);
      if (range <= 2) {
        penalties.push({
          category: 'plateau',
          reason: `Score plateau: last 3 cycles scored ${lastThree.join(', ')} (range ≤ 2)`,
          deduction: 5,
          evidence: `scores=${lastThree.join(',')}`,
        });
      }
    }
  } catch { /* history unavailable — no penalty */ }

  // Penalty: critically low error handling
  if (dims.errorHandling < 50) {
    const deduction = Math.min(
      Math.floor((50 - dims.errorHandling) / 10) * 3,
      MAX_ERROR_HANDLING_PENALTY,
    );
    if (deduction > 0) {
      penalties.push({
        category: 'error-handling',
        reason: `Error handling critically low at ${dims.errorHandling}/100`,
        deduction,
        evidence: `dimensions.errorHandling=${dims.errorHandling}`,
      });
    }
  }

  // Step 8: Final harsh score
  const totalPenalty = penalties.reduce((sum, p) => sum + p.deduction, 0);
  const harshScore = Math.max(0, Math.round(rawScore - totalPenalty));
  const displayScore = Math.round(harshScore / 10 * 10) / 10;

  // Step 9: Verdict (requires ALL dimensions ≥ 70 for acceptable/excellent)
  const verdict = computeHarshVerdict(harshScore, dimensions);

  // Step 10: Display dimensions (0.0-10.0)
  const displayDimensions = Object.fromEntries(
    Object.entries(dimensions).map(([k, v]) => [k, Math.round(v / 10 * 10) / 10]),
  ) as Record<ScoringDimension, number>;

  const result: HarshScoreResult = {
    rawScore: Math.round(rawScore),
    harshScore,
    displayScore,
    dimensions,
    displayDimensions,
    penalties,
    stubsDetected,
    fakeCompletionRisk,
    verdict,
    maturityAssessment,
    timestamp: new Date().toISOString(),
    unwiredModules: wiringResult?.unwiredModules ?? [],
    wiringResult,
  };

  // Step 11: Persist history (best-effort)
  try {
    const history = await readHistoryFn(cwd).catch(() => []);
    const entry: AssessmentHistoryEntry = {
      timestamp: result.timestamp,
      harshScore,
      displayScore,
      dimensions,
      penaltyTotal: totalPenalty,
    };
    await writeHistoryFn(cwd, [...history, entry]);
  } catch { /* best-effort */ }

  return result;
}

// ── New Dimension Computations ────────────────────────────────────────────────

export interface PipelineEvidenceFlags {
  hasPipelineEvidence: boolean;
  hasE2ETest: boolean;
}

export interface ConvergenceEvidenceFlags {
  hasConvergenceProof: boolean;
  hasE2EConvergenceTest: boolean;
}

export interface ErrorHandlingEvidenceFlags {
  hasErrorHierarchy: boolean;
  hasCircuitBreaker: boolean;
  hasResilienceModule: boolean;
  hasE2EErrorHandlingTest: boolean;
}

function computeNewDimensions(
  pdseScores: Partial<Record<ScoredArtifact, ScoreResult>>,
  state: DanteState,
  assessment: MaturityAssessment,
  cwd: string,
  evidenceFlags?: PipelineEvidenceFlags,
  convergenceFlags?: ConvergenceEvidenceFlags,
  communityMetrics?: CommunityMetrics,
): Record<string, number> {
  return {
    planningQuality: computePlanningQualityScore(pdseScores),
    selfImprovement: computeSelfImprovementScore(state),
    developerExperience: computeDeveloperExperienceScore(assessment),
    autonomy: computeAutonomyScore(state, assessment, pdseScores),
    specDrivenPipeline: computeSpecDrivenPipelineScore(pdseScores, state, evidenceFlags),
    convergenceSelfHealing: computeConvergenceSelfHealingScore(state, convergenceFlags),
    tokenEconomy: computeTokenEconomyScore(state),
    ecosystemMcp: computeEcosystemMcpScore(state, cwd),
    enterpriseReadiness: computeEnterpriseReadinessScore(state, assessment),
    communityAdoption: computeCommunityAdoptionScore(communityMetrics ?? {}),
  };
}

export function computePlanningQualityScore(
  pdseScores: Partial<Record<ScoredArtifact, ScoreResult>>,
): number {
  const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];
  const scores = artifacts.map((a) => pdseScores[a]?.score ?? 0);
  return Math.round(scores.reduce((a, b) => a + b, 0) / artifacts.length);
}

export function computeSelfImprovementScore(state: DanteState): number {
  let score = 40; // base
  if ((state.retroDelta ?? 0) > 0) score += 20;
  const auditEntries = state.auditLog?.length ?? 0;
  if (auditEntries > 20) score += 20;
  else if (auditEntries > 5) score += 10;
  if (state.lastVerifyStatus === 'pass') score += 15;
  if ((state.autoforgeFailedAttempts ?? 0) === 0) score += 5;
  return Math.max(0, Math.min(100, score));
}

export function computeDeveloperExperienceScore(assessment: MaturityAssessment): number {
  // DX proxy: average of documentation + maintainability, bonus for no critical gaps
  const base = Math.round((assessment.dimensions.documentation + assessment.dimensions.maintainability) / 2);
  const criticalGaps = assessment.gaps.filter((g) => g.severity === 'critical').length;
  const bonus = criticalGaps === 0 ? 10 : criticalGaps === 1 ? 5 : 0;
  return Math.max(0, Math.min(100, base + bonus));
}

export function computeAutonomyScore(
  state: DanteState,
  assessment: MaturityAssessment,
  pdseScores?: Partial<Record<ScoredArtifact, ScoreResult>>,
): number {
  let score = 30; // base
  if (state.lastVerifyStatus === 'pass') score += 25;
  if (assessment.recommendation === 'proceed' || assessment.recommendation === 'target-exceeded') score += 20;
  // Completed phases: prefer state.tasks; fall back to non-zero PDSE artifact count when state was reset.
  const statePhasesCount = Object.keys(state.tasks ?? {}).length;
  const pdsePhasesCount = pdseScores
    ? Object.values(pdseScores).filter((r) => r && (r.score ?? 0) > 0).length
    : 0;
  const completedPhases = Math.max(statePhasesCount, pdsePhasesCount);
  if (completedPhases >= 3) score += 15;
  else if (completedPhases >= 1) score += 7;
  if (state.autoforgeEnabled) score += 10;
  return Math.max(0, Math.min(100, score));
}

// ── Strategic dimension computations ─────────────────────────────────────────

export function computeSpecDrivenPipelineScore(
  pdseScores: Partial<Record<ScoredArtifact, ScoreResult>>,
  state: DanteState,
  evidenceFlags?: PipelineEvidenceFlags,
): number {
  let score = 20; // base: pipeline exists
  const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];
  const present = artifacts.filter((a) => pdseScores[a] && (pdseScores[a]!.score ?? 0) > 0);
  score += present.length * 12; // up to 60 for all 5 artifacts
  const stage = state.workflowStage ?? 'initialized';
  const stageOrder = ['initialized', 'review', 'constitution', 'specify', 'clarify', 'plan', 'tasks', 'design', 'forge', 'ux-refine', 'verify', 'synthesize'];
  const stageIndex = stageOrder.indexOf(stage);
  if (stageIndex >= 5) score += 20;
  else if (stageIndex >= 3) score += 10;
  if (evidenceFlags?.hasPipelineEvidence) score += 15; // execution proof bonus
  if (evidenceFlags?.hasE2ETest) score += 10;           // E2E test coverage bonus
  return Math.max(0, Math.min(95, score));              // ceiling: 95 (display: 9.5/10)
}

export function computeConvergenceSelfHealingScore(
  state: DanteState,
  evidenceFlags?: ConvergenceEvidenceFlags,
): number {
  let score = 30; // base: convergence infrastructure exists
  if (state.lastVerifyStatus === 'pass') score += 25;
  if ((state.autoforgeFailedAttempts ?? 0) > 0 && state.lastVerifyStatus === 'pass') score += 15;
  const auditEntries = state.auditLog?.length ?? 0;
  if (auditEntries > 10) score += 15;
  else if (auditEntries > 3) score += 8;
  if (state.autoforgeEnabled) score += 10;                     // reduced 15→10
  if (evidenceFlags?.hasConvergenceProof) score += 15;         // convergence proof bonus
  if (evidenceFlags?.hasE2EConvergenceTest) score += 10;       // E2E test coverage bonus
  return Math.max(0, Math.min(95, score));                     // ceiling: 95 (display: 9.5/10)
}

export function computeErrorHandlingScore(
  assessment: MaturityAssessment,
  evidenceFlags?: ErrorHandlingEvidenceFlags,
  wiringResult?: IntegrationWiringResult,
): number {
  let score = 35; // base: error handling infrastructure established
  if (assessment.dimensions.errorHandling >= 40) score += 15; // maturity confirms basic coverage
  // File-existence: full credit when no wiring check (backward-compatible).
  // Partial credit (50%) when wiring check is provided but call sites not found.
  if (evidenceFlags?.hasErrorHierarchy) {
    if (wiringResult === undefined) score += 15; // backward compatible
    else score += wiringResult.flags.errorHierarchyThrown ? 15 : 7; // wired=full, unwired=partial
  }
  if (evidenceFlags?.hasCircuitBreaker) {
    if (wiringResult === undefined) score += 10; // backward compatible
    else score += wiringResult.flags.circuitBreakerInvoked ? 10 : 5; // wired=full, unwired=partial
  }
  if (evidenceFlags?.hasResilienceModule) score += 10;        // resilience module
  if (evidenceFlags?.hasE2EErrorHandlingTest) score += 10;    // E2E test coverage
  // Wiring bonus: extra credit for actively invoked modules beyond the above
  if (wiringResult) score += Math.floor(computeWiringBonus(wiringResult) / 4); // scaled down
  return Math.max(0, Math.min(95, score));                    // ceiling: 95 (display: 9.5/10)
}

export function computeTokenEconomyScore(state: DanteState): number {
  // Access optional state fields safely via record pattern
  const s = state as unknown as Record<string, unknown>;
  let score = 40; // base: task-router and budget systems exist
  if (typeof s['maxBudgetUsd'] === 'number' && s['maxBudgetUsd'] > 0) score += 20;
  if (s['routingAggressiveness']) score += 15;
  if (s['lastComplexityPreset']) score += 15;
  // Active budget-tracked usage: tokens used is the real signal.
  // autoforgeFailedAttempts are normal during iterative development and should not penalise.
  if (typeof s['totalTokensUsed'] === 'number' && s['totalTokensUsed'] >= 1000) score += 10;
  return Math.max(0, Math.min(100, score));
}

export function computeEcosystemMcpScore(state: DanteState, _cwd: string): number {
  const s = state as unknown as Record<string, unknown>;
  let score = 30; // base: MCP server + skill system exists
  const skillCount = typeof s['skillCount'] === 'number' ? s['skillCount'] : 0;
  if (skillCount >= 10) score += 25;
  else if (skillCount >= 5) score += 15;
  else if (skillCount > 0) score += 8;
  const mcpToolCount = typeof s['mcpToolCount'] === 'number' ? s['mcpToolCount'] : 15;
  if (mcpToolCount >= 15) score += 20;
  else if (mcpToolCount >= 5) score += 10;
  if (s['hasPluginManifest']) score += 15;
  if ((typeof s['providerCount'] === 'number' ? s['providerCount'] : 5) >= 5) score += 10;
  return Math.max(0, Math.min(100, score));
}

export function computeEnterpriseReadinessScore(
  state: DanteState,
  assessment: MaturityAssessment,
): number {
  const s = state as unknown as Record<string, unknown>;
  let score = 15; // base: audit log exists
  const auditEntries = state.auditLog?.length ?? 0;
  if (auditEntries > 20) score += 20;
  else if (auditEntries > 5) score += 10;
  if (s['selfEditPolicy'] === 'deny' || s['selfEditPolicy'] === 'prompt') score += 15;
  if (assessment.dimensions.security >= 80) score += 20;
  else if (assessment.dimensions.security >= 70) score += 10;
  if (s['lastVerifyReceiptPath']) score += 15;
  return Math.max(0, Math.min(100, score));
}

// ── Community Adoption — real GitHub + npm signals ──────────────────────────

export interface CommunityMetrics {
  npmDownloadsMonthly?: number;
  githubStars?: number;
  githubContributors?: number;
}

/** Fetches real community signals from npm registry and GitHub API. Best-effort — returns {} on any failure. */
export async function fetchCommunityMetrics(
  packageName: string,
  repoSlug: string,
  opts: { _fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<CommunityMetrics> {
  const fetcher = opts._fetch ?? fetch;
  const timeout = opts.timeoutMs ?? 5000;
  const result: CommunityMetrics = {};

  // npm monthly downloads
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetcher(
      `https://api.npmjs.org/downloads/point/last-month/${packageName}`,
      { signal: ctrl.signal },
    );
    clearTimeout(t);
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      if (typeof data['downloads'] === 'number') {
        result.npmDownloadsMonthly = data['downloads'] as number;
      }
    }
  } catch { /* best-effort */ }

  // GitHub stars + contributors
  if (repoSlug) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetcher(
        `https://api.github.com/repos/${repoSlug}`,
        { signal: ctrl.signal, headers: { 'User-Agent': 'danteforge-scorer/1.0' } },
      );
      clearTimeout(t);
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        if (typeof data['stargazers_count'] === 'number') {
          result.githubStars = data['stargazers_count'] as number;
        }
      }
    } catch { /* best-effort */ }

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetcher(
        `https://api.github.com/repos/${repoSlug}/contributors?per_page=1&anon=false`,
        { signal: ctrl.signal, headers: { 'User-Agent': 'danteforge-scorer/1.0' } },
      );
      clearTimeout(t);
      if (res.ok) {
        const link = res.headers.get('link') ?? '';
        // Extract last page count from Link header: rel="last"
        const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
        if (match) {
          result.githubContributors = parseInt(match[1], 10);
        } else {
          const data = await res.json() as unknown[];
          result.githubContributors = Array.isArray(data) ? data.length : undefined;
        }
      }
    } catch { /* best-effort */ }
  }

  return result;
}

export function computeCommunityAdoptionScore(metrics: CommunityMetrics = {}): number {
  let score = 15; // base: project exists with git history

  // GitHub stars (max 60)
  const stars = metrics.githubStars ?? 0;
  if (stars >= 1000) score += 60;
  else if (stars >= 500) score += 40;
  else if (stars >= 100) score += 20;
  else if (stars >= 1) score += 10;

  // npm monthly downloads (max 30)
  const downloads = metrics.npmDownloadsMonthly ?? 0;
  if (downloads >= 10000) score += 30;
  else if (downloads >= 1000) score += 25;
  else if (downloads >= 100) score += 15;
  else if (downloads >= 1) score += 5;

  // Contributors (max 10)
  const contributors = metrics.githubContributors ?? 1;
  if (contributors >= 6) score += 10;
  else if (contributors >= 2) score += 5;

  return Math.max(0, Math.min(100, score));
}

// ── Real coverage % reader ────────────────────────────────────────────────────

/** Reads coverage percentage from c8 summary files. Returns null if not found. */
export async function readCoveragePercent(
  cwd: string,
  _readFile?: (p: string) => Promise<string>,
): Promise<number | null> {
  const readFile = _readFile ?? ((p: string) => fs.readFile(p, 'utf-8'));
  const candidates = [
    path.join(cwd, '.danteforge', 'coverage-summary.json'),
    path.join(cwd, 'coverage', 'coverage-summary.json'),
  ];
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate);
      const data = JSON.parse(raw) as Record<string, unknown>;
      const total = data['total'] as Record<string, unknown> | undefined;
      const lines = total?.['lines'] as Record<string, unknown> | undefined;
      const pct = lines?.['pct'];
      if (typeof pct === 'number') return pct;
    } catch { /* try next */ }
  }
  return null;
}

// ── Score helpers ─────────────────────────────────────────────────────────────

export function computeWeightedScore(dims: Record<ScoringDimension, number>): number {
  return Object.entries(DIMENSION_WEIGHTS).reduce(
    (sum, [k, w]) => sum + (dims[k as ScoringDimension] ?? 0) * w,
    0,
  );
}

export function computeHarshVerdict(
  harshScore: number,
  dims: Record<ScoringDimension, number>,
): HarshVerdict {
  if (harshScore < HARSH_THRESHOLDS.NEEDS_WORK) return 'blocked';
  const allAcceptable = Object.values(dims).every((v) => v >= HARSH_THRESHOLDS.ACCEPTABLE);
  if (harshScore >= HARSH_THRESHOLDS.EXCELLENT && allAcceptable) return 'excellent';
  if (harshScore >= HARSH_THRESHOLDS.ACCEPTABLE && allAcceptable) return 'acceptable';
  return 'needs-work';
}

export function computeFakeCompletionRisk(
  overallCompletion: number,
  currentMaturityLevel: MaturityLevel,
  targetLevel: MaturityLevel,
): 'low' | 'medium' | 'high' {
  if (overallCompletion >= 95 && currentMaturityLevel < targetLevel) return 'high';
  if (overallCompletion >= 80 && currentMaturityLevel < targetLevel - 1) return 'medium';
  return 'low';
}

// ── Progress bar renderer ─────────────────────────────────────────────────────

export function formatDimensionBar(score: number, maxWidth = 10): string {
  const filled = Math.min(maxWidth, Math.round(Math.max(0, Math.min(100, score)) / 10));
  return '█'.repeat(filled) + '░'.repeat(maxWidth - filled);
}

// ── History I/O ───────────────────────────────────────────────────────────────

export async function readAssessmentHistory(cwd: string): Promise<AssessmentHistoryEntry[]> {
  const historyPath = path.join(cwd, '.danteforge', 'assessment-history.json');
  try {
    const content = await fs.readFile(historyPath, 'utf-8');
    return JSON.parse(content) as AssessmentHistoryEntry[];
  } catch {
    return [];
  }
}

export async function writeAssessmentHistory(
  cwd: string,
  entries: AssessmentHistoryEntry[],
): Promise<void> {
  const dir = path.join(cwd, '.danteforge');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'assessment-history.json'), JSON.stringify(entries, null, 2));
}

// ── File listing ──────────────────────────────────────────────────────────────

async function listSourceFiles(cwd: string): Promise<string[]> {
  const srcDir = path.join(cwd, 'src');
  try {
    return await walkDir(srcDir, cwd, '.ts');
  } catch {
    return [];
  }
}

async function walkDir(dir: string, base: string, ext: string): Promise<string[]> {
  const results: string[] = [];
  let entries: { name: string; isDirectory: () => boolean }[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await walkDir(full, base, ext);
      results.push(...sub);
    } else if (entry.name.endsWith(ext)) {
      results.push(path.relative(base, full));
    }
  }
  return results;
}

// ── Strict (tamper-resistant) Dimension Scoring ───────────────────────────────
//
// These scores are derived entirely from verifiable code signals:
// git commit history, evidence files written by the CI/test pipeline,
// and LLM cache entry counts. STATE.yaml config fields (retroDelta,
// lastVerifyStatus, lastComplexityPreset, autoforgeFailedAttempts, etc.)
// are deliberately excluded — they are mutable and were observed to be
// manually inflated during ascend/score runs, producing false high scores.

export interface StrictDimensions {
  /** autonomy: derived from git commit count + verify evidence files */
  autonomy: number;
  /** selfImprovement: derived from retro commits in git log + evidence files */
  selfImprovement: number;
  /** tokenEconomy: derived from LLM cache entry count + router code presence */
  tokenEconomy: number;
  /** specDrivenPipeline: derived from PDSE artifact presence on disk */
  specDrivenPipeline: number;
  /** developerExperience: derived from onboarding docs + examples + test count */
  developerExperience: number;
  /** planningQuality: derived from planning artifacts + git plan/spec commits */
  planningQuality: number;
  /** convergenceSelfHealing: derived from circuit-breaker + autoforge evidence */
  convergenceSelfHealing: number;
}

type GitLogFn = (args: string[], cwd: string) => Promise<string>;
type ExistsFn = (p: string) => Promise<boolean>;
type ListDirFn = (p: string) => Promise<string[]>;

/**
 * Compute tamper-resistant scores for the three dimensions most vulnerable to
 * STATE.yaml manipulation. Called by `score --strict`.
 *
 * All signals are read-only observations of filesystem/git state.
 * Scores are clamped [0, 100] (display: N/10).
 */
export async function computeStrictDimensions(
  cwd: string,
  gitLogFn?: GitLogFn,
  existsFn?: ExistsFn,
  listDirFn?: ListDirFn,
): Promise<StrictDimensions> {
  const runGit: GitLogFn = gitLogFn ?? (async (args, dir) => {
    const { execSync } = await import('node:child_process');
    try {
      return execSync(`git ${args.join(' ')}`, {
        encoding: 'utf8',
        cwd: dir,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch {
      return '';
    }
  });

  const checkExists: ExistsFn = existsFn ?? (async (p) => {
    try { await fs.access(p); return true; } catch { return false; }
  });

  const listDir: ListDirFn = listDirFn ?? (async (p) => {
    try {
      const entries = await fs.readdir(p);
      return entries;
    } catch { return []; }
  });

  // ── autonomy ─────────────────────────────────────────────────────────────────
  // Base: 20. Signals: git commit count (code was actually written), verify evidence.
  let autonomy = 20;

  const commitLog = await runGit(['log', '--oneline', '--no-merges'], cwd);
  const commitCount = commitLog.trim() === '' ? 0 : commitLog.trim().split('\n').length;
  if (commitCount >= 100) autonomy += 30;
  else if (commitCount >= 30) autonomy += 20;
  else if (commitCount >= 10) autonomy += 10;
  else if (commitCount >= 1) autonomy += 5;

  // Evidence: verify receipts written by the test pipeline
  const verifyEvidenceDir = path.join(cwd, '.danteforge', 'evidence', 'verify');
  const verifyFiles = await listDir(verifyEvidenceDir);
  if (verifyFiles.length >= 5) autonomy += 25;
  else if (verifyFiles.length >= 2) autonomy += 15;
  else if (verifyFiles.length >= 1) autonomy += 8;

  // Evidence: autoforge loop evidence (state machine ran)
  const autoforgeEvidenceExists = await checkExists(path.join(cwd, '.danteforge', 'evidence', 'autoforge'));
  if (autoforgeEvidenceExists) autonomy += 15;

  // Evidence: harvest receipt present (OSS learning occurred)
  const harvestReceiptExists = await checkExists(path.join(cwd, '.danteforge', 'evidence', 'oss-harvest.json'));
  if (harvestReceiptExists) autonomy += 10;

  autonomy = Math.max(0, Math.min(100, autonomy));

  // ── selfImprovement ───────────────────────────────────────────────────────────
  // Base: 20. Signals: retro commits in git log, retro evidence files.
  let selfImprovement = 20;

  const retroCommits = await runGit(['log', '--oneline', '--grep=retro', '--no-merges'], cwd);
  const retroCount = retroCommits.trim() === '' ? 0 : retroCommits.trim().split('\n').length;
  if (retroCount >= 10) selfImprovement += 25;
  else if (retroCount >= 3) selfImprovement += 15;
  else if (retroCount >= 1) selfImprovement += 8;

  const lessonCommits = await runGit(['log', '--oneline', '--grep=lesson', '--no-merges'], cwd);
  const lessonCount = lessonCommits.trim() === '' ? 0 : lessonCommits.trim().split('\n').length;
  if (lessonCount >= 10) selfImprovement += 20;
  else if (lessonCount >= 3) selfImprovement += 12;
  else if (lessonCount >= 1) selfImprovement += 5;

  // Evidence: retro evidence files written by the pipeline
  const retroEvidenceDir = path.join(cwd, '.danteforge', 'evidence', 'retro');
  const retroFiles = await listDir(retroEvidenceDir);
  if (retroFiles.length >= 5) selfImprovement += 20;
  else if (retroFiles.length >= 2) selfImprovement += 12;
  else if (retroFiles.length >= 1) selfImprovement += 6;

  // Lessons file exists and has content
  const lessonsExists = await checkExists(path.join(cwd, '.danteforge', 'lessons.md'));
  if (lessonsExists) selfImprovement += 15;

  // Evidence: retro session outputs in .danteforge/retros/ — each file = a retrospective was run
  // (different from evidence/retro/ which holds pipeline-stamped receipts)
  const retrosOutputDir = path.join(cwd, '.danteforge', 'retros');
  const retrosOutputFiles = await listDir(retrosOutputDir);
  if (retrosOutputFiles.length >= 10) selfImprovement += 15;
  else if (retrosOutputFiles.length >= 3) selfImprovement += 8;
  else if (retrosOutputFiles.length >= 1) selfImprovement += 3;

  selfImprovement = Math.max(0, Math.min(100, selfImprovement));

  // ── tokenEconomy ──────────────────────────────────────────────────────────────
  // Base: 20. Signals: LLM cache entry count, task-router source file exists.
  let tokenEconomy = 20;

  // Task-router source signals routing infrastructure
  const taskRouterExists = await checkExists(path.join(cwd, 'src', 'core', 'task-router.ts'));
  if (taskRouterExists) tokenEconomy += 20;

  // Circuit breaker signals budget/reliability controls
  const circuitBreakerExists = await checkExists(path.join(cwd, 'src', 'core', 'circuit-breaker.ts'));
  if (circuitBreakerExists) tokenEconomy += 15;

  // LLM cache entries prove real budget-aware calls were made
  const llmCacheDir = path.join(cwd, '.danteforge', 'cache');
  const cacheFiles = await listDir(llmCacheDir);
  if (cacheFiles.length >= 50) tokenEconomy += 30;
  else if (cacheFiles.length >= 10) tokenEconomy += 20;
  else if (cacheFiles.length >= 1) tokenEconomy += 10;

  // Context compressor signals token reduction infrastructure
  const compressorExists = await checkExists(path.join(cwd, 'src', 'core', 'context-compressor.ts'));
  if (compressorExists) tokenEconomy += 15;

  tokenEconomy = Math.max(0, Math.min(100, tokenEconomy));

  // ── specDrivenPipeline ────────────────────────────────────────────────────────
  // Base: 10. Signals: PDSE artifact files on disk, pipeline evidence, e2e tests.
  // Capped at 85 — file existence can't fully prove pipeline execution quality.
  let specDrivenPipeline = 10;

  const pdseArtifacts = ['CONSTITUTION.md', 'SPEC.md', 'PLAN.md', 'TASKS.md'];
  for (const artifact of pdseArtifacts) {
    if (await checkExists(path.join(cwd, artifact))) specDrivenPipeline += 15;
    else if (await checkExists(path.join(cwd, '.danteforge', artifact))) specDrivenPipeline += 15;
  }

  const evidenceDir = path.join(cwd, '.danteforge', 'evidence');
  const evidenceFiles = await listDir(evidenceDir);
  if (evidenceFiles.length >= 1) specDrivenPipeline += 10;

  const testFiles = await listDir(path.join(cwd, 'tests'));
  const hasE2ETest = testFiles.some(f => f.includes('e2e') || f.includes('integration'));
  if (hasE2ETest) specDrivenPipeline += 5;

  specDrivenPipeline = Math.max(0, Math.min(85, specDrivenPipeline));

  // ── developerExperience ───────────────────────────────────────────────────────
  // Base: 15. Signals: onboarding docs, examples directory, test suite depth.
  let developerExperience = 15;

  if (await checkExists(path.join(cwd, 'CLAUDE.md'))) developerExperience += 20;

  try {
    const readmePath = path.join(cwd, 'README.md');
    const { readFile } = await import('node:fs/promises');
    const readmeContent = await readFile(readmePath, 'utf8').catch(() => '');
    if (readmeContent.length > 500) developerExperience += 15;
  } catch { /* non-fatal */ }

  const examplesFiles = await listDir(path.join(cwd, 'examples'));
  if (examplesFiles.length >= 1) developerExperience += 20;

  if (testFiles.length >= 100) developerExperience += 15;
  else if (testFiles.length >= 50) developerExperience += 10;
  else if (testFiles.length >= 10) developerExperience += 5;

  developerExperience = Math.max(0, Math.min(100, developerExperience));

  // ── planningQuality ───────────────────────────────────────────────────────────
  // Base: 15. Signals: PDSE planning artifacts + git commits with plan/spec keywords.
  let planningQuality = 15;

  const planningArtifacts: [string, number][] = [
    ['PLAN.md', 20], ['SPEC.md', 15], ['CONSTITUTION.md', 15], ['CLARIFY.md', 15],
  ];
  for (const [artifact, pts] of planningArtifacts) {
    const exists = await checkExists(path.join(cwd, artifact))
      || await checkExists(path.join(cwd, '.danteforge', artifact));
    if (exists) planningQuality += pts;
  }

  const planCommits = await runGit(['log', '--oneline', '--grep=plan', '--no-merges'], cwd);
  const planCount = planCommits.trim() === '' ? 0 : planCommits.trim().split('\n').length;
  if (planCount >= 3) planningQuality += 10;

  const specCommits = await runGit(['log', '--oneline', '--grep=spec', '--no-merges'], cwd);
  const specCount = specCommits.trim() === '' ? 0 : specCommits.trim().split('\n').length;
  if (specCount >= 3) planningQuality += 10;

  planningQuality = Math.max(0, Math.min(100, planningQuality));

  // ── convergenceSelfHealing ────────────────────────────────────────────────────
  // Base: 15. Signals: circuit-breaker, context-compressor, autoforge evidence.
  let convergenceSelfHealing = 15;

  if (await checkExists(path.join(cwd, 'src', 'core', 'circuit-breaker.ts'))) convergenceSelfHealing += 25;
  if (await checkExists(path.join(cwd, 'src', 'core', 'context-compressor.ts'))) convergenceSelfHealing += 20;

  const autoforgeEvidenceDir = path.join(cwd, '.danteforge', 'evidence', 'autoforge');
  const autoforgeEvidenceFiles = await listDir(autoforgeEvidenceDir);
  if (autoforgeEvidenceFiles.length >= 3) convergenceSelfHealing += 15;
  else if (autoforgeEvidenceFiles.length >= 1) convergenceSelfHealing += 8;

  const convergenceProof = await checkExists(path.join(cwd, '.danteforge', 'evidence', 'convergence-proof.json'))
    || await checkExists(path.join(cwd, 'examples', 'todo-app', 'evidence', 'convergence-proof.json'));
  if (convergenceProof) convergenceSelfHealing += 10;

  convergenceSelfHealing = Math.max(0, Math.min(100, convergenceSelfHealing));

  return { autonomy, selfImprovement, tokenEconomy, specDrivenPipeline, developerExperience, planningQuality, convergenceSelfHealing };
}
