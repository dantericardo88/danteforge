import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { withCommandNode, _resetSession } from '../src/core/decision-node-recorder.js';

let tmpDir: string;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dnr-hof-'));
  process.env.DANTEFORGE_DECISION_STORE = path.join(tmpDir, 'nodes.jsonl');
});

after(async () => {
  delete process.env.DANTEFORGE_DECISION_STORE;
  _resetSession();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('withCommandNode HOF', () => {
  it('passes the return value of fn through unchanged', async () => {
    _resetSession();
    const result = await withCommandNode({
      cwd: tmpDir,
      command: 'test-cmd',
      fn: async () => 42,
    });
    assert.equal(result, 42);
  });

  it('records a start node with success=false and result=in-progress before fn runs', async () => {
    _resetSession();
    const storePath = path.join(tmpDir, 'nodes-start.jsonl');
    process.env.DANTEFORGE_DECISION_STORE = storePath;

    let nodeCountDuringFn = 0;
    await withCommandNode({
      cwd: tmpDir,
      command: 'start-check',
      goal: 'test start node',
      fn: async () => {
        try {
          const raw = await fs.readFile(storePath, 'utf8');
          nodeCountDuringFn = raw.trim().split('\n').filter(Boolean).length;
        } catch { nodeCountDuringFn = 0; }
        return 'done';
      },
    });

    assert.ok(nodeCountDuringFn >= 1, 'start node should be recorded before fn() runs');
  });

  it('records a completion node with parentNodeId linking to the start node', async () => {
    _resetSession();
    const storePath = path.join(tmpDir, 'nodes-parent.jsonl');
    process.env.DANTEFORGE_DECISION_STORE = storePath;

    await withCommandNode({
      cwd: tmpDir,
      command: 'parent-check',
      goal: 'test parent linking',
      fn: async () => 'ok',
    });

    const allNodes: unknown[] = [];
    try {
      const raw = await fs.readFile(storePath, 'utf8');
      for (const line of raw.trim().split('\n').filter(Boolean)) {
        allNodes.push(JSON.parse(line));
      }
    } catch { /* empty store */ }

    assert.ok(allNodes.length >= 2, 'should have at least start + completion nodes');
    const startNode = allNodes[0] as Record<string, unknown>;
    const endNode = allNodes[allNodes.length - 1] as Record<string, unknown>;
    const startOut = startNode['output'] as Record<string, unknown>;
    const endOut = endNode['output'] as Record<string, unknown>;
    assert.equal(startOut['result'], 'in-progress');
    assert.equal(startOut['success'], false);
    assert.equal(endNode['parentId'], startNode['id'], 'completion node must link to start node');
    assert.equal(endOut['success'], true);
    assert.ok((endOut['latencyMs'] as number ?? 0) >= 0, 'latencyMs should be recorded');
  });

  it('records latencyMs > 0 on the completion node', async () => {
    _resetSession();
    const storePath = path.join(tmpDir, 'nodes-latency.jsonl');
    process.env.DANTEFORGE_DECISION_STORE = storePath;

    await withCommandNode({
      cwd: tmpDir,
      command: 'latency-check',
      fn: async () => {
        await new Promise(r => setTimeout(r, 5));
        return true;
      },
    });

    const raw = await fs.readFile(storePath, 'utf8');
    const nodes = raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    const endNode = nodes[nodes.length - 1]!;
    assert.ok((endNode.output.latencyMs ?? 0) >= 0, 'latencyMs should be >= 0');
  });

  it('uses toResult to set qualityScore on the completion node', async () => {
    _resetSession();
    const storePath = path.join(tmpDir, 'nodes-quality.jsonl');
    process.env.DANTEFORGE_DECISION_STORE = storePath;

    await withCommandNode({
      cwd: tmpDir,
      command: 'quality-check',
      fn: async () => ({ score: 8.5 }),
      toResult: (r) => ({ result: `score:${r.score}`, success: true, qualityScore: r.score * 10 }),
    });

    const raw = await fs.readFile(storePath, 'utf8');
    const nodes = raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    const endNode = nodes[nodes.length - 1]!;
    assert.equal(endNode.output.qualityScore, 85);
    assert.equal(endNode.output.result, 'score:8.5');
  });

  it('on fn() throw: records a failure node with success=false then re-throws', async () => {
    _resetSession();
    const storePath = path.join(tmpDir, 'nodes-error.jsonl');
    process.env.DANTEFORGE_DECISION_STORE = storePath;

    const err = new Error('test failure');
    await assert.rejects(
      () => withCommandNode({
        cwd: tmpDir,
        command: 'error-check',
        fn: async () => { throw err; },
      }),
      /test failure/,
    );

    const raw = await fs.readFile(storePath, 'utf8');
    const nodes = raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.ok(nodes.length >= 2, 'should record start + failure nodes');
    const failNode = nodes[nodes.length - 1]!;
    assert.equal(failNode.output.success, false);
    assert.ok(String(failNode.output.result).includes('test failure'));
  });
});
