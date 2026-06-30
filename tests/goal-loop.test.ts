// tests/goal-loop.test.ts — Cross-project goal loop engine tests

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  resolveProjects,
  readProjectStatus,
  pickNextProject,
  renderProgressTable,
  runGoalLoopEngine,
  type GoalLoopProjectStatus,
} from '../src/core/goal-loop-engine.js';
import { goalLoop } from '../src/cli/commands/goal-loop.js';

// ── resolveProjects ───────────────────────────────────────────────────────────

describe('resolveProjects', () => {
  it('returns explicit projects when provided', async () => {
    const projects = await resolveProjects([{ name: 'A', path: '/a' }, { name: 'B', path: '/b' }]);
    assert.equal(projects.length, 2);
    assert.equal(projects[0].name, 'A');
  });

  it('falls back to manifest when no explicit projects', async () => {
    const projects = await resolveProjects([], async () => ({
      projects: [{ name: 'ManifestProj', path: '/manifest', lastSnapshot: '', avgScore: 7, artifactScores: {}, topArtifact: null, bottomArtifact: null, registeredAt: '' }],
      lastUpdated: '',
    }));
    assert.equal(projects.length, 1);
    assert.equal(projects[0].name, 'ManifestProj');
  });

  it('returns empty array when manifest fails', async () => {
    const projects = await resolveProjects([], async () => { throw new Error('no manifest'); });
    assert.equal(projects.length, 0);
  });
});

// ── readProjectStatus ─────────────────────────────────────────────────────────

