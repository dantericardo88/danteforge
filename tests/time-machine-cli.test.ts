import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';

import { timeMachine } from '../src/cli/commands/time-machine.js';
import { createDecisionNode, createDecisionNodeStore } from '../src/core/decision-node.js';

function initGit(cwd: string): void {
  execSync('git init -q', { cwd });
  execSync('git -c user.email=t@t -c user.name=Test commit --allow-empty -q -m initial', { cwd });
}

function write(rel: string, body: string, cwd: string): void {
  const target = resolve(cwd, rel);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, body);
}

describe('time-machine CLI command', () => {
  let workspace: string;
  let lines: string[];

  beforeEach(async () => {
    workspace = await mkdtemp(resolve(tmpdir(), 'danteforge-time-machine-cli-'));
    initGit(workspace);
    lines = [];
  });

  afterEach(() => {
    rmSync(workspace, { recursive: true, force: true });
  });

  it('commits, verifies, restores, and fails verification after tampering', async () => {
    write('doc.txt', 'original\n', workspace);

    await timeMachine({
      action: 'commit',
      cwd: workspace,
      path: ['doc.txt'],
      label: 'cli-fixture',
      _stdout: line => lines.push(line),
      _now: () => '2026-04-29T10:00:00.000Z',
    });
    const commitReport = JSON.parse(lines.join('\n')) as { commitId: string };
    assert.ok(commitReport.commitId);

    lines = [];
    await timeMachine({ action: 'verify', cwd: workspace, _stdout: line => lines.push(line) });
    assert.equal(JSON.parse(lines.join('\n')).valid, true);

    lines = [];
    const outDir = resolve(workspace, 'restored');
    await timeMachine({
      action: 'restore',
      cwd: workspace,
      commit: commitReport.commitId,
      out: outDir,
      _stdout: line => lines.push(line),
    });
    assert.equal(readFileSync(resolve(outDir, 'doc.txt'), 'utf8'), 'original\n');

    const commitPath = resolve(workspace, '.danteforge/time-machine/commits', `${commitReport.commitId}.json`);
    const tampered = JSON.parse(readFileSync(commitPath, 'utf8'));
    tampered.label = 'tampered';
    writeFileSync(commitPath, JSON.stringify(tampered, null, 2));

    lines = [];
    await timeMachine({ action: 'verify', cwd: workspace, _stdout: line => lines.push(line) });
    assert.equal(JSON.parse(lines.join('\n')).valid, false);
  });

  it('pipeline replay restores into an isolated workspace and records alternate nodes directly', async () => {
    write('doc.txt', 'branch-state\n', workspace);

    await timeMachine({
      action: 'commit',
      cwd: workspace,
      path: ['doc.txt'],
      label: 'branch-state',
      _stdout: line => lines.push(line),
      _now: () => '2026-04-29T10:00:00.000Z',
    });
    const commitReport = JSON.parse(lines.join('\n')) as { commitId: string };
    lines = [];

    write('doc.txt', 'current-state\n', workspace);
    const storePath = resolve(workspace, '.danteforge', 'decision-nodes.jsonl');
    const store = createDecisionNodeStore(storePath);
    const branch = createDecisionNode({
      parentNode: null,
      sessionId: 'session-cli-pipeline',
      timelineId: 'main',
      actor: { type: 'agent', id: 'test', product: 'danteforge' },
      input: { prompt: 'original branch' },
      output: {
        result: 'branch',
        success: true,
        costUsd: 0,
        latencyMs: 1,
        fileStateRef: commitReport.commitId,
      },
    });
    await store.append(branch);
    await store.close();

    await timeMachine({
      action: 'replay',
      cwd: workspace,
      store: storePath,
      session: 'session-cli-pipeline',
      nodeId: branch.id,
      alteredInput: 'alternate request',
      pipelineMode: true,
      json: true,
      _newTimelineId: 'cli-alt-timeline',
      _runReplayPipeline: async ({ cwd, env, storePath: replayStorePath }) => {
        assert.match(cwd, /time-machine[\\/]+replays[\\/]+cli-alt-timeline[\\/]+workspace$/);
        assert.equal(readFileSync(resolve(cwd, 'doc.txt'), 'utf8'), 'branch-state\n');
        assert.equal(env.DANTEFORGE_DECISION_STORE, replayStorePath);
        assert.equal(env.DANTEFORGE_DECISION_SESSION_ID, 'session-cli-pipeline');
        assert.equal(env.DANTEFORGE_DECISION_TIMELINE_ID, 'cli-alt-timeline');
        assert.equal(env.DANTEFORGE_DECISION_PARENT_ID, branch.id);

        const replayStore = createDecisionNodeStore(replayStorePath);
        const node = createDecisionNode({
          parentNode: branch,
          sessionId: env.DANTEFORGE_DECISION_SESSION_ID!,
          timelineId: env.DANTEFORGE_DECISION_TIMELINE_ID!,
          actor: { type: 'agent', id: 'test', product: 'danteforge' },
          input: { prompt: 'child pipeline node' },
          output: { result: 'ok', success: true, costUsd: 0.02, latencyMs: 2 },
        });
        await replayStore.append(node);
        await replayStore.close();

        return { exitCode: 0, stdout: 'ok', stderr: '', durationMs: 3 };
      },
      _stdout: line => lines.push(line),
    });

    const result = JSON.parse(lines.join('\n'));
    assert.equal(result.newTimelineId, 'cli-alt-timeline');
    assert.equal(result.alternatePath.length, 1);
    assert.equal(result.alternatePath[0].timelineId, 'cli-alt-timeline');
    assert.equal(result.artifacts.pipelineExitCode, 0);

    const readStore = createDecisionNodeStore(storePath);
    const altNodes = await readStore.getByTimeline('cli-alt-timeline');
    await readStore.close();
    assert.equal(altNodes.length, 1, 'pipeline node should not be duplicated');
  });
});
