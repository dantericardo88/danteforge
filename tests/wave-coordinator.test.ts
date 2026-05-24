// wave-coordinator.test.ts — Phase O parallel-agent research wave orchestration.
//
// Tests use the `_runAgent` injection seam so no real Claude-Code-CLI
// processes spawn; the substrate orchestration is what's under test.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  runResearchWave,
  type RunAgentInput,
  type RunAgentResult,
} from '../src/matrix/research/wave-coordinator.js';

let tmpDir = '';
beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wave-coord-')); });
afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

function baseActivation(overrides: Record<string, unknown> = {}) {
  return {
    projectComposite: 8.0,
    dimDerivedScore: 7.0,
    achievedTier: 'T2' as const,
    declaredCeiling: 'T4' as const,
    hasActiveDispensation: false,
    researchStatus: {
      research_waves_completed: 0,
      consecutive_stuck_waves: 3,
      last_wave_outcome: null,
    },
    ...overrides,
  };
}

describe('runResearchWave — activation refusal', () => {
  it('refuses with reason when activation criteria fail', async () => {
    const result = await runResearchWave({
      dimensionId: 'testing',
      cwd: tmpDir,
      activation: baseActivation({ projectComposite: 6.0 }), // below threshold
    });
    assert.equal(result.outcome, null);
    assert.ok(result.refusalReason);
    assert.match(result.refusalReason!, /composite/);
    assert.equal(result.agents.length, 0);
  });

  it('refuses when dim has active dispensation', async () => {
    const result = await runResearchWave({
      dimensionId: 'testing',
      cwd: tmpDir,
      activation: baseActivation({ hasActiveDispensation: true }),
    });
    assert.equal(result.outcome, null);
    assert.match(result.refusalReason!, /dispensation/);
  });
});

describe('runResearchWave — happy path with mock agents', () => {
  it('dispatches benchmark-designer first, then parallel roles, then synthesizer', async () => {
    const spawnOrder: string[] = [];
    const result = await runResearchWave({
      dimensionId: 'testing',
      cwd: tmpDir,
      activation: baseActivation(),
      _runAgent: async (input: RunAgentInput): Promise<RunAgentResult> => {
        spawnOrder.push(input.roleId);
        await fs.mkdir(input.workdir, { recursive: true });
        if (input.roleId === 'benchmark-designer') {
          await fs.writeFile(path.join(input.workdir, 'frontier-definition.md'), '# Frontier\n');
        } else {
          await fs.writeFile(path.join(input.workdir, 'hypothesis.md'), '# Hypothesis\n');
        }
        return { roleId: input.roleId, exitCode: 0, durationMs: 1, producedRequiredOutputs: true, outputDir: input.workdir };
      },
    });
    assert.equal(spawnOrder[0], 'benchmark-designer', 'benchmark-designer must run first');
    assert.equal(spawnOrder[spawnOrder.length - 1], 'hybrid-synthesizer', 'hybrid-synthesizer must run last');
    assert.ok(result.outcome !== null);
  });

  it('writes manifest.json with status=complete and outcome', async () => {
    const result = await runResearchWave({
      dimensionId: 'testing',
      cwd: tmpDir,
      activation: baseActivation(),
      _runAgent: async (input) => {
        await fs.mkdir(input.workdir, { recursive: true });
        if (input.roleId === 'benchmark-designer') {
          await fs.writeFile(path.join(input.workdir, 'frontier-definition.md'), '# Frontier\n');
        }
        return { roleId: input.roleId, exitCode: 0, durationMs: 1, producedRequiredOutputs: true, outputDir: input.workdir };
      },
    });
    const manifest = JSON.parse(await fs.readFile(path.join(result.waveDir, 'manifest.json'), 'utf8')) as { status: string; outcome: string };
    assert.equal(manifest.status, 'complete');
    assert.ok(manifest.outcome);
  });

  it('writes synthesis-recommendation.md', async () => {
    const result = await runResearchWave({
      dimensionId: 'testing',
      cwd: tmpDir,
      activation: baseActivation(),
      _runAgent: async (input) => {
        await fs.mkdir(input.workdir, { recursive: true });
        if (input.roleId === 'benchmark-designer') {
          await fs.writeFile(path.join(input.workdir, 'frontier-definition.md'), '# Frontier\n');
        }
        return { roleId: input.roleId, exitCode: 0, durationMs: 1, producedRequiredOutputs: true, outputDir: input.workdir };
      },
    });
    const synthesis = await fs.readFile(path.join(result.waveDir, 'synthesis-recommendation.md'), 'utf8');
    assert.match(synthesis, /Verdict:/);
  });

  it('appends to .danteforge/lessons.md with [Research] prefix', async () => {
    await runResearchWave({
      dimensionId: 'testing',
      cwd: tmpDir,
      activation: baseActivation(),
      _runAgent: async (input) => {
        await fs.mkdir(input.workdir, { recursive: true });
        if (input.roleId === 'benchmark-designer') {
          await fs.writeFile(path.join(input.workdir, 'frontier-definition.md'), '# Frontier\n');
        }
        return { roleId: input.roleId, exitCode: 0, durationMs: 1, producedRequiredOutputs: true, outputDir: input.workdir };
      },
    });
    const lessons = await fs.readFile(path.join(tmpDir, '.danteforge', 'lessons.md'), 'utf8');
    assert.match(lessons, /\[Research\]/);
  });
});

describe('runResearchWave — stop conditions', () => {
  it('halts before parallel phase when benchmark-designer fails to produce frontier-definition.md', async () => {
    let parallelPhaseEntered = false;
    const result = await runResearchWave({
      dimensionId: 'testing',
      cwd: tmpDir,
      activation: baseActivation(),
      _runAgent: async (input) => {
        await fs.mkdir(input.workdir, { recursive: true });
        // benchmark-designer fails to write frontier-definition.md
        if (input.roleId !== 'benchmark-designer') {
          parallelPhaseEntered = true;
        }
        return { roleId: input.roleId, exitCode: 0, durationMs: 1, producedRequiredOutputs: false, outputDir: input.workdir };
      },
    });
    assert.equal(parallelPhaseEntered, false, 'parallel phase should NOT have started');
    assert.equal(result.outcome, 'cap');
    assert.match(result.reason!, /frontier-definition/);
  });
});

describe('runResearchWave — _runAgent: null disables dispatch', () => {
  it('returns null outcome and dispatches no agents when _runAgent is null', async () => {
    const result = await runResearchWave({
      dimensionId: 'testing',
      cwd: tmpDir,
      activation: baseActivation(),
      _runAgent: null,
    });
    assert.equal(result.outcome, null);
    assert.equal(result.agents.length, 0);
  });
});

describe('runResearchWave — force override', () => {
  it('runs even when activation criteria fail when force=true', async () => {
    const result = await runResearchWave({
      dimensionId: 'testing',
      cwd: tmpDir,
      force: true,
      activation: baseActivation({ projectComposite: 5.0 }), // would otherwise refuse
      _runAgent: async (input) => {
        await fs.mkdir(input.workdir, { recursive: true });
        if (input.roleId === 'benchmark-designer') {
          await fs.writeFile(path.join(input.workdir, 'frontier-definition.md'), '# Frontier\n');
        }
        return { roleId: input.roleId, exitCode: 0, durationMs: 1, producedRequiredOutputs: true, outputDir: input.workdir };
      },
    });
    assert.ok(result.outcome !== null);
    assert.ok(!result.refusalReason);
  });
});
