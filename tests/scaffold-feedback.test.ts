import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recordForgeScaffoldReward } from '../src/core/scaffold-feedback.js';
import { bestScaffold } from '../src/core/scaffold-library.js';
import type { ForgeSelection } from '../src/core/best-of-n-forge.js';
import type { ForgeCandidate } from '../src/core/best-of-n-forge.js';

const ROOT = path.join(os.tmpdir(), `scaffold-feedback-${process.pid}`);
after(async () => { await fs.rm(ROOT, { recursive: true, force: true }).catch(() => {}); });

function cleanSelection(opCount: number, files: { path: string; content: string }[] = []): ForgeSelection {
  const chosen: ForgeCandidate = { index: 0, result: 'R', files, opCount };
  return { chosen, ranked: [{ candidate: chosen, reward: opCount, clean: true, findings: 0 }], emptyCandidates: 0 };
}

describe('scaffold-feedback — closes the Ornith loop in the live forge path', () => {
  test('records a clean selection reward to the per-task-type scaffold (real fs round-trip)', async () => {
    const cwd = path.join(ROOT, 'a');
    await fs.mkdir(cwd, { recursive: true });
    const zeroed = await recordForgeScaffoldReward('balanced', cleanSelection(3), cwd, '2026-06-29T00:00:00.000Z');
    assert.equal(zeroed, null, 'a clean selection is not zeroed');
    const s = await bestScaffold('balanced', cwd);
    assert.ok(s, 'a scaffold was created for the task type');
    assert.equal(s!.rewardStats.runs, 1);
    assert.equal(s!.rewardStats.meanReward, 3);
  });

  test('accumulates reward across multiple cycles', async () => {
    const cwd = path.join(ROOT, 'b');
    await fs.mkdir(cwd, { recursive: true });
    await recordForgeScaffoldReward('quality', cleanSelection(2), cwd, '2026-06-29T00:00:00.000Z');
    await recordForgeScaffoldReward('quality', cleanSelection(4), cwd, '2026-06-29T00:01:00.000Z');
    const s = await bestScaffold('quality', cwd);
    assert.equal(s!.rewardStats.runs, 2);
    assert.equal(s!.rewardStats.meanReward, 3); // (2+4)/2
  });

  test('zeroes the reward if the chosen candidate touched the trust surface (defense in depth)', async () => {
    const cwd = path.join(ROOT, 'c');
    await fs.mkdir(cwd, { recursive: true });
    const sel = cleanSelection(5, [{ path: '.danteforge/compete/matrix.json', content: '{}' }]);
    const zeroed = await recordForgeScaffoldReward('balanced', sel, cwd, '2026-06-29T00:00:00.000Z');
    assert.match(zeroed ?? '', /trust surface/);
    const s = await bestScaffold('balanced', cwd);
    assert.equal(s!.rewardStats.lastReward, 0);
  });
});
