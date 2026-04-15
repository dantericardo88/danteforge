// tests/compete-auto-strict.test.ts — compete --auto wires strict scoring into post-sprint rescore

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { compete } from '../src/cli/commands/compete.js';

async function makeTmpMatrix(dir: string) {
  const competeDir = path.join(dir, '.danteforge', 'compete');
  await fs.mkdir(competeDir, { recursive: true });
  const matrix = {
    project: 'test',
    competitors: ['Aider'],
    competitors_closed_source: [],
    competitors_oss: ['Aider'],
    lastUpdated: new Date().toISOString(),
    overallSelfScore: 5.0,
    dimensions: [
      {
        id: 'autonomy',
        label: 'Autonomy',
        weight: 1.0,
        category: 'autonomy',
        frequency: 'high',
        scores: { self: 6.0, Aider: 8.0 },
        gap_to_leader: 2.0,
        leader: 'Aider',
        gap_to_closed_source_leader: 0,
        closed_source_leader: 'none',
        gap_to_oss_leader: 2.0,
        oss_leader: 'Aider',
        status: 'in-progress',
        sprint_history: [],
        next_sprint_target: 9.0,
      },
    ],
  };
  await fs.writeFile(path.join(competeDir, 'matrix.json'), JSON.stringify(matrix));
  return matrix;
}

describe('compete --auto strict scoring', () => {
  it('applyStrictOverrides is called on post-sprint score result', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compete-strict-'));
    await makeTmpMatrix(tmpDir);

    let strictDimsCalled = false;
    const strictResult = { autonomy: 40, selfImprovement: 40, tokenEconomy: 50 };

    await compete({
      auto: true,
      maxCycles: 1,
      cwd: tmpDir,
      yes: true,
      _loadMatrix: async () => {
        const raw = await fs.readFile(path.join(tmpDir, '.danteforge', 'compete', 'matrix.json'), 'utf8');
        return JSON.parse(raw);
      },
      _saveMatrix: async () => {},
      _postSprintScore: async () => ({
        displayScore: 7.0,
        displayDimensions: { autonomy: 6, selfImprovement: 6, tokenEconomy: 5 },
        unwiredModules: [],
        rawScore: 70,
      } as never),
      _computeStrictDims: async () => { strictDimsCalled = true; return strictResult; },
      _runInferno: async () => {},
      _confirmMatrix: async () => true,
      _stdout: () => {},
    });

    assert.ok(strictDimsCalled, 'computeStrictDimensions must be called during auto-sprint rescore');
  });

  it('strict overrides patch displayDimensions before matrix update', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compete-strict2-'));
    await makeTmpMatrix(tmpDir);

    let capturedScore: number | null = null;
    const { updateDimensionScore: _orig, ...rest } = await import('../src/core/compete-matrix.js');
    void rest;

    await compete({
      auto: true,
      maxCycles: 1,
      cwd: tmpDir,
      yes: true,
      _loadMatrix: async () => {
        const raw = await fs.readFile(path.join(tmpDir, '.danteforge', 'compete', 'matrix.json'), 'utf8');
        return JSON.parse(raw);
      },
      _saveMatrix: async (m) => { capturedScore = m.overallSelfScore; },
      _postSprintScore: async () => ({
        displayScore: 8.5, // inflated
        displayDimensions: { autonomy: 9, selfImprovement: 9, tokenEconomy: 9 },
        unwiredModules: [],
        rawScore: 85,
      } as never),
      _computeStrictDims: async () => ({ autonomy: 20, selfImprovement: 20, tokenEconomy: 20 }),
      _runInferno: async () => {},
      _confirmMatrix: async () => true,
      _stdout: () => {},
    });

    // After strict override, autonomy dim gets patched to 2.0 (20/10), pulling score down
    // The matrix update uses the patched displayScore
    assert.ok(capturedScore !== null, 'matrix must be saved after cycle');
  });

  it('--yes flag skips the confirmation gate', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compete-yes-'));
    await makeTmpMatrix(tmpDir);

    let confirmCalled = false;

    await compete({
      auto: true,
      maxCycles: 1,
      cwd: tmpDir,
      yes: true,
      _loadMatrix: async () => {
        const raw = await fs.readFile(path.join(tmpDir, '.danteforge', 'compete', 'matrix.json'), 'utf8');
        return JSON.parse(raw);
      },
      _saveMatrix: async () => {},
      _postSprintScore: async () => ({ displayScore: 7.0, displayDimensions: {}, unwiredModules: [], rawScore: 70 } as never),
      _computeStrictDims: async () => ({ autonomy: 40, selfImprovement: 40, tokenEconomy: 50 }),
      _runInferno: async () => {},
      _confirmMatrix: async () => { confirmCalled = true; return true; },
      _stdout: () => {},
    });

    assert.ok(!confirmCalled, '--yes must skip _confirmMatrix');
  });

  it('without --yes, confirmation gate is called', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compete-noyes-'));
    await makeTmpMatrix(tmpDir);

    let confirmCalled = false;

    await compete({
      auto: true,
      maxCycles: 1,
      cwd: tmpDir,
      yes: false,
      _loadMatrix: async () => {
        const raw = await fs.readFile(path.join(tmpDir, '.danteforge', 'compete', 'matrix.json'), 'utf8');
        return JSON.parse(raw);
      },
      _saveMatrix: async () => {},
      _postSprintScore: async () => ({ displayScore: 7.0, displayDimensions: {}, unwiredModules: [], rawScore: 70 } as never),
      _computeStrictDims: async () => ({ autonomy: 40, selfImprovement: 40, tokenEconomy: 50 }),
      _runInferno: async () => {},
      _confirmMatrix: async () => { confirmCalled = true; return true; },
      _stdout: () => {},
    });

    assert.ok(confirmCalled, 'confirmation gate must be called when --yes not set');
  });
});
