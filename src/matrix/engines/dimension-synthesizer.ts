// Matrix Kernel — Dimension Graph synthesizer (Phase 3 of PRD)
//
// Thin wrapper over compete-matrix.ts. Reads the existing MatrixDimension
// records and converts them to PRD §9.2 DimensionGraphNode shape, computing
// gaps vs OSS frontier and closed-source frontier separately.
//
// Reuses (per Phase 0 audit):
//   - compete-matrix.ts:loadMatrix
//   - compete-matrix.ts:MatrixDimension type
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadMatrix } from '../../core/compete-matrix.js';
import type { MatrixDimension, CompeteMatrix } from '../../core/compete-matrix.js';
import type {
  DimensionGraph,
  DimensionGraphNode,
  DimensionContract,
  Competitor,
  CompetitorCategory,
  InspectionMode,
} from '../types/dimension-graph.js';
import type { ProjectGraph } from '../types/project-graph.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';

// ── Public API ──────────────────────────────────────────────────────────────

export interface SynthesizeDimensionsOptions {
  cwd?: string;
  targetScore?: number;          // default 9.0
  /** Optional ProjectGraph for `touches` inference. */
  projectGraph?: ProjectGraph;
  /** Injection seam: replaces loadMatrix() for tests. */
  _loadMatrix?: typeof loadMatrix;
}

export async function synthesizeDimensions(
  options: SynthesizeDimensionsOptions = {},
): Promise<DimensionGraph> {
  const cwd = options.cwd ?? process.cwd();
  const targetScore = options.targetScore ?? 9.0;
  const loader = options._loadMatrix ?? loadMatrix;

  // Best-effort: ensure feature universe is populated before dimension synthesis.
  // Matrix-kernel work-packets are driven by dimension gaps, but the universe
  // is the ground truth for "what features should exist." Building it here
  // means /matrixdev users see a populated universe in subsequent runs.
  try {
    const { ensureUniverseReady } = await import('../../core/feature-universe.js');
    const universe = await ensureUniverseReady(cwd);
    if (universe && universe.features.length > 0) {
      // eslint-disable-next-line no-console
      console.error(`[dimension-synthesizer] universe ready: ${universe.features.length} features across ${universe.competitors.length} competitors`);
    }
  } catch { /* best-effort */ }

  const matrix = await loader(cwd);
  if (!matrix) {
    return {
      generatedAt: new Date().toISOString(),
      nodes: [],
      competitors: [],
    };
  }

  const excluded = new Set(matrix.excludedDimensions ?? []);
  const nodes: DimensionGraphNode[] = matrix.dimensions
    .filter(dim => !excluded.has(dim.id))
    .map(dim => convertDimension(dim, targetScore, options.projectGraph));

  const competitors = buildCompetitorList(matrix);

  return {
    generatedAt: new Date().toISOString(),
    nodes,
    competitors,
  };
}

export async function writeDimensionGraph(
  graph: DimensionGraph,
  cwd?: string,
): Promise<string> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.dimensionGraph);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(graph, null, 2), 'utf8');
  return outPath;
}

// ── Conversion helpers ──────────────────────────────────────────────────────

function convertDimension(
  dim: MatrixDimension,
  targetScore: number,
  projectGraph?: ProjectGraph,
): DimensionGraphNode {
  const currentScore = dim.scores.self ?? 0;
  const closedFrontier = currentScore + dim.gap_to_closed_source_leader;
  const ossFrontier = currentScore + dim.gap_to_oss_leader;
  const touches = inferTouches(dim, projectGraph);

  const contract: DimensionContract = {
    dimensionId: dim.id,
    name: dim.label,
    category: dim.category,
    targetScore,
    currentScore,
    touches,
    dependsOnDimensions: [],
    evidenceRequired: deriveEvidenceRequirements(dim),
    frontierLeaderId: dim.leader ? `competitor.${slugify(dim.leader)}` : undefined,
  };

  return {
    ...contract,
    ossFrontierScore: ossFrontier,
    closedFrontierScore: closedFrontier,
    gapVsTarget: Math.max(0, targetScore - currentScore),
    gapVsOssFrontier: Math.max(0, ossFrontier - currentScore),
    gapVsClosedFrontier: Math.max(0, closedFrontier - currentScore),
  };
}

// When the heuristic catches more files than this, we cap the result and
// emit a warning so the dimension still produces a runnable work-packet
// instead of a giant scope that the conflict detector will (correctly) flag
// as a protected-path violation. Dimensions that exceed the cap should
// declare an explicit `touches` array in compete-matrix.json.
const MAX_HEURISTIC_TOUCHES = 25;

