// Phase 3 — Dimension Synthesizer tests
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { synthesizeDimensions, writeDimensionGraph } from '../../src/matrix/engines/dimension-synthesizer.js';
import type { CompeteMatrix } from '../../src/core/compete-matrix.js';
import type { ProjectGraph } from '../../src/matrix/types/index.js';

const tmpDirs: string[] = [];
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

function fixtureMatrix(): CompeteMatrix {
  return {
    project: 'fixture',
    competitors: ['cursor', 'aider'],
    competitors_closed_source: ['cursor'],
    competitors_oss: ['aider'],
    lastUpdated: '2026-05-11',
    overallSelfScore: 5.0,
    dimensions: [
      {
        id: 'core_feature_x',
        label: 'Core Feature X',
        weight: 1.0,
        category: 'features',
        frequency: 'high',
        scores: { self: 3.0, cursor: 9.0, aider: 7.0 },
        gap_to_leader: 6.0,
        leader: 'cursor',
        gap_to_closed_source_leader: 6.0,
        closed_source_leader: 'cursor',
        gap_to_oss_leader: 4.0,
        oss_leader: 'aider',
        status: 'in-progress',
        sprint_history: [],
        next_sprint_target: 7.0,
      },
      {
        id: 'workflow_speed',
        label: 'Workflow Speed',
        weight: 1.0,
        category: 'performance',
        frequency: 'medium',
        scores: { self: 7.0, cursor: 8.0, aider: 6.0 },
        gap_to_leader: 1.0,
        leader: 'cursor',
        gap_to_closed_source_leader: 1.0,
        closed_source_leader: 'cursor',
        gap_to_oss_leader: 0,
        oss_leader: 'aider',
        status: 'in-progress',
        sprint_history: [],
        next_sprint_target: 9.0,
      },
    ],
  };
}

// ── synthesizeDimensions ───────────────────────────────────────────────────

describe('synthesizeDimensions', () => {
  it('returns empty graph when no matrix exists', async () => {
    const graph = await synthesizeDimensions({ _loadMatrix: async () => null });
    assert.equal(graph.nodes.length, 0);
    assert.equal(graph.competitors.length, 0);
  });

  it('converts MatrixDimensions to DimensionGraphNodes with computed gaps', async () => {
    const matrix = fixtureMatrix();
    const graph = await synthesizeDimensions({ _loadMatrix: async () => matrix });
    assert.equal(graph.nodes.length, 2);
    const coreFx = graph.nodes.find(n => n.dimensionId === 'core_feature_x')!;
    assert.equal(coreFx.currentScore, 3.0);
    assert.equal(coreFx.targetScore, 9.0);  // default
    assert.equal(coreFx.gapVsTarget, 6.0);
    assert.equal(coreFx.closedFrontierScore, 9.0);
    assert.equal(coreFx.ossFrontierScore, 7.0);
    assert.equal(coreFx.gapVsClosedFrontier, 6.0);
    assert.equal(coreFx.gapVsOssFrontier, 4.0);
  });

  it('respects a non-default targetScore', async () => {
    const matrix = fixtureMatrix();
    const graph = await synthesizeDimensions({
      _loadMatrix: async () => matrix,
      targetScore: 10,
    });
    const coreFx = graph.nodes.find(n => n.dimensionId === 'core_feature_x')!;
    assert.equal(coreFx.targetScore, 10);
    assert.equal(coreFx.gapVsTarget, 7.0);
  });

  it('builds a competitor list with category + inspectionMode', async () => {
    const matrix = fixtureMatrix();
    const graph = await synthesizeDimensions({ _loadMatrix: async () => matrix });
    const cursor = graph.competitors.find(c => c.name === 'cursor');
    const aider = graph.competitors.find(c => c.name === 'aider');
    assert.equal(cursor!.category, 'closed_source');
    assert.equal(cursor!.inspectionMode, 'observational');
    assert.equal(aider!.category, 'oss');
    assert.equal(aider!.inspectionMode, 'source_available');
  });

  it('infers touches from a ProjectGraph by token match', async () => {
    const matrix = fixtureMatrix();
    const projectGraph: ProjectGraph = {
      project: {
        projectId: 'fixture', rootPath: '/tmp', detectedAt: '',
        buildCommands: [], verifyCommands: [],
        protectedPaths: [], ownershipPath: '', evidenceDir: '',
      },
      nodes: [
        { nodeId: 'file.src.core.workflow-speed-helpers.ts', type: 'file', paths: ['src/core/workflow-speed-helpers.ts'] },
        { nodeId: 'file.src.core.unrelated.ts', type: 'file', paths: ['src/core/unrelated.ts'] },
      ],
      generatedAt: '',
    };
    const graph = await synthesizeDimensions({ _loadMatrix: async () => matrix, projectGraph });
    const speed = graph.nodes.find(n => n.dimensionId === 'workflow_speed')!;
    assert.ok(speed.touches.length >= 1, `expected ≥1 touched node, got ${speed.touches.length}`);
    assert.ok(speed.touches.some(t => t.includes('workflow-speed')));
  });
});

// ── writeDimensionGraph ────────────────────────────────────────────────────

describe('writeDimensionGraph', () => {
  it('persists the dimension graph to canonical path', async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'matrix-ds-'));
    tmpDirs.push(cwd);
    const matrix = fixtureMatrix();
    const graph = await synthesizeDimensions({ _loadMatrix: async () => matrix });
    const outPath = await writeDimensionGraph(graph, cwd);
    assert.ok(outPath.endsWith('matrix.dimension-graph.json'));
    const content = await fs.readFile(outPath, 'utf8');
    const parsed = JSON.parse(content);
    assert.equal(parsed.nodes.length, 2);
  });
});
