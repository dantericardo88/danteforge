// Matrix Kernel — Work Packet generator (Phase 4 of PRD)
//
// Translates DimensionGraphNodes into actionable WorkPackets. Each packet has
// owned/read-only/forbidden paths derived from the dimension's touches and the
// repo's ownership map.
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  DimensionGraph,
  DimensionGraphNode,
} from '../types/dimension-graph.js';
import type { ProjectGraph } from '../types/project-graph.js';
import type { WorkPacket, WorkGraph } from '../types/work-graph.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';

// ── Public API ──────────────────────────────────────────────────────────────

export interface GenerateWorkPacketsOptions {
  /** Required: the dimension graph driving work generation. */
  dimensionGraph: DimensionGraph;
  /** Required: the project graph for path resolution. */
  projectGraph: ProjectGraph;
  /** Globs that no packet may write to (typically merged with frozenFiles). */
  globalForbiddenPaths?: string[];
  /** Override deterministic packet IDs. */
  _now?: () => string;
}

export function generateWorkPackets(options: GenerateWorkPacketsOptions): WorkGraph {
  const { dimensionGraph, projectGraph } = options;
  const now = options._now ?? (() => new Date().toISOString());
  const frozenFromProject = projectGraph.project.protectedPaths ?? [];
  const globalForbidden = [...(options.globalForbiddenPaths ?? []), ...frozenFromProject];

  // Build a "paths owned by each dimension" map for cross-dimension forbidden inference.
  const dimensionOwnedPaths = new Map<string, string[]>();
  for (const dim of dimensionGraph.nodes) {
    dimensionOwnedPaths.set(dim.dimensionId, pathsForDimension(dim, projectGraph));
  }

  const packets: WorkPacket[] = [];
  for (const dim of dimensionGraph.nodes) {
    if (dim.gapVsTarget <= 0) continue;     // already at target
    const owned = dimensionOwnedPaths.get(dim.dimensionId) ?? [];
    const forbiddenFromOtherDims: string[] = [];
    for (const [otherDimId, otherPaths] of dimensionOwnedPaths) {
      if (otherDimId === dim.dimensionId) continue;
      for (const p of otherPaths) {
        if (!owned.includes(p)) forbiddenFromOtherDims.push(p);
      }
    }
    packets.push(buildPacket(dim, owned, [...forbiddenFromOtherDims, ...globalForbidden], now));
  }

  return { generatedAt: now(), packets };
}

export async function writeWorkGraph(graph: WorkGraph, cwd?: string): Promise<string> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.workGraph);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(graph, null, 2), 'utf8');
  return outPath;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function pathsForDimension(dim: DimensionGraphNode, projectGraph: ProjectGraph): string[] {
  // `dim.touches` can carry either project-graph node IDs (auto-inferred by
  // the dimension-synthesizer's token heuristic) OR raw file paths declared
  // directly in compete-matrix.json. Accept both — match each touch entry
  // against the project-graph nodes by ID first, then by literal path match.
  const paths = new Set<string>();
  const touched = new Set(dim.touches);
  if (touched.size === 0) return [];
  for (const node of projectGraph.nodes) {
    if (touched.has(node.nodeId)) {
      for (const p of node.paths) paths.add(p);
      continue;
    }
    for (const p of node.paths ?? []) {
      if (touched.has(p)) {
        for (const q of node.paths) paths.add(q);
        break;
      }
    }
  }
  // If still empty (e.g. an explicit `touches` lists a path no project-graph
  // node maps to), fall back to using the literal path strings directly so
  // the work-packet is at least scoped, even if not project-graph-tracked.
  if (paths.size === 0) {
    for (const t of touched) {
      // Only include entries that look like a real path (contain `/` or `\`).
      if (t.includes('/') || t.includes('\\')) paths.add(t);
    }
  }
  return Array.from(paths);
}

function buildPacket(
  dim: DimensionGraphNode,
  ownedPaths: string[],
  forbiddenPaths: string[],
  now: () => string,
): WorkPacket {
  // Risk classification
  const dimRiskMultiplier = dim.gapVsTarget > 4 ? 2 : 1;
  const riskLevel: WorkPacket['riskLevel'] =
    dim.gapVsTarget > 5 ? 'critical'
      : dim.gapVsTarget > 3 ? 'high'
        : dim.gapVsTarget > 1 ? 'medium' : 'low';

  // Surface heuristics
  const tasteGateRequired = ownedPaths.some(p =>
    p.includes('src/cli/commands/') || p.startsWith('docs/') || p.endsWith('.md'),
  );

  const redTeamRequired = riskLevel === 'high' || riskLevel === 'critical' || dim.gapVsTarget > 3;

  return {
    id: `work.${dim.dimensionId}.${stamp(now())}`,
    title: `Close gap on ${dim.name}`,
    objective: `Move "${dim.name}" from current score ${dim.currentScore} toward target ${dim.targetScore}.`,
    dimensionId: dim.dimensionId,
    paths: {
      ownedPaths,
      readOnlyPaths: [],
      forbiddenPaths: Array.from(new Set(forbiddenPaths)),
    },
    dependsOn: [],
    mayConflictWith: [],
    acceptanceCriteria: [
      ...dim.evidenceRequired,
      `Score for ${dim.dimensionId} increases by at least 1.0`,
    ],
    proof: {
      proofRequired: [
        'typecheck exits 0',
        'tests pass',
        'no forbidden files changed',
        'dimension score moves verifiably',
      ],
      requiredCommands: ['npm run typecheck', 'npm test'],
    },
    tasteGateRequired,
    redTeamRequired,
    rollbackPlan: 'Remove worktree, discard branch, restore from Time Machine snapshot.',
    riskLevel,
    estimatedLoc: 200 * dimRiskMultiplier,
    estimatedMinutes: 30 * dimRiskMultiplier,
    createdAt: now(),
    createdBy: 'matrix-kernel',
  };
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, '-').slice(0, 19);
}