/**
 * If the dimension declares `touches: ['src/foo.ts']` explicitly in
 * compete-matrix.json, honor that as-is. Otherwise fall back to a path-
 * segment heuristic.
 *
 * Heuristic match: tokenize the dimension id/label/category, then match
 * against path SEGMENTS (split on `/`, `-`, `_`, `.`) rather than substrings.
 * That prevents a token like "agent" from matching every file in
 * `src/harvested/dante-agents/**` — which on this repo expanded into a 24+
 * file work-packet that overlapped protected paths.
 *
 * If the heuristic still returns more than `MAX_HEURISTIC_TOUCHES` results,
 * sort by path depth (deeper = more specific) and keep the top N, while
 * leaving the broader set discoverable via the diagnostic warning.
 */
function inferTouches(dim: MatrixDimension, projectGraph?: ProjectGraph): string[] {
  if (Array.isArray(dim.touches) && dim.touches.length > 0) {
    return [...dim.touches];
  }
  if (!projectGraph) return [];

  // Build a stop-word set of common project vocabulary that would over-match.
  // The dimension's own tokens are filtered against this set after deduping.
  const stopwords = new Set<string>([
    'core', 'src', 'test', 'tests', 'lib', 'agent', 'agents', 'dante',
    'matrix', 'kernel', 'engine', 'cli', 'command', 'commands',
  ]);

  const rawTokens = new Set<string>([
    dim.id.toLowerCase(),
    dim.label.toLowerCase(),
    dim.category.toLowerCase(),
    ...dim.id.split(/[_-]/).map(s => s.toLowerCase()),
    ...dim.label.toLowerCase().split(/[\s_-]+/),
  ]);
  // Keep tokens that are: at least 4 chars long AND not in the generic
  // project vocabulary stop-words.
  const tokens = Array.from(rawTokens).filter(t => t.length >= 4 && !stopwords.has(t));
  if (tokens.length === 0) return [];

  const touches: string[] = [];
  for (const node of projectGraph.nodes) {
    // Match path segments — split on / \ - _ . — so "provenance" matches
    // `time-machine-provenance.ts` but "agent" does NOT match
    // `dante-agents` (where "agents" is a segment, not "agent").
    const hayId = (node.nodeId ?? '').toLowerCase();
    const hayPaths = (node.paths ?? []).join(' ').toLowerCase();
    const segments = `${hayId} ${hayPaths}`.split(/[\\/\-_.\s]+/).filter(Boolean);
    if (segments.some(seg => tokens.includes(seg))) {
      touches.push(node.nodeId);
    }
  }
  const unique = Array.from(new Set(touches));
  if (unique.length <= MAX_HEURISTIC_TOUCHES) return unique;

  // Too many heuristic matches — cap by path-depth specificity. Deeper
  // paths come first since they're more focused than broad directory hits.
  const ranked = unique
    .map(id => ({ id, depth: id.split(/[\\/]/).length }))
    .sort((a, b) => b.depth - a.depth)
    .slice(0, MAX_HEURISTIC_TOUCHES)
    .map(x => x.id);
  // Caller (synthesizeDimensions) emits no log itself; surface a hint via
  // process.stderr so operators see it without coupling this helper to the
  // logger. The cap is non-fatal — the dimension still gets a runnable
  // packet — but it's an actionable signal to add explicit `touches`.
  if (process.stderr && typeof process.stderr.write === 'function') {
    process.stderr.write(`[dimension-synthesizer] WARN dim ${dim.id}: heuristic matched ${unique.length} files; capping at ${MAX_HEURISTIC_TOUCHES}. Add explicit \`touches\` to compete-matrix.json for stable scope.\n`);
  }
  return ranked;
}

function deriveEvidenceRequirements(dim: MatrixDimension): string[] {
  // Default evidence requirements derived from category — caller can override
  const base = [
    `Implementation passes typecheck and tests`,
    `Score moves from ${dim.scores.self ?? 0} toward ${dim.next_sprint_target}`,
  ];
  if (dim.harvest_source) base.push(`Harvest pattern from ${dim.harvest_source}`);
  return base;
}

function buildCompetitorList(matrix: CompeteMatrix): Competitor[] {
  const all = new Set<string>([
    ...(matrix.competitors ?? []),
    ...(matrix.competitors_oss ?? []),
    ...(matrix.competitors_closed_source ?? []),
  ]);
  const ossSet = new Set(matrix.competitors_oss ?? []);
  const closedSet = new Set(matrix.competitors_closed_source ?? []);

  const competitors: Competitor[] = [];
  for (const name of all) {
    if (name === 'self' || name === matrix.project) continue;
    const category: CompetitorCategory = closedSet.has(name)
      ? 'closed_source'
      : ossSet.has(name)
        ? 'oss'
        : 'unknown';
    const inspectionMode: InspectionMode = category === 'oss'
      ? 'source_available'
      : category === 'closed_source'
        ? 'observational'
        : 'unknown';
    competitors.push({
      id: `competitor.${slugify(name)}`,
      name,
      category,
      inspectionMode,
      confidence: category === 'closed_source' ? 0.7 : 0.9,
      provenance: [{ type: 'manual_note', capturedAt: new Date().toISOString(), note: 'imported from compete-matrix.json' }],
    });
  }
  return competitors;
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
