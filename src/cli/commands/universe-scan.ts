// Universe Scan — evidence-based competitive intelligence with dimension evolution.
// Differs from universe.ts (LLM-scored features) by using Grep+Glob to self-score.
// Outputs: .danteforge/UNIVERSE.json, .danteforge/SCORES.json,
//          .danteforge/universe-history/{timestamp}.json

import fs from 'node:fs/promises';
import path from 'node:path';
import { glob } from 'glob';
import { logger } from '../../core/logger.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import {
  loadHarvestQueue,
  saveHarvestQueue,
  updateGapCoverage,
} from '../../core/harvest-queue.js';
import { type GoalConfig } from './set-goal.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UniverseDimension {
  /** Short slug name, e.g. "circuit-breaker" */
  name: string;
  /** Human description */
  description: string;
  /** 1-10: How much this impacts end-users */
  userImpact: number;
  /** 1-10: How much this separates leaders from laggards */
  differentiation: number;
  /** 1-10: How new/trending this capability is */
  emergenceScore: number;
  /** Combined weight: userImpact × differentiation × emergenceScore / 1000 */
  weight: number;
  /** OSS repos that implement this dimension well */
  competitors: string[];
}

export interface UniverseScan {
  version: '1.0.0';
  scannedAt: string;
  /** From GOAL.json or LLM-inferred */
  category: string;
  dimensions: UniverseDimension[];
  /** dimension name → evidence-based score (0,3,5,7,9,10) */
  selfScores: Record<string, number>;
  dimensionChanges: {
    /** Dimension names new since last scan */
    new: string[];
    /** Dimension names removed since last scan */
    dead: string[];
    /** Dimensions whose weight changed by > 20% */
    shifted: Array<{ dimension: string; delta: number }>;
  };
}

