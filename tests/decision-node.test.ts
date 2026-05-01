/**
 * Tests for src/core/decision-node.ts
 *
 * Covers:
 *  1.  createDecisionNode produces a valid UUID id and correct hash
 *  2.  Hash chain integrity — child carries parent hash in prevHash
 *  3.  Root node has null parentId and null prevHash
 *  4.  hashDecisionNode is deterministic for identical inputs
 *  5.  fromTraceEvent adapter maps all fields correctly
 *  6.  fromTraceEvent preserves original hash and prevHash
 *  7.  DecisionNodeStore: append + getById round-trip
 *  8.  DecisionNodeStore: getBySession filters correctly
 *  9.  DecisionNodeStore: getByTimeline filters correctly
 * 10.  DecisionNodeStore: getAncestors walks full chain to root
 * 11.  DecisionNodeStore: getAncestors on root node returns empty array
 * 12.  DecisionNodeStore: persists across store re-creation (JSONL durability)
 * 13.  canonicalJson sorts keys deterministically
 * 14.  hashDecisionNode changes when any field changes
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  canonicalJson,
  createDecisionNode,
  createDecisionNodeStore,
  fromTraceEvent,
  hashDecisionNode,
  type DecisionNode,
  type TraceEventLike,
} from '../src/core/decision-node.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeActor(
  product: DecisionNode['actor']['product'] = 'danteforge',
): DecisionNode['actor'] {
  return { type: 'agent', id: 'test-agent-1', product };
}

function makeInput(prompt = 'do something'): DecisionNode['input'] {
  return { prompt, context: { key: 'value' } };
}

function makeOutput(success = true): DecisionNode['output'] {
  return { result: { done: true }, success, costUsd: 0.001, latencyMs: 42 };
}

function makeTraceEvent(overrides: Partial<TraceEventLike> = {}): TraceEventLike {
  return {
    id: 'trace-id-abc',
    type: 'decision',
    timestamp: '2026-04-30T12:00:00.000Z',
    agentId: 'da-agent-99',
    data: { reasoning: 'chose path A' },
    parentId: null,
    hash: 'aabbccdd1122',
    prevHash: null,
    sessionId: 'session-trace-001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('decision-node', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'df-decision-node-'));
  });

  after(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // 1. createDecisionNode: valid UUID + hash present
  // -------------------------------------------------------------------------
  it('createDecisionNode produces a UUID id and non-empty hash', () => {
    const node = createDecisionNode({
      parentNode: null,
      sessionId: 'sess-1',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput(),
      output: makeOutput(),
    });

    // UUID v4 pattern
    assert.match(
      node.id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    assert.ok(node.hash.length === 64, 'hash should be 64 hex chars (SHA-256)');
  });

  // -------------------------------------------------------------------------
  // 2. Hash chain integrity: child.prevHash === parent.hash
  // -------------------------------------------------------------------------
  it('child node prevHash equals parent hash', () => {
    const parent = createDecisionNode({
      parentNode: null,
      sessionId: 'sess-chain',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput('step 1'),
      output: makeOutput(),
    });

    const child = createDecisionNode({
      parentNode: parent,
      sessionId: 'sess-chain',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput('step 2'),
      output: makeOutput(),
    });

    assert.equal(child.prevHash, parent.hash);
    assert.equal(child.parentId, parent.id);
  });

  // -------------------------------------------------------------------------
  // 3. Root node has null parentId and null prevHash
  // -------------------------------------------------------------------------
  it('root node has null parentId and null prevHash', () => {
    const root = createDecisionNode({
      parentNode: null,
      sessionId: 'sess-root',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput(),
      output: makeOutput(),
    });

    assert.equal(root.parentId, null);
    assert.equal(root.prevHash, null);
  });

  // -------------------------------------------------------------------------
  // 4. hashDecisionNode is deterministic
  // -------------------------------------------------------------------------
  it('hashDecisionNode is deterministic for identical inputs', () => {
    const root = createDecisionNode({
      parentNode: null,
      sessionId: 'sess-det',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput(),
      output: makeOutput(),
    });

    // Strip the hash to simulate the Omit<DecisionNode, 'hash'> shape
    const { hash: _hash, ...partial } = root;

    const hash1 = hashDecisionNode(partial);
    const hash2 = hashDecisionNode(partial);
    assert.equal(hash1, hash2);
  });

  // -------------------------------------------------------------------------
  // 5. fromTraceEvent: field mapping
  // -------------------------------------------------------------------------
  it('fromTraceEvent maps actor fields from TraceEventLike', () => {
    const event = makeTraceEvent();
    const node = fromTraceEvent(event);

    assert.equal(node.id, event.id);
    assert.equal(node.sessionId, event.sessionId);
    assert.equal(node.actor.type, 'agent');
    assert.equal(node.actor.id, event.agentId);
    assert.equal(node.actor.product, 'danteagents');
    assert.equal(node.input.prompt, event.type);
    assert.deepEqual(node.input.context, event.data);
    assert.deepEqual(node.output.result, event.data);
    assert.equal(node.output.success, true);
  });

  // -------------------------------------------------------------------------
  // 6. fromTraceEvent: original hash/prevHash preserved
  // -------------------------------------------------------------------------
  it('fromTraceEvent preserves original TraceEvent hash and prevHash', () => {
    const event = makeTraceEvent({ hash: 'deadbeef01234567', prevHash: '11223344' });
    const node = fromTraceEvent(event, 'abc123gitsha');

    assert.equal(node.hash, 'deadbeef01234567');
    assert.equal(node.prevHash, '11223344');
    assert.equal(node.output.fileStateRef, 'abc123gitsha');
  });

  // -------------------------------------------------------------------------
  // 7. Store: append + getById
  // -------------------------------------------------------------------------
  it('store append and getById round-trip', async () => {
    const storePath = join(tmpDir, 'store-basic.jsonl');
    const store = createDecisionNodeStore(storePath);

    const node = createDecisionNode({
      parentNode: null,
      sessionId: 'sess-store',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput(),
      output: makeOutput(),
    });

    await store.append(node);
    const retrieved = await store.getById(node.id);
    await store.close();

    assert.ok(retrieved !== undefined, 'node should be retrievable');
    assert.equal(retrieved?.id, node.id);
    assert.equal(retrieved?.hash, node.hash);
  });

  // -------------------------------------------------------------------------
  // 8. Store: getBySession filters correctly
  // -------------------------------------------------------------------------
  it('store getBySession returns only nodes for the given session', async () => {
    const storePath = join(tmpDir, 'store-session.jsonl');
    const store = createDecisionNodeStore(storePath);

    const nodeA = createDecisionNode({
      parentNode: null,
      sessionId: 'sess-A',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput('A'),
      output: makeOutput(),
    });
    const nodeB = createDecisionNode({
      parentNode: null,
      sessionId: 'sess-B',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput('B'),
      output: makeOutput(),
    });

    await store.append(nodeA);
    await store.append(nodeB);

    const sessA = await store.getBySession('sess-A');
    const sessB = await store.getBySession('sess-B');
    await store.close();

    assert.equal(sessA.length, 1);
    assert.equal(sessA[0].sessionId, 'sess-A');
    assert.equal(sessB.length, 1);
    assert.equal(sessB[0].sessionId, 'sess-B');
  });

  // -------------------------------------------------------------------------
  // 9. Store: getByTimeline
  // -------------------------------------------------------------------------
  it('store getByTimeline filters correctly', async () => {
    const storePath = join(tmpDir, 'store-timeline.jsonl');
    const store = createDecisionNodeStore(storePath);

    const main1 = createDecisionNode({
      parentNode: null,
      sessionId: 'sess-tl',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput(),
      output: makeOutput(),
    });
    const branch1 = createDecisionNode({
      parentNode: null,
      sessionId: 'sess-tl',
      timelineId: 'branch-xyz',
      actor: makeActor(),
      input: makeInput(),
      output: makeOutput(),
    });

    await store.append(main1);
    await store.append(branch1);

    const mainNodes = await store.getByTimeline('main');
    const branchNodes = await store.getByTimeline('branch-xyz');
    await store.close();

    assert.equal(mainNodes.length, 1);
    assert.equal(branchNodes.length, 1);
    assert.equal(mainNodes[0].timelineId, 'main');
    assert.equal(branchNodes[0].timelineId, 'branch-xyz');
  });

  // -------------------------------------------------------------------------
  // 10. Store: getAncestors walks full chain
  // -------------------------------------------------------------------------
  it('store getAncestors returns full ancestor chain in order from parent to root', async () => {
    const storePath = join(tmpDir, 'store-ancestors.jsonl');
    const store = createDecisionNodeStore(storePath);

    const root = createDecisionNode({
      parentNode: null,
      sessionId: 'sess-anc',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput('root'),
      output: makeOutput(),
    });
    const middle = createDecisionNode({
      parentNode: root,
      sessionId: 'sess-anc',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput('middle'),
      output: makeOutput(),
    });
    const leaf = createDecisionNode({
      parentNode: middle,
      sessionId: 'sess-anc',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput('leaf'),
      output: makeOutput(),
    });

    await store.append(root);
    await store.append(middle);
    await store.append(leaf);

    const ancestors = await store.getAncestors(leaf.id);
    await store.close();

    // Should be [middle, root] — parent first, then grandparent
    assert.equal(ancestors.length, 2);
    assert.equal(ancestors[0].id, middle.id);
    assert.equal(ancestors[1].id, root.id);
  });

  // -------------------------------------------------------------------------
  // 11. Store: getAncestors on root returns empty array
  // -------------------------------------------------------------------------
  it('store getAncestors on root node returns empty array', async () => {
    const storePath = join(tmpDir, 'store-root-anc.jsonl');
    const store = createDecisionNodeStore(storePath);

    const root = createDecisionNode({
      parentNode: null,
      sessionId: 'sess-root-anc',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput(),
      output: makeOutput(),
    });

    await store.append(root);
    const ancestors = await store.getAncestors(root.id);
    await store.close();

    assert.equal(ancestors.length, 0);
  });

  // -------------------------------------------------------------------------
  // 12. Store: JSONL durability — re-created store reads persisted data
  // -------------------------------------------------------------------------
  it('store persists nodes across close and re-open', async () => {
    const storePath = join(tmpDir, 'store-durable.jsonl');

    const node = createDecisionNode({
      parentNode: null,
      sessionId: 'sess-durable',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput('persistent thought'),
      output: makeOutput(),
    });

    const store1 = createDecisionNodeStore(storePath);
    await store1.append(node);
    await store1.close();

    // Re-open with a fresh store instance pointing at the same file
    const store2 = createDecisionNodeStore(storePath);
    const retrieved = await store2.getById(node.id);
    await store2.close();

    assert.ok(retrieved !== undefined, 'node should survive store re-creation');
    assert.equal(retrieved?.id, node.id);
    assert.equal(retrieved?.input.prompt, 'persistent thought');
  });

  // -------------------------------------------------------------------------
  // 13. canonicalJson sorts keys deterministically
  // -------------------------------------------------------------------------
  it('canonicalJson produces identical output regardless of key insertion order', () => {
    const a = { z: 1, a: 2, m: 3 };
    const b = { m: 3, z: 1, a: 2 };
    assert.equal(canonicalJson(a), canonicalJson(b));
    assert.equal(canonicalJson(a), '{"a":2,"m":3,"z":1}');
  });

  // -------------------------------------------------------------------------
  // 14. hashDecisionNode changes when any field changes
  // -------------------------------------------------------------------------
  it('hashDecisionNode produces different hashes for different nodes', () => {
    const base = createDecisionNode({
      parentNode: null,
      sessionId: 'sess-diff',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput('original prompt'),
      output: makeOutput(),
    });

    const modified = createDecisionNode({
      parentNode: null,
      sessionId: 'sess-diff',
      timelineId: 'main',
      actor: makeActor(),
      input: makeInput('different prompt'),
      output: makeOutput(),
    });

    assert.notEqual(base.hash, modified.hash);
  });
});
