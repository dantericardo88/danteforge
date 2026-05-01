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

  it('throws a clear error when live mode has neither llmCaller nor pipelineCaller', async () => {
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
          // no llmCaller or pipelineCaller provided
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

  it('pipelineCaller path: calls pipelineCaller with altered input and records all returned nodes', async () => {
    const storePath = join(workspace, 'nodes-pipeline.jsonl');
    const store = createDecisionNodeStore(storePath);
    const sessionId = 'sess-pipeline-1';

    const branch = makeNode({ prompt: 'pipeline-branch', result: 'init', sessionId, timelineId: 'main', parent: null });
    await store.append(branch);

    const receivedInputs: string[] = [];
    const receivedTimelineIds: string[] = [];
    const pipelineCaller = async (input: string, context: { timelineId: string }) => {
      receivedInputs.push(input);
      receivedTimelineIds.push(context.timelineId);
      const n1 = makeNode({ prompt: `step-1: ${input}`, result: 'step1-out', sessionId, timelineId: 'pipeline', parent: branch });
      const n2 = makeNode({ prompt: `step-2: ${input}`, result: 'step2-out', sessionId, timelineId: 'pipeline', parent: n1 });
      return { nodes: [n1, n2], costUsd: 0.02 };
    };

    const result = await counterfactualReplay(
      { branchFromNodeId: branch.id, alteredInput: 'pipeline-input', sessionId, dryRun: false },
      store,
      { pipelineCaller },
    );

    await store.close();

    assert.equal(receivedInputs.length, 1, 'pipelineCaller called once');
    assert.equal(receivedInputs[0], 'pipeline-input', 'pipelineCaller receives altered input');
    assert.equal(receivedTimelineIds[0], result.newTimelineId, 'pipelineCaller receives alternate timeline id');
    assert.equal(result.alternatePath.length, 2, 'two alternate nodes from pipeline');
    assert.equal(result.costUsd, 0.02, 'costUsd comes from pipeline result');
    assert.notEqual(result.newTimelineId, branch.timelineId, 'new timeline ID is distinct');
    assert.equal(result.alternatePath[0].timelineId, result.newTimelineId, 'nodes are rebranded with new timeline');
    assert.equal(result.alternatePath[0].input.prompt, 'step-1: pipeline-input');
  });

  it('pipelineCaller path: rebranded nodes are persisted to the store', async () => {
    const storePath = join(workspace, 'nodes-pipeline2.jsonl');
    const store = createDecisionNodeStore(storePath);
    const sessionId = 'sess-pipeline-2';

    const branch = makeNode({ prompt: 'pipeline-branch2', result: 'init', sessionId, timelineId: 'main2', parent: null });
    await store.append(branch);

    const pipelineCaller = async (input: string) => {
      const n = makeNode({ prompt: `step: ${input}`, result: 'out', sessionId, timelineId: 'ignored', parent: branch });
      return { nodes: [n], costUsd: 0 };
    };

    const result = await counterfactualReplay(
      { branchFromNodeId: branch.id, alteredInput: 'pipeline-input2', sessionId, dryRun: false },
      store,
      { pipelineCaller },
    );

    // Re-open store and verify the rebranded node was written
    const readStore = createDecisionNodeStore(storePath);
    const readBack = await readStore.getById(result.alternatePath[0].id);
    await readStore.close();
    await store.close();

    assert.ok(readBack, 'rebranded node should be persisted to store');
    assert.equal(readBack.timelineId, result.newTimelineId, 'persisted node has correct timeline ID');
  });

  it('pipelineCaller preferred over llmCaller when both provided', async () => {
    const storePath = join(workspace, 'nodes-prefer-pipeline.jsonl');
    const store = createDecisionNodeStore(storePath);
    const sessionId = 'sess-prefer';

    const branch = makeNode({ prompt: 'prefer-branch', result: 'init', sessionId, timelineId: 'main', parent: null });
    await store.append(branch);

    let llmCalled = false;
    let pipelineCalled = false;

    const llmCaller = async (_p: string) => { llmCalled = true; return 'llm-response'; };
    const pipelineCaller = async (input: string) => {
      pipelineCalled = true;
      const n = makeNode({ prompt: `pipe: ${input}`, result: 'pipe-out', sessionId, timelineId: 'alt', parent: branch });
      return { nodes: [n], costUsd: 0 };
    };

    await counterfactualReplay(
      { branchFromNodeId: branch.id, alteredInput: 'prefer-input', sessionId, dryRun: false },
      store,
      { llmCaller, pipelineCaller },
    );

    await store.close();

    assert.equal(pipelineCalled, true, 'pipelineCaller should be used');
    assert.equal(llmCalled, false, 'llmCaller should not be called when pipelineCaller is present');
  });

  it('pipelineCaller path: uses caller-provided timeline id when supplied', async () => {
    const storePath = join(workspace, 'nodes-fixed-timeline.jsonl');
    const store = createDecisionNodeStore(storePath);
    const sessionId = 'sess-fixed-timeline';

    const branch = makeNode({ prompt: 'fixed-branch', result: 'init', sessionId, timelineId: 'main', parent: null });
    await store.append(branch);

    const result = await counterfactualReplay(
      {
        branchFromNodeId: branch.id,
        alteredInput: 'fixed-input',
        sessionId,
        dryRun: false,
        newTimelineId: 'tm-fixed-timeline',
      },
      store,
      {
        pipelineCaller: async (_input, context) => ({
          nodes: [
            makeNode({
              prompt: 'fixed pipeline step',
              result: 'done',
              sessionId,
              timelineId: context.timelineId,
              parent: branch,
            }),
          ],
          costUsd: 0.01,
        }),
      },
    );

    await store.close();

    assert.equal(result.newTimelineId, 'tm-fixed-timeline');
    assert.equal(result.alternatePath[0].timelineId, 'tm-fixed-timeline');
  });

  it('pipelineCaller path: does not duplicate already-recorded alternate timeline nodes', async () => {
    const storePath = join(workspace, 'nodes-persisted-pipeline.jsonl');
    const store = createDecisionNodeStore(storePath);
    const sessionId = 'sess-persisted-pipeline';

    const branch = makeNode({ prompt: 'persisted-branch', result: 'init', sessionId, timelineId: 'main', parent: null });
    await store.append(branch);

    const result = await counterfactualReplay(
      {
        branchFromNodeId: branch.id,
        alteredInput: 'persisted-input',
        sessionId,
        dryRun: false,
        newTimelineId: 'persisted-alt',
      },
      store,
      {
        pipelineCaller: async (_input, context) => {
          const alreadyRecorded = makeNode({
            prompt: 'already recorded by child process',
            result: 'ok',
            sessionId: context.sessionId,
            timelineId: context.timelineId,
            parent: branch,
          });
          await store.append(alreadyRecorded);
          return { nodes: [alreadyRecorded], costUsd: 0.03, nodesAlreadyRecorded: true };
        },
      },
    );

    const readBack = await store.getByTimeline('persisted-alt');
    await store.close();

    assert.equal(result.alternatePath.length, 1);
    assert.equal(readBack.length, 1, 'already-recorded node should not be duplicated');
    assert.equal(readBack[0].id, result.alternatePath[0].id);
  });
});
