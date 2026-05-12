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

  const matrix = await loader(cwd);
  if (!matrix) {
    return {
      generatedAt: new Date().toISOString(),
      nodes: [],
      competitors: [],
    };
  }

  const nodes: DimensionGraphNode[] = matrix.dimensions.map(dim =>
    convertDimension(dim, targetScore, options.projectGraph),
  );

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

/**
 * Heuristic match: dimensions touch ProjectGraphNodes whose paths or names
 * mention the dimension's category, label, or id. For MVP this is intentionally
 * shallow; future iterations can refine with an LLM mapping pass.
 */
function inferTouches(dim: MatrixDimension, projectGraph?: ProjectGraph): string[] {
  if (!projectGraph) return [];
  const tokens = new Set<string>([
    dim.id.toLowerCase(),
    dim.label.toLowerCase(),
    dim.category.toLowerCase(),
    ...dim.id.split(/[_-]/).map(s => s.toLowerCase()),
  ]);
  const touches: string[] = [];
  for (const node of projectGraph.nodes) {
    const hay = `${node.nodeId} ${(node.paths ?? []).join(' ')}`.toLowerCase();
    for (const token of tokens) {
      if (token.length >= 4 && hay.includes(token)) {
        touches.push(node.nodeId);
        break;
      }
    }
  }
  return Array.from(new Set(touches));
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
