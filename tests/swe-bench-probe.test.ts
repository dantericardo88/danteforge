// Tests for swe-bench-probe.ts. The probe is a read-only adapter over
// `.danteforge/bench-results.json` that the ascend-engine consults when
// the active matrix dimension is `swe_bench`. Tests cover:
//
//   - Pass-rate → 0-10 score conversion (latest run wins).
//   - Returns null when bench-results is missing or malformed.
//   - Goal builder includes failure modes when present, falls back when not.
//   - isSweBenchDimension recognizes all canonical id forms.

import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  readSweBenchScore,
  formatSweBenchGoal,
  isSweBenchDimension,
} from '../src/core/swe-bench-probe.js';

let tempCwd: string;

beforeEach(async () => {
  tempCwd = await fs.mkdtemp(path.join(os.tmpdir(), 'swe-probe-'));
  await fs.mkdir(path.join(tempCwd, '.danteforge'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(tempCwd, { recursive: true, force: true }).catch(() => {});
});

async function writeBenchResults(content: unknown): Promise<void> {
  await fs.writeFile(
    path.join(tempCwd, '.danteforge', 'bench-results.json'),
    JSON.stringify(content),
    'utf-8',
  );
}

describe('readSweBenchScore', () => {
  it('returns null when bench-results.json is missing', async () => {
    const result = await readSweBenchScore(tempCwd);
    assert.strictEqual(result, null);
  });

  it('returns null when bench-results.json is malformed JSON', async () => {
    await fs.writeFile(
      path.join(tempCwd, '.danteforge', 'bench-results.json'),
      '{not valid json',
      'utf-8',
    );
    const result = await readSweBenchScore(tempCwd);
    assert.strictEqual(result, null);
  });

  it('returns null when runs array is empty', async () => {
    await writeBenchResults({ runs: [], best_pass_rate: 0 });
    const result = await readSweBenchScore(tempCwd);
    assert.strictEqual(result, null);
  });

  it('converts pass_rate 0.56 to displayScore 5.6', async () => {
    await writeBenchResults({
      last_updated: '2026-04-21T06:00:00Z',
      best_pass_rate: 0.56,
      best_model: 'anthropic/claude-sonnet-4-6',
      runs: [
        {
          run_id: 'run-2026-04-21-010',
          timestamp: '2026-04-21T06:00:00Z',
          model: 'anthropic/claude-sonnet-4-6',
          total: 100,
          resolved: 56,
          pass_rate: 0.56,
          failure_modes: ['test_assertion:19', 'timeout:10'],
        },
      ],
    });
    const result = await readSweBenchScore(tempCwd);
    assert.notStrictEqual(result, null);
    assert.strictEqual(result!.displayScore, 5.6);
    assert.strictEqual(result!.passRate, 0.56);
    assert.strictEqual(result!.instancesTotal, 100);
    assert.strictEqual(result!.latestRunId, 'run-2026-04-21-010');
    assert.deepStrictEqual(result!.failureModes, ['test_assertion:19', 'timeout:10']);
  });

  it('uses the FIRST run in the array (newest-first canonical order)', async () => {
    await writeBenchResults({
      best_pass_rate: 0.7,
      runs: [
        { run_id: 'newest', total: 100, pass_rate: 0.7, failure_modes: [], timestamp: 't1' },
        { run_id: 'older',  total: 100, pass_rate: 0.5, failure_modes: [], timestamp: 't0' },
      ],
    });
    const result = await readSweBenchScore(tempCwd);
    assert.strictEqual(result!.latestRunId, 'newest');
    assert.strictEqual(result!.displayScore, 7);
  });

  it('handles missing failure_modes field gracefully', async () => {
    await writeBenchResults({
      runs: [{ run_id: 'r1', total: 50, pass_rate: 0.4, timestamp: 't' }],
    });
    const result = await readSweBenchScore(tempCwd);
    assert.deepStrictEqual(result!.failureModes, []);
  });

  it('handles missing top-level fields safely', async () => {
    await writeBenchResults({ runs: [{}] });
    const result = await readSweBenchScore(tempCwd);
    assert.strictEqual(result!.displayScore, 0);
    assert.strictEqual(result!.passRate, 0);
    assert.strictEqual(result!.latestRunId, 'unknown');
  });
});

describe('formatSweBenchGoal', () => {
  it('returns instructive fallback when no bench-results exist', async () => {
    const goal = await formatSweBenchGoal(tempCwd, 9);
    assert.match(goal, /target 9\.0\/10/);
    assert.match(goal, /No bench-results\.json found/);
    assert.match(goal, /dantecode bench --instances/);
  });

  it('embeds pass rate, instance count, and failure modes', async () => {
    await writeBenchResults({
      runs: [{
        run_id: 'run-test',
        timestamp: 't',
        total: 100,
        pass_rate: 0.56,
        failure_modes: ['test_assertion:19', 'timeout:10', 'no_patch:7'],
      }],
    });
    const goal = await formatSweBenchGoal(tempCwd, 9);
    assert.match(goal, /5\.6\/10 → target 9\.0\/10/);
    assert.match(goal, /resolved 56\/100/);
    assert.match(goal, /test_assertion:19/);
    assert.match(goal, /timeout:10/);
    assert.match(goal, /no_patch:7/);
  });

  it('points at failure-analysis.md when present', async () => {
    await writeBenchResults({
      runs: [{ run_id: 'r', timestamp: 't', total: 100, pass_rate: 0.6, failure_modes: ['x:1'] }],
    });
    await fs.writeFile(
      path.join(tempCwd, '.danteforge', 'swe-bench-failure-analysis.md'),
      '# analysis',
      'utf-8',
    );
    const goal = await formatSweBenchGoal(tempCwd, 9);
    assert.match(goal, /swe-bench-failure-analysis\.md/);
    assert.match(goal, /Pick ONE pattern/);
  });

  it('falls back to generic instruction when failure-analysis.md is missing', async () => {
    await writeBenchResults({
      runs: [{ run_id: 'r', timestamp: 't', total: 100, pass_rate: 0.6, failure_modes: ['x:1'] }],
    });
    const goal = await formatSweBenchGoal(tempCwd, 9);
    assert.match(goal, /Pick the largest failure-mode bucket/);
  });
});

describe('isSweBenchDimension', () => {
  it('recognizes snake_case', () => {
    assert.strictEqual(isSweBenchDimension('swe_bench'), true);
  });

  it('recognizes camelCase', () => {
    assert.strictEqual(isSweBenchDimension('sweBench'), true);
  });

  it('recognizes kebab-case', () => {
    assert.strictEqual(isSweBenchDimension('swe-bench'), true);
  });

  it('rejects unrelated dim ids', () => {
    assert.strictEqual(isSweBenchDimension('functionality'), false);
    assert.strictEqual(isSweBenchDimension('swe_bench_xtra'), false);
    assert.strictEqual(isSweBenchDimension(''), false);
  });
});