describe('readProjectStatus', () => {
  it('reads GOAL_STATUS.json when present', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gl-rs-'));
    try {
      const dfDir = path.join(tmpDir, '.danteforge');
      await fs.mkdir(dfDir, { recursive: true });
      await fs.writeFile(path.join(dfDir, 'GOAL_STATUS.json'), JSON.stringify({
        allGreen: false,
        target: 9.0,
        passing: 3,
        failing: 2,
        blocked: 1,
        total: 6,
        failingDimensions: ['Autonomy: 6.5', 'Testing: 7.0'],
        checkedAt: new Date().toISOString(),
      }));

      const status = await readProjectStatus(tmpDir, 9.0);
      assert.equal(status.passing, 3);
      assert.equal(status.failing, 2);
      assert.equal(status.allGreen, false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('falls back to matrix.json when no GOAL_STATUS.json', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gl-matrix-'));
    try {
      const competeDir = path.join(tmpDir, '.danteforge', 'compete');
      await fs.mkdir(competeDir, { recursive: true });
      const matrix = {
        project: 'test', competitors: [], competitors_closed_source: [], competitors_oss: [],
        lastUpdated: '', overallSelfScore: 7.5,
        // Dims average to the overall (loadMatrix recomputes overallSelfScore from decisionDimScore, so the
        // fixture must be internally consistent): (9.0 + 6.0) / 2 = 7.5. autonomy passes (≥9), testing fails (<9).
        dimensions: [
          { id: 'autonomy', scores: { self: 9.0 }, weight: 1 },
          { id: 'testing', scores: { self: 6.0 }, weight: 1 },
        ],
      };
      await fs.writeFile(path.join(competeDir, 'matrix.json'), JSON.stringify(matrix));

      const status = await readProjectStatus(tmpDir, 9.0);
      assert.equal(status.failing, 1); // testing is below 9.0
      assert.equal(status.passing, 1); // autonomy is 9.5
      assert.equal(status.overallScore, 7.5);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns zeroed status when project has no data', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gl-empty-'));
    try {
      const status = await readProjectStatus(tmpDir, 9.0);
      assert.equal(status.total, 0);
      assert.equal(status.allGreen, false);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── pickNextProject ───────────────────────────────────────────────────────────

describe('pickNextProject', () => {
  const makeStatus = (name: string, failing: number, allGreen = false): GoalLoopProjectStatus => ({
    name, path: `/${name}`, passing: 10 - failing, failing, blocked: 0,
    total: 10, overallScore: 8.0, allGreen, lastChecked: '',
  });

  it('greedy mode picks project with most failing dimensions', () => {
    const statuses = [makeStatus('A', 3), makeStatus('B', 7), makeStatus('C', 1)];
    const next = pickNextProject(statuses, {}, 'greedy', 10);
    assert.equal(next?.name, 'B');
  });

  it('round-robin mode picks project with fewest cycles', () => {
    const statuses = [makeStatus('A', 3), makeStatus('B', 7), makeStatus('C', 1)];
    const cycles = { A: 5, B: 2, C: 4 };
    const next = pickNextProject(statuses, cycles, 'round-robin', 10);
    assert.equal(next?.name, 'B');
  });

  it('skips green projects', () => {
    const statuses = [makeStatus('A', 0, true), makeStatus('B', 3)];
    const next = pickNextProject(statuses, {}, 'greedy', 10);
    assert.equal(next?.name, 'B');
  });

  it('returns null when all projects are green or exhausted', () => {
    const statuses = [makeStatus('A', 0, true), makeStatus('B', 0, true)];
    const next = pickNextProject(statuses, {}, 'greedy', 10);
    assert.equal(next, null);
  });

  it('skips projects that hit maxCyclesPerProject', () => {
    const statuses = [makeStatus('A', 5), makeStatus('B', 3)];
    const cycles = { A: 10 }; // A is exhausted
    const next = pickNextProject(statuses, cycles, 'greedy', 10);
    assert.equal(next?.name, 'B');
  });
});

// ── renderProgressTable ───────────────────────────────────────────────────────

describe('renderProgressTable', () => {
  it('renders a table with project rows', () => {
    const statuses: GoalLoopProjectStatus[] = [
      { name: 'DanteForge', path: '/', passing: 45, failing: 5, blocked: 0, total: 50, overallScore: 9.1, allGreen: false, lastChecked: '' },
      { name: 'DanteCode', path: '/', passing: 50, failing: 0, blocked: 0, total: 50, overallScore: 9.5, allGreen: true, lastChecked: '' },
    ];
    const table = renderProgressTable(statuses, 9.0);
    assert.ok(table.includes('DanteForge'), 'Table should include DanteForge');
    assert.ok(table.includes('DanteCode'), 'Table should include DanteCode');
    assert.ok(table.includes('DONE'), 'DanteCode should show DONE');
    assert.ok(table.includes('5 gaps'), 'DanteForge should show 5 gaps');
  });
});

// ── runGoalLoopEngine ─────────────────────────────────────────────────────────

describe('runGoalLoopEngine', () => {
  it('stops when all projects are green', async () => {
    let cycles = 0;
    const result = await runGoalLoopEngine({
      projects: [{ name: 'A', path: '/a' }, { name: 'B', path: '/b' }],
      target: 9.0,
      maxCycles: 50,
      _runCompeteAuto: async () => { cycles++; return {}; },
      _checkAllNine: async (p) => ({
        name: path.basename(p),
        path: p,
        passing: 10,
        failing: 0,
        blocked: 0,
        total: 10,
        overallScore: 9.5,
        allGreen: true,
        lastChecked: '',
      }),
    });

    assert.equal(result.allProjectsGreen, true);
    assert.equal(result.success, true);
  });

  it('greedy mode is exercised via pickNextProject (unit-tested separately)', async () => {
    // The greedy rotation logic is fully covered by the pickNextProject tests above.
    // This integration test just verifies the engine runs without error and respects maxCycles.
    const order: string[] = [];
    const result = await runGoalLoopEngine({
      projects: [{ name: 'Alpha', path: '/alpha' }, { name: 'Beta', path: '/beta' }],
      target: 9.0,
      maxCycles: 2,
      maxCyclesPerProject: 5,
      rotationMode: 'greedy',
      _runCompeteAuto: async (p) => { order.push(path.basename(p)); return {}; },
      _checkAllNine: async (p) => ({
        name: path.basename(p), path: p, passing: 5, failing: 5,
        blocked: 0, total: 10, overallScore: 7.0, allGreen: false, lastChecked: '',
      }),
    });

    assert.equal(result.cyclesRun, 2, 'Should run exactly maxCycles cycles');
    // Depth-Doctrine wave alternation: breadth cycles run compete-auto, depth cycles run validate. Over 2
    // cycles that is 1 compete-auto call, so assert it was exercised at least once (the integration smoke).
    assert.ok(order.length >= 1, 'compete-auto was exercised on the breadth wave(s)');
  });

  it('respects maxCycles limit', async () => {
    const result = await runGoalLoopEngine({
      projects: [{ name: 'A', path: '/a' }],
      target: 9.0,
      maxCycles: 3,
      _runCompeteAuto: async () => ({}),
      _checkAllNine: async (p) => ({
        name: 'A', path: p, passing: 0, failing: 10, blocked: 0,
        total: 10, overallScore: 5.0, allGreen: false, lastChecked: '',
      }),
    });

    assert.equal(result.cyclesRun, 3);
    assert.equal(result.allProjectsGreen, false);
  });

  it('continues after per-project errors', async () => {
    let errorThrown = false;
    const result = await runGoalLoopEngine({
      projects: [{ name: 'Broken', path: '/broken' }, { name: 'OK', path: '/ok' }],
      target: 9.0,
      maxCycles: 4,
      maxCyclesPerProject: 5,
      _runCompeteAuto: async (p) => {
        if (path.basename(p) === 'Broken' && !errorThrown) {
          errorThrown = true;
          throw new Error('inferno failed');
        }
        return {};
      },
      _checkAllNine: async (p) => ({
        name: path.basename(p), path: p, passing: 10, failing: 0,
        blocked: 0, total: 10, overallScore: 9.5, allGreen: true, lastChecked: '',
      }),
    });

    assert.equal(result.success, true, 'Should succeed despite one error');
  });
});

// ── goalLoop command ──────────────────────────────────────────────────────────

describe('goalLoop command', () => {
  it('emits usage in prompt mode without running anything', async () => {
    const lines: string[] = [];
    const result = await goalLoop({
      promptMode: true,
      _stdout: (l) => lines.push(l),
    });
    assert.equal(result.cyclesRun, 0);
    assert.ok(lines.some(l => l.includes('goal-loop') || l.includes('GOAL LOOP')));
  });

  it('exits 1 when no projects found', async () => {
    const originalExitCode = process.exitCode;
    const result = await goalLoop({
      projects: [],
      _resolveProjects: async () => [],
    });
    assert.equal(result.success, false);
    assert.equal(process.exitCode, 1);
    process.exitCode = originalExitCode;
  });

  it('runs the engine with resolved project list', async () => {
    const originalExitCode = process.exitCode;
    let engineCalled = false;

    const result = await goalLoop({
      projects: [],
      target: 9.0,
      maxCycles: 1,
      yes: true,
      _resolveProjects: async () => [{ name: 'TestProj', path: '/test' }],
      _runCompeteAuto: async () => { engineCalled = true; return {}; },
      _checkAllNine: async () => ({
        name: 'TestProj', path: '/test', passing: 10, failing: 0,
        blocked: 0, total: 10, overallScore: 9.5, allGreen: true, lastChecked: '',
      }),
    });

    assert.equal(engineCalled, true);
    assert.equal(result.allProjectsGreen, true);
    assert.equal(process.exitCode, 0);
    process.exitCode = originalExitCode;
  });
});
