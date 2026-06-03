import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runAscendFrontier, type PushResult } from '../src/cli/commands/ascend-frontier.js';
import type { DimState } from '../src/core/ascend-frontier-engine.js';

const ROOT = path.join('X:\\tmp', `ascend-loop-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

function dim(over: Partial<DimState> = {}): DimState {
  return { id: 'd', effectiveScore: 8.0, frontierStatus: 'frozen', ceiling: null, attempts: 0, isMarketCapped: false, ...over };
}

describe('ascend-frontier — unattended loop control', () => {
  test('dry-run prints the next action and does not execute', async () => {
    let executed = false;
    const r = await runAscendFrontier({
      cwd: ROOT, dryRun: true,
      _buildState: async () => [dim({ id: 'a', effectiveScore: 7.0 })],
      _runPushTo9: async () => { executed = true; return { verdict: 'REJECTED', fingerprint: { dimId: 'a', command: 'x', artifactPath: 'y', gitSha: 's' } }; },
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'dry-run');
    assert.match(r.actions[0]!, /push-to-9\(a\)/);
    assert.equal(executed, false, 'dry-run must not execute the push');
  });

  test('terminates DONE when all dims are validated or ceilinged', async () => {
    const r = await runAscendFrontier({
      cwd: ROOT,
      _buildState: async () => [dim({ id: 'a', effectiveScore: 9.0, frontierStatus: 'validated' })],
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done');
    assert.equal(r.cycles, 0);
  });

  test('a dim that keeps getting REJECTED is ceilinged after maxAttempts → loop ends DONE', async () => {
    // buildState reflects the disk ledger's attempt count (the loop records each rejected attempt).
    let pushN = 0;
    const r = await runAscendFrontier({
      cwd: ROOT, maxAttemptsPerDim: 2, maxCycles: 20,
      _buildState: async () => {
        const ledger = JSON.parse(await fs.readFile(path.join(ROOT, '.danteforge', 'evidence-novelty.json'), 'utf8').catch(() => '[]'));
        const attempts = ledger.filter((a: { dimId: string }) => a.dimId === 'a').length;
        const ceiling = await fs.readFile(path.join(ROOT, '.danteforge', 'ceilings', 'a.json'), 'utf8').then(JSON.parse).catch(() => null);
        return [{ ...dim({ id: 'a', effectiveScore: 8.0 }), attempts, ceiling }];
      },
      _runPushTo9: async (): Promise<PushResult> => {
        pushN++;
        return { verdict: 'REJECTED', fingerprint: { dimId: 'a', command: 'run', artifactPath: 'art', gitSha: `sha-${pushN}` } }; // fresh SHA → novel each time
      },
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done', 'after 2 rejected attempts the dim is ceilinged → all complete');
    assert.equal(pushN, 2, 'exactly maxAttempts pushes, then generator-ceiling');
    // A generator-ceiling receipt was written for the dim.
    const ceiling = JSON.parse(await fs.readFile(path.join(ROOT, '.danteforge', 'ceilings', 'a.json'), 'utf8'));
    assert.equal(ceiling.cause, 'generator-ceiling');
  });

  test('--parallel mode fans the push across members (each builds a different dim concurrently)', async () => {
    const dir = path.join(ROOT, 'par');
    const pushedBy: Record<string, string> = {};
    let rounds = 0;
    const r = await runAscendFrontier({
      cwd: dir, parallel: true, maxCycles: 3,
      _buildState: async () => {
        // After round 1, all three are validated → done. Before, three frozen dims at 8.0.
        if (rounds >= 1) return ['a', 'b', 'c'].map(id => ({ ...dim({ id, effectiveScore: 9.0, frontierStatus: 'validated' as const }) }));
        return ['a', 'b', 'c'].map(id => ({ ...dim({ id, effectiveScore: 8.0 }) }));
      },
      _discoverMembers: async () => ['codex', 'claude-code', 'grok-build'],
      _runParallelPush: async (_cwd, asg) => {
        rounds = 1;
        pushedBy[asg.dimId] = asg.memberId;
        return { dimId: asg.dimId, builderId: asg.memberId, verdict: 'VALIDATED', passedByJudges: ['codex', 'claude-code', 'grok-build'].filter(m => m !== asg.memberId) };
      },
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done');
    // Each of the 3 dims was pushed by a DIFFERENT member in the same round.
    assert.deepEqual(Object.keys(pushedBy).sort(), ['a', 'b', 'c']);
    assert.equal(new Set(Object.values(pushedBy)).size, 3, 'three distinct member-builders');
  });

  test('a non-novel push (no new evidence) is ceilinged immediately (anti-grind)', async () => {
    const dir = path.join(ROOT, 'nn');
    const r = await runAscendFrontier({
      cwd: dir, maxCycles: 5,
      _buildState: async () => {
        const ceiling = await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 'a.json'), 'utf8').then(JSON.parse).catch(() => null);
        return [{ ...dim({ id: 'a', effectiveScore: 8.0 }), ceiling }];
      },
      // Same fingerprint every push (no new SHA) — must be caught as non-novel after the first record.
      _runPushTo9: async (): Promise<PushResult> => ({ verdict: 'REJECTED', fingerprint: { dimId: 'a', command: 'run', artifactPath: 'art', gitSha: 'SAME' } }),
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done');
    const ceiling = JSON.parse(await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 'a.json'), 'utf8'));
    assert.equal(ceiling.failedGates[0], 'evidence-novelty');
  });
});
