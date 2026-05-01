import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createDanteAgentsBridge,
  type ForgeResultLike,
  type StepResultLike,
} from '../src/core/decision-node-danteagents-bridge.js';
import { createDecisionNodeStore, type TraceEventLike } from '../src/core/decision-node.js';

describe('createDanteAgentsBridge', () => {
  let tmpDir: string;
  let storePath: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'df-bridge-test-'));
    storePath = join(tmpDir, 'decision-nodes.jsonl');
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeResult(overrides: Partial<ForgeResultLike> = {}): ForgeResultLike {
    const step: StepResultLike = {
      stepId: 'step-1',
      output: 'step output',
      success: true,
      attempts: 1,
      qualityScore: 88,
      durationMs: 120,
    };
    return {
      success: true,
      response: 'final synthesized answer',
      steps: [step],
      metadata: {
        totalDurationMs: 500,
        totalSteps: 1,
        averageQualityScore: 88,
        state: 'COMPLETE',
      },
      ...overrides,
    };
  }

  it('creates a bridge with recordForgeResult and recordTraceEvent', () => {
    const bridge = createDanteAgentsBridge(storePath);
    assert.equal(typeof bridge.recordForgeResult, 'function');
    assert.equal(typeof bridge.recordTraceEvent, 'function');
  });

  it('recordForgeResult returns N+1 nodes (root + one per step)', async () => {
    const bridge = createDanteAgentsBridge(storePath);
    const nodes = await bridge.recordForgeResult({
      task: 'Build the time machine',
      result: makeResult(),
      sessionId: 'sess-001',
    });
    assert.equal(nodes.length, 2); // root + 1 step
  });

  it('root node has actor.product = danteagents', async () => {
    const bridge = createDanteAgentsBridge(storePath);
    const nodes = await bridge.recordForgeResult({
      task: 'Build the time machine',
      result: makeResult(),
      sessionId: 'sess-002',
    });
    assert.equal(nodes[0]?.actor.product, 'danteagents');
    assert.equal(nodes[0]?.actor.type, 'agent');
  });

  it('step node is a child of the root node', async () => {
    const bridge = createDanteAgentsBridge(storePath);
    const nodes = await bridge.recordForgeResult({
      task: 'Build the time machine',
      result: makeResult(),
      sessionId: 'sess-003',
    });
    assert.equal(nodes[1]?.parentId, nodes[0]?.id);
  });

  it('step node preserves qualityScore and durationMs', async () => {
    const bridge = createDanteAgentsBridge(storePath);
    const nodes = await bridge.recordForgeResult({
      task: 'Build the time machine',
      result: makeResult(),
      sessionId: 'sess-004',
    });
    assert.equal(nodes[1]?.output.qualityScore, 88);
    assert.equal(nodes[1]?.output.latencyMs, 120);
  });

  it('failed forge result is recorded with success=false', async () => {
    const bridge = createDanteAgentsBridge(storePath);
    const result = makeResult({ success: false, response: 'Task blocked: budget exhausted' });
    const nodes = await bridge.recordForgeResult({
      task: 'Build the time machine',
      result,
      sessionId: 'sess-005',
    });
    assert.equal(nodes[0]?.output.success, false);
  });

  it('evidenceHash is forwarded to root node evidenceRef', async () => {
    const bridge = createDanteAgentsBridge(storePath);
    const result = makeResult({ evidenceHash: 'abc123soulseal' });
    const nodes = await bridge.recordForgeResult({
      task: 'Build the time machine',
      result,
      sessionId: 'sess-006',
    });
    assert.equal(nodes[0]?.evidenceRef, 'abc123soulseal');
  });

  it('fileStateRef is forwarded to root node output', async () => {
    const bridge = createDanteAgentsBridge(storePath);
    const nodes = await bridge.recordForgeResult({
      task: 'Build the time machine',
      result: makeResult(),
      sessionId: 'sess-007',
      fileStateRef: 'deadbeef1234',
    });
    assert.equal(nodes[0]?.output.fileStateRef, 'deadbeef1234');
  });

  it('nodes are persisted to the JSONL store', async () => {
    const bridge = createDanteAgentsBridge(storePath);
    const sessionId = 'sess-persist-001';
    await bridge.recordForgeResult({
      task: 'Persist test',
      result: makeResult(),
      sessionId,
    });
    const store = createDecisionNodeStore(storePath);
    const nodes = await store.getBySession(sessionId);
    await store.close();
    assert.equal(nodes.length, 2);
  });

  it('hash chain is intact across root and step nodes', async () => {
    const bridge = createDanteAgentsBridge(storePath);
    const nodes = await bridge.recordForgeResult({
      task: 'Hash chain test',
      result: makeResult(),
      sessionId: 'sess-chain-001',
    });
    assert.equal(nodes[0]?.prevHash, null); // genesis
    assert.notEqual(nodes[0]?.hash, '');
    assert.equal(nodes[1]?.prevHash, nodes[0]?.hash);
  });

  it('custom timelineId is propagated to all nodes', async () => {
    const bridge = createDanteAgentsBridge(storePath);
    const nodes = await bridge.recordForgeResult({
      task: 'Timeline test',
      result: makeResult(),
      sessionId: 'sess-tl-001',
      timelineId: 'counterfactual-branch-xyz',
    });
    assert.equal(nodes[0]?.timelineId, 'counterfactual-branch-xyz');
    assert.equal(nodes[1]?.timelineId, 'counterfactual-branch-xyz');
  });

  it('recordTraceEvent converts TraceEventLike and persists it', async () => {
    const bridge = createDanteAgentsBridge(storePath);
    const event: TraceEventLike = {
      id: 'trace-evt-001',
      type: 'decision',
      timestamp: new Date().toISOString(),
      agentId: 'my-agent',
      data: { prompt: 'Choose the fastest path', result: 'option-B' },
      parentId: null,
      hash: 'fakehash1',
      prevHash: null,
      sessionId: 'trace-sess-001',
    };
    const node = await bridge.recordTraceEvent(event, 'gitsha-abc');
    assert.equal(node.actor.product, 'danteagents');
    assert.equal(node.output.fileStateRef, 'gitsha-abc');
  });

  it('handles multiple steps creating a linear chain', async () => {
    const bridge = createDanteAgentsBridge(storePath);
    const steps: StepResultLike[] = [
      { stepId: 'step-a', output: 'A', success: true, attempts: 1, qualityScore: 80, durationMs: 50 },
      { stepId: 'step-b', output: 'B', success: true, attempts: 1, qualityScore: 85, durationMs: 60 },
      { stepId: 'step-c', output: 'C', success: false, error: 'timeout', attempts: 3, qualityScore: 40, durationMs: 900 },
    ];
    const result = makeResult({ steps, metadata: { totalDurationMs: 1010, totalSteps: 3, averageQualityScore: 68, state: 'BLOCKED' } });
    const nodes = await bridge.recordForgeResult({
      task: 'Multi-step test',
      result,
      sessionId: 'sess-multi-001',
    });
    assert.equal(nodes.length, 4); // root + 3 steps
    assert.equal(nodes[1]?.parentId, nodes[0]?.id);
    assert.equal(nodes[2]?.parentId, nodes[1]?.id);
    assert.equal(nodes[3]?.parentId, nodes[2]?.id);
  });
});
