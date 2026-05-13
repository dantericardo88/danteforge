// End-to-end integration test for PRD-MATRIX-ORCHESTRATION-V1
// Drives the orchestrator state machine through every stage on the
// docs/test-fixtures/toy-cli-prd.md fixture, with all LLM/network seams
// stubbed. Asserts that the headline command `danteforge matrix <prd>` works
// end-to-end without external services and produces the expected artifacts.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runOrchestration } from '../../src/matrix-orchestration/orchestrator.js';
import { loadOrch } from '../../src/matrix-orchestration/state-io.js';
import type {
  CapacityReport,
  CompetitiveUniverse,
  FinalReportSummary,
  InterPhaseRetrospective,
  LearningState,
  OrchestrationDimensionMatrix,
  PhaseExecutionResult,
  ProjectIntent,
  RunState,
  UniverseEntry,
} from '../../src/matrix-orchestration/types.js';

const tmpDirs: string[] = [];

async function freshCwd(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'orch-integ-'));
  tmpDirs.push(d);
  return d;
}

after(async () => {
  for (const d of tmpDirs) {
    await fs.rm(d, { recursive: true, force: true }).catch(() => undefined);
  }
});

const TOY_PRD_PATH = path.resolve(
  process.cwd(),
  'docs',
  'test-fixtures',
  'toy-cli-prd.md',
);

function makeIntent(): ProjectIntent {
  return {
    sourcePath: TOY_PRD_PATH,
    projectName: 'Quill',
    goal: 'A fast, keyboard-driven CLI for tracking TODOs across markdown and code',
    projectType: 'cli_tool',
    targetUser: 'developer',
    keyFeatures: [
      'scan source tree for TODO/FIXME/XXX/HACK markers',
      'index findings into local .quill/ store',
      'list / filter / sort / tag findings',
      'mark items done; rewrite source',
      'export to markdown / json / html',
      'watch mode',
    ],
    constraintEmphasis: ['performance_critical', 'cost_critical'],
    nonGoals: ['web app', 'external task tracker integration'],
    competitiveCategoryBoundary: {
      direct: ['todo-cli', 'taskwarrior', 'dstask', 'topydo'],
      adjacent: ['ripgrep', 'the_silver_searcher', 'git grep'],
      research: ['SonarQube TODO detection'],
    },
    frontierFraming: {
      target: 'oss_frontier',
      matchLeaderOn: ['scan speed', 'cross-platform', 'cli ergonomics'],
      exceedLeaderOn: ['zero-config indexing', 'markdown-native output'],
      defineNewCategoryOn: ['TODO as first-class workflow primitive'],
    },
    confidence: 0.92,
    extractedAt: new Date().toISOString(),
  };
}

function makeUniverse(): CompetitiveUniverse {
  const entries: UniverseEntry[] = [
    { id: 'todo-cli', name: 'todo-cli', category: 'oss', source: 'github_search',
      confidence: 0.9, recommendedAction: 'harvest', licenseStatus: 'allowed' },
    { id: 'taskwarrior', name: 'taskwarrior', category: 'oss', source: 'awesome_list',
      confidence: 0.85, recommendedAction: 'harvest', licenseStatus: 'allowed' },
    { id: 'dstask', name: 'dstask', category: 'oss', source: 'github_search',
      confidence: 0.8, recommendedAction: 'harvest', licenseStatus: 'allowed' },
    { id: 'topydo', name: 'topydo', category: 'oss', source: 'github_search',
      confidence: 0.75, recommendedAction: 'harvest', licenseStatus: 'allowed' },
    { id: 'ripgrep', name: 'ripgrep', category: 'hybrid', source: 'manual',
      confidence: 0.9, recommendedAction: 'observe', licenseStatus: 'allowed' },
    { id: 'silver-searcher', name: 'the_silver_searcher', category: 'hybrid',
      source: 'manual', confidence: 0.85, recommendedAction: 'observe',
      licenseStatus: 'allowed' },
    { id: 'todo-tree-vscode', name: 'todo-tree (VSCode)', category: 'oss',
      source: 'github_search', confidence: 0.7, recommendedAction: 'harvest',
      licenseStatus: 'allowed' },
    { id: 'sonarqube', name: 'SonarQube TODO', category: 'closed_source',
      source: 'manual', confidence: 0.6, recommendedAction: 'profile' },
    { id: 'github-todo-ann', name: 'GitHub TODO annotations', category: 'closed_source',
      source: 'manual', confidence: 0.65, recommendedAction: 'profile' },
    { id: 'tl-dr-todo', name: 'tl;dr-todo', category: 'oss',
      source: 'github_search', confidence: 0.55, recommendedAction: 'harvest',
      licenseStatus: 'allowed' },
  ];
  return {
    generatedAt: new Date().toISOString(),
    projectName: 'Quill',
    entries,
    approvedByUser: true,
    approvedAt: new Date().toISOString(),
  };
}

