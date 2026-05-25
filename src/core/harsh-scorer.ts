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
import { KNOWN_CEILINGS } from './compete-matrix.js';
import {
  computeCausalCoherenceScore,
  computeCommunityAdoptionScore,
  fetchCommunityMetrics,
  listSourceFiles,
  readAssessmentHistory,
  readCoveragePercent,
  writeAssessmentHistory,
  type CommunityMetrics,
  type CommunityReadinessScore,
} from './harsh-scorer-community.js';
import { assessCommunityReadiness, fetchCommunityData } from './harsh-scorer-community-readiness.js';
import { computeStrictDimensions, type StrictDimensions } from './harsh-scorer-strict.js';
import {
  computeContextEconomyScore,
  computeEcosystemMcpScore,
  computeEnterpriseReadinessScore,
  detectMcpToolCountSync,
  detectPluginManifestSync,
  detectSkillCountSync,
} from './harsh-scorer-ecosystem.js';
import { computeFakeCompletionRisk } from './harsh-scorer-display.js';
export {
  computeCausalCoherenceScore,
  computeCommunityAdoptionScore,
  fetchCommunityMetrics,
  readAssessmentHistory,
  readCoveragePercent,
  writeAssessmentHistory,
  type CommunityMetrics,
} from './harsh-scorer-community.js';
export { computeStrictDimensions, makeFileChecker, type StrictDimensions } from './harsh-scorer-strict.js';
export {
  computeContextEconomyScore,
  computeEcosystemMcpScore,
  computeEnterpriseReadinessScore,
  detectMcpToolCountSync,
  detectPluginManifestSync,
  detectSkillCountSync,
} from './harsh-scorer-ecosystem.js';
export { computeFakeCompletionRisk, formatDimensionBar } from './harsh-scorer-display.js';

// ── 20-Dimension Scoring Type ────────────────────────────────────────────────
// Extends the 8 existing MaturityDimensions with 12 competitor-facing ones.

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
  // 8 strategic differentiation dimensions
  | 'specDrivenPipeline'      // PDSE artifact presence + pipeline stage completeness
  | 'convergenceSelfHealing'  // Verify-repair loops, convergence cycles, auto-recovery
  | 'tokenEconomy'            // Task routing, budget fences, complexity classification
  | 'contextEconomy'          // Filter pipeline, sacred-content preservation, savings telemetry (Article XIV)
  | 'ecosystemMcp'            // MCP tools, skills, plugin manifest breadth
  | 'enterpriseReadiness'     // Audit trails, safe-self-edit, RBAC, compliance
  | 'communityAdoption'       // npm downloads, GitHub stars, contributor count
  | 'causalCoherence';        // Prediction accuracy of convergence loop forward model (Article XV)

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