export interface UniverseScanOptions {
  cwd?: string;
  promptMode?: boolean;
  _llmCaller?: (prompt: string) => Promise<string>;
  _isLLMAvailable?: () => Promise<boolean>;
  _readGoal?: (cwd?: string) => Promise<GoalConfig | null>;
  _globFn?: (pattern: string, cwd: string) => Promise<string[]>;
  _grepFn?: (pattern: string, cwd: string) => Promise<string[]>;
  /**
   * Web search injection — returns a list of competitor names from search results.
   * When provided, Phase 1 searches for fresh competitors and merges them with GOAL.json.
   * When omitted, the static GOAL.json competitors list is used (current behaviour unchanged).
   */
  _searchWeb?: (query: string) => Promise<string[]>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const UNIVERSE_FILENAME = 'UNIVERSE.json';
const SCORES_FILENAME = 'SCORES.json';

/** 8 standard dimensions used when LLM is unavailable */
const STANDARD_DIMENSIONS: UniverseDimension[] = [
  {
    name: 'circuit-breaker',
    description: 'Fault isolation with automatic open/half-open/closed state transitions',
    userImpact: 9, differentiation: 8, emergenceScore: 7,
    weight: 9 * 8 * 7 / 1000,
    competitors: [],
  },
  {
    name: 'observability',
    description: 'Structured logging, metrics, and distributed tracing',
    userImpact: 8, differentiation: 7, emergenceScore: 9,
    weight: 8 * 7 * 9 / 1000,
    competitors: [],
  },
  {
    name: 'streaming',
    description: 'Streaming LLM output with backpressure and token tracking',
    userImpact: 9, differentiation: 9, emergenceScore: 10,
    weight: 9 * 9 * 10 / 1000,
    competitors: [],
  },
  {
    name: 'multi-agent',
    description: 'Parallel agent execution with DAG orchestration and result synthesis',
    userImpact: 8, differentiation: 9, emergenceScore: 10,
    weight: 8 * 9 * 10 / 1000,
    competitors: [],
  },
  {
    name: 'testing',
    description: 'Injection seams, deterministic tests, and coverage enforcement',
    userImpact: 7, differentiation: 8, emergenceScore: 6,
    weight: 7 * 8 * 6 / 1000,
    competitors: [],
  },
  {
    name: 'security',
    description: 'Shell denylist, prompt injection stripping, and privilege controls',
    userImpact: 9, differentiation: 7, emergenceScore: 8,
    weight: 9 * 7 * 8 / 1000,
    competitors: [],
  },
  {
    name: 'cost-control',
    description: 'Token budget, provider routing, and spend guardrails',
    userImpact: 8, differentiation: 8, emergenceScore: 9,
    weight: 8 * 8 * 9 / 1000,
    competitors: [],
  },
  {
    name: 'self-improvement',
    description: 'Convergence loops, plateau detection, and lesson compaction',
    userImpact: 7, differentiation: 10, emergenceScore: 10,
    weight: 7 * 10 * 10 / 1000,
    competitors: [],
  },
];

/** Grep patterns used to score each standard dimension (0-10 scale) */
const DIMENSION_EVIDENCE: Record<string, string[]> = {
  'circuit-breaker': ['CircuitBreaker', 'HALF_OPEN', 'circuit.*open', 'circuitBreaker'],
  'observability':   ['opentelemetry', 'structuredLog', 'tracing', 'metrics', 'otel'],
  'streaming':       ['stream', 'ReadableStream', 'AsyncIterable', 'onChunk', 'streamText'],
  'multi-agent':     ['agent-dag', 'AgentDAG', 'Promise.all.*agent', 'party.*mode', 'parallelAgent'],
  'testing':         ['_llmCaller', '_isLLMAvailable', 'makeTempDir', 'injection.*seam'],
  'security':        ['denylist', 'allowlist', 'sanitize', 'promptInjection', 'shellDeny'],
  'cost-control':    ['BudgetFence', 'maxBudgetUsd', 'tokenBudget', 'costUsd', 'budgetExhausted'],
  'self-improvement':['detectPlateau', 'convergence', 'harvestForge', 'CycleRecord', 'renderConvergenceChart'],
};

// ── Path helpers ──────────────────────────────────────────────────────────────

function getDanteforgeDir(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge');
}

// ── Default injections ────────────────────────────────────────────────────────

async function defaultGlobFn(pattern: string, cwd: string): Promise<string[]> {
  return glob(pattern, { cwd, absolute: false });
}

async function defaultGrepFn(pattern: string, cwd: string): Promise<string[]> {
  try {
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);
    const result = await execAsync(
      `grep -rl "${pattern}" src/ 2>/dev/null || true`,
      { cwd, timeout: 5000 },
    );
    return result.stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function defaultReadGoal(cwd?: string): Promise<GoalConfig | null> {
  try {
    const { loadGoal } = await import('./set-goal.js');
    return loadGoal(cwd);
  } catch {
    return null;
  }
}

// ── Evidence-based self-scoring ───────────────────────────────────────────────

/**
 * Score a dimension 0/3/5/7/9/10 based on grep evidence matches.
 * More matches across more patterns = higher score.
 */
function computeEvidenceScore(matchCount: number): number {
  if (matchCount === 0) return 0;
  if (matchCount === 1) return 3;
  if (matchCount <= 3) return 5;
  if (matchCount <= 6) return 7;
  if (matchCount <= 10) return 9;
  return 10;
}

async function scoreDimension(
  dimensionName: string,
  cwd: string,
  grepFn: (pattern: string, cwd: string) => Promise<string[]>,
): Promise<number> {
  const patterns = DIMENSION_EVIDENCE[dimensionName] ?? [];
  let totalMatches = 0;
  for (const pattern of patterns) {
    const matches = await grepFn(pattern, cwd);
    totalMatches += matches.length;
  }
  return computeEvidenceScore(totalMatches);
}

// ── Dimension evolution diff ──────────────────────────────────────────────────

function computeDimensionChanges(
  previous: UniverseDimension[],
  current: UniverseDimension[],
): UniverseScan['dimensionChanges'] {
  const prevNames = new Set(previous.map(d => d.name));
  const currNames = new Set(current.map(d => d.name));

  const newDims = current.filter(d => !prevNames.has(d.name)).map(d => d.name);
  const deadDims = previous.filter(d => !currNames.has(d.name)).map(d => d.name);

  const shifted: Array<{ dimension: string; delta: number }> = [];
  for (const curr of current) {
    const prev = previous.find(d => d.name === curr.name);
    if (!prev) continue;
    const delta = curr.weight - prev.weight;
    if (Math.abs(delta) / (prev.weight || 0.001) > 0.2) {
      shifted.push({ dimension: curr.name, delta: Math.round(delta * 1000) / 1000 });
    }
  }

  return { new: newDims, dead: deadDims, shifted };
}

// ── LLM dimension extraction ──────────────────────────────────────────────────

async function extractDimensionsViaLLM(
  category: string,
  competitors: string[],
  llmCaller: (prompt: string) => Promise<string>,
): Promise<UniverseDimension[]> {
  const competitorList = competitors.length > 0 ? competitors.join(', ') : 'leading tools in this category';

  const prompt = `You are a product strategist analyzing competitive dimensions for software tooling.

Category: ${category}
Key competitors: ${competitorList}

List the 8-12 most important capability dimensions that distinguish leaders from laggards in this category.
For each dimension, score:
- userImpact: 1-10 (how much this impacts end-users)
- differentiation: 1-10 (how much this separates market leaders from average tools)
- emergenceScore: 1-10 (how new/trending this is in 2025-2026)

Also list 2-3 notable OSS repos that implement this dimension exceptionally well.

Respond ONLY with valid JSON:
{
  "dimensions": [
    {
      "name": "kebab-case-slug",
      "description": "one sentence",
      "userImpact": 8,
      "differentiation": 9,
      "emergenceScore": 7,
      "competitors": ["repo/name"]
    }
  ]
}`;

  try {
    const raw = await llmCaller(prompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return STANDARD_DIMENSIONS;
    const parsed = JSON.parse(jsonMatch[0]) as { dimensions: Array<Omit<UniverseDimension, 'weight'>> };
    // Apply 1.5x multiplier for high-emergence dimensions (trending/new in 2025-2026)
    const withWeights = (parsed.dimensions ?? []).map(d => ({
      ...d,
      weight: (d.userImpact * d.differentiation * d.emergenceScore) / 1000 *
        (d.emergenceScore >= 8 ? 1.5 : 1.0),
    }));
    // Sort by effective weight descending so high-emergence dims are prioritised first
    return withWeights.sort((a, b) => b.weight - a.weight);
  } catch {
    return STANDARD_DIMENSIONS;
  }
}

// ── Main entry ─────────────────────────────────────────────────────────────────

async function mergeWebCompetitors(
  searchWeb: (query: string) => Promise<string[]>,
  competitors: string[],
  category: string,
): Promise<string[]> {
  logger.info('[universe-scan] Phase 1: Searching for fresh competitors...');
  try {
    const results = await Promise.all([
      searchWeb(`"${category}" tool 2025 2026 github stars`),
      searchWeb(`"${category}" alternative open source github`),
    ]);
    const discovered = results.flat().map(name => name.trim()).filter(Boolean);
    const seen = new Set(competitors.map(c => c.toLowerCase()));
    let merged = [...competitors];
    for (const name of discovered) {
      if (!seen.has(name.toLowerCase())) { merged = [...merged, name]; seen.add(name.toLowerCase()); }
    }
    if (discovered.length > 0) logger.info(`[universe-scan] Merged ${discovered.length} web-discovered competitors.`);
    return merged;
  } catch (err) {
    logger.warn(`[universe-scan] Web search failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    return competitors;
  }
}

async function persistUniverseScanResults(
  scan: UniverseScan,
  selfScores: Record<string, number>,
  dimensions: UniverseDimension[],
  cwd: string | undefined,
  danteforgeDir: string,
): Promise<void> {
  await fs.mkdir(danteforgeDir, { recursive: true });
  await fs.writeFile(path.join(danteforgeDir, UNIVERSE_FILENAME), JSON.stringify(scan, null, 2), 'utf8');
  await fs.writeFile(path.join(danteforgeDir, SCORES_FILENAME), JSON.stringify(selfScores, null, 2), 'utf8');

  const historyDir = path.join(danteforgeDir, 'universe-history');
  await fs.mkdir(historyDir, { recursive: true });
  await fs.writeFile(path.join(historyDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify(scan, null, 2), 'utf8');

  try {
    let queue = await loadHarvestQueue(cwd);
    for (const dim of dimensions) queue = updateGapCoverage(queue, dim.name, selfScores[dim.name] ?? 0);
    await saveHarvestQueue(queue, cwd);
  } catch { /* best-effort */ }
}

async function logEmergentDimensions(cwd: string | undefined): Promise<void> {
  try {
    const emergentPath = path.join(cwd ?? process.cwd(), '.danteforge', 'emergent-dimensions.json');
    const emergentRaw = await fs.readFile(emergentPath, 'utf8');
    const emergentData = JSON.parse(emergentRaw) as { dimensions?: Array<{ dimension: string; description: string; emergenceSignal: string; relevanceScore: number }> };
    if (Array.isArray(emergentData.dimensions) && emergentData.dimensions.length > 0) {
      logger.info(`[universe-scan] Merging ${emergentData.dimensions.length} emergent dimensions from oss-deep`);
      for (const dim of emergentData.dimensions) {
        if (dim.relevanceScore > 0.7) {
          logger.info(`[universe-scan] Emergent dimension: "${dim.dimension}" — ${dim.description}`);
          logger.info(`[universe-scan]   Signal: ${dim.emergenceSignal}`);
        }
      }
    }
  } catch { /* No emergent dims file — normal for new projects */ }
}

export async function universeScan(opts: UniverseScanOptions = {}): Promise<UniverseScan> {
  const cwd = opts.cwd ?? process.cwd();
  const llmCaller = opts._llmCaller ?? callLLM;
  const isLLMAvailableFn = opts._isLLMAvailable ?? isLLMAvailable;
  const readGoal = opts._readGoal ?? defaultReadGoal;
  const globFn = opts._globFn ?? defaultGlobFn;
  const grepFn = opts._grepFn ?? defaultGrepFn;
  const searchWeb = opts._searchWeb;

  // ── Prompt mode ─────────────────────────────────────────────────────────────
  if (opts.promptMode) {
    const plan = `# Universe Scan Plan

## What This Does
1. Read GOAL.json (category + competitors) or LLM-infer from codebase
   (When _searchWeb is provided, also searches the web for fresh competitors)
2. Extract 8-12 competitive dimensions via LLM (or use 8 standard dimensions)
3. Evidence-based self-scoring: grep src/** for each dimension's signals
4. Compute dimension evolution vs previous UNIVERSE.json
5. Write .danteforge/UNIVERSE.json, SCORES.json, universe-history/{timestamp}.json
6. Update harvest-queue.json gaps via updateGapCoverage

## Score Scale
  0 = no evidence    3 = minimal    5 = clear impl    7 = full feature
  9 = full + tests   10 = industry-leading
`;
    logger.info(plan);
    return buildEmptyScan('unknown');
  }

  logger.info('[universe-scan] Starting competitive universe scan...');

  // ── Phase 1: Category + competitor discovery ──────────────────────────────
  const goal = await readGoal(cwd);
  const category = goal?.category ?? 'agentic development CLI';
  let competitors = goal?.competitors ?? [];

  if (searchWeb) {
    competitors = await mergeWebCompetitors(searchWeb, competitors, category);
  }

  logger.info(`[universe-scan] Category: ${category}`);

  // ── Phase 2: Dimension extraction ────────────────────────────────────────
  let dimensions: UniverseDimension[];
  const llmAvailable = await isLLMAvailableFn();

  if (llmAvailable) {
    logger.info('[universe-scan] Extracting dimensions via LLM...');
    dimensions = await extractDimensionsViaLLM(category, competitors, llmCaller);
  } else {
    logger.info('[universe-scan] LLM unavailable — using 8 standard dimensions.');
    dimensions = STANDARD_DIMENSIONS;
  }

  logger.info(`[universe-scan] Found ${dimensions.length} dimensions.`);

  // ── Phase 3: Evidence-based self-scoring ─────────────────────────────────
  logger.info('[universe-scan] Scoring codebase evidence...');
  const selfScores: Record<string, number> = {};
  for (const dim of dimensions) {
    const score = await scoreDimension(dim.name, cwd, grepFn);
    selfScores[dim.name] = score;
    logger.info(`  ${dim.name}: ${score}/10`);
  }

  // ── Phase 4: Dimension evolution ─────────────────────────────────────────
  const danteforgeDir = getDanteforgeDir(cwd);
  let previousDimensions: UniverseDimension[] = [];
  try {
    const prevRaw = await fs.readFile(path.join(danteforgeDir, UNIVERSE_FILENAME), 'utf8');
    const prev = JSON.parse(prevRaw) as UniverseScan;
    previousDimensions = prev.dimensions ?? [];
  } catch {
    // No previous scan — all dimensions are new
  }

  const dimensionChanges = computeDimensionChanges(previousDimensions, dimensions);
  if (dimensionChanges.new.length > 0) {
    logger.info(`[universe-scan] New dimensions: ${dimensionChanges.new.join(', ')}`);
  }
  if (dimensionChanges.dead.length > 0) {
    logger.info(`[universe-scan] Retired dimensions: ${dimensionChanges.dead.join(', ')}`);
  }

  // ── Phase 5: Persist ─────────────────────────────────────────────────────
  const scan: UniverseScan = { version: '1.0.0', scannedAt: new Date().toISOString(), category, dimensions, selfScores, dimensionChanges };
  await persistUniverseScanResults(scan, selfScores, dimensions, cwd, danteforgeDir);
  await logEmergentDimensions(cwd);

  logger.info(`[universe-scan] Complete. ${dimensions.length} dimensions scored. Written to .danteforge/.`);
  return scan;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildEmptyScan(category: string): UniverseScan {
  return {
    version: '1.0.0',
    scannedAt: new Date().toISOString(),
    category,
    dimensions: [],
    selfScores: {},
    dimensionChanges: { new: [], dead: [], shifted: [] },
  };
}

export { computeEvidenceScore };
