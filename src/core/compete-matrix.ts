// compete-matrix.ts — Persistent matrix for the Competitive Harvest Loop (CHL)
// Tracks self vs competitor scores per dimension, sprint history, and next-sprint selection.
// The matrix is the "strategy layer" on top of the existing competitor-scanner execution layer.
//
// Two-matrix structure (from the CHL design):
//   - competitors_closed_source: Cursor, Copilot, Devin — what users pay for, gold standard
//   - competitors_oss: Aider, Continue.dev, Tabby — what you can legally harvest
// This distinction drives the sprint strategy: harvest from OSS leader, aim toward closed-source leader.

import fs from 'fs/promises';
import path from 'path';
import type { CompetitorComparison } from './competitor-scanner.js';

const STATE_DIR = '.danteforge';
const COMPETE_DIR = 'compete';
const MATRIX_FILE = 'matrix.json';

// ── Known OSS Tools ───────────────────────────────────────────────────────────
// Identifies which competitors are open-source (harvestable) vs closed-source (gold standard).
// Add new tools here as the ecosystem evolves.

export const KNOWN_OSS_TOOLS = new Set([
  'Aider', 'Continue', 'Continue.dev', 'OpenHands', 'SWE-Agent', 'SWE-agent (Princeton)',
  'MetaGPT', 'AutoGen', 'CrewAI', 'LangChain', 'Cline', 'Goose',
  'GPT-Engineer', 'Tabby', 'CodeGeeX', 'FauxPilot', 'Ollama',
  'Gpt-engineer', 'OpenDevin', 'AgentCoder', 'Plandex',
]);

