/**
 * tests/time-machine-causal-attribution.test.ts
 *
 * 10+ tests for the Time Machine causal attribution classifier.
 * Uses Node.js built-in test runner with no external dependencies.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyNodesHeuristic,
  classifyNodes,
  areNodesEquivalent,
  detectConvergence,
  type CausalAttributionResult,
} from '../src/core/time-machine-causal-attribution.js';
import type { DecisionNode } from '../src/core/decision-node.js';

// ---------------------------------------------------------------------------
// Minimal factory — keeps tests DRY
// ---------------------------------------------------------------------------

let _idCounter = 0;

function makeNode(overrides: Partial<DecisionNode> = {}): DecisionNode {
  _idCounter += 1;
  const id = overrides.id ?? `node-${_idCounter}`;
  return {
    id,
    parentId: null,
    sessionId: 'sess-test',
    timelineId: 'main',
    timestamp: '2026-04-30T00:00:00.000Z',
    actor: {
      type: 'agent',
      product: 'danteforge',
      id: 'agent-1',
    },
    input: {
      prompt: 'default prompt text',
    },
    output: {
      result: 'result text',
      success: true,
      costUsd: 0,
      latencyMs: 0,
    },
    hash: `hash-${id}`,
    prevHash: null,
    ...overrides,
  };
}

function makeBranchPoint(): DecisionNode {
  return makeNode({
    id: 'branch-point-id',
    input: { prompt: 'choose authentication strategy: oauth or session cookies' },
    output: {
      result: 'oauth selected as authentication strategy for security compliance',
      success: true,
      costUsd: 0,
      latencyMs: 0,
    },
  });
}

// ---------------------------------------------------------------------------
// T1: classifyNodesHeuristic — independent nodes (no keyword/structural link)
// ---------------------------------------------------------------------------

describe('classifyNodesHeuristic — independent nodes', () => {
  it('T1: node with no keyword overlap and no causal dependency is classified as independent', () => {
    const bp = makeBranchPoint();
    const independent = makeNode({
      input: { prompt: 'format database migration scripts for postgres' },
    });

    const result = classifyNodesHeuristic(bp, [independent], []);

    assert.equal(result.independentCount, 1, 'should count 1 independent node');
    assert.equal(result.adaptableCount, 0);
    assert.equal(result.incompatibleCount, 0);
    assert.equal(result.originalNodes[0]?.classification, 'independent');
  });

  it('T2: node at same position in both timelines with similar prompts is independent', () => {
    const bp = makeBranchPoint();
    const sharedPrompt = 'compile typescript source and emit declaration files';
    const orig = makeNode({ input: { prompt: sharedPrompt } });
    const alt = makeNode({ input: { prompt: sharedPrompt } });

    const result = classifyNodesHeuristic(bp, [orig], [alt]);

    assert.equal(result.originalNodes[0]?.classification, 'independent');
    assert.equal(result.independentCount, 1);
  });
});

// ---------------------------------------------------------------------------
// T3: classifyNodesHeuristic — dependent nodes via causal.dependentOn
// ---------------------------------------------------------------------------

describe('classifyNodesHeuristic — dependent nodes', () => {
  it('T3: node with causal.dependentOn referencing branchPoint is classified as dependent', () => {
    const bp = makeBranchPoint();
    const dep = makeNode({
      input: { prompt: 'configure redirect URI for provider integration' },
      causal: { dependentOn: [bp.id] },
    });

    // No equivalent in alternate timeline → incompatible
    const result = classifyNodesHeuristic(bp, [dep], []);

    assert.notEqual(result.originalNodes[0]?.classification, 'independent');
    assert.equal(result.originalNodes[0]?.classification, 'dependent-incompatible');
    assert.equal(result.incompatibleCount, 1);
  });

  it('T4: node with causal.dependentOn AND matching alternate node → dependent-adaptable', () => {
    const bp = makeBranchPoint();
    const dep = makeNode({
      input: { prompt: 'configure redirect URI for provider integration' },
      causal: { dependentOn: [bp.id] },
    });
    const altEquivalent = makeNode({
      actor: { type: 'agent', product: 'danteforge', id: 'agent-2' },
      input: { prompt: 'configure redirect URI for provider integration setup' },
      output: { result: 'done', success: true, costUsd: 0, latencyMs: 0 },
    });

    const result = classifyNodesHeuristic(bp, [dep], [altEquivalent]);

    assert.equal(result.originalNodes[0]?.classification, 'dependent-adaptable');
    assert.equal(result.adaptableCount, 1);
    assert.ok(result.originalNodes[0]?.adaptedEquivalent !== undefined, 'should have adaptedEquivalent');
  });

  it('T5: node with >30% keyword overlap with branch point output is dependent', () => {
    const bp = makeBranchPoint();
    // Shares "oauth", "authentication", "strategy" with branch point
    const dep = makeNode({
      input: { prompt: 'oauth authentication strategy token validation endpoint' },
    });

    const result = classifyNodesHeuristic(bp, [dep], []);

    assert.notEqual(result.originalNodes[0]?.classification, 'independent',
      'high keyword overlap should be dependent');
    assert.ok(result.incompatibleCount + result.adaptableCount >= 1);
  });
});

// ---------------------------------------------------------------------------
// T6: detectConvergence — converged timelines
// ---------------------------------------------------------------------------

describe('detectConvergence', () => {
  it('T6: returns converged=true when final output.result is JSON-equal', () => {
    const origEnd = makeNode({ output: { result: { status: 'deployed' }, success: true, costUsd: 0, latencyMs: 0 } });
    const altEnd = makeNode({ output: { result: { status: 'deployed' }, success: true, costUsd: 0, latencyMs: 0 } });

    const { converged } = detectConvergence([origEnd], [altEnd]);
    assert.equal(converged, true);
  });

  it('T7: returns converged=true when final prompts share >60% keywords', () => {
    const sharedWords = 'verify deployment health checks passing endpoint ready';
    const origEnd = makeNode({ input: { prompt: sharedWords } });
    const altEnd = makeNode({ input: { prompt: sharedWords + ' confirmed' } });

    const { converged } = detectConvergence([origEnd], [altEnd]);
    assert.equal(converged, true);
  });

  it('T8: returns converged=false for clearly divergent timelines', () => {
    const origEnd = makeNode({
      input: { prompt: 'deploy to kubernetes cluster with oauth service mesh' },
      output: { result: 'kubernetes-deployed', success: true, costUsd: 0, latencyMs: 0 },
    });
    const altEnd = makeNode({
      input: { prompt: 'ship docker image to heroku dynos with session cookies' },
      output: { result: 'heroku-deployed', success: true, costUsd: 0, latencyMs: 0 },
    });

    const { converged } = detectConvergence([origEnd], [altEnd]);
    assert.equal(converged, false);
  });

  it('T9: returns converged=false for empty timelines', () => {
    const { converged } = detectConvergence([], []);
    assert.equal(converged, false);
  });

  it('T10: convergenceIndex is defined when timelines converge', () => {
    const sharedResult = { outcome: 'success' };
    const orig = [
      makeNode({ input: { prompt: 'step 1 different' } }),
      makeNode({ output: { result: sharedResult, success: true, costUsd: 0, latencyMs: 0 } }),
    ];
    const alt = [
      makeNode({ input: { prompt: 'step 1 also different' } }),
      makeNode({ output: { result: sharedResult, success: true, costUsd: 0, latencyMs: 0 } }),
    ];

    const { converged, convergenceIndex } = detectConvergence(orig, alt);
    assert.equal(converged, true);
    assert.ok(convergenceIndex !== undefined, 'convergenceIndex should be set');
  });
});

// ---------------------------------------------------------------------------
// T11–T12: areNodesEquivalent
// ---------------------------------------------------------------------------

describe('areNodesEquivalent', () => {
  it('T11: matches nodes with same actor and high prompt similarity', () => {
    const a = makeNode({
      actor: { type: 'agent', product: 'danteforge', id: 'a1' },
      input: { prompt: 'configure rate limiting middleware for api gateway' },
      output: { result: 'done', success: true, costUsd: 0, latencyMs: 0 },
    });
    const b = makeNode({
      actor: { type: 'agent', product: 'danteforge', id: 'b1' },
      input: { prompt: 'configure rate limiting middleware for api gateway setup' },
      output: { result: 'configured', success: true, costUsd: 0, latencyMs: 0 },
    });

    assert.equal(areNodesEquivalent(a, b), true);
  });

  it('T12: rejects nodes with different actor type', () => {
    const a = makeNode({
      actor: { type: 'human', product: 'danteforge', id: 'h1' },
      input: { prompt: 'configure caching layer for database queries' },
    });
    const b = makeNode({
      actor: { type: 'agent', product: 'danteforge', id: 'a1' },
      input: { prompt: 'configure caching layer for database queries' },
    });

    assert.equal(areNodesEquivalent(a, b), false);
  });

  it('T13: rejects nodes with different actor product', () => {
    const a = makeNode({
      actor: { type: 'agent', product: 'danteforge', id: 'a1' },
      input: { prompt: 'run integration test suite' },
    });
    const b = makeNode({
      actor: { type: 'agent', product: 'danteagents', id: 'a2' },
      input: { prompt: 'run integration test suite' },
    });

    assert.equal(areNodesEquivalent(a, b), false);
  });

  it('T14: rejects nodes with different success status', () => {
    const a = makeNode({
      actor: { type: 'agent', product: 'danteforge', id: 'a1' },
      input: { prompt: 'deploy service to production environment' },
      output: { result: 'ok', success: true, costUsd: 0, latencyMs: 0 },
    });
    const b = makeNode({
      actor: { type: 'agent', product: 'danteforge', id: 'a2' },
      input: { prompt: 'deploy service to production environment' },
      output: { result: 'error', success: false, costUsd: 0, latencyMs: 0 },
    });

    assert.equal(areNodesEquivalent(a, b), false);
  });

  it('T15: rejects nodes with low prompt similarity', () => {
    const a = makeNode({ input: { prompt: 'provision mongodb replica set cluster' } });
    const b = makeNode({ input: { prompt: 'generate pdf invoice for customer billing' } });

    assert.equal(areNodesEquivalent(a, b), false);
  });
});

// ---------------------------------------------------------------------------
// T16: Full CausalAttributionResult shape and counts
// ---------------------------------------------------------------------------

describe('classifyNodesHeuristic — full result shape', () => {
  it('T16: result has correct counts and human-readable summary', () => {
    const bp = makeBranchPoint();

    const indep1 = makeNode({ input: { prompt: 'run lint checks on typescript source files' } });
    const indep2 = makeNode({ input: { prompt: 'update package json version number' } });
    const depWithMatch = makeNode({
      input: { prompt: 'configure redirect URI for provider integration' },
      causal: { dependentOn: [bp.id] },
    });
    const altEquiv = makeNode({
      actor: { type: 'agent', product: 'danteforge', id: 'alt-agent' },
      input: { prompt: 'configure redirect URI for provider integration setup' },
      output: { result: 'done', success: true, costUsd: 0, latencyMs: 0 },
    });
    const depNoMatch = makeNode({
      input: { prompt: 'oauth session token refresh flow implementation' },
      causal: { dependentOn: [bp.id] },
    });

    const result: CausalAttributionResult = classifyNodesHeuristic(
      bp,
      [indep1, indep2, depWithMatch, depNoMatch],
      [altEquiv],
    );

    assert.equal(result.branchPointId, bp.id);
    assert.equal(result.independentCount, 2, 'two independent nodes');
    assert.equal(result.adaptableCount, 1, 'one adaptable node');
    assert.equal(result.incompatibleCount, 1, 'one incompatible node');
    assert.equal(result.originalNodes.length, 4, 'four original nodes attributed');
    assert.ok(typeof result.summary === 'string' && result.summary.length > 20,
      'summary should be a non-trivial string');
    assert.ok(result.summary.includes(bp.id), 'summary should mention branch point id');
  });
});

// ---------------------------------------------------------------------------
// T17: converged flag wired into classifyNodesHeuristic result
// ---------------------------------------------------------------------------

describe('classifyNodesHeuristic — converged flag', () => {
  it('T17: converged=true when timelines end with same result', () => {
    const bp = makeBranchPoint();
    const sharedResult = { status: 'all systems go' };
    const origEnd = makeNode({ output: { result: sharedResult, success: true, costUsd: 0, latencyMs: 0 } });
    const altEnd = makeNode({ output: { result: sharedResult, success: true, costUsd: 0, latencyMs: 0 } });

    const result = classifyNodesHeuristic(bp, [origEnd], [altEnd]);
    assert.equal(result.converged, true);
    assert.ok(result.convergenceNodeId !== undefined);
  });

  it('T18: converged=false when timelines diverge', () => {
    const bp = makeBranchPoint();
    const orig = makeNode({
      input: { prompt: 'write unit tests for oauth service' },
      output: { result: 'tests-written-oauth', success: true, costUsd: 0, latencyMs: 0 },
    });
    const alt = makeNode({
      input: { prompt: 'write integration tests for session middleware' },
      output: { result: 'tests-written-session', success: true, costUsd: 0, latencyMs: 0 },
    });

    const result = classifyNodesHeuristic(bp, [orig], [alt]);
    assert.equal(result.converged, false);
    assert.equal(result.convergenceNodeId, undefined);
  });
});

// ---------------------------------------------------------------------------
// T19: classifyNodes async path — LLM call refines incompatible to adaptable
// ---------------------------------------------------------------------------

describe('classifyNodes (async, LLM path)', () => {
  it('T19: LLM can upgrade dependent-incompatible to dependent-adaptable', async () => {
    const bp = makeBranchPoint();
    // Use a keyword-overlap dependent node (not structural causal.dependentOn) so
    // heuristic assigns confidence 0.7, which is below the 0.8 LLM-escalation threshold.
    const dep = makeNode({
      // Shares "oauth", "authentication", "strategy" with branch point → keyword-overlap dependent
      input: { prompt: 'oauth authentication strategy token validation endpoint' },
      // No causal.dependentOn — relies on keyword overlap detection only
    });

    // Verify heuristic gives dependent-incompatible with confidence < 0.8 so LLM is invoked
    const heuristic = classifyNodesHeuristic(bp, [dep], []);
    assert.notEqual(heuristic.originalNodes[0]?.classification, 'independent',
      'pre-condition: node must be dependent');
    assert.ok((heuristic.originalNodes[0]?.confidence ?? 1) < 0.8,
      'pre-condition: confidence must be < 0.8 for LLM escalation');

    // LLM says this is actually adaptable
    const fakeLlm = async (_prompt: string): Promise<string> => 'dependent-adaptable';

    const result = await classifyNodes(bp, [dep], [], { llmCaller: fakeLlm });

    assert.equal(result.originalNodes[0]?.classification, 'dependent-adaptable');
    assert.equal(result.adaptableCount, 1);
    assert.equal(result.incompatibleCount, 0);
    assert.ok(
      result.originalNodes[0]?.reasoning.includes('LLM agreed'),
      'reasoning should reflect LLM input',
    );
  });

  it('T20: LLM error falls back to heuristic result gracefully', async () => {
    const bp = makeBranchPoint();
    const dep = makeNode({
      input: { prompt: 'configure redirect URI for provider integration' },
      causal: { dependentOn: [bp.id] },
    });

    const failingLlm = async (_prompt: string): Promise<string> => {
      throw new Error('LLM unavailable');
    };

    const result = await classifyNodes(bp, [dep], [], { llmCaller: failingLlm });

    // Should fall back to heuristic (incompatible since no alternate equivalent)
    assert.equal(result.originalNodes[0]?.classification, 'dependent-incompatible');
  });

  it('T21: without llmCaller, classifyNodes returns same as heuristic', async () => {
    const bp = makeBranchPoint();
    const indep = makeNode({ input: { prompt: 'run linting checks on code' } });

    const asyncResult = await classifyNodes(bp, [indep], []);
    const syncResult = classifyNodesHeuristic(bp, [indep], []);

    assert.equal(asyncResult.independentCount, syncResult.independentCount);
    assert.equal(asyncResult.adaptableCount, syncResult.adaptableCount);
    assert.equal(asyncResult.incompatibleCount, syncResult.incompatibleCount);
    assert.equal(asyncResult.converged, syncResult.converged);
  });
});
