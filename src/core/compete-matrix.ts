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
import os from 'node:os';

const STATE_DIR = '.danteforge';
const COMPETE_DIR = 'compete';
const MATRIX_FILE = 'matrix.json';

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

  // Closing strategy — how to close this dimension
  closingStrategy?: 'code' | 'human' | 'ceiling';
  manualActionHint?: string;  // specific action for 'human' strategy dims

  // Explicit touches — file/dir paths this dimension owns. When set, overrides
  // the dimension-synthesizer's heuristic token-match inference. Use this when
  // your dimension ID doesn't share tokens with the file paths it should scope.
  touches?: string[];

  // Evidence provenance for competitor leader scores.
  // 'llm-baseline': initial score was an LLM estimate
  // 'github-evidence': adjusted down from real open-issue counts
  // 'benchmark': set from a published benchmark result
  leaderScoreSource?: Record<string, 'llm-baseline' | 'github-evidence' | 'benchmark'>;
}

export interface AdversarialCalibration {
  dimensionId: string;
  beforeScore: number;
  afterScore: number;
  adversarialScore: number;
  verdict: 'inflated' | 'trusted' | 'watch' | 'underestimated';
  rationale: string;
  date: string;
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

  // Adversarial calibration history — records when hostile-review verdicts
  // were applied to correct inflated self-scores.
  adversarialCalibrations?: AdversarialCalibration[];

  // Dimensions the user has explicitly de-prioritized. Excluded dimensions
  // remain in the matrix for scoring continuity but are skipped by sprint
  // selection, work-packet generation, and gap-report ranking. Reverse with
  // `danteforge compete --include <id>`.
  excludedDimensions?: string[];
}

// ── Path Helpers ──────────────────────────────────────────────────────────────

export function getMatrixPath(cwd?: string): string {
  const base = cwd ?? process.cwd();
  return path.join(base, STATE_DIR, COMPETE_DIR, MATRIX_FILE);
}

// ── Persistence ───────────────────────────────────────────────────────────────

// In-memory TTL cache: avoids re-parsing the matrix JSON on every call
// within a single process (e.g. crusade frontier loop calling loadMatrix per cycle).
const MATRIX_CACHE_TTL_MS = 5_000; // 5 s — short enough to pick up saves
interface MatrixCacheEntry { matrix: CompeteMatrix; expiresAt: number; path: string }
let _matrixCache: MatrixCacheEntry | null = null;

/** Invalidate the in-process matrix cache (called by saveMatrix). */
export function invalidateMatrixCache(): void {
  _matrixCache = null;
}

export async function loadMatrix(
  cwd?: string,
  _fsRead?: (p: string) => Promise<string>,
): Promise<CompeteMatrix | null> {
  const matrixPath = getMatrixPath(cwd);

  // Return cached value if still valid and no injection override is active
  if (!_fsRead && _matrixCache && _matrixCache.path === matrixPath && Date.now() < _matrixCache.expiresAt) {
    return _matrixCache.matrix;
  }

  const read = _fsRead ?? ((p: string) => fs.readFile(p, 'utf8'));
  try {
    const raw = await read(matrixPath);
    const matrix = JSON.parse(raw) as CompeteMatrix;

    // Phase F: outcome-derived scoring. For any dim that declares `outcomes`,
    // replace `scores.self` with the score computed from the current outcome
    // evidence on disk. The original writable value is preserved at
    // `legacy_score` for transition diff display. This is the read-time
    // honesty enforcement — every consumer of loadMatrix sees the derived
    // value, never the agent-written one.
    if (!_fsRead) {
      await applyOutcomeDerivedScores(matrix, cwd ?? process.cwd());
      _matrixCache = { matrix, expiresAt: Date.now() + MATRIX_CACHE_TTL_MS, path: matrixPath };
    }
    return matrix;
  } catch {
    return null;
  }
}

/**
 * Phase F: walk the matrix, and for every dim that declares outcomes, compute
 * the outcome-evidence-derived score and store it in `scores.derived`.
 * `scores.self` is the competitive/adversarial assessment — this function does NOT touch it.
 * Best-effort — if evidence cannot be loaded, derived is left unchanged.
 */
