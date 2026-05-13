/**
 * agent-activity-provenance.test.ts
 *
 * Covers the re_gent-pattern surfaces added to close the Agent Activity
 * Provenance & Time Travel gap:
 *
 *  - Chain-of-custody integrity verifier
 *  - Provenance coverage metrics
 *  - Per-agent activity log
 *  - Deterministic replay verifier
 *  - Merkle root over activity slices
 *  - New store query APIs (getByActor, getByFileStateRef, getChildren, reload, size)
 *  - ASCII activity table renderer
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createDecisionNode,
  createDecisionNodeStore,
  type DecisionNode,
  type DecisionNodeStore,
} from '../src/core/decision-node.js';
import {
  buildAgentActivityLog,
  collectAllNodes,
  computeAgentActivityMerkleRoot,
  computeProvenanceCoverage,
  renderAgentActivityTable,
  verifyChainOfCustody,
  verifyDecisionNode,
  verifyReplayDeterminism,
} from '../src/core/time-machine-timeline.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ChainBuilderOptions {
  sessionId?: string;
  actor?: DecisionNode['actor'];
  count: number;
  withFileStateRef?: boolean;
  withEvidenceRef?: boolean;
  withContext?: boolean;
  withObservability?: boolean;
  withCausal?: boolean;
}

function buildChain(opts: ChainBuilderOptions): DecisionNode[] {
  const sessionId = opts.sessionId ?? 'session-test';
  const actor = opts.actor ?? { type: 'agent', id: 'pm', product: 'danteforge' };
  const out: DecisionNode[] = [];
  let parent: DecisionNode | null = null;
  for (let i = 0; i < opts.count; i++) {
    const node = createDecisionNode({
      parentNode: parent,
      sessionId,
      timelineId: 'main',
      actor,
      input: {
        prompt: `step ${i}`,
        ...(opts.withContext ? { context: { stepIndex: i } } : {}),
      },
      output: {
        result: `out-${i}`,
        success: i % 5 !== 4, // ~80% success
        costUsd: opts.withObservability ? 0.001 : 0,
        latencyMs: opts.withObservability ? 50 + i : 0,
        ...(opts.withFileStateRef ? { fileStateRef: `tm_commit_${i}` } : {}),
      },
      ...(opts.withEvidenceRef ? { evidenceRef: `sha256:${i}` } : {}),
      ...(parent && opts.withCausal
        ? { causal: { dependentOn: [parent.id], classification: 'independent' as const } }
        : {}),
    });
    out.push(node);
    parent = node;
  }
  return out;
}

async function makeStore(): Promise<{ store: DecisionNodeStore; tmpDir: string; storePath: string }> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-prov-test-'));
  const storePath = path.join(tmpDir, 'decision-nodes.jsonl');
  const store = createDecisionNodeStore(storePath);
  return { store, tmpDir, storePath };
}

async function writeChain(store: DecisionNodeStore, chain: DecisionNode[]): Promise<void> {
  for (const node of chain) await store.append(node);
}

// ---------------------------------------------------------------------------
// New store query APIs
// ---------------------------------------------------------------------------

describe('DecisionNodeStore — new query APIs', () => {
  let tmpDir: string;
  let store: DecisionNodeStore;

  before(async () => {
    const setup = await makeStore();
    tmpDir = setup.tmpDir;
    store = setup.store;

    const pmChain = buildChain({ sessionId: 's1', actor: { type: 'agent', id: 'pm', product: 'danteforge' }, count: 4, withFileStateRef: true });
    const devChain = buildChain({ sessionId: 's1', actor: { type: 'agent', id: 'dev', product: 'danteforge' }, count: 3 });
    const humanChain = buildChain({ sessionId: 's2', actor: { type: 'human', id: 'pm', product: 'danteforge' }, count: 2 });
    await writeChain(store, pmChain);
    await writeChain(store, devChain);
    await writeChain(store, humanChain);
  });

  after(async () => {
    await store.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('getByActor returns nodes for a specific actor.id', async () => {
    const pmAgentNodes = await store.getByActor('pm', 'agent');
    assert.equal(pmAgentNodes.length, 4);
    assert.ok(pmAgentNodes.every(n => n.actor.id === 'pm' && n.actor.type === 'agent'));
  });

  it('getByActor distinguishes actor types (agent vs human with same id)', async () => {
    const pmHumanNodes = await store.getByActor('pm', 'human');
    assert.equal(pmHumanNodes.length, 2);
    assert.ok(pmHumanNodes.every(n => n.actor.type === 'human'));

    const pmAll = await store.getByActor('pm');
    assert.equal(pmAll.length, 6);
  });

  it('getByActor returns sorted by timestamp ascending', async () => {
    const pmNodes = await store.getByActor('pm', 'agent');
    for (let i = 1; i < pmNodes.length; i++) {
      assert.ok(pmNodes[i - 1]!.timestamp <= pmNodes[i]!.timestamp);
    }
  });

  it('getByFileStateRef returns only nodes with matching fileStateRef', async () => {
    const nodes = await store.getByFileStateRef('tm_commit_2');
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0]!.output.fileStateRef, 'tm_commit_2');
  });

  it('getByFileStateRef returns empty array for unknown ref', async () => {
    const nodes = await store.getByFileStateRef('tm_does_not_exist');
    assert.equal(nodes.length, 0);
  });

  it('getChildren returns one-step descendants', async () => {
    const pmNodes = await store.getByActor('pm', 'agent');
    const first = pmNodes[0]!;
    const children = await store.getChildren(first.id);
    assert.equal(children.length, 1); // linear chain
    assert.equal(children[0]!.parentId, first.id);
  });

  it('size reports total node count', async () => {
    const total = await store.size();
    assert.equal(total, 9); // 4 + 3 + 2
  });

  it('reload re-reads the file from disk', async () => {
    // Re-loading on the same content should keep size stable
    const before = await store.size();
    await store.reload();
    const after = await store.size();
    assert.equal(before, after);
  });
});

// ---------------------------------------------------------------------------
// Chain-of-custody integrity
// ---------------------------------------------------------------------------

describe('verifyChainOfCustody — chain-of-custody integrity', () => {
  it('reports valid=true on a clean chain', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      const chain = buildChain({ count: 5, withFileStateRef: true, withCausal: true });
      await writeChain(store, chain);
      const report = await verifyChainOfCustody(store);
      assert.equal(report.valid, true, `expected valid=true, got: ${JSON.stringify(report)}`);
      assert.equal(report.nodesChecked, 5);
      assert.equal(report.hashFailures, 0);
      assert.equal(report.prevHashFailures, 0);
      assert.equal(report.orphanCount, 0);
      assert.equal(report.tamperingDetected, false);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects tampering when a node hash is altered', async () => {
    const { store, tmpDir, storePath } = await makeStore();
    try {
      const chain = buildChain({ count: 4 });
      await writeChain(store, chain);
      await store.close();

      // Tamper with the JSONL file: alter the prompt of the 3rd node but keep
      // its stored hash. This is exactly the tampering pattern verify-chain
      // must catch.
      const raw = await fs.readFile(storePath, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      const parsed = JSON.parse(lines[2]!) as DecisionNode;
      parsed.input.prompt = 'TAMPERED PROMPT';
      lines[2] = JSON.stringify(parsed);
      await fs.writeFile(storePath, lines.join('\n') + '\n', 'utf-8');

      const freshStore = createDecisionNodeStore(storePath);
      const report = await verifyChainOfCustody(freshStore);
      assert.equal(report.valid, false);
      assert.ok(report.hashFailures >= 1, `expected >=1 hashFailure, got ${report.hashFailures}`);
      assert.equal(report.tamperingDetected, true);
      assert.ok(report.failures.some(f => !f.hashValid));
      await freshStore.close();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects prev-hash chain break (broken link without single-node tamper)', async () => {
    const { store, tmpDir, storePath } = await makeStore();
    try {
      const chain = buildChain({ count: 4 });
      await writeChain(store, chain);
      await store.close();

      // Mutate the prevHash of node[2] to a random value.
      const raw = await fs.readFile(storePath, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      const parsed = JSON.parse(lines[2]!) as DecisionNode;
      parsed.prevHash = 'a'.repeat(64);
      lines[2] = JSON.stringify(parsed);
      await fs.writeFile(storePath, lines.join('\n') + '\n', 'utf-8');

      const freshStore = createDecisionNodeStore(storePath);
      const report = await verifyChainOfCustody(freshStore);
      assert.equal(report.valid, false);
      assert.ok(report.prevHashFailures >= 1);
      await freshStore.close();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('filters by sessionId', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      await writeChain(store, buildChain({ sessionId: 'sA', count: 3 }));
      await writeChain(store, buildChain({ sessionId: 'sB', count: 2 }));
      const report = await verifyChainOfCustody(store, { sessionId: 'sA' });
      assert.equal(report.nodesChecked, 3);
      assert.equal(report.valid, true);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('filters by actorId for per-agent audit', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      await writeChain(store, buildChain({ actor: { type: 'agent', id: 'pm', product: 'danteforge' }, count: 4 }));
      await writeChain(store, buildChain({ actor: { type: 'agent', id: 'dev', product: 'danteforge' }, count: 3 }));
      const pmReport = await verifyChainOfCustody(store, { actorId: 'pm' });
      assert.equal(pmReport.nodesChecked, 4);
      assert.equal(pmReport.valid, true);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('caps failure reports at 50', async () => {
    const { store, tmpDir, storePath } = await makeStore();
    try {
      // Build a 60-node chain and tamper every node's hash so we'd otherwise
      // emit 60 failure rows.
      const chain = buildChain({ count: 60 });
      await writeChain(store, chain);
      await store.close();

      const raw = await fs.readFile(storePath, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      const mutated = lines.map(line => {
        const node = JSON.parse(line) as DecisionNode;
        node.input.prompt = 'TAMPERED';
        return JSON.stringify(node);
      });
      await fs.writeFile(storePath, mutated.join('\n') + '\n', 'utf-8');

      const freshStore = createDecisionNodeStore(storePath);
      const report = await verifyChainOfCustody(freshStore);
      assert.ok(report.failures.length <= 50, `expected cap at 50 failures, got ${report.failures.length}`);
      await freshStore.close();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// verifyDecisionNode — pure function
// ---------------------------------------------------------------------------

describe('verifyDecisionNode — pure single-node verifier', () => {
  it('returns hashValid=true for a freshly created node', () => {
    const node = createDecisionNode({
      parentNode: null,
      sessionId: 's1',
      timelineId: 'main',
      actor: { type: 'agent', id: 'pm', product: 'danteforge' },
      input: { prompt: 'hello' },
      output: { result: 'ok', success: true, costUsd: 0, latencyMs: 0 },
    });
    const result = verifyDecisionNode(node);
    assert.equal(result.hashValid, true);
    assert.equal(result.prevHashValid, true);
    assert.equal(result.reason, undefined);
  });

  it('returns hashValid=false when fields are tampered after creation', () => {
    const node = createDecisionNode({
      parentNode: null,
      sessionId: 's1',
      timelineId: 'main',
      actor: { type: 'agent', id: 'pm', product: 'danteforge' },
      input: { prompt: 'hello' },
      output: { result: 'ok', success: true, costUsd: 0, latencyMs: 0 },
    });
    const tampered = { ...node, input: { prompt: 'tampered' } };
    const result = verifyDecisionNode(tampered);
    assert.equal(result.hashValid, false);
    assert.ok(result.reason?.includes('hash mismatch'));
  });

  it('checks prev-hash link when parent is provided', () => {
    const root = createDecisionNode({
      parentNode: null,
      sessionId: 's1',
      timelineId: 'main',
      actor: { type: 'agent', id: 'pm', product: 'danteforge' },
      input: { prompt: 'root' },
      output: { result: 'ok', success: true, costUsd: 0, latencyMs: 0 },
    });
    const child = createDecisionNode({
      parentNode: root,
      sessionId: 's1',
      timelineId: 'main',
      actor: { type: 'agent', id: 'pm', product: 'danteforge' },
      input: { prompt: 'child' },
      output: { result: 'ok', success: true, costUsd: 0, latencyMs: 0 },
    });
    const result = verifyDecisionNode(child, root);
    assert.equal(result.hashValid, true);
    assert.equal(result.prevHashValid, true);
  });

  it('flags prev-hash mismatch when child claims a different parent hash', () => {
    const root = createDecisionNode({
      parentNode: null,
      sessionId: 's1',
      timelineId: 'main',
      actor: { type: 'agent', id: 'pm', product: 'danteforge' },
      input: { prompt: 'root' },
      output: { result: 'ok', success: true, costUsd: 0, latencyMs: 0 },
    });
    const child = createDecisionNode({
      parentNode: root,
      sessionId: 's1',
      timelineId: 'main',
      actor: { type: 'agent', id: 'pm', product: 'danteforge' },
      input: { prompt: 'child' },
      output: { result: 'ok', success: true, costUsd: 0, latencyMs: 0 },
    });
    const fakeParent = { ...root, hash: 'f'.repeat(64) };
    const result = verifyDecisionNode(child, fakeParent);
    assert.equal(result.prevHashValid, false);
    assert.ok(result.reason?.includes('prevHash mismatch'));
  });
});

// ---------------------------------------------------------------------------
// Provenance coverage metrics
// ---------------------------------------------------------------------------

describe('computeProvenanceCoverage — provenance coverage report', () => {
  it('returns zero coverage on an empty store', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      const report = await computeProvenanceCoverage(store);
      assert.equal(report.totalNodes, 0);
      assert.equal(report.coverageScore, 0);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports high coverage on a richly-populated chain', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      const chain = buildChain({
        count: 10,
        withFileStateRef: true,
        withEvidenceRef: true,
        withContext: true,
        withObservability: true,
        withCausal: true,
      });
      await writeChain(store, chain);
      const report = await computeProvenanceCoverage(store);
      assert.equal(report.totalNodes, 10);
      assert.ok(report.integrityRate === 1.0, `integrityRate=${report.integrityRate}`);
      assert.ok(report.fileStateRefRate === 1.0);
      assert.ok(report.evidenceRefRate === 1.0);
      assert.ok(report.contextRate === 1.0);
      assert.ok(report.observabilityRate === 1.0);
      // 9 non-root nodes / 9 with causal links == 1.0
      assert.ok(report.causalLinkRate === 1.0);
      assert.ok(report.coverageScore >= 0.95, `coverageScore=${report.coverageScore}`);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports low coverage on a bare-bones chain', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      const chain = buildChain({ count: 5 });
      await writeChain(store, chain);
      const report = await computeProvenanceCoverage(store);
      assert.equal(report.integrityRate, 1.0); // hashes still valid
      assert.equal(report.fileStateRefRate, 0);
      assert.equal(report.evidenceRefRate, 0);
      assert.equal(report.observabilityRate, 0);
      // Coverage = 0.30 integrity only ≈ 0.30
      assert.ok(report.coverageScore <= 0.5, `coverageScore=${report.coverageScore}`);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('lists distinct actor/timeline/session ids', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      await writeChain(store, buildChain({ sessionId: 'sA', actor: { type: 'agent', id: 'pm', product: 'danteforge' }, count: 2 }));
      await writeChain(store, buildChain({ sessionId: 'sB', actor: { type: 'agent', id: 'dev', product: 'danteforge' }, count: 2 }));
      const report = await computeProvenanceCoverage(store);
      assert.deepEqual(report.actorIds.sort(), ['dev', 'pm']);
      assert.deepEqual(report.sessionIds.sort(), ['sA', 'sB']);
      assert.ok(report.timelineIds.includes('main'));
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('detects integrity failures and reflects in integrityRate', async () => {
    const { store, tmpDir, storePath } = await makeStore();
    try {
      const chain = buildChain({ count: 5 });
      await writeChain(store, chain);
      await store.close();

      // Tamper with 2 of 5 nodes.
      const raw = await fs.readFile(storePath, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      for (const idx of [1, 3]) {
        const parsed = JSON.parse(lines[idx]!) as DecisionNode;
        parsed.input.prompt = `TAMPERED-${idx}`;
        lines[idx] = JSON.stringify(parsed);
      }
      await fs.writeFile(storePath, lines.join('\n') + '\n', 'utf-8');

      const freshStore = createDecisionNodeStore(storePath);
      const report = await computeProvenanceCoverage(freshStore);
      assert.ok(report.integrityRate < 1.0, `expected integrityRate<1.0, got ${report.integrityRate}`);
      await freshStore.close();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Per-agent activity log
// ---------------------------------------------------------------------------

describe('buildAgentActivityLog — per-agent activity log', () => {
  it('emits one row per (actor.type, actor.id) pair', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      await writeChain(store, buildChain({ actor: { type: 'agent', id: 'pm', product: 'danteforge' }, count: 5 }));
      await writeChain(store, buildChain({ actor: { type: 'agent', id: 'dev', product: 'danteforge' }, count: 3 }));
      await writeChain(store, buildChain({ actor: { type: 'human', id: 'reviewer', product: 'danteforge' }, count: 2 }));

      const rows = await buildAgentActivityLog(store);
      assert.equal(rows.length, 3);
      // Sorted hottest first.
      assert.equal(rows[0]!.actorId, 'pm');
      assert.equal(rows[0]!.decisionCount, 5);
      assert.equal(rows[1]!.actorId, 'dev');
      assert.equal(rows[2]!.actorId, 'reviewer');
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('aggregates cost, latency, success count correctly', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      const chain = buildChain({
        actor: { type: 'agent', id: 'pm', product: 'danteforge' },
        count: 10,
        withObservability: true,
      });
      await writeChain(store, chain);
      const rows = await buildAgentActivityLog(store);
      const row = rows[0]!;
      assert.equal(row.decisionCount, 10);
      assert.equal(row.successCount, 8); // 80% success per buildChain pattern
      assert.ok(row.totalLatencyMs > 0);
      assert.ok(row.totalCostUsd > 0);
      assert.deepEqual(row.timelines, ['main']);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty array for an empty store', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      const rows = await buildAgentActivityLog(store);
      assert.equal(rows.length, 0);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('distinguishes same id with different actor.type', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      await writeChain(store, buildChain({ actor: { type: 'agent', id: 'pm', product: 'danteforge' }, count: 3 }));
      await writeChain(store, buildChain({ actor: { type: 'human', id: 'pm', product: 'danteforge' }, count: 2 }));
      const rows = await buildAgentActivityLog(store);
      assert.equal(rows.length, 2);
      const agentRow = rows.find(r => r.actorType === 'agent');
      const humanRow = rows.find(r => r.actorType === 'human');
      assert.ok(agentRow);
      assert.ok(humanRow);
      assert.equal(agentRow!.decisionCount, 3);
      assert.equal(humanRow!.decisionCount, 2);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Replay determinism
// ---------------------------------------------------------------------------

describe('verifyReplayDeterminism — chain replay safety', () => {
  it('reports deterministic=true on a clean chain', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      const chain = buildChain({ count: 7, withFileStateRef: true });
      await writeChain(store, chain);
      const report = await verifyReplayDeterminism(store);
      assert.equal(report.deterministic, true, `errors: ${report.errors.join(', ')}`);
      assert.equal(report.chainLength, 7);
      assert.equal(report.errors.length, 0);
      assert.ok(report.fileStateRefTransitions > 0);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports deterministic=false when a node is tampered', async () => {
    const { store, tmpDir, storePath } = await makeStore();
    try {
      const chain = buildChain({ count: 5 });
      await writeChain(store, chain);
      await store.close();

      const raw = await fs.readFile(storePath, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      const parsed = JSON.parse(lines[2]!) as DecisionNode;
      parsed.input.prompt = 'TAMPERED';
      lines[2] = JSON.stringify(parsed);
      await fs.writeFile(storePath, lines.join('\n') + '\n', 'utf-8');

      const freshStore = createDecisionNodeStore(storePath);
      const report = await verifyReplayDeterminism(freshStore);
      assert.equal(report.deterministic, false);
      assert.ok(report.errors.length >= 1);
      await freshStore.close();
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('respects headNodeId — only verifies ancestor chain', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      const chain = buildChain({ count: 5 });
      await writeChain(store, chain);
      const head = chain[2]!;
      const report = await verifyReplayDeterminism(store, { headNodeId: head.id });
      // Chain to node 2 is nodes [0,1,2] — length 3.
      assert.equal(report.chainLength, 3);
      assert.equal(report.deterministic, true);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns error when headNodeId is unknown', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      const report = await verifyReplayDeterminism(store, { headNodeId: 'does-not-exist' });
      assert.equal(report.deterministic, false);
      assert.ok(report.errors[0]?.includes('not found'));
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('reports deterministic=true on empty store', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      const report = await verifyReplayDeterminism(store);
      assert.equal(report.deterministic, true);
      assert.equal(report.chainLength, 0);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Merkle root
// ---------------------------------------------------------------------------

describe('computeAgentActivityMerkleRoot — Merkle anchor', () => {
  it('produces a deterministic root for the same chain', async () => {
    const a = await makeStore();
    const b = await makeStore();
    try {
      const chainA = buildChain({ count: 6 });
      const chainB = chainA; // same nodes, same hashes
      await writeChain(a.store, chainA);
      await writeChain(b.store, chainB);
      const rootA = await computeAgentActivityMerkleRoot(a.store);
      const rootB = await computeAgentActivityMerkleRoot(b.store);
      assert.equal(rootA.root, rootB.root);
      assert.equal(rootA.leafCount, 6);
    } finally {
      await a.store.close();
      await b.store.close();
      await fs.rm(a.tmpDir, { recursive: true, force: true });
      await fs.rm(b.tmpDir, { recursive: true, force: true });
    }
  });

  it('produces a different root when any node hash changes', async () => {
    const a = await makeStore();
    const b = await makeStore();
    try {
      const chainA = buildChain({ count: 4 });
      const chainB = buildChain({ count: 4 });
      // chainB has different ids (UUIDs), so hashes differ.
      await writeChain(a.store, chainA);
      await writeChain(b.store, chainB);
      const rootA = await computeAgentActivityMerkleRoot(a.store);
      const rootB = await computeAgentActivityMerkleRoot(b.store);
      assert.notEqual(rootA.root, rootB.root);
    } finally {
      await a.store.close();
      await b.store.close();
      await fs.rm(a.tmpDir, { recursive: true, force: true });
      await fs.rm(b.tmpDir, { recursive: true, force: true });
    }
  });

  it('handles odd-leaf-count by duplicating the trailing leaf', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      const chain = buildChain({ count: 3 });
      await writeChain(store, chain);
      const root = await computeAgentActivityMerkleRoot(store);
      assert.equal(root.leafCount, 3);
      assert.equal(root.root.length, 64); // sha256 hex
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns empty-string sha256 hash for an empty filtered set', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      const root = await computeAgentActivityMerkleRoot(store);
      assert.equal(root.leafCount, 0);
      assert.equal(root.root, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('honors actor/timeline/session filters', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      await writeChain(store, buildChain({ sessionId: 'sX', actor: { type: 'agent', id: 'pm', product: 'danteforge' }, count: 4 }));
      await writeChain(store, buildChain({ sessionId: 'sX', actor: { type: 'agent', id: 'dev', product: 'danteforge' }, count: 3 }));
      const rootPm = await computeAgentActivityMerkleRoot(store, { actorId: 'pm' });
      assert.equal(rootPm.leafCount, 4);
      const rootDev = await computeAgentActivityMerkleRoot(store, { actorId: 'dev' });
      assert.equal(rootDev.leafCount, 3);
      assert.notEqual(rootPm.root, rootDev.root);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// collectAllNodes
// ---------------------------------------------------------------------------

describe('collectAllNodes — full-store enumeration', () => {
  it('returns every node across multiple sessions', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      await writeChain(store, buildChain({ sessionId: 'sA', count: 3 }));
      await writeChain(store, buildChain({ sessionId: 'sB', count: 4 }));
      const all = await collectAllNodes(store);
      assert.equal(all.length, 7);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// ASCII activity table
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Checkpoint recording (decision-node-recorder)
// ---------------------------------------------------------------------------

describe('recordCheckpoint / findLatestCheckpoint — provenance anchors', () => {
  it('records a checkpoint that includes fileStateRef and is queryable', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-cp-test-'));
    try {
      // Stage the env so the recorder uses our tmp store.
      const storePath = path.join(tmpDir, 'decision-nodes.jsonl');
      const originalStore = process.env.DANTEFORGE_DECISION_STORE;
      const originalSession = process.env.DANTEFORGE_DECISION_SESSION_ID;
      process.env.DANTEFORGE_DECISION_STORE = storePath;
      process.env.DANTEFORGE_DECISION_SESSION_ID = '11111111-1111-1111-1111-111111111111';
      const { _resetSession, recordCheckpoint, findLatestCheckpoint } = await import('../src/core/decision-node-recorder.js');
      _resetSession();

      try {
        const node = await recordCheckpoint({
          cwd: tmpDir,
          actorType: 'agent',
          command: 'forge',
          goal: 'apply wave 1',
          fileStateRef: 'tm_abc123',
          evidenceRef: 'sha256:deadbeef',
          qualityScore: 9.0,
        });
        assert.equal(node.output.fileStateRef, 'tm_abc123');
        assert.equal(node.output.success, true);
        assert.equal(node.output.qualityScore, 9.0);

        const latest = await findLatestCheckpoint({ cwd: tmpDir });
        assert.ok(latest, 'expected to find at least one checkpoint');
        assert.equal(latest!.output.fileStateRef, 'tm_abc123');
      } finally {
        _resetSession();
        if (originalStore === undefined) delete process.env.DANTEFORGE_DECISION_STORE;
        else process.env.DANTEFORGE_DECISION_STORE = originalStore;
        if (originalSession === undefined) delete process.env.DANTEFORGE_DECISION_SESSION_ID;
        else process.env.DANTEFORGE_DECISION_SESSION_ID = originalSession;
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('findLatestCheckpoint returns undefined when no checkpoints recorded', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-cp-test-'));
    try {
      const storePath = path.join(tmpDir, 'decision-nodes.jsonl');
      const originalStore = process.env.DANTEFORGE_DECISION_STORE;
      const originalSession = process.env.DANTEFORGE_DECISION_SESSION_ID;
      process.env.DANTEFORGE_DECISION_STORE = storePath;
      process.env.DANTEFORGE_DECISION_SESSION_ID = '22222222-2222-2222-2222-222222222222';
      const { _resetSession, findLatestCheckpoint } = await import('../src/core/decision-node-recorder.js');
      _resetSession();
      try {
        const latest = await findLatestCheckpoint({ cwd: tmpDir });
        assert.equal(latest, undefined);
      } finally {
        _resetSession();
        if (originalStore === undefined) delete process.env.DANTEFORGE_DECISION_STORE;
        else process.env.DANTEFORGE_DECISION_STORE = originalStore;
        if (originalSession === undefined) delete process.env.DANTEFORGE_DECISION_SESSION_ID;
        else process.env.DANTEFORGE_DECISION_SESSION_ID = originalSession;
      }
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});

describe('renderAgentActivityTable — ASCII renderer', () => {
  it('renders a non-empty activity log to multi-line ASCII', async () => {
    const { store, tmpDir } = await makeStore();
    try {
      await writeChain(store, buildChain({ actor: { type: 'agent', id: 'pm', product: 'danteforge' }, count: 5, withObservability: true }));
      await writeChain(store, buildChain({ actor: { type: 'agent', id: 'dev', product: 'danteforge' }, count: 3 }));
      const rows = await buildAgentActivityLog(store);
      const rendered = renderAgentActivityTable(rows);
      assert.ok(rendered.includes('Per-Agent Activity Log'));
      assert.ok(rendered.includes('agent:pm'));
      assert.ok(rendered.includes('agent:dev'));
      assert.ok(rendered.includes('AGENT'));
      // Should be multi-line
      assert.ok(rendered.split('\n').length > 4);
    } finally {
      await store.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('returns a helpful message when no agents recorded', () => {
    const rendered = renderAgentActivityTable([]);
    assert.ok(rendered.includes('no agent activity'));
  });
});
