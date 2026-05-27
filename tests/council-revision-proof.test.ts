import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  recordCouncilRevisionFrontierReceipt,
  runRevisionProofCommands,
} from '../src/matrix/engines/council-revision-proof.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-council-revision-'));
  tempDirs.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('council revision proof receipts', () => {
  it('runs runtime proof commands and anchors a frontier receipt in Time Machine', async () => {
    const cwd = await makeTempDir();
    const proofCommands = await runRevisionProofCommands(cwd, [
      'node -e "console.log(\'revision proof ok\')"',
    ]);

    assert.equal(proofCommands.length, 1);
    assert.equal(proofCommands[0]!.passed, true);
    assert.match(proofCommands[0]!.stdout, /revision proof ok/);

    const result = await recordCouncilRevisionFrontierReceipt({
      cwd,
      receipt: {
        dimensionId: 'council-revision',
        runId: 'revision-write-lease.test',
        cycle: 1,
        builderId: 'codex',
        judgeIds: ['claude-code', 'grok-build'],
        consensusBefore: 'FAIL',
        consensusAfter: 'PASS',
        scoreBefore: 4,
        scoreAfter: 9,
        targetScore: 9,
        proofCommands,
        preservedApprovals: ['production wiring preserved'],
        blockingConcerns: ['no runtime proof receipt'],
        changedFiles: ['src/matrix/engines/council-revision.ts'],
        originalDiff: 'diff --git a/src/a.ts b/src/a.ts\n+old',
        revisedDiff: 'diff --git a/src/a.ts b/src/a.ts\n+new',
      },
      now: () => '2026-05-26T12:00:00.000Z',
    });

    const parsed = JSON.parse(await fs.readFile(result.receiptPath, 'utf8')) as Record<string, unknown>;
    assert.equal(parsed.schemaVersion, 'danteforge.council-revision.frontier.v1');
    assert.equal(parsed.dimensionId, 'council-revision');
    assert.equal(parsed.timeMachineCommitId, result.timeMachineCommitId);
    assert.deepEqual(parsed.frontierMovement, {
      targetScore: 9,
      scoreBefore: 4,
      scoreAfter: 9,
      gapToFrontierBefore: 5,
      gapToFrontierAfter: 0,
      improved: true,
    });
    assert.deepEqual(parsed.capabilityTest, {
      passed: true,
      commandCount: 1,
      failedCommands: [],
    });
    assert.match(result.timeMachineCommitId, /^tm_/);
    await assert.doesNotReject(() =>
      fs.access(path.join(cwd, '.danteforge', 'time-machine', 'commits', `${result.timeMachineCommitId}.json`)));
  });
});
