// PDSE — Planning Document Scoring Engine
// Scores artifacts across 6 dimensions, produces remediation suggestions,
// and makes autoforge advance/pause/block decisions. All scoring functions are pure.
import fs from 'fs/promises';
import path from 'path';
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

// ── Primary scoring function — pure, deterministic ──────────────────────────

export function scoreArtifact(ctx: ScoringContext): ScoreResult {
  const issues: ScoreIssue[] = [];
  const content = ctx.artifactContent;
  const contentLower = content.toLowerCase();

  // ── Fast path: empty or trivially short artifacts score near zero ──
  if (content.trim().length < 20) {
    issues.push({
      dimension: 'completeness',
      severity: 'error',
      message: 'Artifact is empty or trivially short',
    });
    const emptyScore = content.trim().length > 0 ? 5 : 0;
    return {
      artifact: ctx.artifactName,
      score: emptyScore,
      dimensions: {
        completeness: 0,
        clarity: 0,
        testability: 0,
        constitutionAlignment: 0,
        integrationFitness: 0,
        freshness: emptyScore,
      },
      issues,
      remediationSuggestions: generateRemediationSuggestions(issues, ctx.artifactName),
      timestamp: new Date().toISOString(),
      autoforgeDecision: 'blocked',
      hasCEOReviewBonus: false,
    };
  }

  // ── Completeness (0–20) ──
  const checklist = SECTION_CHECKLISTS[ctx.artifactName] ?? [];
  let sectionsFound = 0;
  for (const required of checklist) {
    if (contentLower.includes(required.toLowerCase())) {
      sectionsFound++;
    } else {
      issues.push({
        dimension: 'completeness',
        severity: 'error',
        message: `Missing required section or keyword: "${required}"`,
      });
    }
  }
  const completeness = checklist.length > 0
    ? Math.round((sectionsFound / checklist.length) * DIMENSION_WEIGHTS.completeness)
    : (content.trim().length > 0 ? DIMENSION_WEIGHTS.completeness : 0);

  // ── Clarity (0–20) ──
  let clarity = DIMENSION_WEIGHTS.clarity;

  // Anti-stub scan — floors clarity to 0
  // Supports both plain string patterns (case-insensitive includes) and RegExp patterns
  const stubHits: string[] = [];
  for (const pattern of ANTI_STUB_PATTERNS) {
    if (pattern instanceof RegExp) {
      if (pattern.test(content)) {
        stubHits.push(pattern.source);
      }
    } else {
      if (contentLower.includes(pattern.toLowerCase())) {
        stubHits.push(pattern);
      }
    }
  }
  if (stubHits.length > 0) {
    clarity = 0;
    issues.push({
      dimension: 'clarity',
      severity: 'error',
      message: `Anti-stub violation: found forbidden patterns: ${stubHits.join(', ')}`,
      evidence: stubHits.join(', '),
    });
  } else {
    // Ambiguity word deductions
    let ambiguityCount = 0;
    const ambiguityHits: string[] = [];
    for (const word of AMBIGUITY_WORDS) {
      const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'gi');
      const matches = content.match(regex);
      if (matches) {
        ambiguityCount += matches.length;
        ambiguityHits.push(`"${word}" (${matches.length}x)`);
      }
    }
    if (ambiguityCount > 0) {
      clarity = Math.max(0, clarity - ambiguityCount);
      issues.push({
        dimension: 'clarity',
        severity: 'warning',
        message: `${ambiguityCount} ambiguity signal(s) found: ${ambiguityHits.join(', ')}`,
        evidence: ambiguityHits.join(', '),
      });
    }
  }

  // Missing acceptance criteria in SPEC floors clarity
  if (ctx.artifactName === 'SPEC') {
    const hasAcceptanceCriteria = SPEC_REQUIRED_PATTERNS.some(p => p.test(content));
    if (!hasAcceptanceCriteria) {
      clarity = Math.min(clarity, 12);
      issues.push({
        dimension: 'clarity',
        severity: 'error',
        message: 'SPEC.md is missing acceptance criteria — unmeasurable specs are ambiguous',
      });
    }
  }

  // CEO Review bonus: +5 for ## CEO Review Notes presence (capped at dimension max)
  const hasCEOReviewBonus = content.includes('## CEO Review Notes');
  if (hasCEOReviewBonus) {
    clarity = Math.min(clarity + 5, DIMENSION_WEIGHTS.clarity);
  }

  // ── Testability (0–20) ──
  let testability = DIMENSION_WEIGHTS.testability;

  if (ctx.artifactName === 'SPEC') {
    // Check for acceptance criteria section
    if (!(/acceptance criteria/i.test(content))) {
      testability = Math.min(testability, 8);
      issues.push({
        dimension: 'testability',
        severity: 'error',
        message: 'Missing acceptance criteria section — testability cannot be verified',
      });
    }
  }

  if (ctx.artifactName === 'TASKS') {
    // Check for done-conditions / verify fields in tasks
    const taskLines = content.split('\n').filter(l => /^[-*]\s/.test(l.trim()));
    const tasksWithVerify = taskLines.filter(l =>
      /verify|done|acceptance|test|assert/i.test(l),
    );
    if (taskLines.length > 0) {
      const ratio = tasksWithVerify.length / taskLines.length;
      testability = Math.round(ratio * DIMENSION_WEIGHTS.testability);
      if (ratio < 0.5) {
        issues.push({
          dimension: 'testability',
          severity: 'warning',
          message: `Only ${tasksWithVerify.length}/${taskLines.length} tasks have explicit done-conditions`,
        });
      }
    }
  }

  // Web project evidence bonus
  if (ctx.isWebProject && ctx.evidenceDir) {
    // Evidence screenshots improve testability score
    testability = Math.min(testability + 2, DIMENSION_WEIGHTS.testability);
  }

  // ── Constitution Alignment (0–20) ──
  let constitutionAlignment = 0;
  const foundKeywords: string[] = [];
  for (const keyword of CONSTITUTION_KEYWORDS) {
    if (contentLower.includes(keyword.toLowerCase())) {
      foundKeywords.push(keyword);
    }
  }
  constitutionAlignment = Math.min(
    foundKeywords.length * 3,
    DIMENSION_WEIGHTS.constitutionAlignment,
  );

  // Cross-reference with upstream CONSTITUTION.md
  const constitutionContent = ctx.upstreamArtifacts.CONSTITUTION;
  if (constitutionContent && ctx.artifactName !== 'CONSTITUTION') {
    // Bonus for referencing constitution principles
    const constitutionLower = constitutionContent.toLowerCase();
    const sharedTerms = CONSTITUTION_KEYWORDS.filter(
      k => contentLower.includes(k.toLowerCase()) && constitutionLower.includes(k.toLowerCase()),
    );
    if (sharedTerms.length >= 2) {
      constitutionAlignment = Math.min(
        constitutionAlignment + 4,
        DIMENSION_WEIGHTS.constitutionAlignment,
      );
    }
  }

  if (constitutionAlignment < 10) {
    issues.push({
      dimension: 'constitutionAlignment',
      severity: 'warning',
      message: `Low constitution alignment — only ${foundKeywords.length} keyword(s) found`,
    });
  }

  // ── Integration Fitness (0–10) ──
  const expectedUpstreams = UPSTREAM_DEPENDENCY_MAP[ctx.artifactName] ?? [];
  let upstreamScore = 0;
  if (expectedUpstreams.length === 0) {
    upstreamScore = DIMENSION_WEIGHTS.integrationFitness;
  } else {
    let foundUpstreams = 0;
    for (const up of expectedUpstreams) {
      if (ctx.upstreamArtifacts[up] !== undefined) {
        foundUpstreams++;
      }
    }
    upstreamScore = Math.round(
      (foundUpstreams / expectedUpstreams.length) * DIMENSION_WEIGHTS.integrationFitness,
    );
    if (foundUpstreams < expectedUpstreams.length) {
      const missing = expectedUpstreams.filter(u => ctx.upstreamArtifacts[u] === undefined);
      issues.push({
        dimension: 'integrationFitness',
        severity: 'warning',
        message: `Missing upstream artifact(s): ${missing.join(', ')}`,
      });
    }
  }
  const integrationFitness = upstreamScore;

  // ── Freshness (0–10) ──
  let freshness = DIMENSION_WEIGHTS.freshness;
  for (const marker of FRESHNESS_DEDUCTION_MARKERS) {
    const regex = new RegExp(`\\b${escapeRegex(marker)}\\b`, 'gi');
    const matches = content.match(regex);
    if (matches) {
      freshness = Math.max(0, freshness - matches.length * 2);
      issues.push({
        dimension: 'freshness',
        severity: 'warning',
        message: `Freshness marker "${marker}" found ${matches.length} time(s)`,
        evidence: marker,
      });
    }
  }

  // ── Aggregate ──
  const dimensions: ScoreDimensions = {
    completeness,
    clarity,
    testability,
    constitutionAlignment,
    integrationFitness,
    freshness,
  };

  const score = completeness + clarity + testability +
    constitutionAlignment + integrationFitness + freshness;

  const autoforgeDecision = computeAutoforgeDecision(score);
  const remediationSuggestions = generateRemediationSuggestions(issues, ctx.artifactName);

  return {
    artifact: ctx.artifactName,
    score,
    dimensions,
    issues,
    remediationSuggestions,
    timestamp: new Date().toISOString(),
    autoforgeDecision,
    hasCEOReviewBonus,
  };
}

// ── Score all artifacts on disk ──────────────────────────────────────────────

export async function scoreAllArtifacts(
  cwd: string,
  state: DanteState,
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
      // Missing artifact → score 0, blocked
      results[artifactName] = {
        artifact: artifactName,
        score: 0,
        dimensions: {
          completeness: 0, clarity: 0, testability: 0,
          constitutionAlignment: 0, integrationFitness: 0, freshness: 0,
        },
        issues: [{
          dimension: 'completeness',
          severity: 'error',
          message: `Artifact ${artifactName}.md does not exist`,
        }],
        remediationSuggestions: [
          `Run: danteforge ${ARTIFACT_COMMAND_MAP[artifactName]}`,
        ],
        timestamp: new Date().toISOString(),
        autoforgeDecision: 'blocked',
        hasCEOReviewBonus: false,
      };
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

  return results as Record<ScoredArtifact, ScoreResult>;
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