export function isOssTool(name: string): boolean {
  if (KNOWN_OSS_TOOLS.has(name)) return true;
  // Match prefix (e.g. "SWE-Agent (Princeton)" → "SWE-Agent")
  const prefix = name.split(/[\s(]/)[0];
  return prefix !== undefined && KNOWN_OSS_TOOLS.has(prefix);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SprintRecord {
  dimensionId: string;
  before: number;          // self score before sprint (0-10)
  after: number;           // self score after sprint (0-10)
  date: string;            // ISO date string
  commit?: string;         // git SHA for PDSE audit trail
  harvestSource?: string;  // OSS repo that was harvested
}

export type DimensionStatus = 'not-started' | 'in-progress' | 'closed';

export interface MatrixDimension {
  id: string;              // snake_case e.g. "spec_driven_pipeline"
  label: string;           // human-readable label
  weight: number;          // importance multiplier (default 1.0; high-frequency = 1.5)
  category: string;        // "performance" | "ux" | "features" | "reliability" | "quality"
  frequency: 'high' | 'medium' | 'low';
  scores: Record<string, number>; // { self: 4.5, cursor: 9.0, aider: 7.0 }

  // Primary gap (vs best competitor overall — backward compat)
  gap_to_leader: number;   // max(all competitor scores) - self score (0 if leading)
  leader: string;          // competitor name with highest score

  // Two-matrix split — the core CHL insight
  gap_to_closed_source_leader: number; // gap vs best closed-source (gold standard)
  closed_source_leader: string;        // e.g. "Cursor" at 9.2
  gap_to_oss_leader: number;           // gap vs best OSS (harvestable)
  oss_leader: string;                  // e.g. "Aider" at 7.0

  status: DimensionStatus;
  sprint_history: SprintRecord[];
  next_sprint_target: number; // target self score for next sprint
  harvest_source?: string;    // recommended OSS project to harvest from

  // Ceiling classification — max score achievable via automation
  ceiling?: number;           // if set, ascend will not attempt to push self score beyond this
  ceilingReason?: string;     // human-readable explanation (e.g. "requires external users")
}

export interface CompeteMatrix {
  project: string;

  // Flat list (backward compat + quick lookup)
  competitors: string[];

  // Two-matrix split — the strategy layer
  competitors_closed_source: string[]; // Cursor, Copilot Workspace, Devin…
  competitors_oss: string[];           // Aider, Continue.dev, Tabby…

  lastUpdated: string;
  overallSelfScore: number;    // weighted average across all dimensions (0-10)
  dimensions: MatrixDimension[];
}

// ── Priority Constants ────────────────────────────────────────────────────────

export const FREQUENCY_MULTIPLIERS: Record<string, number> = {
  high: 1.5,
  medium: 1.0,
  low: 0.5,
};

// ── Ceiling Defaults ──────────────────────────────────────────────────────────
// Dimensions that cannot reach 10/10 via code changes alone.
// communityAdoption requires external users; enterpriseReadiness requires
// real production deployments. These ceilings prevent ascend from wasting
// cycles trying to automate inherently social/market-dependent dimensions.

export const KNOWN_CEILINGS: Record<string, { ceiling: number; reason: string }> = {
  communityAdoption: {
    ceiling: 4.0,
    reason: 'requires npm downloads, GitHub stars, and external contributors — cannot be automated',
  },
  enterpriseReadiness: {
    ceiling: 9.0,
    reason: 'filesystem evidence (SECURITY.md, CHANGELOG.md, RUNBOOK.md) is automatable up to 9.0; the final point requires real production deployments and customer validation',
  },
};

// ── Path Helpers ──────────────────────────────────────────────────────────────

export function getMatrixPath(cwd?: string): string {
  const base = cwd ?? process.cwd();
  return path.join(base, STATE_DIR, COMPETE_DIR, MATRIX_FILE);
}

// ── Persistence ───────────────────────────────────────────────────────────────

export async function loadMatrix(
  cwd?: string,
  _fsRead?: (p: string) => Promise<string>,
): Promise<CompeteMatrix | null> {
  const matrixPath = getMatrixPath(cwd);
  const read = _fsRead ?? ((p: string) => fs.readFile(p, 'utf8'));
  try {
    const raw = await read(matrixPath);
    return JSON.parse(raw) as CompeteMatrix;
  } catch {
    return null;
  }
}

export async function saveMatrix(
  matrix: CompeteMatrix,
  cwd?: string,
  _fsWrite?: (p: string, content: string) => Promise<void>,
): Promise<void> {
  const matrixPath = getMatrixPath(cwd);
  const write = _fsWrite ?? (async (p: string, content: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
  });
  await write(matrixPath, JSON.stringify(matrix, null, 2));
}

// ── Core Computations ─────────────────────────────────────────────────────────

/**
 * Compute the sprint priority score for a dimension.
 * Higher = should be sprinted sooner.
 * Formula: weight × gap_to_leader × frequency_multiplier
 */
export function computeGapPriority(dim: MatrixDimension): number {
  const freq = FREQUENCY_MULTIPLIERS[dim.frequency] ?? 1.0;
  return dim.weight * dim.gap_to_leader * freq;
}

/**
 * Find the next dimension to sprint on: highest priority that isn't 'closed'
 * and hasn't hit its automation ceiling AND whose ceiling can reach the target.
 * A dim is ineligible if its ceiling < target (can never reach target via automation),
 * or if its current score has already hit the ceiling.
 * Returns null if all dimensions are closed/at-ceiling or the matrix is empty.
 */
export function getNextSprintDimension(matrix: CompeteMatrix, target = 9.0): MatrixDimension | null {
  const eligible = matrix.dimensions.filter(d =>
    d.status !== 'closed' &&
    // exclude dims already at or above target — nothing to improve
    (d.scores['self'] ?? 0) < target &&
    // ceiling must either not exist, OR be >= target (can reach target) AND score not yet at ceiling
    (d.ceiling === undefined || (d.ceiling >= target && (d.scores['self'] ?? 0) < d.ceiling)),
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((best, d) =>
    computeGapPriority(d) > computeGapPriority(best) ? d : best,
  );
}

/**
 * Classify dimensions into achievable (can still be improved via automation)
 * vs atCeiling (self score has reached the automation ceiling).
 * Closed dimensions (gap_to_leader <= 0) are excluded from both lists.
 */
export function classifyDimensions(matrix: CompeteMatrix, target = 9.0): {
  achievable: MatrixDimension[];
  atCeiling: MatrixDimension[];
} {
  // A dim is at ceiling when: ceiling is defined AND (ceiling < target OR current score hit ceiling).
  // If ceiling < target, automation can never bring it to target — treat it as blocked immediately,
  // regardless of current score. This prevents infinite retry loops on dims like communityAdoption
  // whose ceiling (4.0) is below any reasonable target.
  const atCeiling = matrix.dimensions.filter(d =>
    d.status !== 'closed' &&
    d.ceiling !== undefined &&
    (d.ceiling < target || (d.scores['self'] ?? 0) >= d.ceiling),
  );
  const atCeilingIds = new Set(atCeiling.map(d => d.id));
  const achievable = matrix.dimensions.filter(d =>
    d.status !== 'closed' && !atCeilingIds.has(d.id),
  );
  return { achievable, atCeiling };
}

/**
 * Compute weighted average self score across all dimensions (0-10 scale).
 */
export function computeOverallScore(matrix: CompeteMatrix): number {
  if (matrix.dimensions.length === 0) return 0;
  const totalWeight = matrix.dimensions.reduce((s, d) => s + d.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = matrix.dimensions.reduce(
    (s, d) => s + d.weight * (d.scores['self'] ?? 0),
    0,
  );
  return Math.round((weightedSum / totalWeight) * 10) / 10;
}

/**
 * Compute two-gap fields for a dimension given the closed-source and OSS competitor sets.
 * Returns { gap_to_closed_source_leader, closed_source_leader, gap_to_oss_leader, oss_leader }.
 */
export function computeTwoGaps(
  dim: { scores: Record<string, number> },
  closedSourceNames: string[],
  ossNames: string[],
): {
  gap_to_closed_source_leader: number;
  closed_source_leader: string;
  gap_to_oss_leader: number;
  oss_leader: string;
} {
  const selfScore = dim.scores['self'] ?? 0;

  const findBest = (names: string[]): [string, number] => {
    let bestName = '';
    let bestScore = 0;
    for (const name of names) {
      const s = dim.scores[name] ?? 0;
      if (s > bestScore) { bestScore = s; bestName = name; }
    }
    return [bestName, bestScore];
  };

  const [csLeader, csScore] = findBest(closedSourceNames);
  const [ossLeader, ossScore] = findBest(ossNames);

  return {
    gap_to_closed_source_leader: Math.max(0, csScore - selfScore),
    closed_source_leader: csLeader || 'unknown',
    gap_to_oss_leader: Math.max(0, ossScore - selfScore),
    oss_leader: ossLeader || 'unknown',
  };
}

/**
 * Update self score for a dimension after completing a sprint.
 * Mutates the matrix in-place. Caller must call saveMatrix() afterward.
 */
export function updateDimensionScore(
  matrix: CompeteMatrix,
  dimensionId: string,
  newScore: number,
  commit?: string,
  harvestSource?: string,
): void {
  const dim = matrix.dimensions.find(d => d.id === dimensionId);
  if (!dim) throw new Error(`Dimension "${dimensionId}" not found in matrix`);

  const before = dim.scores['self'] ?? 0;
  // Clamp to ceiling so a dimension can never be scored above its automation ceiling.
  const clamped = dim.ceiling !== undefined ? Math.min(newScore, dim.ceiling) : newScore;
  dim.scores['self'] = clamped;

  // Recompute gap_to_leader (all competitors)
  const competitorEntries = Object.entries(dim.scores).filter(([k]) => k !== 'self');
  const maxEntry = competitorEntries.reduce(
    (best, [k, v]) => v > best[1] ? [k, v] : best,
    ['', 0] as [string, number],
  );
  dim.gap_to_leader = Math.max(0, maxEntry[1] - clamped);
  if (maxEntry[0]) dim.leader = maxEntry[0];

  // Recompute two-gap fields
  const twoGaps = computeTwoGaps(dim, matrix.competitors_closed_source ?? [], matrix.competitors_oss ?? []);
  dim.gap_to_closed_source_leader = twoGaps.gap_to_closed_source_leader;
  dim.closed_source_leader = twoGaps.closed_source_leader;
  dim.gap_to_oss_leader = twoGaps.gap_to_oss_leader;
  dim.oss_leader = twoGaps.oss_leader;

  // Record sprint
  const record: SprintRecord = {
    dimensionId,
    before,
    after: clamped,
    date: new Date().toISOString().slice(0, 10),
    ...(commit ? { commit } : {}),
    ...(harvestSource ? { harvestSource } : {}),
  };
  dim.sprint_history.push(record);

  // Update status
  if (dim.gap_to_leader <= 0) {
    dim.status = 'closed';
  } else if (dim.status === 'not-started') {
    dim.status = 'in-progress';
  }

  matrix.lastUpdated = new Date().toISOString();
  matrix.overallSelfScore = computeOverallScore(matrix);
}

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
  dim.gap_to_leader = Math.max(0, maxEntry[1] - selfScore);
  dim.leader = maxEntry[0];

  const closedEntries = entries.filter(([k]) => closedSourceCompetitors.includes(k));
  if (closedEntries.length > 0) {
    const best = closedEntries.reduce((a, b) => (b[1] > a[1] ? b : a));
    dim.gap_to_closed_source_leader = Math.max(0, best[1] - selfScore);
    dim.closed_source_leader = best[0];
  } else {
    dim.gap_to_closed_source_leader = 0;
    dim.closed_source_leader = 'none';
  }

  const ossEntries = entries.filter(([k]) => ossCompetitors.includes(k));
  if (ossEntries.length > 0) {
    const best = ossEntries.reduce((a, b) => (b[1] > a[1] ? b : a));
    dim.gap_to_oss_leader = Math.max(0, best[1] - selfScore);
    dim.oss_leader = best[0];
  } else {
    dim.gap_to_oss_leader = 0;
    dim.oss_leader = 'none';
  }
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
 * The dimension will no longer appear in scoring or sprint selection.
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
 * Weight is clamped to a minimum of 0.
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
};

/**
 * Convert a CompetitorComparison (from competitor-scanner.ts) into a CompeteMatrix.
 * Scores are in 0-100 in CompetitorComparison; we normalize to 0-10.
 * Splits competitors into closed-source vs OSS using isOssTool().
 */
export function bootstrapMatrixFromComparison(
  comparison: CompetitorComparison,
  project: string,
): CompeteMatrix {
  // Split competitors into OSS vs closed-source
  const allCompetitorNames = comparison.competitors.map(c => c.name);
  const ossNames = allCompetitorNames.filter(isOssTool);
  const closedSourceNames = allCompetitorNames.filter(n => !isOssTool(n));

  const dimensions: MatrixDimension[] = comparison.gapReport.map(gap => {
    const id = gap.dimension as string;
    const knownCeiling = KNOWN_CEILINGS[id];
    const rawSelfScore = Math.round((comparison.ourDimensions[gap.dimension] ?? 0) / 10 * 10) / 10;
    // Clamp initial score to ceiling so bootstrap can never create a score > ceiling.
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

  // Sort by priority descending
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
 * a fresh harsh-scorer assessment. Pass `harshDimensions` from computeHarshScore()
 * to enable drift detection; omit for age-only check.
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
      // Map snake_case dimension id back to camelCase for harsh-scorer lookup
      // e.g., "ux_polish" → "uxPolish", "spec_driven_pipeline" → "specDrivenPipeline"
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
