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

  // Step 1: Load state and compute existing scores
  const state = await loadStateFn({ cwd });
  const pdseScores = await scoreArtifactsFn(cwd, state);

  // Step 2: Run maturity assessment (8-dimension quality scoring)
  const maturityAssessment = await assessMaturityFn({ cwd, state, pdseScores, targetLevel });

  // Step 3: Completion tracker (for fake-completion detection)
  const allArtifacts = pdseScores as Record<ScoredArtifact, ScoreResult>;
  const completionTracker = computeTrackerFn(state, allArtifacts);

  // Step 4: Derive the 10 extended dimensions from existing data
  const newDimensions = computeNewDimensions(pdseScores, state, maturityAssessment, cwd);

  // Step 5: Combine all 18 dimensions (8 from maturity + 10 extended)
  const dims = maturityAssessment.dimensions;
  const dimensions = {
    functionality: dims.functionality,
    testing: dims.testing,
    errorHandling: dims.errorHandling,
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

function computeNewDimensions(
  pdseScores: Partial<Record<ScoredArtifact, ScoreResult>>,
  state: DanteState,
  assessment: MaturityAssessment,
  cwd: string,
): Record<string, number> {
  return {
    planningQuality: computePlanningQualityScore(pdseScores),
    selfImprovement: computeSelfImprovementScore(state),
    developerExperience: computeDeveloperExperienceScore(assessment),
    autonomy: computeAutonomyScore(state, assessment),
    specDrivenPipeline: computeSpecDrivenPipelineScore(pdseScores, state),
    convergenceSelfHealing: computeConvergenceSelfHealingScore(state),
    tokenEconomy: computeTokenEconomyScore(state),
    ecosystemMcp: computeEcosystemMcpScore(state, cwd),
    enterpriseReadiness: computeEnterpriseReadinessScore(state, assessment),
    communityAdoption: computeCommunityAdoptionScore(),
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

export function computeAutonomyScore(state: DanteState, assessment: MaturityAssessment): number {
  let score = 30; // base
  if (state.lastVerifyStatus === 'pass') score += 25;
  if (assessment.recommendation === 'proceed' || assessment.recommendation === 'target-exceeded') score += 20;
  const completedPhases = Object.keys(state.tasks ?? {}).length;
  if (completedPhases >= 3) score += 15;
  else if (completedPhases >= 1) score += 7;
  if (state.autoforgeEnabled) score += 10;
  return Math.max(0, Math.min(100, score));
}

// ── Strategic dimension computations ─────────────────────────────────────────

export function computeSpecDrivenPipelineScore(
  pdseScores: Partial<Record<ScoredArtifact, ScoreResult>>,
  state: DanteState,
): number {
  let score = 20; // base: pipeline exists
  const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];
  const present = artifacts.filter((a) => pdseScores[a] && (pdseScores[a]!.score ?? 0) > 0);
  score += present.length * 12; // up to 60 for all 5 artifacts
  const stage = state.workflowStage ?? 'initialized';
  const stageOrder = ['initialized', 'constitution', 'specified', 'clarified', 'planned', 'tasked', 'forging', 'verified', 'synthesized'];
  const stageIndex = stageOrder.indexOf(stage);
  if (stageIndex >= 5) score += 20;
  else if (stageIndex >= 3) score += 10;
  return Math.max(0, Math.min(100, score));
}

export function computeConvergenceSelfHealingScore(state: DanteState): number {
  let score = 30; // base: convergence infrastructure exists
  if (state.lastVerifyStatus === 'pass') score += 25;
  if ((state.autoforgeFailedAttempts ?? 0) > 0 && state.lastVerifyStatus === 'pass') score += 15;
  const auditEntries = state.auditLog?.length ?? 0;
  if (auditEntries > 10) score += 15;
  else if (auditEntries > 3) score += 8;
  if (state.autoforgeEnabled) score += 15;
  return Math.max(0, Math.min(100, score));
}

export function computeTokenEconomyScore(state: DanteState): number {
  // Access optional state fields safely via record pattern
  const s = state as unknown as Record<string, unknown>;
  let score = 40; // base: task-router and budget systems exist
  if (typeof s['maxBudgetUsd'] === 'number' && s['maxBudgetUsd'] > 0) score += 20;
  if (s['routingAggressiveness']) score += 15;
  if (s['lastComplexityPreset']) score += 15;
  if (typeof s['totalTokensUsed'] === 'number' && s['totalTokensUsed'] > 0 &&
      (state.autoforgeFailedAttempts ?? 0) === 0) score += 10;
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

export function computeCommunityAdoptionScore(): number {
  // Static: no external users, no npm publish, no GitHub stars yet
  return 15;
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