export interface CanonicalScore {
  /** Overall score on the public 0.0-10.0 scale after harsh scoring and strict overrides. */
  overall: number;
  /** Per-dimension scores on the public 0.0-10.0 scale after strict overrides. */
  dimensions: Record<ScoringDimension, number>;
  /** ISO timestamp for the cache artifact. For git repos this is the HEAD commit date. */
  computedAt: string;
  /** Git SHA used as the cache key. */
  gitSha: string;
  /** Schema marker for external agents. */
  source: 'canonical-v1';
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
const _NI = 'not ' + 'implemented';
const STUB_PATTERNS = [
  new RegExp(`\\/\\/ ${_T}`, 'i'),
  new RegExp(`\\/\\/ ${_F}`, 'i'),
  new RegExp(`throw new Error\\(['"]${_NI}`, 'i'),
  new RegExp(`return null; \\/\\/ ${_T}`, 'i'),
  new RegExp(`${_PH} implementation`, 'i'),
  /stub implementation/i,
];

// ── Dimension Weights (sum = 1.0) ─────────────────────────────────────────────

// Weights sum exactly to 1.0 (20 dimensions)
// causalCoherence 0.05 funded by: functionality 0.11→0.09, testing 0.09→0.08, autonomy 0.07→0.06
const DIMENSION_WEIGHTS: Record<ScoringDimension, number> = {
  functionality: 0.08,
  testing: 0.08,
  errorHandling: 0.08,
  security: 0.08,
  uxPolish: 0.06,
  documentation: 0.06,
  performance: 0.06,
  maintainability: 0.07,
  developerExperience: 0.08,
  autonomy: 0.06,
  planningQuality: 0.05,
  selfImprovement: 0.04,
  specDrivenPipeline: 0.03,
  convergenceSelfHealing: 0.03,
  tokenEconomy: 0.03,
  contextEconomy: 0.03,
  ecosystemMcp: 0.01,
  enterpriseReadiness: 0.01,
  communityAdoption: 0.01,
  causalCoherence: 0.05,
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
  /** Injection seam: override local community readiness analysis for testing */
  _assessCommunityReadiness?: (cwd: string) => Promise<CommunityReadinessScore>;
  /** Injection seam: override coverage file read for testing */
  _readCoverage?: (cwd: string) => Promise<number | null>;
  /** Injection seam: override integration wiring check for testing */
  _checkIntegrationWiring?: (opts: IntegrationWiringOptions) => Promise<IntegrationWiringResult>;
  /** Injection seam: override enterprise evidence detection for testing */
  _readEnterpriseProof?: (cwd: string) => Promise<EnterpriseEvidenceFlags>;
}

// ── Main scoring function ─────────────────────────────────────────────────────

async function gatherEvidenceFlags(
  cwd: string,
  options: HarshScorerOptions,
  existsFn: (p: string) => Promise<boolean>,
): Promise<{ evidenceFlags: PipelineEvidenceFlags; convergenceFlags: ConvergenceEvidenceFlags; errorHandlingFlags: ErrorHandlingEvidenceFlags; enterpriseFlags: EnterpriseEvidenceFlags }> {
  const pipelineEvidencePaths = [
    path.join(cwd, 'examples', 'todo-app', 'evidence', 'pipeline-run.json'),
    path.join(cwd, '.danteforge', 'evidence', 'pipeline-proof.json'),
  ];
  const hasPipelineEvidence = (await Promise.all(pipelineEvidencePaths.map(existsFn))).some(Boolean);
  const hasE2ETest = await existsFn(path.join(cwd, 'tests', 'e2e-spec-pipeline.test.ts'));
  const evidenceFlags: PipelineEvidenceFlags = { hasPipelineEvidence, hasE2ETest };

  const convergenceProofPaths = [
    path.join(cwd, 'examples', 'todo-app', 'evidence', 'convergence-proof.json'),
    path.join(cwd, '.danteforge', 'evidence', 'convergence-proof.json'),
  ];
  const hasConvergenceProof = (await Promise.all(convergenceProofPaths.map(existsFn))).some(Boolean);
  const hasE2EConvergenceTest = await existsFn(path.join(cwd, 'tests', 'e2e-convergence.test.ts'));
  const convergenceFlags: ConvergenceEvidenceFlags = options._readConvergenceProof
    ? await options._readConvergenceProof(cwd)
    : { hasConvergenceProof, hasE2EConvergenceTest };

  // Monorepo-aware: check both src/core/<file>.ts (single-package) and
  // packages/<pkg>/src/<file>.ts (monorepo). Without this, mature monorepo
  // projects with full error hierarchies score 0 on these flags.
  const checkErrFile = async (filename: string): Promise<boolean> => {
    if (await existsFn(path.join(cwd, 'src', 'core', filename))) return true;
    // Probe known package src dirs (covers both turbo/npm-workspaces layouts)
    for (const pkg of ['core', 'cli', 'vscode', 'sandbox', 'mcp']) {
      if (await existsFn(path.join(cwd, 'packages', pkg, 'src', filename))) return true;
    }
    return false;
  };
  const checkErrTest = async (filename: string): Promise<boolean> => {
    if (await existsFn(path.join(cwd, 'tests', filename))) return true;
    // Monorepo: tests live next to source as packages/<pkg>/src/<...>.test.ts
    for (const pkg of ['core', 'cli', 'vscode']) {
      if (await existsFn(path.join(cwd, 'packages', pkg, 'src', filename.replace('.test.ts', '.test.ts')))) return true;
      if (await existsFn(path.join(cwd, 'packages', pkg, 'src', '__tests__', filename))) return true;
    }
    return false;
  };
  const hasErrorHierarchy = await checkErrFile('errors.ts');
  const hasCircuitBreaker = await checkErrFile('circuit-breaker.ts');
  const hasResilienceModule = await checkErrFile('resilience.ts');
  const hasE2EErrorHandlingTest = await checkErrTest('e2e-error-handling.test.ts')
    || await checkErrTest('errors.test.ts');  // monorepo unit test counts as evidence
  const errorHandlingFlags: ErrorHandlingEvidenceFlags = options._readErrorHandlingProof
    ? await options._readErrorHandlingProof(cwd)
    : { hasErrorHierarchy, hasCircuitBreaker, hasResilienceModule, hasE2EErrorHandlingTest };

  let enterpriseFlags: EnterpriseEvidenceFlags;
  if (options._readEnterpriseProof) {
    enterpriseFlags = await options._readEnterpriseProof(cwd);
  } else {
    const securityPath = path.join(cwd, 'SECURITY.md');
    const hasSecurityFile = await existsFn(securityPath);
    let hasSecurityPolicy = false;
    if (hasSecurityFile) {
      try {
        const secContent = await fs.readFile(securityPath, 'utf8');
        hasSecurityPolicy = secContent.length > 200;
      } catch { /* best-effort */ }
    }
    const changelogPath = path.join(cwd, 'CHANGELOG.md');
    let hasVersionedChangelog = false;
    if (await existsFn(changelogPath)) {
      try {
        const clContent = await fs.readFile(changelogPath, 'utf8');
        const versionHeadings = clContent.match(/^## \[?\d+\.\d+/gm) ?? [];
        hasVersionedChangelog = versionHeadings.length >= 2;
      } catch { /* best-effort */ }
    }
    const hasRunbook = await existsFn(path.join(cwd, 'docs', 'RUNBOOK.md'));
    const hasContributing = await existsFn(path.join(cwd, 'CONTRIBUTING.md'));
    enterpriseFlags = { hasSecurityPolicy, hasVersionedChangelog, hasRunbook, hasContributing };
  }

  return { evidenceFlags, convergenceFlags, errorHandlingFlags, enterpriseFlags };
}

async function computeAugmentedTestingScore(
  dims: MaturityDimensions,
  coveragePct: number | null,
  cwd: string,
  existsFn: (p: string) => Promise<boolean>,
): Promise<number> {
  let score = coveragePct !== null
    ? Math.round((dims.testing * 0.4) + (Math.min(coveragePct, 100) * 0.6))
    : dims.testing;
  if (await existsFn(path.join(cwd, 'tests', 'mutation-score.test.ts'))) {
    score = Math.min(100, score + 3);
  }
  if (await existsFn(path.join(cwd, 'tests', 'v090-adversarial.test.ts')) ||
      await existsFn(path.join(cwd, 'tests', 'adversarial-scorer-dim.test.ts'))) {
    score = Math.min(100, score + 2);
  }
  return score;
}

async function applyAllPenalties(
  cwd: string,
  dims: MaturityDimensions,
  completionTracker: { overall: number },
  maturityAssessment: MaturityAssessment,
  targetLevel: MaturityLevel,
  listFilesFn: (cwd: string) => Promise<string[]>,
  readFileFn: (p: string) => Promise<string>,
  readHistoryFn: (cwd: string) => Promise<AssessmentHistoryEntry[]>,
): Promise<{ penalties: HarshPenalty[]; stubsDetected: string[]; fakeCompletionRisk: 'low' | 'medium' | 'high' }> {
  const penalties: HarshPenalty[] = [];
  const stubsDetected: string[] = [];

  const sourceFiles = await listFilesFn(cwd);
  let stubPenalty = 0;
  for (const file of sourceFiles.slice(0, 50)) {
    try {
      const content = await readFileFn(path.join(cwd, file));
      if (STUB_PATTERNS.some((p) => p.test(content))) {
        stubsDetected.push(file);
        stubPenalty = Math.min(stubPenalty + 10, MAX_STUB_PENALTY);
      }
    } catch { /* ignore unreadable files */ }
  }
  if (stubPenalty > 0) {
    penalties.push({ category: 'stub-detection', reason: `Stub marker patterns detected in ${stubsDetected.length} file(s)`, deduction: stubPenalty, evidence: stubsDetected.slice(0, 3).join(', ') });
  }

  const fakeCompletionRisk = computeFakeCompletionRisk(completionTracker.overall, scoreToMaturityLevel(maturityAssessment.overallScore), targetLevel);
  if (fakeCompletionRisk === 'high') {
    penalties.push({ category: 'fake-completion', reason: `Completion tracker reports ${completionTracker.overall.toFixed(0)}% but maturity level is below target`, deduction: 20, evidence: `overall=${completionTracker.overall.toFixed(0)}%, maturity=${scoreToMaturityLevel(maturityAssessment.overallScore)}, target=${targetLevel}` });
  } else if (fakeCompletionRisk === 'medium') {
    penalties.push({ category: 'fake-completion', reason: `Completion tracker shows ${completionTracker.overall.toFixed(0)}% but maturity is 2+ levels below target`, deduction: 10, evidence: `maturity=${scoreToMaturityLevel(maturityAssessment.overallScore)}, target=${targetLevel}` });
  }

  if (dims.testing < 70) {
    penalties.push({ category: 'test-coverage', reason: `Testing dimension at ${dims.testing}/100 (threshold: 70)`, deduction: 15, evidence: `dimensions.testing=${dims.testing}` });
  }

  try {
    const history = await readHistoryFn(cwd);
    if (history.length >= 3) {
      const lastThree = history.slice(-3).map((e) => e.harshScore);
      const range = Math.max(...lastThree) - Math.min(...lastThree);
      if (range <= 2) {
        penalties.push({ category: 'plateau', reason: `Score plateau: last 3 cycles scored ${lastThree.join(', ')} (range ≤ 2)`, deduction: 5, evidence: `scores=${lastThree.join(',')}` });
      }
    }
  } catch { /* history unavailable — no penalty */ }

  if (dims.errorHandling < 50) {
    const deduction = Math.min(Math.floor((50 - dims.errorHandling) / 10) * 3, MAX_ERROR_HANDLING_PENALTY);
    if (deduction > 0) {
      penalties.push({ category: 'error-handling', reason: `Error handling critically low at ${dims.errorHandling}/100`, deduction, evidence: `dimensions.errorHandling=${dims.errorHandling}` });
    }
  }

  return { penalties, stubsDetected, fakeCompletionRisk };
}

async function persistHarshHistory(
  cwd: string,
  harshScore: number,
  displayScore: number,
  dimensions: Record<ScoringDimension, number>,
  penaltyTotal: number,
  timestamp: string,
  readHistoryFn: (cwd: string) => Promise<AssessmentHistoryEntry[]>,
  writeHistoryFn: (cwd: string, entries: AssessmentHistoryEntry[]) => Promise<void>,
): Promise<void> {
  try {
    const history = await readHistoryFn(cwd).catch(() => []);
    await writeHistoryFn(cwd, [...history, { timestamp, harshScore, displayScore, dimensions, penaltyTotal }]);
  } catch { /* best-effort */ }
}

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

  const state = await loadStateFn({ cwd });
  const pdseScores = await scoreArtifactsFn(cwd, state);
  const maturityAssessment = await assessMaturityFn({ cwd, state, pdseScores, targetLevel });
  const completionTracker = computeTrackerFn(state, pdseScores as Record<ScoredArtifact, ScoreResult>);

  const { evidenceFlags, convergenceFlags, errorHandlingFlags, enterpriseFlags } = await gatherEvidenceFlags(cwd, options, existsFn);

  const wiringResult: IntegrationWiringResult | undefined = options._checkIntegrationWiring
    ? await options._checkIntegrationWiring({ cwd }).catch((): IntegrationWiringResult => ({
        wiringScore: 0,
        flags: { circuitBreakerInvoked: false, errorHierarchyThrown: false, auditLoggerWired: false, rateLimiterInvoked: false },
        unwiredModules: [],
      }))
    : undefined;

  const communityMetrics = await fetchCommunityData(cwd, options, readFileFn);
  const communityReadiness = await assessCommunityReadiness(cwd, options);
  const coveragePct = await (options._readCoverage ? options._readCoverage(cwd) : readCoveragePercent(cwd, readFileFn)).catch(() => null);

  let causalGlobalCoherence = 0;
  let causalTotalAttributions = 0;
  try {
    const { loadCausalWeightMatrix } = await import('./causal-weight-matrix.js');
    const matrix = await loadCausalWeightMatrix(cwd);
    causalGlobalCoherence = matrix.globalCausalCoherence;
    causalTotalAttributions = matrix.totalAttributions;
  } catch { /* best-effort — no matrix yet */ }

  const newDimensions = computeNewDimensions(pdseScores, state, maturityAssessment, cwd, evidenceFlags, convergenceFlags, communityMetrics, communityReadiness, enterpriseFlags, causalGlobalCoherence, causalTotalAttributions);

  const dims = maturityAssessment.dimensions;
  const testingScore = await computeAugmentedTestingScore(dims, coveragePct, cwd, existsFn);
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

  const rawScore = computeWeightedScore(dimensions);
  const { penalties, stubsDetected, fakeCompletionRisk } = await applyAllPenalties(
    cwd, dims, completionTracker, maturityAssessment, targetLevel, listFilesFn, readFileFn, readHistoryFn,
  );
  const totalPenalty = penalties.reduce((sum, p) => sum + p.deduction, 0);
  const harshScore = Math.max(0, Math.round(rawScore - totalPenalty));
  const displayScore = Math.round(harshScore / 10 * 10) / 10;
  const verdict = computeHarshVerdict(harshScore, dimensions);
  const displayDimensions = Object.fromEntries(
    Object.entries(dimensions).map(([k, v]) => [k, Math.round(v / 10 * 10) / 10]),
  ) as Record<ScoringDimension, number>;
  const timestamp = new Date().toISOString();

  const result: HarshScoreResult = {
    rawScore: Math.round(rawScore), harshScore, displayScore, dimensions, displayDimensions,
    penalties, stubsDetected, fakeCompletionRisk, verdict, maturityAssessment, timestamp,
    unwiredModules: wiringResult?.unwiredModules ?? [], wiringResult,
  };

  await persistHarshHistory(cwd, harshScore, displayScore, dimensions, totalPenalty, timestamp, readHistoryFn, writeHistoryFn);
  return result;
}

function roundDisplayScore(value: number): number {
  return Math.round(value * 10) / 10;
}

function allScoringDimensions(): ScoringDimension[] {
  return Object.keys(DIMENSION_WEIGHTS) as ScoringDimension[];
}

function scoreCachePath(cwd: string, gitSha: string): string {
  const safeSha = gitSha.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(cwd, '.danteforge', 'score-cache', `${safeSha}.json`);
}

function isCanonicalScore(value: unknown, gitSha: string): value is CanonicalScore {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<CanonicalScore>;
  if (candidate.source !== 'canonical-v1') return false;
  if (candidate.gitSha !== gitSha) return false;
  if (typeof candidate.overall !== 'number') return false;
  if (typeof candidate.computedAt !== 'string') return false;
  if (!candidate.dimensions || typeof candidate.dimensions !== 'object') return false;
  return allScoringDimensions().every((dim) => typeof candidate.dimensions?.[dim] === 'number');
}

async function readCanonicalCache(cwd: string, gitSha: string): Promise<CanonicalScore | null> {
  try {
    const raw = await fs.readFile(scoreCachePath(cwd, gitSha), 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    return isCanonicalScore(parsed, gitSha) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCanonicalCache(cwd: string, score: CanonicalScore): Promise<void> {
  const cachePath = scoreCachePath(cwd, score.gitSha);
  await fs.mkdir(path.dirname(cachePath), { recursive: true });
  await fs.writeFile(cachePath, JSON.stringify(score, null, 2) + '\n', 'utf8');
}

async function runGitText(cwd: string, args: string[]): Promise<string> {
  try {
    const { execFile } = await import('node:child_process');
    return await new Promise<string>((resolve) => {
      execFile('git', args, { cwd, windowsHide: true }, (error, stdout) => {
        resolve(error ? '' : String(stdout).trim());
      });
    });
  } catch {
    return '';
  }
}

async function getCanonicalGitSha(cwd: string): Promise<string> {
  return (await runGitText(cwd, ['rev-parse', 'HEAD'])) || 'no-git';
}

async function getCanonicalComputedAt(cwd: string): Promise<string> {
  return (await runGitText(cwd, ['show', '-s', '--format=%cI', 'HEAD'])) || new Date().toISOString();
}

export function applyCanonicalScoreToResult(result: HarshScoreResult, canonical: CanonicalScore): HarshScoreResult {
  result.displayScore = canonical.overall;
  result.displayDimensions = { ...canonical.dimensions };
  result.dimensions = Object.fromEntries(
    allScoringDimensions().map((dim) => [dim, roundDisplayScore((canonical.dimensions[dim] ?? 0) * 10)]),
  ) as Record<ScoringDimension, number>;
  result.rawScore = Math.round(computeWeightedScore(result.dimensions));
  result.harshScore = Math.round(canonical.overall * 10);
  result.verdict = computeHarshVerdict(result.harshScore, result.dimensions);
  return result;
}

export function canonicalScoreToHarshResult(canonical: CanonicalScore): HarshScoreResult {
  const dimensions = Object.fromEntries(
    allScoringDimensions().map((dim) => [dim, roundDisplayScore((canonical.dimensions[dim] ?? 0) * 10)]),
  ) as Record<ScoringDimension, number>;
  const maturityDimensions: MaturityDimensions = {
    functionality: dimensions.functionality,
    testing: dimensions.testing,
    errorHandling: dimensions.errorHandling,
    security: dimensions.security,
    uxPolish: dimensions.uxPolish,
    documentation: dimensions.documentation,
    performance: dimensions.performance,
    maintainability: dimensions.maintainability,
  };
  const maturityAssessment: MaturityAssessment = {
    currentLevel: scoreToMaturityLevel(canonical.overall * 10),
    targetLevel: 5,
    overallScore: canonical.overall * 10,
    dimensions: maturityDimensions,
    gaps: [],
    founderExplanation: 'Canonical cached score.',
    recommendation: canonical.overall >= 8.5 ? 'proceed' : 'refine',
    timestamp: canonical.computedAt,
  };
  return {
    rawScore: Math.round(computeWeightedScore(dimensions)),
    harshScore: Math.round(canonical.overall * 10),
    displayScore: canonical.overall,
    dimensions,
    displayDimensions: { ...canonical.dimensions },
    penalties: [],
    stubsDetected: [],
    fakeCompletionRisk: 'low',
    verdict: computeHarshVerdict(Math.round(canonical.overall * 10), dimensions),
    maturityAssessment,
    timestamp: canonical.computedAt,
    unwiredModules: [],
  };
}

export async function applyStrictOverrides(
  result: HarshScoreResult,
  cwd: string,
  computeStrictDimsFn: typeof computeStrictDimensions = computeStrictDimensions,
): Promise<HarshScoreResult> {
  const strict = await computeStrictDimsFn(cwd);
  const strictDisplay: Partial<Record<ScoringDimension, number>> = {
    autonomy: roundDisplayScore(strict.autonomy / 10),
    selfImprovement: roundDisplayScore(strict.selfImprovement / 10),
    tokenEconomy: roundDisplayScore(strict.tokenEconomy / 10),
    specDrivenPipeline: roundDisplayScore(strict.specDrivenPipeline / 10),
    developerExperience: roundDisplayScore(strict.developerExperience / 10),
    planningQuality: roundDisplayScore(strict.planningQuality / 10),
    convergenceSelfHealing: roundDisplayScore(strict.convergenceSelfHealing / 10),
  };

  for (const [dim, value] of Object.entries(strictDisplay) as [ScoringDimension, number][]) {
    result.displayDimensions[dim] = value;
  }

  for (const [dimId, { ceiling }] of Object.entries(KNOWN_CEILINGS)) {
    const dim = dimId as ScoringDimension;
    if (result.displayDimensions[dim] !== undefined) {
      result.displayDimensions[dim] = Math.min(result.displayDimensions[dim]!, ceiling);
    }
  }

  result.dimensions = Object.fromEntries(
    allScoringDimensions().map((dim) => [dim, roundDisplayScore((result.displayDimensions[dim] ?? 0) * 10)]),
  ) as Record<ScoringDimension, number>;

  const weightedRaw = computeWeightedScore(result.dimensions);
  const penaltyTotal = (result.penalties ?? []).reduce((sum, penalty) => sum + penalty.deduction, 0);
  result.rawScore = Math.round(weightedRaw);
  result.harshScore = Math.max(0, Math.round(weightedRaw - penaltyTotal));
  result.displayScore = roundDisplayScore(result.harshScore / 10);
  result.verdict = computeHarshVerdict(result.harshScore, result.dimensions);
  return result;
}

export async function computeCanonicalScore(cwd: string): Promise<CanonicalScore> {
  const gitSha = await getCanonicalGitSha(cwd);
  const cached = await readCanonicalCache(cwd, gitSha);
  if (cached) return cached;

  const harsh = await computeHarshScore({
    cwd,
    _readHistory: async () => [],
    _writeHistory: async () => {},
    _fetchCommunity: async () => ({}),
  });
  await applyStrictOverrides(harsh, cwd, computeStrictDimensions);
  const dimensions = Object.fromEntries(
    allScoringDimensions().map((dim) => [dim, roundDisplayScore(harsh.displayDimensions[dim] ?? 0)]),
  ) as Record<ScoringDimension, number>;
  const canonical: CanonicalScore = {
    overall: roundDisplayScore(harsh.displayScore),
    dimensions,
    computedAt: await getCanonicalComputedAt(cwd),
    gitSha,
    source: 'canonical-v1',
  };
  await writeCanonicalCache(cwd, canonical).catch(() => {});
  return canonical;
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

export interface EnterpriseEvidenceFlags {
  /** SECURITY.md exists with substantive content (>200 chars) */
  hasSecurityPolicy: boolean;
  /** CHANGELOG.md has ≥2 versioned release headings */
  hasVersionedChangelog: boolean;
  /** docs/RUNBOOK.md exists (operational readiness documentation) */
  hasRunbook: boolean;
  /** CONTRIBUTING.md exists (governance/contribution process) */
  hasContributing: boolean;
}

function computeNewDimensions(
  pdseScores: Partial<Record<ScoredArtifact, ScoreResult>>,
  state: DanteState,
  assessment: MaturityAssessment,
  cwd: string,
  evidenceFlags?: PipelineEvidenceFlags,
  convergenceFlags?: ConvergenceEvidenceFlags,
  communityMetrics?: CommunityMetrics,
  communityReadiness?: CommunityReadinessScore,
  enterpriseFlags?: EnterpriseEvidenceFlags,
  causalGlobalCoherence = 0,
  causalTotalAttributions = 0,
): Record<string, number> {
  return {
    planningQuality: computePlanningQualityScore(pdseScores),
    selfImprovement: computeSelfImprovementScore(state),
    developerExperience: computeDeveloperExperienceScore(assessment),
    autonomy: computeAutonomyScore(state, assessment, pdseScores),
    specDrivenPipeline: computeSpecDrivenPipelineScore(pdseScores, state, evidenceFlags),
    convergenceSelfHealing: computeConvergenceSelfHealingScore(state, convergenceFlags),
    tokenEconomy: computeTokenEconomyScore(state),
    contextEconomy: computeContextEconomyScore(cwd),
    ecosystemMcp: computeEcosystemMcpScore(state, cwd),
    enterpriseReadiness: computeEnterpriseReadinessScore(state, assessment, enterpriseFlags),
    communityAdoption: computeCommunityAdoptionScore(communityMetrics ?? {}, communityReadiness),
    causalCoherence: computeCausalCoherenceScore(causalGlobalCoherence, causalTotalAttributions),
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

// Context Economy scorer - reads telemetry evidence from PRD-26 implementation.
// Filesystem detectors for ecosystem signals — used when STATE.yaml hasn't
// been bootstrapped (e.g., during direct trio scoring). Mirrors the logic of
// `bootstrapEcosystemSignals` in src/cli/commands/score.ts but synchronous so
// it can run inline inside the scorer without changing callers.
// ── Community Adoption — real GitHub + npm signals ──────────────────────────

/** Fetches real community signals from npm registry and GitHub API. Best-effort — returns {} on any failure. */
// ── Real coverage % reader ────────────────────────────────────────────────────

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

// ── History I/O ───────────────────────────────────────────────────────────────

// ── File listing ──────────────────────────────────────────────────────────────

// ── Strict (tamper-resistant) Dimension Scoring ───────────────────────────────
//
// These scores are derived entirely from verifiable code signals:
// git commit history, evidence files written by the CI/test pipeline,
// and LLM cache entry counts. STATE.yaml config fields (retroDelta,
// lastVerifyStatus, lastComplexityPreset, autoforgeFailedAttempts, etc.)
// are deliberately excluded — they are mutable and were observed to be
// manually inflated during ascend/score runs, producing false high scores.

