import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DecisionNode } from '../src/core/decision-node.js';
import {
  evaluateAttributionLabels,
  writeAttributionEvaluationReport,
} from '../src/core/time-machine-attribution-eval.js';

let idCounter = 0;

function node(overrides: Partial<DecisionNode> = {}): DecisionNode {
  idCounter += 1;
  const id = overrides.id ?? `node-${idCounter}`;
  return {
    id,
    parentId: null,
    sessionId: 'session-a',
    timelineId: 'main',
    timestamp: '2026-04-30T00:00:00.000Z',
    actor: { type: 'agent', id: 'agent', product: 'danteforge' },
    input: { prompt: 'default prompt' },
    output: { result: 'default result', success: true, costUsd: 0, latencyMs: 0 },
    hash: `hash-${id}`,
    prevHash: null,
    ...overrides,
  };
}

describe('time-machine attribution evaluator', () => {
  it('computes precision, recall, and false-independent rate from labels', () => {
    const branchPoint = node({
      id: 'branch',
      input: { prompt: 'choose oauth authentication strategy' },
      output: { result: 'oauth authentication selected', success: true, costUsd: 0, latencyMs: 0 },
    });
    const dependent = node({
      id: 'dep',
      input: { prompt: 'oauth authentication token middleware' },
      causal: { dependentOn: [branchPoint.id] },
    });
    const independent = node({
      id: 'ind',
      input: { prompt: 'format postgres migration files' },
    });

    const report = evaluateAttributionLabels({
      branchPoint,
      originalTimeline: [dependent, independent],
      alternateTimeline: [],
      labels: [
        { nodeId: dependent.id, expected: 'dependent-incompatible' },
        { nodeId: independent.id, expected: 'independent' },
      ],
      now: () => '2026-04-30T00:00:00.000Z',
    });

    assert.equal(report.labelCount, 2);
    assert.equal(report.precision, 1);
    assert.equal(report.recall, 1);
    assert.equal(report.falseIndependentRate, 0);
    assert.equal(report.passed, true);
  });

  it('fails when a dependent label is predicted independent', () => {
    const branchPoint = node({
      id: 'branch-2',
      input: { prompt: 'choose cache provider' },
      output: { result: 'redis selected', success: true, costUsd: 0, latencyMs: 0 },
    });
    const mislabeled = node({
      id: 'mislabeled',
      input: { prompt: 'format readme headings' },
    });

    const report = evaluateAttributionLabels({
      branchPoint,
      originalTimeline: [mislabeled],
      alternateTimeline: [],
      labels: [{ nodeId: mislabeled.id, expected: 'dependent-incompatible' }],
    });

    assert.equal(report.recall, 0);
    assert.equal(report.falseIndependentRate, 1);
    assert.equal(report.passed, false);
  });

  it('writes a report artifact', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'tm-attribution-eval-'));
    try {
      const branchPoint = node({ id: 'branch-3' });
      const child = node({
        id: 'child-3',
        causal: { dependentOn: [branchPoint.id] },
      });
      const report = evaluateAttributionLabels({
        branchPoint,
        originalTimeline: [child],
        alternateTimeline: [],
        labels: [{ nodeId: child.id, expected: 'dependent-incompatible' }],
      });
      const outFile = join(workspace, 'report.json');
      await writeAttributionEvaluationReport(outFile, report);
      const parsed = JSON.parse(await readFile(outFile, 'utf-8'));
      assert.equal(parsed.branchPointId, 'branch-3');
      assert.equal(parsed.labelCount, 1);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
