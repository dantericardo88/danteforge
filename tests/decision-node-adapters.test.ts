/**
 * tests/decision-node-adapters.test.ts
 *
 * Tests for the Phase 4 ecosystem adapter interfaces in
 * src/core/decision-node-adapters.ts.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashDecisionNode } from '../src/core/decision-node.js';
import type { TraceEventLike } from '../src/core/decision-node.js';
import {
  fromDanteAgentsEvent,
  fromDanteCodeEvent,
  fromDanteHarvestEvent,
  fromDanteDojoEvent,
  fromScienceExperimentEvent,
  type DanteCodeEvent,
  type DanteHarvestEvent,
  type DanteDojoEvent,
  type ScienceExperimentEvent,
} from '../src/core/decision-node-adapters.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTraceEvent(overrides?: Partial<TraceEventLike>): TraceEventLike {
  return {
    id: 'trace-id-001',
    type: 'TOOL_CALL',
    timestamp: '2026-04-30T00:00:00.000Z',
    agentId: 'agent-alpha',
    data: { tool: 'forge', args: { wave: 1 } },
    parentId: null,
    hash: 'deadbeef01',
    prevHash: null,
    sessionId: 'session-trace-001',
    ...overrides,
  };
}

function makeDanteCodeEvent(overrides?: Partial<DanteCodeEvent>): DanteCodeEvent {
  return {
    requestId: 'req-code-001',
    sessionId: 'session-code-001',
    prompt: 'Implement a binary search function in TypeScript',
    response: 'export function binarySearch(arr: number[], target: number): number { return -1; }',
    language: 'typescript',
    filesPaths: ['src/utils/binary-search.ts'],
    gitCommitSha: 'abc123def456',
    success: true,
    costUsd: 0.002,
    latencyMs: 1200,
    timestamp: '2026-04-30T01:00:00.000Z',
    ...overrides,
  };
}

function makeDanteHarvestEvent(overrides?: Partial<DanteHarvestEvent>): DanteHarvestEvent {
  return {
    harvestId: 'harvest-001',
    sessionId: 'session-harvest-001',
    repoUrl: 'https://github.com/example/oss-repo',
    patternName: 'circuit-breaker',
    decision: 'adopt',
    reasoning: 'Circuit breaker pattern significantly improves resilience under load',
    patternsFound: 12,
    patternsAdopted: 3,
    costUsd: 0.005,
    timestamp: '2026-04-30T02:00:00.000Z',
    ...overrides,
  };
}

function makeDanteDojoEvent(overrides?: Partial<DanteDojoEvent>): DanteDojoEvent {
  return {
    runId: 'run-dojo-001',
    sessionId: 'session-dojo-001',
    checkpointStep: 5000,
    hyperparameters: { lr: 0.001, batch_size: 32, optimizer: 'adam' },
    metrics: { loss: 0.234, accuracy: 0.91 },
    checkpointPath: '/models/run-dojo-001/step-5000.ckpt',
    decision: 'continue training',
    success: true,
    timestamp: '2026-04-30T03:00:00.000Z',
    ...overrides,
  };
}

function makeScienceEvent(overrides?: Partial<ScienceExperimentEvent>): ScienceExperimentEvent {
  return {
    experimentId: 'exp-bio-001',
    sessionId: 'session-sci-001',
    domain: 'biochemistry',
    hypothesis: 'Does compound X inhibit enzyme Y at 10µM concentration?',
    parameters: { concentration: '10µM', temperature: '37°C', pH: 7.4 },
    outcome: { inhibition_pct: 78.3, ic50: '4.2µM', error: 2.1 },
    decision: 'advance compound X to in-vivo testing',
    success: true,
    timestamp: '2026-04-30T04:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidUuidV4(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function verifyNodeHash(node: ReturnType<typeof fromDanteCodeEvent>): boolean {
  const { hash, ...withoutHash } = node;
  const expected = hashDecisionNode(withoutHash);
  return hash === expected;
}

// ---------------------------------------------------------------------------
// 1. fromDanteAgentsEvent
// ---------------------------------------------------------------------------

describe('fromDanteAgentsEvent', () => {
  it('produces a valid DecisionNode with actor.product = danteagents', () => {
    const event = makeTraceEvent();
    const node = fromDanteAgentsEvent(event);

    assert.strictEqual(node.actor.product, 'danteagents');
    assert.strictEqual(node.actor.type, 'agent');
    assert.strictEqual(node.actor.id, 'agent-alpha');
    assert.strictEqual(node.id, 'trace-id-001');
    assert.strictEqual(node.sessionId, 'session-trace-001');
  });

  it('preserves the original TraceEvent hash (chain re-verification)', () => {
    const event = makeTraceEvent({ hash: 'original-hash-value', prevHash: 'previous-hash' });
    const node = fromDanteAgentsEvent(event);

    // fromTraceEvent preserves the original hash, not recomputes
    assert.strictEqual(node.hash, 'original-hash-value');
    assert.strictEqual(node.prevHash, 'previous-hash');
  });

  it('overlays qualityScore and costUsd from opts', () => {
    const event = makeTraceEvent();
    const node = fromDanteAgentsEvent(event, { qualityScore: 9.2, costUsd: 0.003 });

    assert.strictEqual(node.output.qualityScore, 9.2);
    assert.strictEqual(node.output.costUsd, 0.003);
  });

  it('maps fileStateRef from opts to output.fileStateRef', () => {
    const event = makeTraceEvent();
    const node = fromDanteAgentsEvent(event, { fileStateRef: 'git-sha-abc' });

    assert.strictEqual(node.output.fileStateRef, 'git-sha-abc');
  });

  it('timelineId defaults to main', () => {
    const node = fromDanteAgentsEvent(makeTraceEvent());
    assert.strictEqual(node.timelineId, 'main');
  });
});

// ---------------------------------------------------------------------------
// 2. fromDanteCodeEvent
// ---------------------------------------------------------------------------

describe('fromDanteCodeEvent', () => {
  it('produces a valid DecisionNode with actor.product = dantecode', () => {
    const node = fromDanteCodeEvent(makeDanteCodeEvent());

    assert.strictEqual(node.actor.product, 'dantecode');
    assert.strictEqual(node.actor.type, 'agent');
    assert.strictEqual(node.actor.id, 'req-code-001');
  });

  it('maps gitCommitSha to output.fileStateRef', () => {
    const node = fromDanteCodeEvent(makeDanteCodeEvent({ gitCommitSha: 'abc123def456' }));
    assert.strictEqual(node.output.fileStateRef, 'abc123def456');
  });

  it('omits fileStateRef when gitCommitSha is absent', () => {
    const event = makeDanteCodeEvent();
    delete (event as Partial<DanteCodeEvent>).gitCommitSha;
    const node = fromDanteCodeEvent(event);
    assert.strictEqual(node.output.fileStateRef, undefined);
  });

  it('maps prompt field to input.prompt', () => {
    const node = fromDanteCodeEvent(makeDanteCodeEvent());
    assert.strictEqual(node.input.prompt, 'Implement a binary search function in TypeScript');
  });

  it('maps language and filesPaths into input.context', () => {
    const node = fromDanteCodeEvent(makeDanteCodeEvent());
    const ctx = node.input.context as Record<string, unknown>;
    assert.strictEqual(ctx['language'], 'typescript');
    assert.deepStrictEqual(ctx['filesPaths'], ['src/utils/binary-search.ts']);
  });

  it('timelineId defaults to main, can be overridden', () => {
    const defaultNode = fromDanteCodeEvent(makeDanteCodeEvent());
    assert.strictEqual(defaultNode.timelineId, 'main');

    const branchNode = fromDanteCodeEvent(makeDanteCodeEvent(), 'branch-abc');
    assert.strictEqual(branchNode.timelineId, 'branch-abc');
  });

  it('produces a valid hash chain (hash matches node content)', () => {
    const node = fromDanteCodeEvent(makeDanteCodeEvent());
    assert.ok(verifyNodeHash(node), 'node hash does not match computed hash');
  });

  it('parentId is null (callers wire the chain)', () => {
    const node = fromDanteCodeEvent(makeDanteCodeEvent());
    assert.strictEqual(node.parentId, null);
    assert.strictEqual(node.prevHash, null);
  });
});

// ---------------------------------------------------------------------------
// 3. fromDanteHarvestEvent
// ---------------------------------------------------------------------------

describe('fromDanteHarvestEvent', () => {
  it('produces a valid DecisionNode with actor.product = danteharvest', () => {
    const node = fromDanteHarvestEvent(makeDanteHarvestEvent());

    assert.strictEqual(node.actor.product, 'danteharvest');
    assert.strictEqual(node.actor.type, 'agent');
    assert.strictEqual(node.actor.id, 'harvest-001');
  });

  it('maps adopt decision correctly — success=true', () => {
    const node = fromDanteHarvestEvent(makeDanteHarvestEvent({ decision: 'adopt' }));
    assert.strictEqual(node.output.success, true);
    const result = node.output.result as Record<string, unknown>;
    assert.strictEqual(result['decision'], 'adopt');
  });

  it('maps reject decision correctly — success=false', () => {
    const node = fromDanteHarvestEvent(makeDanteHarvestEvent({ decision: 'reject' }));
    assert.strictEqual(node.output.success, false);
    const result = node.output.result as Record<string, unknown>;
    assert.strictEqual(result['decision'], 'reject');
  });

  it('maps defer decision correctly — success=false', () => {
    const node = fromDanteHarvestEvent(makeDanteHarvestEvent({ decision: 'defer' }));
    assert.strictEqual(node.output.success, false);
  });

  it('maps reasoning to input.prompt', () => {
    const node = fromDanteHarvestEvent(makeDanteHarvestEvent());
    assert.ok(node.input.prompt.includes('Circuit breaker pattern'));
  });

  it('maps repoUrl and patternName into input.context', () => {
    const node = fromDanteHarvestEvent(makeDanteHarvestEvent());
    const ctx = node.input.context as Record<string, unknown>;
    assert.strictEqual(ctx['repoUrl'], 'https://github.com/example/oss-repo');
    assert.strictEqual(ctx['patternName'], 'circuit-breaker');
  });

  it('produces a valid hash chain', () => {
    const node = fromDanteHarvestEvent(makeDanteHarvestEvent());
    assert.ok(verifyNodeHash(node), 'harvest node hash does not match');
  });

  it('timelineId defaults to main', () => {
    const node = fromDanteHarvestEvent(makeDanteHarvestEvent());
    assert.strictEqual(node.timelineId, 'main');
  });
});

// ---------------------------------------------------------------------------
// 4. fromDanteDojoEvent
// ---------------------------------------------------------------------------

describe('fromDanteDojoEvent', () => {
  it('produces a valid DecisionNode with actor.product = dantedojo', () => {
    const node = fromDanteDojoEvent(makeDanteDojoEvent());

    assert.strictEqual(node.actor.product, 'dantedojo');
    assert.strictEqual(node.actor.type, 'model-training');
    assert.strictEqual(node.actor.id, 'run-dojo-001');
  });

  it('maps checkpointPath to output.fileStateRef', () => {
    const node = fromDanteDojoEvent(makeDanteDojoEvent());
    assert.strictEqual(node.output.fileStateRef, '/models/run-dojo-001/step-5000.ckpt');
  });

  it('maps decision string to input.prompt', () => {
    const node = fromDanteDojoEvent(makeDanteDojoEvent());
    assert.strictEqual(node.input.prompt, 'continue training');
  });

  it('maps hyperparameters and metrics into input.context', () => {
    const node = fromDanteDojoEvent(makeDanteDojoEvent());
    const ctx = node.input.context as Record<string, unknown>;
    assert.deepStrictEqual(ctx['hyperparameters'], { lr: 0.001, batch_size: 32, optimizer: 'adam' });
    assert.deepStrictEqual(ctx['metrics'], { loss: 0.234, accuracy: 0.91 });
  });

  it('produces a valid hash chain', () => {
    const node = fromDanteDojoEvent(makeDanteDojoEvent());
    assert.ok(verifyNodeHash(node), 'dojo node hash does not match');
  });

  it('timelineId defaults to main, can be overridden', () => {
    const defaultNode = fromDanteDojoEvent(makeDanteDojoEvent());
    assert.strictEqual(defaultNode.timelineId, 'main');

    const branchNode = fromDanteDojoEvent(makeDanteDojoEvent(), 'training-branch-7');
    assert.strictEqual(branchNode.timelineId, 'training-branch-7');
  });
});

// ---------------------------------------------------------------------------
// 5. fromScienceExperimentEvent
// ---------------------------------------------------------------------------

describe('fromScienceExperimentEvent', () => {
  it('produces a valid DecisionNode with actor.product = unknown', () => {
    const node = fromScienceExperimentEvent(makeScienceEvent());

    // Science adapter uses 'unknown' product since it spans many domains
    assert.strictEqual(node.actor.product, 'unknown');
    assert.strictEqual(node.actor.id, 'exp-bio-001');
  });

  it('maps hypothesis to input.prompt', () => {
    const node = fromScienceExperimentEvent(makeScienceEvent());
    assert.strictEqual(
      node.input.prompt,
      'Does compound X inhibit enzyme Y at 10µM concentration?',
    );
  });

  it('maps domain and parameters into input.context', () => {
    const node = fromScienceExperimentEvent(makeScienceEvent());
    const ctx = node.input.context as Record<string, unknown>;
    assert.strictEqual(ctx['domain'], 'biochemistry');
    assert.deepStrictEqual(ctx['parameters'], {
      concentration: '10µM',
      temperature: '37°C',
      pH: 7.4,
    });
  });

  it('maps outcome and decision into output.result', () => {
    const node = fromScienceExperimentEvent(makeScienceEvent());
    const result = node.output.result as Record<string, unknown>;
    const outcome = result['outcome'] as Record<string, unknown>;
    assert.strictEqual(outcome['inhibition_pct'], 78.3);
    assert.strictEqual(result['decision'], 'advance compound X to in-vivo testing');
  });

  it('maps success flag from experiment', () => {
    const successNode = fromScienceExperimentEvent(makeScienceEvent({ success: true }));
    assert.strictEqual(successNode.output.success, true);

    const failNode = fromScienceExperimentEvent(makeScienceEvent({ success: false }));
    assert.strictEqual(failNode.output.success, false);
  });

  it('produces a valid hash chain', () => {
    const node = fromScienceExperimentEvent(makeScienceEvent());
    assert.ok(verifyNodeHash(node), 'science node hash does not match');
  });

  it('timelineId defaults to main', () => {
    const node = fromScienceExperimentEvent(makeScienceEvent());
    assert.strictEqual(node.timelineId, 'main');
  });

  it('produces a UUID v4 id', () => {
    const node = fromScienceExperimentEvent(makeScienceEvent());
    assert.ok(isValidUuidV4(node.id), `Expected UUID v4, got: ${node.id}`);
  });

  it('supports non-standard domain strings', () => {
    const node = fromScienceExperimentEvent(
      makeScienceEvent({ domain: 'quantum-computing' }),
    );
    const ctx = node.input.context as Record<string, unknown>;
    assert.strictEqual(ctx['domain'], 'quantum-computing');
  });
});

// ---------------------------------------------------------------------------
// Cross-adapter: all adapters set parentId=null
// ---------------------------------------------------------------------------

describe('all adapters — parentId is null (callers wire chain)', () => {
  it('fromDanteCodeEvent parentId=null', () => {
    assert.strictEqual(fromDanteCodeEvent(makeDanteCodeEvent()).parentId, null);
  });
  it('fromDanteHarvestEvent parentId=null', () => {
    assert.strictEqual(fromDanteHarvestEvent(makeDanteHarvestEvent()).parentId, null);
  });
  it('fromDanteDojoEvent parentId=null', () => {
    assert.strictEqual(fromDanteDojoEvent(makeDanteDojoEvent()).parentId, null);
  });
  it('fromScienceExperimentEvent parentId=null', () => {
    assert.strictEqual(fromScienceExperimentEvent(makeScienceEvent()).parentId, null);
  });
});
