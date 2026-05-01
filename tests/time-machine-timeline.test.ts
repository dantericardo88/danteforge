import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderAsciiTimeline } from '../src/core/time-machine-timeline.js';
import { createDecisionNode } from '../src/core/decision-node.js';
import type { CounterfactualReplayResult } from '../src/core/time-machine-replay.js';

function makeResult(overrides?: Partial<CounterfactualReplayResult>): CounterfactualReplayResult {
  const branchPoint = createDecisionNode({
    parentNode: null,
    sessionId: 's1',
    timelineId: 'orig',
    actor: { type: 'agent', id: 'test', product: 'danteforge' },
    input: { prompt: 'initial decision' },
    output: { result: 'ok', success: true, costUsd: 0, latencyMs: 0 },
  });
  const origNode = createDecisionNode({
    parentNode: branchPoint,
    sessionId: 's1',
    timelineId: 'orig',
    actor: { type: 'agent', id: 'test', product: 'danteforge' },
    input: { prompt: 'original step' },
    output: { result: 'orig-out', success: true, costUsd: 0, latencyMs: 0 },
  });
  const altNode = createDecisionNode({
    parentNode: branchPoint,
    sessionId: 's1',
    timelineId: 'alt',
    actor: { type: 'agent', id: 'test', product: 'danteforge' },
    input: { prompt: 'alternate step' },
    output: { result: 'alt-out', success: true, costUsd: 0, latencyMs: 0 },
  });
  return {
    originalTimelineId: 'orig',
    newTimelineId: 'alt',
    branchPoint,
    originalPath: [origNode],
    alternatePath: [altNode],
    divergence: { convergent: [], divergent: [altNode], unreachable: [origNode] },
    outcomeEquivalent: false,
    causalChain: [],
    costUsd: 0,
    durationMs: 100,
    ...overrides,
  };
}

describe('renderAsciiTimeline', () => {
  it('contains BRANCH POINT header', () => {
    const result = makeResult();
    const output = renderAsciiTimeline(result);
    assert.ok(output.includes('BRANCH POINT'), `Expected 'BRANCH POINT' in output:\n${output}`);
  });

  it('shows convergent node with ≡ marker', () => {
    const branchPoint = createDecisionNode({
      parentNode: null,
      sessionId: 's1',
      timelineId: 'orig',
      actor: { type: 'agent', id: 'test', product: 'danteforge' },
      input: { prompt: 'initial decision' },
      output: { result: 'ok', success: true, costUsd: 0, latencyMs: 0 },
    });
    const sharedNode = createDecisionNode({
      parentNode: branchPoint,
      sessionId: 's1',
      timelineId: 'orig',
      actor: { type: 'agent', id: 'test', product: 'danteforge' },
      input: { prompt: 'shared step' },
      output: { result: 'shared', success: true, costUsd: 0, latencyMs: 0 },
    });
    const result = makeResult({
      divergence: { convergent: [sharedNode], divergent: [], unreachable: [] },
    });
    const output = renderAsciiTimeline(result);
    assert.ok(output.includes('≡'), `Expected '≡' marker in output:\n${output}`);
  });

  it('shows divergent node with ↻ marker', () => {
    const result = makeResult();
    const output = renderAsciiTimeline(result);
    assert.ok(output.includes('↻'), `Expected '↻' marker in output:\n${output}`);
  });

  it('shows unreachable node with ✗ marker', () => {
    const result = makeResult();
    const output = renderAsciiTimeline(result);
    assert.ok(output.includes('✗'), `Expected '✗' marker in output:\n${output}`);
  });

  it('outcome-equivalent result shows YES banner', () => {
    const result = makeResult({ outcomeEquivalent: true });
    const output = renderAsciiTimeline(result);
    assert.ok(output.includes('YES'), `Expected 'YES' in output:\n${output}`);
  });

  it('outcome-inequivalent result shows NO banner', () => {
    const result = makeResult({ outcomeEquivalent: false });
    const output = renderAsciiTimeline(result);
    assert.ok(output.includes('NO'), `Expected 'NO' in output:\n${output}`);
  });
});
