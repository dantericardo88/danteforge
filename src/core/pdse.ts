// PDSE — Planning Document Scoring Engine
// Scores artifacts across 6 dimensions, produces remediation suggestions,
// and makes autoforge advance/pause/block decisions. All scoring functions are pure.
import fs from 'fs/promises';
import path from 'path';
import { appendPdseHistory } from './pdse-anomaly.js';
import type { AppendPdseHistoryOptions } from './pdse-anomaly.js';
import type { DanteState } from './state.js';
import {
  type ScoredArtifact,
  type AutoforgeDecision,
  type ScoreDimensions,
  SECTION_CHECKLISTS,
  AMBIGUITY_WORDS,
  ANTI_STUB_PATTERNS,
  SPEC_REQUIRED_PATTERNS,
  CONSTITUTION_KEYWORDS,
  DIMENSION_WEIGHTS,
  SCORE_THRESHOLDS,
  FRESHNESS_DEDUCTION_MARKERS,
  ARTIFACT_COMMAND_MAP,
  UPSTREAM_DEPENDENCY_MAP,
} from './pdse-config.js';

export { type ScoredArtifact, type AutoforgeDecision, type ScoreDimensions } from './pdse-config.js';

export interface ScoreIssue {
  dimension: keyof ScoreDimensions;
  severity: 'error' | 'warning';
  message: string;
  evidence?: string;
}

export interface ScoreResult {
  artifact: ScoredArtifact;
  score: number;             // 0–100, sum of dimensions
  dimensions: ScoreDimensions;
  issues: ScoreIssue[];
  remediationSuggestions: string[];
  timestamp: string;
  autoforgeDecision: AutoforgeDecision;
  hasCEOReviewBonus: boolean;
}

export interface ScoringContext {
  artifactContent: string;
  artifactName: ScoredArtifact;
  stateYaml: DanteState;
  upstreamArtifacts: Partial<Record<ScoredArtifact, string>>;
  isWebProject: boolean;
  evidenceDir?: string;
}

// ── Dimension scoring helpers ─────────────────────────────────────────────────