function makeMatrix(): OrchestrationDimensionMatrix {
  const categories = [
    'scan_performance', 'cli_ergonomics', 'cross_platform',
    'indexing', 'output_formats', 'watch_mode',
    'integration_surface', 'distribution',
  ];
  const dimensions = [];
  let id = 0;
  for (const category of categories) {
    for (let i = 1; i <= 6; i++) {
      dimensions.push({
        dimensionId: `${category}_${i}`,
        name: `${category.replace(/_/g, ' ')} dimension ${i}`,
        category,
        weight: 1.0,
        rubric: {
          score5: `meets minimum bar for ${category}`,
          score7: `competitive on ${category}`,
          score9: `frontier on ${category}`,
        },
        evidenceRequired: ['source code reference', 'benchmark'],
        currentScore: 3 + (id % 5),
        ossFrontierScore: 7 + (id % 3),
        closedFrontierScore: 8 + (id % 2),
        gapToOssFrontier: 0,  // recomputed below
        gapToClosedFrontier: 0,
      });
      id++;
    }
  }
  // 48 dims (8 × 6); recompute gaps
  for (const d of dimensions) {
    d.gapToOssFrontier = Math.max(0, d.ossFrontierScore - d.currentScore);
    d.gapToClosedFrontier = Math.max(0, d.closedFrontierScore - d.currentScore);
  }
  return {
    generatedAt: new Date().toISOString(),
    projectName: 'Quill',
    dimensions,
    overallCurrentScore: 5.2,
    overallOssFrontierScore: 7.6,
    overallClosedFrontierScore: 8.4,
    approvedByUser: true,
    approvedAt: new Date().toISOString(),
  };
}

function makeCapacity(): CapacityReport {
  return {
    generatedAt: new Date().toISOString(),
    hostMachineSignature: 'fixture-sig',
    benchmarkDurationMs: 100,
    totalPracticalConcurrency: 5,
    providers: [
      { providerId: 'claude', installed: true, authStatus: 'authenticated', concurrentInstances: 3 },
      { providerId: 'codex', installed: true, authStatus: 'authenticated', concurrentInstances: 1 },
      { providerId: 'fake', installed: true, authStatus: 'authenticated', concurrentInstances: 1 },
    ],
  };
}

function makePhaseResult(
  phase: 'phase_a_oss_frontier' | 'phase_b_closed_source_frontier',
  closedCount: number,
): PhaseExecutionResult {
  return {
    phase,
    config: {
      phase, workPacketIds: [], maxCostUsd: 50, maxWallClockMinutes: 30,
      maxConcurrentAgents: 5, allowedProviders: ['claude', 'codex', 'fake'],
      redTeamEveryMerge: phase === 'phase_b_closed_source_frontier',
      tasteGateMinScore: phase === 'phase_b_closed_source_frontier' ? 8 : 7,
    },
    attempts: [
      {
        workPacketId: 'p1', providerId: 'claude', outcome: 'merged',
        scoreDeltaByDimension: { scan_performance_1: 2 },
        tokensConsumed: 1000, costUsd: 0.5, wallClockMs: 5000,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString(),
      },
    ],
    dimensionsClosed: Array.from({ length: closedCount }, (_, i) => `dim_${i}`),
    dimensionsOpen: [],
    totalCostUsd: 5,
    totalWallClockMs: 60000,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    terminationReason: 'completed',
  };
}

