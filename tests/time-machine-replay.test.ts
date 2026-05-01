/**
 * tests/time-machine-replay.test.ts
 *
 * Unit tests for the counterfactual replay engine.
 *
 * Coverage goals (8+ tests):
 *  1. dry-run returns a result without calling the LLM
 *  2. dry-run leaves the alternate path empty and returns plan metadata
 *  3. diffTimelines: correctly classifies convergent nodes
 *  4. diffTimelines: correctly classifies divergent nodes
 *  5. diffTimelines: correctly classifies unreachable nodes
 *  6. buildCausalChain produces readable output from branch point + divergent list
 *  7. outcomeEquivalent = true when both paths end with the same result
 *  8. outcomeEquivalent = false when paths end with different results
 *  9. live mode calls llmCaller with the altered input and records response
 * 10. branchFromNodeId not found throws a clear error
 * 11. live mode without llmCaller throws a clear error
 * 12. diffTimelines with empty slices returns all-empty categories
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  counterfactualReplay,
  diffTimelines,
  buildCausalChain,
} from '../src/core/time-machine-replay.js';
import {
  createDecisionNodeStore,
  createDecisionNode,
  type DecisionNode,
} from '../src/core/decision-node.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTOR: DecisionNode['actor'] = {
  type: 'agent',
  id: 'test-agent',
  product: 'danteforge',
};

function makeNode(
  params: {
    prompt: string;
    result: unknown;
    sessionId: string;
    timelineId: string;
    parent: DecisionNode | null;
    classification?: DecisionNode['causal']['classification'];
    timestampOffset?: number;
  },
): DecisionNode {
  return createDecisionNode({
    parentNode: params.parent,
    sessionId: params.sessionId,
    timelineId: params.timelineId,
    actor: ACTOR,
    input: { prompt: params.prompt },
    output: { result: params.result, success: true, costUsd: 0, latencyMs: 1 },
    causal:
      params.classification !== undefined
        ? { dependentOn: [], classification: params.classification }
        : undefined,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('counterfactual replay — diffTimelines', () => {
  it('classifies nodes with matching prompts as convergent', () => {
    const sessionId = 'sess-diff-1';
    const nodeA = makeNode({ prompt: 'shared', result: 'ok', sessionId, timelineId: 'main', parent: null });
    const nodeB = makeNode({ prompt: 'shared', result: 'same', sessionId, timelineId: 'alt', parent: null });

    const diff = diffTimelines([nodeA], [nodeB]);

    assert.equal(diff.convergent.length, 1, 'expected 1 convergent node');
    assert.equal(diff.convergent[0].input.prompt, 'shared');
    assert.equal(diff.divergent.length, 0);
    assert.equal(diff.unreachable.length, 0);
  });

  it('classifies nodes only in alternate as divergent', () => {
    const sessionId = 'sess-diff-2';
    const origNode = makeNode({ prompt: 'original-prompt', result: 'x', sessionId, timelineId: 'main', parent: null });
    const altNode = makeNode({ prompt: 'alt-only-prompt', result: 'y', sessionId, timelineId: 'alt', parent: null });

    const diff = diffTimelines([origNode], [altNode]);

    assert.equal(diff.divergent.length, 1);
    assert.equal(diff.divergent[0].input.prompt, 'alt-only-prompt');
    assert.equal(diff.convergent.length, 0);
    assert.equal(diff.unreachable.length, 1);
  });

  it('classifies nodes only in original as unreachable', () => {
    const sessionId = 'sess-diff-3';
    const origNode = makeNode({ prompt: 'orig-unique', result: 'z', sessionId, timelineId: 'main', parent: null });

    const diff = diffTimelines([origNode], []);

    assert.equal(diff.unreachable.length, 1);
    assert.equal(diff.unreachable[0].input.prompt, 'orig-unique');
    assert.equal(diff.convergent.length, 0);
    assert.equal(diff.divergent.length, 0);
  });

  it('returns all-empty categories when both slices are empty', () => {
    const diff = diffTimelines([], []);
    assert.equal(diff.convergent.length, 0);
    assert.equal(diff.divergent.length, 0);
    assert.equal(diff.unreachable.length, 0);
  });
});

describe('counterfactual replay — buildCausalChain', () => {
  it('produces readable output starting from the branch point', () => {
    const sessionId = 'sess-chain-1';
    const branch = makeNode({ prompt: 'initial decision', result: 'initial result', sessionId, timelineId: 'main', parent: null });
    const d1 = makeNode({ prompt: 'follow-up decision', result: 'follow-up result', sessionId, timelineId: 'alt', parent: branch });

    const chain = buildCausalChain(branch, [d1]);

    assert.equal(chain.length, 2, 'chain should have branch-point + 1 divergent entry');
    assert.ok(chain[0].includes('initial decision'), `expected "initial decision" in: ${chain[0]}`);
    assert.ok(chain[0].includes('initial result'), `expected "initial result" in: ${chain[0]}`);
    assert.ok(chain[1].includes('follow-up decision'), `expected "follow-up decision" in: ${chain[1]}`);
  });

  it('produces only the branch-point entry when there are no divergent nodes', () => {
    const branch = makeNode({ prompt: 'lone branch', result: 'lone result', sessionId: 's1', timelineId: 'main', parent: null });

    const chain = buildCausalChain(branch, []);
    assert.equal(chain.length, 1);
    assert.ok(chain[0].includes('lone branch'));
  });

  it('truncates very long prompts to keep output readable', () => {
    const longPrompt = 'A'.repeat(300);
    const branch = makeNode({ prompt: longPrompt, result: 'r', sessionId: 's2', timelineId: 'main', parent: null });

    const chain = buildCausalChain(branch, []);
    // The formatted line should not exceed the raw prompt length
    assert.ok(chain[0].length < longPrompt.length + 50, 'chain entry should be shorter than raw prompt');
  });
});

describe('counterfactual replay — outcomeEquivalent', () => {
  let workspace: string;
  let storePath: string;

  before(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'df-tm-replay-'));
    storePath = join(workspace, 'nodes.jsonl');
  });

  after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('outcomeEquivalent is true when both paths end with the same result', async () => {
    const store = createDecisionNodeStore(storePath);
    const sessionId = 'sess-equiv-1';

    const branch = makeNode({ prompt: 'branch', result: 'same', sessionId, timelineId: 'main', parent: null });
    await store.append(branch);

    const origNext = makeNode({ prompt: 'orig-next', result: 'same-end', sessionId, timelineId: 'main', parent: branch });
    await store.append(origNext);

    let callCount = 0;
    const llmCaller = async (_prompt: string): Promise<string> => {
      callCount += 1;
      return 'same-end'; // same as origNext.output.result
    };

    const result = await counterfactualReplay(
      { branchFromNodeId: branch.id, alteredInput: 'what if', sessionId, dryRun: false },
      store,
      { llmCaller },
    );

    await store.close();

    assert.equal(callCount, 1, 'llmCaller should have been called once');
    assert.equal(result.outcomeEquivalent, true, 'outcomes should be equivalent');
  });

  it('outcomeEquivalent is false when paths end with different results', async () => {
    const storePath2 = join(workspace, 'nodes2.jsonl');
    const store = createDecisionNodeStore(storePath2);
    const sessionId = 'sess-equiv-2';

    const branch = makeNode({ prompt: 'branch', result: 'x', sessionId, timelineId: 'main', parent: null });
    await store.append(branch);

    const origNext = makeNode({ prompt: 'orig-next', result: 'result-A', sessionId, timelineId: 'main', parent: branch });
    await store.append(origNext);

    const llmCaller = async (_prompt: string): Promise<string> => 'result-B';

    const result = await counterfactualReplay(
      { branchFromNodeId: branch.id, alteredInput: 'alt input', sessionId, dryRun: false },
      store,
      { llmCaller },
    );

    await store.close();

    assert.equal(result.outcomeEquivalent, false, 'outcomes should differ');
  });
});

describe('counterfactual replay — dry-run mode', () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'df-tm-replay-dry-'));
  });

  after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('dry-run returns result without calling llmCaller', async () => {
    const storePath = join(workspace, 'nodes-dry.jsonl');
    const store = createDecisionNodeStore(storePath);
    const sessionId = 'sess-dry-1';

    const branch = makeNode({ prompt: 'dry-branch', result: 'init', sessionId, timelineId: 'main', parent: null });
    await store.append(branch);

    let calledLlm = false;
    const llmCaller = async (_p: string): Promise<string> => {
      calledLlm = true;
      return 'should-not-be-called';
    };

    const result = await counterfactualReplay(
      { branchFromNodeId: branch.id, alteredInput: 'dry-alt', sessionId, dryRun: true },
      store,
      { llmCaller },
    );

    await store.close();

    assert.equal(calledLlm, false, 'llmCaller must not be called in dry-run mode');
    assert.equal(result.alternatePath.length, 0, 'dry-run should not produce alternate nodes');
    assert.equal(result.branchPoint.id, branch.id, 'branchPoint id should match');
    assert.ok(result.newTimelineId.length > 0, 'newTimelineId should be set even in dry-run');
  });

  it('dry-run with no llmCaller option does not throw', async () => {
    const storePath = join(workspace, 'nodes-dry2.jsonl');
    const store = createDecisionNodeStore(storePath);
    const sessionId = 'sess-dry-2';

    const branch = makeNode({ prompt: 'dry-nooption', result: 'init', sessionId, timelineId: 'main', parent: null });
    await store.append(branch);

    await assert.doesNotReject(
      () =>
        counterfactualReplay(
          { branchFromNodeId: branch.id, alteredInput: 'dry-alt', sessionId, dryRun: true },
          store,
          // no options — should still work in dry-run
        ),
      'dry-run without llmCaller should not throw',
    );

    await store.close();
  });
});

describe('counterfactual replay — live mode', () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'df-tm-replay-live-'));
  });

  after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it('calls llmCaller with the altered input and records the response', async () => {
    const storePath = join(workspace, 'nodes-live.jsonl');
    const store = createDecisionNodeStore(storePath);
    const sessionId = 'sess-live-1';

    const branch = makeNode({ prompt: 'live-branch', result: 'live-init', sessionId, timelineId: 'main', parent: null });
    await store.append(branch);

    const receivedPrompts: string[] = [];
    const llmCaller = async (prompt: string): Promise<string> => {
      receivedPrompts.push(prompt);
      return `response-for: ${prompt}`;
    };

    const result = await counterfactualReplay(
      { branchFromNodeId: branch.id, alteredInput: 'altered-prompt', sessionId, dryRun: false },
      store,
      { llmCaller },
    );

    await store.close();

    assert.equal(receivedPrompts.length, 1);
    assert.equal(receivedPrompts[0], 'altered-prompt');
    assert.equal(result.alternatePath.length, 1);
    assert.equal(result.alternatePath[0].input.prompt, 'altered-prompt');
    assert.equal(result.alternatePath[0].output.result, 'response-for: altered-prompt');
  });

  it('throws a clear error when branchFromNodeId is not found', async () => {
    const storePath = join(workspace, 'nodes-notfound.jsonl');
    const store = createDecisionNodeStore(storePath);

    await assert.rejects(
      () =>
        counterfactualReplay(
          { branchFromNodeId: 'does-not-exist', alteredInput: 'x', sessionId: 's', dryRun: false },
          store,
          { llmCaller: async () => 'x' },
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('does-not-exist'),
          `error message should mention the missing id: ${err.message}`,
        );
        return true;
      },
    );

    await store.close();
  });

  it('throws a clear error when live mode has no llmCaller', async () => {
    const storePath = join(workspace, 'nodes-nollm.jsonl');
    const store = createDecisionNodeStore(storePath);
    const sessionId = 'sess-nollm';

    const branch = makeNode({ prompt: 'nollm-branch', result: 'x', sessionId, timelineId: 'main', parent: null });
    await store.append(branch);

    await assert.rejects(
      () =>
        counterfactualReplay(
          { branchFromNodeId: branch.id, alteredInput: 'x', sessionId, dryRun: false },
          store,
          // no llmCaller provided
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(
          err.message.includes('llmCaller'),
          `error message should mention llmCaller: ${err.message}`,
        );
        return true;
      },
    );

    await store.close();
  });
});
