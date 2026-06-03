import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runAscendFrontier, setupCommands, buildTo7Commands, type PushResult } from '../src/cli/commands/ascend-frontier.js';
import type { DimState } from '../src/core/ascend-frontier-engine.js';

const ROOT = path.join('X:\\tmp', `ascend-loop-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

function dim(over: Partial<DimState> = {}): DimState {
  return { id: 'd', effectiveScore: 8.0, frontierStatus: 'frozen', ceiling: null, attempts: 0, isMarketCapped: false, ...over };
}

describe('ascend-frontier — phase routing (sequential vs council-parallel)', () => {
  const M = ['codex', 'claude-code', 'grok-build'];
  test('sequential define = scaffold + migrate only', () => {
    assert.deepEqual(setupCommands(false, M), [['evidence-scaffold'], ['migrate-outcomes', '--write']]);
  });
  test('parallel define fans research out to council-universe (member-split), then serial scaffold/migrate', () => {
    const c = setupCommands(true, M);
    assert.deepEqual(c[0], ['council-universe', '--members', 'codex,claude-code,grok-build', '--propose-outcomes']);
    assert.deepEqual(c.slice(1), [['evidence-scaffold'], ['migrate-outcomes', '--write']]);
  });
  test('build-to-7 always uses harden-crusade (internal parallel + loop-to-exhaustion) — both modes', () => {
    const expected = [['harden-crusade', '--parallel', '4', '--loop', '--target', '7']];
    assert.deepEqual(buildTo7Commands(false, M, ['a', 'b']), expected);
    assert.deepEqual(buildTo7Commands(true, M, ['a', 'b']), expected, 'council fan-out is reserved for push-to-9, not the 7.0 bar');
    assert.deepEqual(buildTo7Commands(true, ['codex'], ['a']), expected);
  });
});

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

  test('an UN-BUILDABLE dim (stuck below 7) is ceilinged after the stall cap → loop reaches DONE (the field bug)', async () => {
    const dir = path.join(ROOT, 'stuck');
    let builds = 0;
    const r = await runAscendFrontier({
      cwd: dir, maxCycles: 10, maxBuildAttempts: 2,
      _buildState: async () => {
        const ceiling = await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 'go_dim.json'), 'utf8').then(JSON.parse).catch(() => null);
        return [{ ...dim({ id: 'go_dim', effectiveScore: 6.0 }), ceiling }]; // never reaches 7 (e.g. Go, no network)
      },
      _runBuildTo7: async () => { builds++; }, // build runs but the dim can't advance
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done', 'the loop signs a ceiling and completes — it does NOT spin to max-cycles');
    assert.equal(builds, 2, 'exactly maxBuildAttempts build attempts, then a stall-ceiling');
    const ceiling = JSON.parse(await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 'go_dim.json'), 'utf8'));
    assert.equal(ceiling.cause, 'generator-ceiling');
    assert.match(ceiling.detail, /build attempts/);
  });

  test('a perpetually-needsSetup dim is ceilinged after the cap → loop is never wedged (DanteCode bug)', async () => {
    const dir = path.join(ROOT, 'setupstuck');
    const r = await runAscendFrontier({
      cwd: dir, maxCycles: 10, maxBuildAttempts: 2,
      _buildState: async () => {
        const ceiling = await fs.readFile(path.join(dir, '.danteforge', 'ceilings', 's.json'), 'utf8').then(JSON.parse).catch(() => null);
        return [{ ...dim({ id: 's', effectiveScore: 9.0, frontierStatus: 'none' as const, needsSetup: true }), ceiling }];
      },
      _runSetup: async () => {}, // setup runs but never clears needsSetup
      _now: () => '2026-06-03T00:00:00.000Z',
    });
    assert.equal(r.terminal, 'done', 'one stuck-setup dim no longer blocks the entire loop forever');
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
      _buildAll: async () => { rounds = 1; },
      _promoteOne: async (_cwd, asg) => {
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
