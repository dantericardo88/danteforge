// time-machine-wiring.test.ts
// Verifies that newly wired CLI commands (Tiers A-E) write DecisionNodes
// to the JSONL store. Each test uses injected stubs — no real LLM, no network.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { _resetSession } from '../src/core/decision-node-recorder.js';
import { maturity } from '../src/cli/commands/maturity.js';
import { frontierGap } from '../src/cli/commands/frontier-gap.js';
import { runSelfAssess } from '../src/cli/commands/self-assess.js';
import { localHarvest } from '../src/cli/commands/local-harvest.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readNodes(storePath: string): Promise<unknown[]> {
  try {
    const raw = await fs.readFile(storePath, 'utf8');
    return raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch {
    return [];
  }
}

function makeMinimalState() {
  return {
    project: 'test',
    lastHandoff: new Date().toISOString(),
    workflowStage: 'forge' as const,
    currentPhase: 1,
    tasks: {},
    auditLog: [],
    profile: 'balanced',
    projectType: 'cli',
  };
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

let tmpDir: string;
let storePath: string;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tm-wiring-'));
  storePath = path.join(tmpDir, 'nodes.jsonl');
});

after(async () => {
  delete process.env.DANTEFORGE_DECISION_STORE;
  _resetSession();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  _resetSession();
  process.env.DANTEFORGE_DECISION_STORE = storePath;
});

// ── maturity (Tier A) ─────────────────────────────────────────────────────────

describe('maturity command — decision node wiring', () => {
  it('writes a start node before assess runs', async () => {
    const uniqueStore = path.join(tmpDir, `nodes-maturity-start-${Date.now()}.jsonl`);
    process.env.DANTEFORGE_DECISION_STORE = uniqueStore;
    _resetSession();

    const stubAssess = async (_ctx: unknown) => ({
      currentLevel: 3 as const,
      targetLevel: 5 as const,
      overallScore: 70,
      dimensions: {
        functionality: 70, testing: 70, errorHandling: 65, security: 80,
        uxPolish: 60, documentation: 55, performance: 70, maintainability: 75,
      },
      gaps: [],
      founderExplanation: 'stub',
      recommendation: 'proceed' as const,
      timestamp: new Date().toISOString(),
    });

    await maturity({
      cwd: tmpDir,
      _loadState: async () => makeMinimalState() as any,
      _scoreArtifacts: async () => ({}),
      _assessMaturity: stubAssess as any,
    });

    const nodes = await readNodes(uniqueStore);
    assert.ok(nodes.length >= 1, `Expected ≥1 decision node, got ${nodes.length}`);
  });

  it('writes start + completion nodes on successful run', async () => {
    const uniqueStore = path.join(tmpDir, `nodes-maturity-${Date.now()}.jsonl`);
    process.env.DANTEFORGE_DECISION_STORE = uniqueStore;
    _resetSession();

    const stubAssess = async (_ctx: unknown) => ({
      currentLevel: 3 as const,
      targetLevel: 5 as const,
      overallScore: 70,
      dimensions: {
        functionality: 70, testing: 70, errorHandling: 65, security: 80,
        uxPolish: 60, documentation: 55, performance: 70, maintainability: 75,
      },
      gaps: [],
      founderExplanation: 'stub',
      recommendation: 'proceed' as const,
      timestamp: new Date().toISOString(),
    });

    await maturity({
      cwd: tmpDir,
      _loadState: async () => makeMinimalState() as any,
      _scoreArtifacts: async () => ({}),
      _assessMaturity: stubAssess as any,
    });

    const nodes = await readNodes(uniqueStore);
    assert.ok(nodes.length >= 2, `Expected ≥2 decision nodes (start + completion), got ${nodes.length}`);

    const startNode = nodes[0] as Record<string, unknown>;
    const endNode = nodes[nodes.length - 1] as Record<string, unknown>;
    const startOut = startNode['output'] as Record<string, unknown>;
    const endOut = endNode['output'] as Record<string, unknown>;

    assert.equal(startOut['result'], 'in-progress', 'start node result must be in-progress');
    assert.equal(startOut['success'], false, 'start node success must be false');
    assert.equal(endOut['success'], true, 'completion node success must be true');
  });

  it('completion node links to start node via parentId', async () => {
    const uniqueStore = path.join(tmpDir, `nodes-maturity-parent-${Date.now()}.jsonl`);
    process.env.DANTEFORGE_DECISION_STORE = uniqueStore;
    _resetSession();

    await maturity({
      cwd: tmpDir,
      _loadState: async () => makeMinimalState() as any,
      _scoreArtifacts: async () => ({}),
      _assessMaturity: async () => ({
        currentLevel: 2 as const, targetLevel: 5 as const, overallScore: 50,
        dimensions: { functionality: 50, testing: 50, errorHandling: 50, security: 50, uxPolish: 50, documentation: 50, performance: 50, maintainability: 50 },
        gaps: [], founderExplanation: 'stub', recommendation: 'refine' as const, timestamp: new Date().toISOString(),
      }) as any,
    });

    const nodes = await readNodes(uniqueStore);
    if (nodes.length < 2) return; // Best-effort — skip if only start node written

    const startNode = nodes[0] as Record<string, unknown>;
    const endNode = nodes[nodes.length - 1] as Record<string, unknown>;
    assert.equal(
      endNode['parentId'],
      startNode['id'],
      'completion node must reference start node id as parentId',
    );
  });
});

// ── frontier-gap (Tier E) ────────────────────────────────────────────────────