function scoreClarity(content: string, contentLower: string, artifactName: ScoredArtifact, issues: ScoreIssue[]): { clarity: number; hasCEOReviewBonus: boolean } {
  let clarity = DIMENSION_WEIGHTS.clarity;
  const stubHits: string[] = [];
  // CONSTITUTION is exempt: it documents anti-stub policy by name and legitimately uses "stub"
  for (const pattern of (artifactName === 'CONSTITUTION' ? [] : ANTI_STUB_PATTERNS)) {
    if (pattern instanceof RegExp) { if (pattern.test(content)) stubHits.push(pattern.source); }
    else { if (contentLower.includes(pattern.toLowerCase())) stubHits.push(pattern); }
  }
  if (stubHits.length > 0) {
    clarity = 0;
    issues.push({ dimension: 'clarity', severity: 'error', message: `Anti-stub violation: found forbidden patterns: ${stubHits.join(', ')}`, evidence: stubHits.join(', ') });
  } else {
    let ambiguityCount = 0;
    const ambiguityHits: string[] = [];
    for (const word of AMBIGUITY_WORDS) {
      const matches = content.match(new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi'));
      if (matches) { ambiguityCount += matches.length; ambiguityHits.push(`"${word}" (${matches.length}x)`); }
    }
    if (ambiguityCount > 0) {
      clarity = Math.max(0, clarity - ambiguityCount);
      issues.push({ dimension: 'clarity', severity: 'warning', message: `${ambiguityCount} ambiguity signal(s) found: ${ambiguityHits.join(', ')}`, evidence: ambiguityHits.join(', ') });
    }
  }
  if (artifactName === 'SPEC' && !SPEC_REQUIRED_PATTERNS.some(p => p.test(content))) {
    clarity = Math.min(clarity, 12);
    issues.push({ dimension: 'clarity', severity: 'error', message: 'SPEC.md is missing acceptance criteria — unmeasurable specs are ambiguous' });
  }
  const hasCEOReviewBonus = content.includes('## CEO Review Notes');
  if (hasCEOReviewBonus) clarity = Math.min(clarity + 5, DIMENSION_WEIGHTS.clarity);
  return { clarity, hasCEOReviewBonus };
}

function scoreTestability(content: string, artifactName: ScoredArtifact, isWebProject: boolean, evidenceDir: string | undefined, issues: ScoreIssue[]): number {
  let testability = DIMENSION_WEIGHTS.testability;
  if (artifactName === 'SPEC' && !(/acceptance criteria/i.test(content))) {
    testability = Math.min(testability, 8);
    issues.push({ dimension: 'testability', severity: 'error', message: 'Missing acceptance criteria section — testability cannot be verified' });
  }
  if (artifactName === 'TASKS') {
    const taskLines = content.split('\n').filter(l => /^[-*]\s/.test(l.trim()));
    const tasksWithVerify = taskLines.filter(l => /verify|done|acceptance|test|assert/i.test(l));
    if (taskLines.length > 0) {
      const ratio = tasksWithVerify.length / taskLines.length;
      testability = Math.round(ratio * DIMENSION_WEIGHTS.testability);
      if (ratio < 0.5) issues.push({ dimension: 'testability', severity: 'warning', message: `Only ${tasksWithVerify.length}/${taskLines.length} tasks have explicit done-conditions` });
    }
  }
  if (isWebProject && evidenceDir) testability = Math.min(testability + 2, DIMENSION_WEIGHTS.testability);
  return testability;
}

function scoreConstitutionAlignment(contentLower: string, upstreamArtifacts: Partial<Record<ScoredArtifact, string>>, artifactName: ScoredArtifact, issues: ScoreIssue[]): number {
  const foundKeywords = CONSTITUTION_KEYWORDS.filter(k => contentLower.includes(k.toLowerCase()));
  let constitutionAlignment = Math.min(foundKeywords.length * 3, DIMENSION_WEIGHTS.constitutionAlignment);
  const constitutionContent = upstreamArtifacts.CONSTITUTION;
  if (constitutionContent && artifactName !== 'CONSTITUTION') {
    const constitutionLower = constitutionContent.toLowerCase();
    const sharedTerms = CONSTITUTION_KEYWORDS.filter(k => contentLower.includes(k.toLowerCase()) && constitutionLower.includes(k.toLowerCase()));
    if (sharedTerms.length >= 2) constitutionAlignment = Math.min(constitutionAlignment + 4, DIMENSION_WEIGHTS.constitutionAlignment);
  }
  if (constitutionAlignment < 10) issues.push({ dimension: 'constitutionAlignment', severity: 'warning', message: `Low constitution alignment — only ${foundKeywords.length} keyword(s) found` });
  return constitutionAlignment;
}

function scoreIntegrationFitness(artifactName: ScoredArtifact, upstreamArtifacts: Partial<Record<ScoredArtifact, string>>, issues: ScoreIssue[]): number {
  const expectedUpstreams = UPSTREAM_DEPENDENCY_MAP[artifactName] ?? [];
  if (expectedUpstreams.length === 0) return DIMENSION_WEIGHTS.integrationFitness;
  const foundUpstreams = expectedUpstreams.filter(up => upstreamArtifacts[up] !== undefined).length;
  const upstreamScore = Math.round((foundUpstreams / expectedUpstreams.length) * DIMENSION_WEIGHTS.integrationFitness);
  if (foundUpstreams < expectedUpstreams.length) {
    const missing = expectedUpstreams.filter(u => upstreamArtifacts[u] === undefined);
    issues.push({ dimension: 'integrationFitness', severity: 'warning', message: `Missing upstream artifact(s): ${missing.join(', ')}` });
  }
  return upstreamScore;
}

// ── Primary scoring function — pure, deterministic ──────────────────────────

export function scoreArtifact(ctx: ScoringContext): ScoreResult {
  const issues: ScoreIssue[] = [];
  const content = ctx.artifactContent;
  const contentLower = content.toLowerCase();

  // ── Fast path: empty or trivially short artifacts score near zero ──
  if (content.trim().length < 20) {
    issues.push({ dimension: 'completeness', severity: 'error', message: 'Artifact is empty or trivially short' });
    const emptyScore = content.trim().length > 0 ? 5 : 0;
    return {
      artifact: ctx.artifactName, score: emptyScore,
      dimensions: { completeness: 0, clarity: 0, testability: 0, constitutionAlignment: 0, integrationFitness: 0, freshness: emptyScore },
      issues, remediationSuggestions: generateRemediationSuggestions(issues, ctx.artifactName),
      timestamp: new Date().toISOString(), autoforgeDecision: 'blocked', hasCEOReviewBonus: false,
    };
  }

  // ── Completeness (0–20) ──
  const checklist = SECTION_CHECKLISTS[ctx.artifactName] ?? [];
  let sectionsFound = 0;
  for (const required of checklist) {
    if (contentLower.includes(required.toLowerCase())) { sectionsFound++; }
    else { issues.push({ dimension: 'completeness', severity: 'error', message: `Missing required section or keyword: "${required}"` }); }
  }
  const completeness = checklist.length > 0
    ? Math.round((sectionsFound / checklist.length) * DIMENSION_WEIGHTS.completeness)
    : (content.trim().length > 0 ? DIMENSION_WEIGHTS.completeness : 0);

  const { clarity, hasCEOReviewBonus } = scoreClarity(content, contentLower, ctx.artifactName, issues);
  const testability = scoreTestability(content, ctx.artifactName, ctx.isWebProject, ctx.evidenceDir, issues);
  const constitutionAlignment = scoreConstitutionAlignment(contentLower, ctx.upstreamArtifacts, ctx.artifactName, issues);
  const integrationFitness = scoreIntegrationFitness(ctx.artifactName, ctx.upstreamArtifacts, issues);

  // ── Freshness (0–10) ──
  let freshness = DIMENSION_WEIGHTS.freshness;
  for (const marker of FRESHNESS_DEDUCTION_MARKERS) {
    const matches = content.match(new RegExp(`\\b${escapeRegex(marker)}\\b`, 'gi'));
    if (matches) {
      freshness = Math.max(0, freshness - matches.length * 2);
      issues.push({ dimension: 'freshness', severity: 'warning', message: `Freshness marker "${marker}" found ${matches.length} time(s)`, evidence: marker });
    }
  }

  const dimensions: ScoreDimensions = { completeness, clarity, testability, constitutionAlignment, integrationFitness, freshness };
  const score = completeness + clarity + testability + constitutionAlignment + integrationFitness + freshness;
  return {
    artifact: ctx.artifactName, score, dimensions, issues,
    remediationSuggestions: generateRemediationSuggestions(issues, ctx.artifactName),
    timestamp: new Date().toISOString(),
    autoforgeDecision: computeAutoforgeDecision(score),
    hasCEOReviewBonus,
  };
}

// ── Score all artifacts on disk ──────────────────────────────────────────────

export interface ScoreAllArtifactsOptions {
  /** Injection seam: override history append for testing */
  _appendHistory?: (entry: Parameters<typeof appendPdseHistory>[0], opts?: AppendPdseHistoryOptions) => Promise<void>;
  /** Optional toolchain metrics to apply as post-scoring adjustments */
  toolchainMetrics?: import('./pdse-toolchain.js').ToolchainMetrics;
}

function buildMissingArtifactResult(artifactName: ScoredArtifact): ScoreResult {
  return {
    artifact: artifactName,
    score: 0,
    dimensions: {
      completeness: 0, clarity: 0, testability: 0,
      constitutionAlignment: 0, integrationFitness: 0, freshness: 0,
    },
    issues: [{ dimension: 'completeness', severity: 'error', message: `Artifact ${artifactName}.md does not exist` }],
    remediationSuggestions: [`Run: danteforge ${ARTIFACT_COMMAND_MAP[artifactName]}`],
    timestamp: new Date().toISOString(),
    autoforgeDecision: 'blocked',
    hasCEOReviewBonus: false,
  };
}

export async function scoreAllArtifacts(
  cwd: string,
  state: DanteState,
  opts?: ScoreAllArtifactsOptions,
): Promise<Record<ScoredArtifact, ScoreResult>> {
  const stateDir = path.join(cwd, '.danteforge');
  const artifactFiles: Record<ScoredArtifact, string> = {
    CONSTITUTION: path.join(stateDir, 'CONSTITUTION.md'),
    SPEC: path.join(stateDir, 'SPEC.md'),
    CLARIFY: path.join(stateDir, 'CLARIFY.md'),
    PLAN: path.join(stateDir, 'PLAN.md'),
    TASKS: path.join(stateDir, 'TASKS.md'),
  };

  const isWebProject = state.projectType === 'web';

  // Load all artifacts that exist
  const loaded: Partial<Record<ScoredArtifact, string>> = {};
  for (const [name, filePath] of Object.entries(artifactFiles)) {
    try {
      loaded[name as ScoredArtifact] = await fs.readFile(filePath, 'utf8');
    } catch {
      // Artifact doesn't exist — will get score 0
    }
  }

  // Check for evidence directory
  const evidenceDir = path.join(stateDir, 'evidence');
  let hasEvidence = false;
  try {
    const entries = await fs.readdir(evidenceDir);
    hasEvidence = entries.some(e => e.endsWith('.png'));
  } catch {
    // No evidence directory
  }

  const results: Partial<Record<ScoredArtifact, ScoreResult>> = {};
  const artifacts: ScoredArtifact[] = ['CONSTITUTION', 'SPEC', 'CLARIFY', 'PLAN', 'TASKS'];

  for (const artifactName of artifacts) {
    const content = loaded[artifactName];
    if (content === undefined) {
      results[artifactName] = buildMissingArtifactResult(artifactName);
      continue;
    }

    results[artifactName] = scoreArtifact({
      artifactContent: content,
      artifactName,
      stateYaml: state,
      upstreamArtifacts: loaded,
      isWebProject,
      evidenceDir: hasEvidence ? evidenceDir : undefined,
    });
  }

  let finalResults = results as Record<ScoredArtifact, ScoreResult>;

  // Apply toolchain grounding if metrics were provided (post-scoring adjustment)
  if (opts?.toolchainMetrics) {
    try {
      const { applyToolchainToScores } = await import('./pdse-toolchain.js');
      finalResults = applyToolchainToScores(finalResults, opts.toolchainMetrics);
    } catch {
      // Non-fatal — fall back to ungrounded scores
    }
  }

  // Best-effort: append each score result to wiki PDSE history
  const appendFn = opts?._appendHistory ?? appendPdseHistory;
  for (const [artifact, result] of Object.entries(finalResults)) {
    try {
      await appendFn(
        {
          timestamp: result.timestamp,
          artifact,
          score: result.score,
          dimensions: result.dimensions as unknown as Record<string, number>,
          decision: result.autoforgeDecision,
        },
        { cwd },
      );
    } catch {
      // Non-fatal — never block scoring on wiki write failure
    }
  }

  return finalResults;
}

// ── Persistence ─────────────────────────────────────────────────────────────

export async function persistScoreResult(result: ScoreResult, cwd: string): Promise<string> {
  const scoreDir = path.join(cwd, '.danteforge', 'scores');
  await fs.mkdir(scoreDir, { recursive: true });
  const fileName = `${result.artifact}-score.json`;
  const tmpPath = path.join(scoreDir, `${fileName}.tmp`);
  const finalPath = path.join(scoreDir, fileName);
  await fs.writeFile(tmpPath, JSON.stringify(result, null, 2));
  await fs.rename(tmpPath, finalPath);
  return finalPath;
}

export async function loadCachedScore(
  artifact: ScoredArtifact,
  cwd: string,
): Promise<ScoreResult | null> {
  const scorePath = path.join(cwd, '.danteforge', 'scores', `${artifact}-score.json`);
  try {
    const content = await fs.readFile(scorePath, 'utf8');
    return JSON.parse(content) as ScoreResult;
  } catch {
    return null;
  }
}

// ── Decision logic — pure function ──────────────────────────────────────────

export function computeAutoforgeDecision(score: number): AutoforgeDecision {
  if (score >= SCORE_THRESHOLDS.EXCELLENT) return 'advance';
  if (score >= SCORE_THRESHOLDS.ACCEPTABLE) return 'warn';
  if (score >= SCORE_THRESHOLDS.NEEDS_WORK) return 'pause';
  return 'blocked';
}

// ── Remediation suggestions ─────────────────────────────────────────────────

export function generateRemediationSuggestions(
  issues: ScoreIssue[],
  artifact: ScoredArtifact,
): string[] {
  const suggestions: string[] = [];
  const command = ARTIFACT_COMMAND_MAP[artifact];

  const hasCompleteness = issues.some(i => i.dimension === 'completeness');
  const hasClarity = issues.some(i => i.dimension === 'clarity');
  const hasTestability = issues.some(i => i.dimension === 'testability');
  const hasConstitution = issues.some(i => i.dimension === 'constitutionAlignment');

  if (hasCompleteness) {
    suggestions.push(`Run: danteforge ${command} — add missing required sections`);
  }
  if (hasClarity) {
    const clarityIssues = issues.filter(i => i.dimension === 'clarity');
    const hasStub = clarityIssues.some(i => i.message.includes('Anti-stub'));
    if (hasStub) {
      suggestions.push(`Run: danteforge ${command} — remove all stub/placeholder patterns`);
    } else {
      suggestions.push(`Run: danteforge ${command} — replace ambiguous language with precise terms`);
    }
  }
  if (hasTestability) {
    suggestions.push(`Run: danteforge ${command} — add acceptance criteria or done-conditions`);
  }
  if (hasConstitution) {
    suggestions.push('Ensure artifact references constitution principles (zero ambiguity, local-first, fail-closed)');
  }

  if (suggestions.length === 0 && issues.length > 0) {
    suggestions.push(`Run: danteforge ${command} — address ${issues.length} issue(s)`);
  }

  return suggestions;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