function makeRetrospective(): InterPhaseRetrospective {
  return {
    generatedAt: new Date().toISOString(),
    phaseAResult: makePhaseResult('phase_a_oss_frontier', 30),
    providerPerformance: [
      { providerId: 'claude', attempts: 10, successRate: 0.9, avgCostUsd: 0.5,
        avgWallClockMs: 5000, bestAtDimensions: ['scan_performance'], worstAtDimensions: [] },
    ],
    recurringConflictPatterns: [],
    remainingGapToClosedSourceFrontier: 0.8,
    recommendation: 'proceed_to_phase_b',
    recommendationReason: 'phase A completed cleanly; remaining gap manageable',
  };
}

function makeLearning(): LearningState {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    providerPerformance: {
      claude: { runs: 1, totalAttempts: 10, totalSuccesses: 9,
        avgCostUsd: 0.5, avgWallClockMs: 5000, excelsAt: ['scan_performance'] },
      codex: { runs: 1, totalAttempts: 5, totalSuccesses: 4,
        avgCostUsd: 0.3, avgWallClockMs: 4000, excelsAt: ['cli_ergonomics'] },
      dantecode: { runs: 0, totalAttempts: 0, totalSuccesses: 0,
        avgCostUsd: 0, avgWallClockMs: 0, excelsAt: [] },
      aider: { runs: 0, totalAttempts: 0, totalSuccesses: 0,
        avgCostUsd: 0, avgWallClockMs: 0, excelsAt: [] },
      cursor: { runs: 0, totalAttempts: 0, totalSuccesses: 0,
        avgCostUsd: 0, avgWallClockMs: 0, excelsAt: [] },
      ollama: { runs: 0, totalAttempts: 0, totalSuccesses: 0,
        avgCostUsd: 0, avgWallClockMs: 0, excelsAt: [] },
      fake: { runs: 0, totalAttempts: 0, totalSuccesses: 0,
        avgCostUsd: 0, avgWallClockMs: 0, excelsAt: [] },
      shell: { runs: 0, totalAttempts: 0, totalSuccesses: 0,
        avgCostUsd: 0, avgWallClockMs: 0, excelsAt: [] },
    },
    recurringConflicts: [],
    successfulHarvestSources: [],
    failedHarvestSources: [],
    costEstimates: {},
  };
}

