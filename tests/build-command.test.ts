import { describe, it } from 'node:test';
import assert from 'node:assert';
import { build, detectCompletedStages } from '../src/cli/commands/build.js';
import type { BuildOptions, BuildStage } from '../src/cli/commands/build.js';
import type { ScoreResult } from '../src/cli/commands/score.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function makeScore(displayScore = 7.0): ScoreResult {
  return { displayScore, verdict: 'needs-work', p0Items: [] };
}

function makeOpts(overrides: Partial<BuildOptions> = {}): BuildOptions {
  return {
    spec: 'create a REST API',
    cwd: '/tmp/build-test',
    _detectStages: async () => new Set<BuildStage>(),
    _runStage: async () => true,
    _confirm: async () => true,
    _runScore: async () => makeScore(),
    _stdout: () => {},
    ...overrides,
  };
}

describe('build command', () => {
  it('completed stages are skipped', async () => {
    const ran: string[] = [];
    await build(makeOpts({
      _detectStages: async () => new Set<BuildStage>(['constitution', 'specify', 'clarify']),
      _runStage: async (stage) => { ran.push(stage); return true; },
    }));
    assert.ok(!ran.includes('constitution'), 'constitution should be skipped');
    assert.ok(!ran.includes('specify'), 'specify should be skipped');
    assert.ok(!ran.includes('clarify'), 'clarify should be skipped');
  });

  it('stages run in fixed order', async () => {
    const ran: string[] = [];
    await build(makeOpts({
      _runStage: async (stage) => { ran.push(stage); return true; },
    }));
    const expected = ['constitution', 'specify', 'clarify', 'plan', 'tasks', 'forge', 'verify'];
    assert.deepStrictEqual(ran, expected);
  });

  it('_confirm called between stages when interactive', async () => {
    let confirmCalls = 0;
    await build(makeOpts({
      interactive: true,
      _confirm: async () => { confirmCalls++; return true; },
    }));
    assert.ok(confirmCalls > 0, '_confirm should be called in interactive mode');
  });

  it('loop stops when _confirm returns false', async () => {
    const ran: string[] = [];
    let confirmCalls = 0;
    await build(makeOpts({
      interactive: true,
      _confirm: async () => { confirmCalls++; return confirmCalls <= 1; },
      _runStage: async (stage) => { ran.push(stage); return true; },
    }));
    // Only first stage confirmed, second rejected
    assert.strictEqual(ran.length, 1, 'should stop after first stage');
  });

  it('_runScore called at entry and exit', async () => {
    let scoreCalls = 0;
    await build(makeOpts({
      _runScore: async () => { scoreCalls++; return makeScore(); },
    }));
    assert.ok(scoreCalls >= 2, '_runScore should be called at least twice (entry + exit)');
  });

  it('detectCompletedStages: SPEC.md present → specify in result set', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'build-detect-'));
    try {
      await fs.writeFile(path.join(tmpDir, 'SPEC.md'), '# Spec\n', 'utf8');
      const stages = await detectCompletedStages(tmpDir);
      assert.ok(stages.has('specify'), 'specify should be detected when SPEC.md exists');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('non-interactive runs all pending stages without confirm', async () => {
    const ran: string[] = [];
    let confirmCalled = false;
    await build(makeOpts({
      interactive: false,
      _runStage: async (stage) => { ran.push(stage); return true; },
      _confirm: async () => { confirmCalled = true; return true; },
    }));
    assert.ok(!confirmCalled, '_confirm should NOT be called in non-interactive mode');
    assert.ok(ran.length > 0, 'stages should run without confirm');
  });

  it('T8: _runStage throws → build stops at failing stage and reports correct stagesRun count', async () => {
    const ran: string[] = [];
    const result = await build(makeOpts({
      _runStage: async (stage) => {
        ran.push(stage);
        if (stage === 'clarify') throw new Error('clarify failed');
        return true;
      },
    }));
    // constitution and specify succeed; clarify throws → returns false → pipeline stops
    assert.ok(result.stagesRun.includes('constitution'), 'constitution should be in stagesRun');
    assert.ok(result.stagesRun.includes('specify'), 'specify should be in stagesRun');
    assert.ok(!result.stagesRun.includes('plan'), 'plan should NOT run after clarify fails');
  });

  it('T9: all 7 pipeline stages attempted when none are completed (non-interactive)', async () => {
    const ran: string[] = [];
    await build(makeOpts({
      _detectStages: async () => new Set<BuildStage>(),
      _runStage: async (stage) => { ran.push(stage); return true; },
      interactive: false,
    }));
    const expected = ['constitution', 'specify', 'clarify', 'plan', 'tasks', 'forge', 'verify'];
    for (const stage of expected) {
      assert.ok(ran.includes(stage), `stage "${stage}" should have been attempted`);
    }
  });
});
