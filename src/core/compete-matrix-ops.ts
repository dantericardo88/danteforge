// compete-matrix-ops.ts — Matrix amendment, bootstrap, staleness, and closing strategy.
// Split from compete-matrix.ts to keep files under the 750-LOC hard cap.
import type { CompetitorComparison } from './competitor-scanner.js';
import type { MatrixDimension, CompeteMatrix, DimensionStatus } from './compete-matrix.js';
import { computeOverallScore, computeTwoGaps, computeGapPriority } from './compete-matrix-score.js';

// ── Known OSS Tools ───────────────────────────────────────────────────────────

export const KNOWN_OSS_TOOLS = new Set([
  'Aider', 'Continue', 'Continue.dev', 'OpenHands', 'SWE-Agent', 'SWE-agent (Princeton)',
  'MetaGPT', 'AutoGen', 'CrewAI', 'LangChain', 'Cline', 'Goose',
  'GPT-Engineer', 'Tabby', 'CodeGeeX', 'FauxPilot', 'Ollama',
  'Gpt-engineer', 'OpenDevin', 'AgentCoder', 'Plandex',
  're_gent', 'Regent', 'regent-vcs', 'regent-vcs/re_gent',
]);

export function isOssTool(name: string): boolean {
  if (KNOWN_OSS_TOOLS.has(name)) return true;
  const prefix = name.split(/[\s(]/)[0];
  return prefix !== undefined && KNOWN_OSS_TOOLS.has(prefix);
}

// ── Ceiling Defaults ──────────────────────────────────────────────────────────

export const KNOWN_CEILINGS: Record<string, { ceiling: number; reason: string }> = {
  communityAdoption: {
    ceiling: 4.0,
    reason: 'requires npm downloads, GitHub stars, and external contributors — cannot be automated',
  },
  enterpriseReadiness: {
    ceiling: 9.0,
    reason: 'filesystem evidence (SECURITY.md, CHANGELOG.md, RUNBOOK.md) is automatable up to 9.0; the final point requires real production deployments and customer validation',
  },
  contextEconomy: {
    ceiling: 9.0,
    reason: 'PRD-26 filter pipeline shipped — ceiling raised to 9.0; final point requires live telemetry from real command runs',
  },
  codeSigning: {
    ceiling: 3.0,
    reason: 'requires EV certificate purchase and CA application — human action',
  },
  installerDistribution: {
    ceiling: 5.0,
    reason: 'requires signed installer build pipeline — human action',
  },
  pricingTransparency: {
    ceiling: 6.0,
    reason: 'requires real users and public pricing page — human action',
  },
  voiceInterface: {
    ceiling: 4.0,
    reason: 'limited market demand for CLI voice; ceiling reflects realistic adoption',
  },
};

// ── Matrix Amendment API ──────────────────────────────────────────────────────

function recomputeDimGaps(
  dim: MatrixDimension,
  closedSourceCompetitors: string[],
  ossCompetitors: string[],
): void {
  const selfScore = dim.scores['self'] ?? 0;
  const entries = Object.entries(dim.scores).filter(([k]) => k !== 'self');
  if (entries.length === 0) {
    dim.gap_to_leader = 0;
    dim.leader = 'self';
    dim.gap_to_closed_source_leader = 0;
    dim.closed_source_leader = 'none';
    dim.gap_to_oss_leader = 0;
    dim.oss_leader = 'none';
    return;
  }
  const maxEntry = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  dim.gap_to_leader = roundScore(Math.max(0, maxEntry[1] - selfScore));
  dim.leader = maxEntry[0];

  const closedEntries = entries.filter(([k]) => closedSourceCompetitors.includes(k));
  if (closedEntries.length > 0) {
    const best = closedEntries.reduce((a, b) => (b[1] > a[1] ? b : a));
    dim.gap_to_closed_source_leader = roundScore(Math.max(0, best[1] - selfScore));
    dim.closed_source_leader = best[0];
  } else {
    dim.gap_to_closed_source_leader = 0;
    dim.closed_source_leader = 'none';
  }

  const ossEntries = entries.filter(([k]) => ossCompetitors.includes(k));
  if (ossEntries.length > 0) {
    const best = ossEntries.reduce((a, b) => (b[1] > a[1] ? b : a));
    dim.gap_to_oss_leader = roundScore(Math.max(0, best[1] - selfScore));
    dim.oss_leader = best[0];
  } else {
    dim.gap_to_oss_leader = 0;
    dim.oss_leader = 'none';
  }
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}

function uniquePush(items: string[], item: string): void {
  if (!items.includes(item)) items.push(item);
}

function refreshHarvestTarget(dim: MatrixDimension): void {
  const ossScore = dim.scores[dim.oss_leader] ?? 0;
  if (dim.oss_leader !== 'none' && dim.oss_leader !== 'unknown' && ossScore > (dim.scores['self'] ?? 0)) {
    dim.harvest_source = dim.oss_leader;
    dim.next_sprint_target = roundScore(Math.max(dim.next_sprint_target, ossScore));
  }
}

/**
 * Add or update a competitor across all dimensions and recompute strategic gaps.
 * Missing dimension scores default to 0 so every dimension keeps a complete score row.
 */
export function addOrUpdateCompetitor(
  matrix: CompeteMatrix,
  name: string,
  scores: Record<string, number> = {},
): void {
  uniquePush(matrix.competitors, name);
  if (isOssTool(name)) {
    uniquePush(matrix.competitors_oss, name);
    matrix.competitors_closed_source = matrix.competitors_closed_source.filter(c => c !== name);
  } else {
    uniquePush(matrix.competitors_closed_source, name);
    matrix.competitors_oss = matrix.competitors_oss.filter(c => c !== name);
  }

  for (const dim of matrix.dimensions) {
    dim.scores[name] = scores[dim.id] ?? dim.scores[name] ?? 0;
    recomputeDimGaps(dim, matrix.competitors_closed_source, matrix.competitors_oss);
    refreshHarvestTarget(dim);
  }
  matrix.lastUpdated = new Date().toISOString();
  matrix.overallSelfScore = computeOverallScore(matrix);
}

/**
 * Add or replace a dimension, then recompute leader/gap fields from current competitors.
 */
export function addOrUpdateDimension(
  matrix: CompeteMatrix,
  dimension: Omit<MatrixDimension, 'gap_to_leader' | 'leader' | 'gap_to_closed_source_leader' | 'closed_source_leader' | 'gap_to_oss_leader' | 'oss_leader'> &
    Partial<Pick<MatrixDimension, 'gap_to_leader' | 'leader' | 'gap_to_closed_source_leader' | 'closed_source_leader' | 'gap_to_oss_leader' | 'oss_leader'>>,
): void {
  const dim: MatrixDimension = {
    ...dimension,
    gap_to_leader: dimension.gap_to_leader ?? 0,
    leader: dimension.leader ?? 'self',
    gap_to_closed_source_leader: dimension.gap_to_closed_source_leader ?? 0,
    closed_source_leader: dimension.closed_source_leader ?? 'none',
    gap_to_oss_leader: dimension.gap_to_oss_leader ?? 0,
    oss_leader: dimension.oss_leader ?? 'none',
  };
  for (const competitor of matrix.competitors) {
    dim.scores[competitor] = dim.scores[competitor] ?? 0;
  }
  recomputeDimGaps(dim, matrix.competitors_closed_source, matrix.competitors_oss);
  refreshHarvestTarget(dim);

  const index = matrix.dimensions.findIndex(existing => existing.id === dim.id);
  if (index >= 0) matrix.dimensions[index] = dim;
  else matrix.dimensions.push(dim);
  matrix.lastUpdated = new Date().toISOString();
  matrix.overallSelfScore = computeOverallScore(matrix);
}

/**
 * Remove a competitor from the matrix entirely.
 * Deletes their scores from every dimension and recomputes all gap fields.
 */
export function removeCompetitor(matrix: CompeteMatrix, name: string): void {
  matrix.competitors = matrix.competitors.filter(c => c !== name);
  matrix.competitors_closed_source = matrix.competitors_closed_source.filter(c => c !== name);
  matrix.competitors_oss = matrix.competitors_oss.filter(c => c !== name);
  for (const dim of matrix.dimensions) {
    delete dim.scores[name];
    recomputeDimGaps(dim, matrix.competitors_closed_source, matrix.competitors_oss);
  }
  matrix.lastUpdated = new Date().toISOString();
  matrix.overallSelfScore = computeOverallScore(matrix);
}

/**
 * Drop a dimension from the matrix entirely.
 */
export function dropDimension(matrix: CompeteMatrix, id: string): void {
  matrix.dimensions = matrix.dimensions.filter(d => d.id !== id);
  matrix.lastUpdated = new Date().toISOString();
  matrix.overallSelfScore = computeOverallScore(matrix);
}

/**
 * Change the category of a dimension (e.g. 'quality' → 'autonomy').
 */
export function recategorizeDimension(matrix: CompeteMatrix, id: string, category: string): void {
  const dim = matrix.dimensions.find(d => d.id === id);
  if (dim) {
    dim.category = category;
    matrix.lastUpdated = new Date().toISOString();
  }
}

/**
 * Adjust the weight (importance multiplier) of a dimension.
 */
export function setDimensionWeight(matrix: CompeteMatrix, id: string, weight: number): void {
  const dim = matrix.dimensions.find(d => d.id === id);
  if (dim) {
    dim.weight = Math.max(0, weight);
    matrix.lastUpdated = new Date().toISOString();
  }
}

const BOOTSTRAP_FREQUENCY_MAP: Record<string, 'high' | 'medium' | 'low'> = {
  functionality: 'high', testing: 'high', errorHandling: 'high',
  security: 'high', uxPolish: 'high', documentation: 'medium',
  performance: 'high', maintainability: 'medium',
  developerExperience: 'high', autonomy: 'high',
  planningQuality: 'medium', selfImprovement: 'medium',
  specDrivenPipeline: 'medium', convergenceSelfHealing: 'medium',
  tokenEconomy: 'medium', ecosystemMcp: 'low',
  enterpriseReadiness: 'low', communityAdoption: 'low',
  contextEconomy: 'medium', causalCoherence: 'medium',
};

const BOOTSTRAP_WEIGHT_MAP: Record<string, number> = {
  functionality: 1.5, testing: 1.5, errorHandling: 1.2,
  security: 1.3, uxPolish: 1.4, documentation: 1.0,
  performance: 1.2, maintainability: 1.0,
  developerExperience: 1.5, autonomy: 1.3,
  planningQuality: 1.0, selfImprovement: 1.0,
  specDrivenPipeline: 1.2, convergenceSelfHealing: 1.1,
  tokenEconomy: 0.9, ecosystemMcp: 0.8,
  enterpriseReadiness: 0.8, communityAdoption: 0.7,
  contextEconomy: 1.0, causalCoherence: 1.0,
};

const BOOTSTRAP_LABEL_MAP: Record<string, string> = {
  functionality: 'Core Functionality', testing: 'Test Coverage & Quality',
  errorHandling: 'Error Handling & Recovery', security: 'Security Hardening',
  uxPolish: 'UX Polish & Onboarding', documentation: 'Documentation Quality',
  performance: 'Performance', maintainability: 'Code Maintainability',
  developerExperience: 'Developer Experience', autonomy: 'Autonomy & Self-Direction',
  planningQuality: 'Planning Quality (PDSE)', selfImprovement: 'Self-Improvement Loop',
  specDrivenPipeline: 'Spec-Driven Pipeline', convergenceSelfHealing: 'Convergence & Self-Healing',
  tokenEconomy: 'Token Economy & Budget Control', ecosystemMcp: 'Ecosystem & MCP Integration',
  enterpriseReadiness: 'Enterprise Readiness', communityAdoption: 'Community Adoption',
  contextEconomy: 'Context Economy', causalCoherence: 'Causal Coherence',
};

/**
 * Convert a CompetitorComparison into a CompeteMatrix.
 * Scores are in 0-100 in CompetitorComparison; normalized to 0-10.
 * Splits competitors into closed-source vs OSS using isOssTool().
 */
export function bootstrapMatrixFromComparison(
  comparison: CompetitorComparison,
  project: string,
): CompeteMatrix {
  const allCompetitorNames = comparison.competitors.map(c => c.name);
  const ossNames = allCompetitorNames.filter(isOssTool);
  const closedSourceNames = allCompetitorNames.filter(n => !isOssTool(n));

  const dimensions: MatrixDimension[] = comparison.gapReport.map(gap => {
    const id = gap.dimension as string;
    const knownCeiling = KNOWN_CEILINGS[id];
    const rawSelfScore = Math.round((comparison.ourDimensions[gap.dimension] ?? 0) / 10 * 10) / 10;
    const selfScoreNorm = knownCeiling ? Math.min(rawSelfScore, knownCeiling.ceiling) : rawSelfScore;

    const scores: Record<string, number> = { self: selfScoreNorm };
    for (const c of comparison.competitors) {
      scores[c.name] = Math.round((c.scores[gap.dimension] ?? 0) / 10 * 10) / 10;
    }

    const competitorEntries = Object.entries(scores).filter(([k]) => k !== 'self');
    const maxEntry = competitorEntries.reduce(
      (best, [k, v]) => v > best[1] ? [k, v] : best,
      ['', 0] as [string, number],
    );
    const gapToLeader = Math.max(0, maxEntry[1] - selfScoreNorm);

    const twoGaps = computeTwoGaps({ scores }, closedSourceNames, ossNames);

    const snakeId = id.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
    return {
      id: snakeId,
      label: BOOTSTRAP_LABEL_MAP[id] ?? id,
      weight: BOOTSTRAP_WEIGHT_MAP[id] ?? 1.0,
      category: ['functionality', 'testing', 'errorHandling', 'performance'].includes(id)
        ? 'quality'
        : ['uxPolish', 'developerExperience', 'documentation'].includes(id)
          ? 'ux'
          : ['security', 'enterpriseReadiness', 'maintainability'].includes(id)
            ? 'reliability'
            : 'features',
      frequency: BOOTSTRAP_FREQUENCY_MAP[id] ?? 'medium',
      scores,
      gap_to_leader: gapToLeader,
      leader: maxEntry[0] || 'unknown',
      gap_to_closed_source_leader: twoGaps.gap_to_closed_source_leader,
      closed_source_leader: twoGaps.closed_source_leader,
      gap_to_oss_leader: twoGaps.gap_to_oss_leader,
      oss_leader: twoGaps.oss_leader,
      status: 'not-started' as DimensionStatus,
      sprint_history: [],
      next_sprint_target: Math.min(10, selfScoreNorm + 2.0),
      harvest_source: twoGaps.oss_leader !== 'unknown' ? twoGaps.oss_leader : undefined,
      ...(knownCeiling ? { ceiling: knownCeiling.ceiling, ceilingReason: knownCeiling.reason } : {}),
    };
  });

  dimensions.sort((a, b) => computeGapPriority(b) - computeGapPriority(a));

  const matrix: CompeteMatrix = {
    project,
    competitors: allCompetitorNames,
    competitors_closed_source: closedSourceNames,
    competitors_oss: ossNames,
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 0,
    dimensions,
  };
  matrix.overallSelfScore = computeOverallScore(matrix);
  return matrix;
}

// ── Staleness Detection ───────────────────────────────────────────────────────

export interface MatrixStalenessReport {
  daysOld: number;
  isStale: boolean;
  driftedDimensions: Array<{
    id: string;
    label: string;
    matrixScore: number;
    harshScore: number;
    drift: number;
  }>;
}

/**
 * Check if a matrix is stale (age) or if self-scores have drifted from
 * a fresh harsh-scorer assessment.
 */
export function checkMatrixStaleness(
  matrix: CompeteMatrix,
  harshDimensions?: Record<string, number>,
  staleThresholdDays = 7,
  driftThreshold = 0.5,
): MatrixStalenessReport {
  const lastUpdated = new Date(matrix.lastUpdated);
  const daysOld = Math.floor((Date.now() - lastUpdated.getTime()) / 86400000);
  const isStale = daysOld > staleThresholdDays;

  const driftedDimensions: MatrixStalenessReport['driftedDimensions'] = [];
  if (harshDimensions) {
    for (const dim of matrix.dimensions) {
      const harshKey = dim.id.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      const harshScore = harshDimensions[harshKey];
      if (harshScore !== undefined) {
        const matrixScore = dim.scores['self'] ?? 0;
        const drift = Math.abs(matrixScore - harshScore);
        if (drift >= driftThreshold) {
          driftedDimensions.push({ id: dim.id, label: dim.label, matrixScore, harshScore, drift });
        }
      }
    }
  }

  return { daysOld, isStale, driftedDimensions };
}

// ── Closing Strategy ──────────────────────────────────────────────────────────

/** Dimension IDs that require human action to improve (no forge cycle). */
export const HUMAN_ACTION_DIMENSION_IDS = new Set([
  'community_adoption',
  'code_signing',
  'installer_distribution',
  'pricing_transparency',
  'privacy_policy',
  'enterprise_sla',
  'external_audit',
]);

/**
 * Derive the closing strategy for a dimension.
 */
export function getDimensionStrategy(dim: MatrixDimension, target: number): 'code' | 'human' | 'ceiling' {
  if (dim.ceiling !== undefined && dim.ceiling < target) return 'ceiling';
  if (dim.closingStrategy) return dim.closingStrategy;
  if (HUMAN_ACTION_DIMENSION_IDS.has(dim.id)) return 'human';
  return 'code';
}

/**
 * Unweighted mean of all dimension self-scores (0-10).
 */
export function computeUnweightedComposite(matrix: CompeteMatrix): number {
  if (matrix.dimensions.length === 0) return 0;
  const sum = matrix.dimensions.reduce((s, d) => s + (d.scores['self'] ?? 0), 0);
  return Math.round((sum / matrix.dimensions.length) * 10) / 10;
}

/**
 * Return the top-N dimensions sorted by gap × importance (highest priority first).
 */
export function getTopGapDimensions(matrix: CompeteMatrix, count = 5): MatrixDimension[] {
  const excluded = new Set(matrix.excludedDimensions ?? []);
  return [...matrix.dimensions]
    .filter(d => !excluded.has(d.id) && d.status !== 'closed')
    .sort((a, b) => computeGapPriority(b) - computeGapPriority(a))
    .slice(0, count);
}

/**
 * Mark a dimension as de-prioritized. Idempotent. Caller must call saveMatrix() afterward.
 */
export function excludeDimension(matrix: CompeteMatrix, id: string): void {
  const list = matrix.excludedDimensions ?? [];
  if (!list.includes(id)) list.push(id);
  matrix.excludedDimensions = list;
  matrix.lastUpdated = new Date().toISOString();
}

/**
 * Reverse a previous exclusion. Idempotent. Caller must call saveMatrix() afterward.
 */
export function includeDimension(matrix: CompeteMatrix, id: string): void {
  matrix.excludedDimensions = (matrix.excludedDimensions ?? []).filter(x => x !== id);
  matrix.lastUpdated = new Date().toISOString();
}
