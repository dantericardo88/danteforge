import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDecisionNode, type DecisionNode } from '../src/core/decision-node.js';
import { buildTimeMachineCorpusBundle } from '../src/core/time-machine-corpus.js';
import { timeMachine } from '../src/cli/commands/time-machine.js';

const actor: DecisionNode['actor'] = {
  type: 'agent',
  id: 'test-agent',
  product: 'danteforge',
};

function makeNode(params: {
  parentNode: DecisionNode | null;
  sessionId: string;
  timelineId: string;
  prompt: string;
  result: string;
  causal?: DecisionNode['causal'];
}): DecisionNode {
  return createDecisionNode({
    parentNode: params.parentNode,
    sessionId: params.sessionId,
    timelineId: params.timelineId,
    actor,
    input: { prompt: params.prompt },
    output: { result: params.result, success: true, costUsd: 0, latencyMs: 1 },
    causal: params.causal,
  });
}

function writeStore(filePath: string): DecisionNode[] {
  const branch = makeNode({
    parentNode: null,
    sessionId: 'session-1',
    timelineId: 'main',
    prompt: 'choose database',
    result: 'postgres',
  });
  const originalA = makeNode({
    parentNode: branch,
    sessionId: 'session-1',
    timelineId: 'main',
    prompt: 'write repository layer',
    result: 'repository uses postgres',
    causal: { dependentOn: [branch.id], classification: 'dependent-adaptable' },
  });
  const originalB = makeNode({
    parentNode: originalA,
    sessionId: 'session-1',
    timelineId: 'main',
    prompt: 'write unrelated docs',
    result: 'docs updated',
    causal: { dependentOn: [], classification: 'independent' },
  });
  const alternateA = makeNode({
    parentNode: branch,
    sessionId: 'session-1',
    timelineId: 'alt-1',
    prompt: 'write repository layer',
    result: 'repository uses sqlite',
    causal: { dependentOn: [branch.id], counterfactualOf: branch.id },
  });
  const alternateB = makeNode({
    parentNode: alternateA,
    sessionId: 'session-1',
    timelineId: 'alt-1',
    prompt: 'run tests',
    result: 'tests pass',
    causal: { dependentOn: [alternateA.id], counterfactualOf: branch.id },
  });
  const nodes = [branch, originalA, originalB, alternateA, alternateB];
  writeFileSync(filePath, nodes.map(node => JSON.stringify(node)).join('\n') + '\n', 'utf8');
  return nodes;
}

test('Time Machine corpus builder writes sessions, label candidates, labels, and manifest', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dfg-tm-corpus-'));
  try {
    const storePath = join(workspace, 'decision-nodes.jsonl');
    const nodes = writeStore(storePath);
    const outDir = join(workspace, 'corpus');
    const result = await buildTimeMachineCorpusBundle({
      storePath,
      outDir,
      minSessions: 1,
      minLabels: 2,
      now: () => '2026-05-01T04:00:00.000Z',
    });

    assert.equal(result.replayedSessionCount, 1);
    assert.equal(result.labelCandidateCount, 2);
    assert.equal(result.readyForHumanAdjudication, true);
    assert.equal(result.readyForEvaluation, false);
    assert.equal(existsSync(result.artifacts.sessionsJsonl), true);
    assert.equal(existsSync(result.artifacts.labelCandidatesJson), true);
    assert.equal(existsSync(result.artifacts.labelsJson), true);
    assert.equal(existsSync(result.artifacts.manifestJson), true);

    const labels = JSON.parse(readFileSync(result.artifacts.labelsJson, 'utf8')) as {
      humanAdjudicated: boolean;
      branchPointId: string;
      labels: Array<{ nodeId: string; expected: string }>;
    };
    assert.equal(labels.humanAdjudicated, false);
    assert.equal(labels.branchPointId, nodes[0]!.id);
    assert.equal(labels.labels.length, 2);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('Time Machine corpus CLI command emits JSON manifest', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'dfg-tm-corpus-cli-'));
  try {
    const storePath = join(workspace, 'decision-nodes.jsonl');
    writeStore(storePath);
    const outputs: string[] = [];
    await timeMachine({
      action: 'node-build-corpus',
      cwd: workspace,
      store: storePath,
      out: join(workspace, 'corpus'),
      minSessions: 1,
      minLabels: 2,
      json: true,
      _stdout: line => outputs.push(line),
      _now: () => '2026-05-01T04:00:01.000Z',
    });
    const parsed = JSON.parse(outputs.join('\n')) as { readyForHumanAdjudication: boolean; replayedSessionCount: number };
    assert.equal(parsed.readyForHumanAdjudication, true);
    assert.equal(parsed.replayedSessionCount, 1);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
