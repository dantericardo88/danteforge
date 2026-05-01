/**
 * time-machine-causal-attribution-real-data.test.ts
 *
 * Tests the full pipeline: recordDecision → JSONL → store → classifyNodesHeuristic
 * using real JSONL writes, not synthetic in-memory nodes.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSession, recordDecision, _resetSession } from '../src/core/decision-node-recorder.js';
import { createDecisionNodeStore } from '../src/core/decision-node.js';
import { classifyNodesHeuristic } from '../src/core/time-machine-causal-attribution.js';
import type { DecisionNode } from '../src/core/decision-node.js';

describe('causal attribution — real JSONL data', () => {
  let workspace: string;

  before(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'causal-attr-test-'));
    _resetSession();
  });

  after(async () => {
    _resetSession();
    await rm(workspace, { recursive: true, force: true });
  });

  it('classifies recorded session without error', async () => {
    const sp = join(workspace, 'test1.jsonl');
    const session = { ...getSession(workspace), storePath: sp };

    const branchPoint = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'decide how to implement the authentication module',
      result: 'use JWT tokens',
      success: true,
    });

    const orig1 = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'implement JWT token generation for authentication',
      result: 'JWT token generated',
      success: true,
      parentNodeId: branchPoint.id,
    });

    const orig2 = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'write unit tests for the user service',
      result: 'tests written',
      success: true,
      parentNodeId: orig1.id,
    });

    const alt1 = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'implement session-based cookie authentication instead',
      result: 'session cookies implemented',
      success: true,
      parentNodeId: branchPoint.id,
    });

    const store = createDecisionNodeStore(sp);
    const allNodes = await store.getBySession(session.sessionId);
    await store.close();

    assert.ok(allNodes.length >= 4, `Expected at least 4 nodes, got ${allNodes.length}`);

    const originalNodes = [orig1, orig2];
    const alternateNodes = [alt1];

    const result = classifyNodesHeuristic(branchPoint, originalNodes, alternateNodes);

    assert.ok(Array.isArray(result.originalNodes), 'result.originalNodes should be an array');
    assert.strictEqual(result.originalNodes.length, 2);
    assert.strictEqual(result.branchPointId, branchPoint.id);
  });

  it('independent: identical prompts in both paths classified as independent', async () => {
    const sp = join(workspace, 'test2.jsonl');
    const session = { ...getSession(workspace), storePath: sp };

    const branchPoint = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'choose logging framework',
      result: 'use winston',
      success: true,
    });

    // Shared/independent: same prompt appears in both timelines
    const sharedPrompt = 'initialize database connection pool settings';

    const orig1 = await recordDecision({
      session,
      actorType: 'agent',
      prompt: sharedPrompt,
      result: 'connection pool initialized',
      success: true,
      parentNodeId: branchPoint.id,
    });

    const alt1 = await recordDecision({
      session,
      actorType: 'agent',
      prompt: sharedPrompt,
      result: 'connection pool initialized',
      success: true,
      parentNodeId: branchPoint.id,
    });

    const result = classifyNodesHeuristic(branchPoint, [orig1], [alt1]);

    const classifications = result.originalNodes.map(n => n.classification);
    assert.ok(
      classifications.includes('independent'),
      `Expected at least one 'independent', got: ${JSON.stringify(classifications)}`,
    );
  });

  it('dependent-incompatible: node unique to original path classified as dependent-incompatible', async () => {
    const sp = join(workspace, 'test3.jsonl');
    const session = { ...getSession(workspace), storePath: sp };

    // Branch point prompt has significant words: [decide, architecture, microservices, monolith]
    // Branch point result has significant words: [microservices, architecture, selected]
    const branchPoint = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'decide architecture microservices monolith',
      result: 'microservices architecture selected',
      success: true,
    });

    // origUnique prompt: 'microservices architecture deploy kubernetes cluster'
    // Significant words: [microservices, architecture, deploy, kubernetes, cluster] (5 words)
    // Overlap with branchPoint result [microservices, architecture, selected]: intersection=2 (microservices, architecture)
    // keywordOverlap = 2 / (3 + 5 - 2) = 2/6 = 0.33 > 0.30 → dependent
    // The alternate prompt shares no significant words → no equivalent → dependent-incompatible
    const origUnique = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'microservices architecture deploy kubernetes cluster',
      result: 'kubernetes configured',
      success: true,
      parentNodeId: branchPoint.id,
    });

    // Alternate path prompt: completely different words — no overlap with origUnique
    const alt1 = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'deploy single monolith application VPS server nginx',
      result: 'monolith deployed',
      success: true,
      parentNodeId: branchPoint.id,
    });

    const result = classifyNodesHeuristic(branchPoint, [origUnique], [alt1]);

    const uniqueNodeResult = result.originalNodes.find(n => n.node.id === origUnique.id);
    assert.ok(uniqueNodeResult, 'Expected to find the original unique node in results');
    assert.strictEqual(
      uniqueNodeResult.classification,
      'dependent-incompatible',
      `Expected 'dependent-incompatible' but got '${uniqueNodeResult.classification}'. reasoning: ${uniqueNodeResult.reasoning}`,
    );
  });

  it('forge→verify chain: multi-step chain classifies correctly', async () => {
    const sp = join(workspace, 'test4.jsonl');
    const session = { ...getSession(workspace), storePath: sp };

    const branchPoint = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'forge: build the payment processing module',
      result: 'payment module scaffolded',
      success: true,
    });

    const forgeNode = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'forge wave 1: implement payment gateway integration',
      result: 'gateway integrated',
      success: true,
      parentNodeId: branchPoint.id,
    });

    const verifyNode = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'verify: run tests against payment module implementation',
      result: 'tests failed: missing error handling',
      success: false,
      parentNodeId: forgeNode.id,
    });

    const retryNode = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'retry forge: add error handling to payment gateway integration',
      result: 'error handling added',
      success: true,
      parentNodeId: verifyNode.id,
    });

    const verifyNode2 = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'verify: run tests against updated payment module implementation',
      result: 'all tests pass',
      success: true,
      parentNodeId: retryNode.id,
    });

    const alt1 = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'use stripe sdk for payment processing instead of custom gateway',
      result: 'stripe integrated',
      success: true,
      parentNodeId: branchPoint.id,
    });

    const originalChain = [forgeNode, verifyNode, retryNode, verifyNode2];
    const result = classifyNodesHeuristic(branchPoint, originalChain, [alt1]);

    assert.ok(
      result.originalNodes.length >= 3,
      `Expected at least 3 original nodes, got ${result.originalNodes.length}`,
    );
    assert.strictEqual(result.originalNodes.length, 4);
  });

  it('converged: true when both paths end with same output text', async () => {
    const sp = join(workspace, 'test5.jsonl');
    const session = { ...getSession(workspace), storePath: sp };

    const branchPoint = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'choose approach for implementing feature flag system',
      result: 'will implement feature flags',
      success: true,
    });

    const orig1 = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'build custom feature flag service from scratch',
      result: 'task complete',
      success: true,
      parentNodeId: branchPoint.id,
    });

    const alt1 = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'integrate LaunchDarkly SDK for feature flags',
      result: 'task complete',
      success: true,
      parentNodeId: branchPoint.id,
    });

    const result = classifyNodesHeuristic(branchPoint, [orig1], [alt1]);

    assert.strictEqual(
      result.converged,
      true,
      `Expected converged=true but got converged=${result.converged}`,
    );
  });

  it('converged: false when paths end with different output text', async () => {
    const sp = join(workspace, 'test6.jsonl');
    const session = { ...getSession(workspace), storePath: sp };

    const branchPoint = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'decide how to handle rate limiting',
      result: 'will add rate limiting',
      success: true,
    });

    const orig1 = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'implement token bucket rate limiting algorithm',
      result: 'rate limiting implemented with token bucket strategy',
      success: true,
      parentNodeId: branchPoint.id,
    });

    const alt1 = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'implement sliding window rate limiting algorithm',
      result: 'rate limiting implemented with sliding window counter',
      success: true,
      parentNodeId: branchPoint.id,
    });

    const result = classifyNodesHeuristic(branchPoint, [orig1], [alt1]);

    assert.strictEqual(
      result.converged,
      false,
      `Expected converged=false but got converged=${result.converged}`,
    );
  });

  it('empty alternate path: all original nodes are dependent-incompatible or independent', async () => {
    const sp = join(workspace, 'test7.jsonl');
    const session = { ...getSession(workspace), storePath: sp };

    const branchPoint = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'decide caching strategy for api responses',
      result: 'use Redis for caching',
      success: true,
    });

    const orig1 = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'configure Redis cache TTL and eviction policy',
      result: 'Redis configured',
      success: true,
      parentNodeId: branchPoint.id,
    });

    const orig2 = await recordDecision({
      session,
      actorType: 'agent',
      prompt: 'write cache invalidation logic for user data',
      result: 'cache invalidation implemented',
      success: true,
      parentNodeId: orig1.id,
    });

    const result = classifyNodesHeuristic(branchPoint, [orig1, orig2], []);

    const allowedClassifications = new Set(['dependent-incompatible', 'independent']);
    for (const attributed of result.originalNodes) {
      assert.ok(
        allowedClassifications.has(attributed.classification),
        `Expected classification to be 'dependent-incompatible' or 'independent', got '${attributed.classification}'`,
      );
    }
  });

  it('cross-session: store.getBySession returns only nodes from the target session', async () => {
    const sp = join(workspace, 'test8.jsonl');

    // Session A
    const sessionA = {
      sessionId: 'session-aaaa-0000-0000-000000000001',
      timelineId: 'main',
      product: 'danteforge' as const,
      storePath: sp,
    };

    // Session B
    const sessionB = {
      sessionId: 'session-bbbb-0000-0000-000000000002',
      timelineId: 'main',
      product: 'danteforge' as const,
      storePath: sp,
    };

    // Write 3 nodes under session A
    await recordDecision({
      session: sessionA,
      actorType: 'agent',
      prompt: 'session A node 1: plan the database schema',
      result: 'schema planned',
      success: true,
    });

    await recordDecision({
      session: sessionA,
      actorType: 'agent',
      prompt: 'session A node 2: implement the database migrations',
      result: 'migrations created',
      success: true,
    });

    await recordDecision({
      session: sessionA,
      actorType: 'agent',
      prompt: 'session A node 3: seed the database with initial data',
      result: 'database seeded',
      success: true,
    });

    // Write 2 nodes under session B
    await recordDecision({
      session: sessionB,
      actorType: 'human',
      prompt: 'session B node 1: review the pull request',
      result: 'PR approved',
      success: true,
    });

    await recordDecision({
      session: sessionB,
      actorType: 'human',
      prompt: 'session B node 2: merge the feature branch',
      result: 'branch merged',
      success: true,
    });

    const store = createDecisionNodeStore(sp);
    const sessionANodes = await store.getBySession(sessionA.sessionId);
    await store.close();

    assert.strictEqual(
      sessionANodes.length,
      3,
      `Expected exactly 3 nodes for session A, got ${sessionANodes.length}`,
    );

    // All returned nodes must belong to session A
    for (const node of sessionANodes) {
      assert.strictEqual(node.sessionId, sessionA.sessionId);
    }
  });
});
