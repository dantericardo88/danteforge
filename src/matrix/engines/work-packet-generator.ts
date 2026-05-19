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
import { MATRIX_SCORE_SURFACE_PATTERNS } from '../types/agent-evidence.js';

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
  /**
   * Depth doctrine: when set, ALL packets in this batch share this wave type.
   * Breadth waves (odd): write modules + tests, ceiling 6.
   * Depth waves (even): run outcomes on existing code, unlock 7-9 via receipts.
   */
  waveType?: 'breadth' | 'depth';
}

export function generateWorkPackets(options: GenerateWorkPacketsOptions): WorkGraph {
  const { dimensionGraph, projectGraph } = options;
  const now = options._now ?? (() => new Date().toISOString());
  const frozenFromProject = projectGraph.project.protectedPaths ?? [];
  // Fix B: matrix score surface is always forbidden for worker agents.
  // The kernel's score-merge flow (not workers) writes these files.
  const globalForbidden = [
    ...MATRIX_SCORE_SURFACE_PATTERNS,
    ...(options.globalForbiddenPaths ?? []),
    ...frozenFromProject,
  ];

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
    packets.push(buildPacket(dim, owned, [...forbiddenFromOtherDims, ...globalForbidden], now, options.waveType));
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
  waveType?: 'breadth' | 'depth',
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

  const isDepthWave = waveType === 'depth';
  const scoreCeiling = isDepthWave ? 9 : waveType === 'breadth' ? 6 : undefined;

  const depthCriteria = isDepthWave
    ? [
        'Run `danteforge validate` for this dimension — all outcomes must pass',
        'OutcomeEvidenceEntry with passed=true written to .danteforge/outcome-evidence/',
        'No new production code added — depth waves validate existing code only',
      ]
    : [];

  const breadthCriteria = waveType === 'breadth'
    ? [
        'Score ceiling for this wave: 6. Do NOT claim completion above 6 — depth validation comes next wave.',
        'Every new module must answer: (1) What production function calls this? (2) What is the output artifact? (3) What breaks silently if this fails?',
        'No mocks, no stubs, no TODOs — implement the real thing or leave it unimplemented.',
      ]
    : [];

  return {
    id: `work.${dim.dimensionId}.${stamp(now())}`,
    title: isDepthWave
      ? `Validate (depth wave): ${dim.name}`
      : `Close gap on ${dim.name}`,
    objective: isDepthWave
      ? `Run outcomes for "${dim.name}" to prove execution and lift score ceiling above 7.0. No new code — run things, write receipts.`
      : `Move "${dim.name}" from current score ${dim.currentScore} toward target ${dim.targetScore}.`,
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
      ...depthCriteria,
      ...breadthCriteria,
      `Score for ${dim.dimensionId} moves from ${dim.currentScore} to at least ${dim.targetScore} (gap: ${(dim.targetScore - dim.currentScore).toFixed(1)})`,
    ],
    proof: {
      proofRequired: isDepthWave
        ? [
            'danteforge validate exits 0 for this dimension',
            'outcome evidence files present in .danteforge/outcome-evidence/',
            'no forbidden files changed',
          ]
        : [
            'typecheck exits 0',
            'tests pass',
            'no forbidden files changed',
            'dimension score moves verifiably',
          ],
      requiredCommands: isDepthWave
        ? [`danteforge validate ${dim.dimensionId}`]
        : ['npm run typecheck', 'npm test'],
    },
    tasteGateRequired,
    redTeamRequired,
    rollbackPlan: 'Remove worktree, discard branch, restore from Time Machine snapshot.',
    riskLevel,
    estimatedLoc: isDepthWave ? 0 : 200 * dimRiskMultiplier,
    estimatedMinutes: isDepthWave ? 15 : 30 * dimRiskMultiplier,
    createdAt: now(),
    createdBy: 'matrix-kernel',
    waveType,
    scoreCeiling,
  };
}

function stamp(iso: string): string {
  return iso.replace(/[:.]/g, '-').slice(0, 19);
}