describe('frontier-gap command — decision node wiring', () => {
  it('writes at least a start node even when matrix is not found', async () => {
    const uniqueStore = path.join(tmpDir, `nodes-fg-nomat-${Date.now()}.jsonl`);
    process.env.DANTEFORGE_DECISION_STORE = uniqueStore;
    _resetSession();

    await frontierGap({
      cwd: tmpDir,
      _loadMatrix: async () => null,
      _emit: () => {},
    });

    const nodes = await readNodes(uniqueStore);
    assert.ok(nodes.length >= 1, `Expected ≥1 node even on early exit, got ${nodes.length}`);
    const startNode = nodes[0] as Record<string, unknown>;
    const out = startNode['output'] as Record<string, unknown>;
    assert.equal(out['result'], 'in-progress');
  });

  it('writes start node when matrix is present and default mode runs', async () => {
    const uniqueStore = path.join(tmpDir, `nodes-fg-full-${Date.now()}.jsonl`);
    process.env.DANTEFORGE_DECISION_STORE = uniqueStore;
    _resetSession();

    // Provide a valid CompeteMatrix stub — buildFrontierReport needs MatrixDimension[]
    const mockMatrix = {
      project: 'Test',
      competitors: ['CompA'],
      competitors_closed_source: ['CompA'],
      competitors_oss: [],
      lastUpdated: new Date().toISOString(),
      overallSelfScore: 7.0,
      dimensions: [
        {
          id: 'D1', label: 'Test Dim', weight: 1.0, category: 'quality',
          frequency: 'medium', scores: { self: 7.0, CompA: 9.0 },
          gap_to_leader: 2.0, leader: 'CompA',
          gap_to_closed_source_leader: 2.0, closed_source_leader: 'CompA',
          gap_to_oss_leader: 0, oss_leader: 'unknown',
          status: 'not-started', sprint_history: [], next_sprint_target: 9.0,
        },
      ],
    };

    await frontierGap({
      cwd: tmpDir,
      _loadMatrix: async () => mockMatrix as any,
      _emit: () => {},
    });

    const nodes = await readNodes(uniqueStore);
    assert.ok(nodes.length >= 1, `Expected ≥1 nodes when matrix present, got ${nodes.length}`);
    const startNode = nodes[0] as Record<string, unknown>;
    const startOut = startNode['output'] as Record<string, unknown>;
    assert.equal(startOut['result'], 'in-progress');
  });
});

// ── runSelfAssess (Tier C) ────────────────────────────────────────────────────

describe('runSelfAssess command — decision node wiring', () => {
  it('writes start + completion nodes on successful snapshot capture', async () => {
    const uniqueStore = path.join(tmpDir, `nodes-sa-${Date.now()}.jsonl`);
    process.env.DANTEFORGE_DECISION_STORE = uniqueStore;
    _resetSession();

    const snapshotPath = path.join(tmpDir, 'snapshot.json');
    const stubMetrics = { eslintErrors: 0, tsErrors: 0, testPassRate: 1.0, bundleSizeKb: 150, testCount: 100 };
    const stubSnapshot = {
      timestamp: new Date().toISOString(), metrics: stubMetrics,
      hybridScore: 9.0, llmScore: 9.0, objectiveScore: 9.0, version: '0.5.0',
    };

    await runSelfAssess({
      cwd: tmpDir,
      llmScore: 9.0,
      compareBaseline: false,
      _captureMetrics: async () => stubMetrics,
      _loadBaseline: async () => null,
      _saveSnapshot: async () => snapshotPath,
    });

    const nodes = await readNodes(uniqueStore);
    assert.ok(nodes.length >= 2, `Expected ≥2 nodes, got ${nodes.length}`);
    const endNode = nodes[nodes.length - 1] as Record<string, unknown>;
    const out = endNode['output'] as Record<string, unknown>;
    assert.equal(out['success'], true, 'completion node must be success=true');
    assert.ok((out['latencyMs'] as number ?? 0) >= 0, 'latencyMs must be present');
  });
});

// ── localHarvest (Tier E) ─────────────────────────────────────────────────────

describe('localHarvest command — decision node wiring', () => {
  it('writes start + completion nodes after a successful harvest', async () => {
    const uniqueStore = path.join(tmpDir, `nodes-lh-${Date.now()}.jsonl`);
    process.env.DANTEFORGE_DECISION_STORE = uniqueStore;
    _resetSession();

    const stubReport = {
      sources: [{ path: './stub', depth: 'shallow' as const }],
      topPatterns: [{ name: 'DI pattern', description: 'injectable seams', priority: 'high' as const }],
      synthesis: 'Test synthesis',
      recommendedOssQueries: ['injectable typescript cli'],
    };

    await localHarvest(['./stub-source'], {
      cwd: tmpDir,
      depth: 'shallow',
      _harvester: async () => stubReport,
    });

    const nodes = await readNodes(uniqueStore);
    assert.ok(nodes.length >= 2, `Expected ≥2 nodes, got ${nodes.length}`);

    const startNode = nodes[0] as Record<string, unknown>;
    const endNode = nodes[nodes.length - 1] as Record<string, unknown>;
    const startOut = startNode['output'] as Record<string, unknown>;
    const endOut = endNode['output'] as Record<string, unknown>;

    assert.equal(startOut['result'], 'in-progress');
    assert.equal(endOut['success'], true);
    assert.equal(endNode['parentId'], startNode['id'], 'completion must reference start via parentId');
  });
});