async function applyOutcomeDerivedScores(matrix: CompeteMatrix, cwd: string): Promise<void> {
  let evidence: import('../matrix/types/outcome.js').OutcomeEvidence | null = null;
  for (const dim of matrix.dimensions) {
    const outcomes = (dim as unknown as Record<string, unknown>)['outcomes'];
    if (!Array.isArray(outcomes) || outcomes.length === 0) continue;

    // Lazy-load evidence only when at least one dim declares outcomes.
    if (evidence === null) {
      try {
        const { loadOutcomeEvidence } = await import('../matrix/engines/outcome-runner.js');
        evidence = await loadOutcomeEvidence(cwd);
      } catch {
        return; // best-effort
      }
    }

    try {
      // Staleness guard: only override scores.self when at least one evidence entry
      // for this dimension was recorded in the last 24 hours. Stale evidence causes
      // the derived score to compute as 0.0, which is worse than the stored value.
      const EVIDENCE_MAX_AGE_MS = 86_400_000; // 24 hours
      const now = Date.now();
      const { makeEvidenceKey } = await import('../matrix/types/outcome.js');
      const dimOutcomes = outcomes as Array<{ id: string }>;
      const hasFreshEvidence = dimOutcomes.some(o => {
        const entry = evidence!.get(makeEvidenceKey(dim.id, o.id));
        if (!entry?.ranAt) return false;
        return (now - new Date(entry.ranAt).getTime()) < EVIDENCE_MAX_AGE_MS;
      });
      if (!hasFreshEvidence) continue; // keep stored scores.self — evidence is stale

      const { computeDerivedScoreWithBreakdown } = await import('./derived-score.js');
      const { applyLegacyReceiptCeiling } = await import('../matrix/engines/receipt-ceiling.js');
      const dfs = {
        id: dim.id,
        outcomes: outcomes as import('../matrix/types/outcome.js').Outcome[],
        declared_ceiling: (dim as unknown as Record<string, unknown>)['declared_ceiling'] as 'T0'|'T1'|'T2'|'T3'|'T4'|'T5'|'T6'|undefined,
        legacy_score: dim.scores.self,
        scores: dim.scores,
      };
      const breakdown = computeDerivedScoreWithBreakdown(dfs, evidence!, new Date());
      // Depth doctrine: dims with no outcomes declared cannot exceed 7.0.
      const derived = applyLegacyReceiptCeiling(breakdown.score, breakdown);
      // Write derived score to scores.derived only.
      // scores.self is the human/adversarial competitive assessment — do not overwrite it.
      (dim.scores as unknown as Record<string, unknown>)['derived'] = derived;
    } catch {
      // best-effort; if scoring fails, leave the legacy value
    }
  }
}

export async function saveMatrix(
  matrix: CompeteMatrix,
  cwd?: string,
  _fsWrite?: (p: string, content: string) => Promise<void>,
): Promise<void> {
  const matrixPath = getMatrixPath(cwd);

  // Test-isolation guard (council 2026-05-29): a test once called saveMatrix()
  // with the default (real-disk) write and the real repo as cwd, clobbering the
  // live .danteforge/compete/matrix.json with a 1-dim fixture. Catch the whole
  // class at the chokepoint: when running under Node's test runner with a REAL
  // disk write (no _fsWrite seam) to a path OUTSIDE the OS temp dir, throw.
  // Tests must either pass the _fsWrite seam or a tmp cwd. This never fires in
  // production (NODE_TEST_CONTEXT is only set by `node --test`).
  if (process.env['NODE_TEST_CONTEXT'] && !_fsWrite) {
    const resolved = path.resolve(matrixPath);
    const tmpReal = path.resolve(os.tmpdir());
    if (!resolved.toLowerCase().startsWith(tmpReal.toLowerCase())) {
      throw new Error(
        `[saveMatrix] Refusing to write a real matrix.json during a test run: ${resolved}. ` +
        `Tests must pass the _fsWrite seam or a cwd under os.tmpdir() — writing the live ` +
        `project matrix from a test clobbers real competitive scores.`,
      );
    }
  }

  const write = _fsWrite ?? (async (p: string, content: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
  });
  await write(matrixPath, JSON.stringify(matrix, null, 2));
  // Bust the in-process cache so the next loadMatrix reads the saved value
  invalidateMatrixCache();
}

export { FREQUENCY_MULTIPLIERS, computeGapPriority, getNextSprintDimension, classifyDimensions, effectiveDimScore, computeOverallScore, computeTwoGaps, updateDimensionScore, applyIntelLeaderScores, applyAdversarialCalibration, clampDimScore, MARKET_DIMS_SCORE_CAP, MARKET_DIM_MAX_SCORE } from './compete-matrix-score.js';
export { KNOWN_OSS_TOOLS, isOssTool, KNOWN_CEILINGS, addOrUpdateCompetitor, addOrUpdateDimension, removeCompetitor, dropDimension, recategorizeDimension, setDimensionWeight, bootstrapMatrixFromComparison, checkMatrixStaleness, getDimensionStrategy, computeUnweightedComposite, getTopGapDimensions, HUMAN_ACTION_DIMENSION_IDS, excludeDimension, includeDimension } from './compete-matrix-ops.js';
export type { MatrixStalenessReport } from './compete-matrix-ops.js';