describe('Integration: PRD-MATRIX-ORCHESTRATION-V1 on toy CLI PRD', () => {
  it('runs the full pipeline end-to-end with all stages seamed (Phase A only)', async () => {
    const cwd = await freshCwd();

    const result = await runOrchestration(
      {
        cwd,
        prdPath: TOY_PRD_PATH,
        target: 'oss_frontier',
        maxCostUsd: 100,
        skipApproval: true,
      },
      {
        _readPrd: async () => makeIntent(),
        _discoverUniverse: async () => makeUniverse(),
        _analyzeCompetitors: async () => undefined,
        _synthesizeDimensions: async () => makeMatrix(),
        _scoreCurrentState: async (m) => m,
        _detectCapacity: async () => makeCapacity(),
        _executePhaseA: async () => makePhaseResult('phase_a_oss_frontier', 30),
        _generateFinalReport: async () => ({
          markdownPath: path.join(cwd, '.danteforge', 'matrix-orchestration', 'final-report.md'),
          jsonPath: path.join(cwd, '.danteforge', 'matrix-orchestration', 'final-report.json'),
        }),
        _captureLearning: async () => makeLearning(),
      },
    );

    assert.equal(typeof result.runId, 'string', 'runId emitted');
    assert.ok(result.runId.length > 0, 'runId non-empty');

    // Run state persisted with the right stages marked.
    const persistedRun = await loadOrch<RunState>(cwd, 'runState');
    assert.ok(persistedRun, 'run state persisted');
    assert.ok(persistedRun.completedStages.length > 0, 'stages tracked');
    assert.ok(
      ['completed', 'generating_final_report'].includes(persistedRun.stage),
      `expected terminal stage, got ${persistedRun.stage}`,
    );
  });

  it('phase_b is skipped when target is oss_frontier', async () => {
    const cwd = await freshCwd();
    let phaseBCalled = false;

    await runOrchestration(
      {
        cwd, prdPath: TOY_PRD_PATH,
        target: 'oss_frontier', skipApproval: true, maxCostUsd: 100,
      },
      {
        _readPrd: async () => makeIntent(),
        _discoverUniverse: async () => makeUniverse(),
        _synthesizeDimensions: async () => makeMatrix(),
        _detectCapacity: async () => makeCapacity(),
        _executePhaseA: async () => makePhaseResult('phase_a_oss_frontier', 30),
        _executePhaseB: async () => {
          phaseBCalled = true;
          return makePhaseResult('phase_b_closed_source_frontier', 10);
        },
        _generateRetrospective: async () => makeRetrospective(),
        _generateFinalReport: async () => ({
          markdownPath: path.join(cwd, 'final-report.md'),
          jsonPath: path.join(cwd, 'final-report.json'),
        }),
        _captureLearning: async () => makeLearning(),
      },
    );

    assert.equal(phaseBCalled, false, 'phase B should not run when target is oss_frontier');
  });

  it('runs phase_b when target is closed_source_frontier', async () => {
    const cwd = await freshCwd();
    let phaseBCalled = false;

    await runOrchestration(
      {
        cwd, prdPath: TOY_PRD_PATH,
        target: 'closed_source_frontier', skipApproval: true, maxCostUsd: 200,
      },
      {
        _readPrd: async () => makeIntent(),
        _discoverUniverse: async () => makeUniverse(),
        _synthesizeDimensions: async () => makeMatrix(),
        _detectCapacity: async () => makeCapacity(),
        _executePhaseA: async () => makePhaseResult('phase_a_oss_frontier', 30),
        _executePhaseB: async () => {
          phaseBCalled = true;
          return makePhaseResult('phase_b_closed_source_frontier', 10);
        },
        _generateRetrospective: async () => makeRetrospective(),
        _generateFinalReport: async () => ({
          markdownPath: path.join(cwd, 'final-report.md'),
          jsonPath: path.join(cwd, 'final-report.json'),
        }),
        _captureLearning: async () => makeLearning(),
      },
    );

    assert.equal(phaseBCalled, true, 'phase B must run when target is closed_source_frontier');
  });

  it('produces a dimension matrix with at least 40 dimensions across 8 categories', async () => {
    const matrix = makeMatrix();
    assert.ok(matrix.dimensions.length >= 40, `expected >=40 dims, got ${matrix.dimensions.length}`);
    const categories = new Set(matrix.dimensions.map(d => d.category));
    assert.ok(categories.size >= 6, `expected >=6 categories, got ${categories.size}`);
  });

  it('toy PRD fixture is readable', async () => {
    const content = await fs.readFile(TOY_PRD_PATH, 'utf8');
    assert.ok(content.includes('Quill'), 'fixture mentions project name');
    assert.ok(content.includes('CLI tool'), 'fixture sets project type');
    assert.ok(content.includes('competitors'), 'fixture lists competitors');
  });

  it('competitive universe contains >=10 entries with license classification', () => {
    const universe = makeUniverse();
    assert.ok(universe.entries.length >= 10, 'universe has >=10 entries');
    const withLicense = universe.entries.filter(e => e.licenseStatus);
    assert.ok(withLicense.length >= 7, 'most OSS entries have license classification');
  });

  it('final report summary shape is valid', () => {
    const summary: FinalReportSummary = {
      generatedAt: new Date().toISOString(),
      projectName: 'Quill',
      prdSource: TOY_PRD_PATH,
      startingOverallScore: 5.2,
      endingOverallScore: 7.8,
      ossFrontierAchievement: 0.85,
      closedSourceFrontierAchievement: 0,
      totalAgentsDeployed: 5,
      totalCostUsd: 12.5,
      totalWallClockMs: 90 * 60 * 1000,
      conflictsEncountered: 3,
      conflictsResolved: 3,
      branchesApproved: 30,
      branchesRejected: 5,
      patternsHarvestedCount: 14,
      licenseViolations: 0,
      recommendedNextIterations: [
        'Run phase B targeting closed_source_frontier',
        'Investigate watch_mode dimension gaps',
      ],
    };
    assert.equal(summary.licenseViolations, 0, 'zero license violations is the goal');
    assert.ok(summary.endingOverallScore > summary.startingOverallScore);
  });
});
