#!/usr/bin/env tsx
/**
 * time-machine-demo.ts
 *
 * End-to-end demonstration of the Dante Time Machine.
 *
 * What this shows:
 *   1. Record two decisions as DecisionNodes (simulating a magic + verify run)
 *   2. Bridge a DanteAgents ForgeOrchestrator result into the store
 *   3. Diff two simulated timelines
 *   4. Causal attribution on downstream nodes
 *   5. Convergence detection
 *
 * Run with:  npx tsx scripts/time-machine-demo.ts [--help]
 *        or: npm run time-machine:demo
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDecisionNode, createDecisionNodeStore } from '../src/core/decision-node.js';
import { diffTimelines, buildCausalChain } from '../src/core/time-machine-replay.js';
import { classifyNodesHeuristic, detectConvergence } from '../src/core/time-machine-causal-attribution.js';
import { createDanteAgentsBridge, type ForgeResultLike, type StepResultLike } from '../src/core/decision-node-danteagents-bridge.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function section(title: string): void {
  console.log('');
  console.log('='.repeat(60));
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

function print(label: string, value: unknown): void {
  const v = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  console.log(`  ${label}: ${v}`);
}

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log(`
Dante Time Machine — End-to-End Demo
=====================================
Usage: npx tsx scripts/time-machine-demo.ts [--help]

What this demo shows:
  1. Recording decisions: two DecisionNodes for a magic+verify session
  2. DanteAgents bridge: ForgeOrchestrator result recorded as a linked chain
  3. Timeline diff: divergence between two simulated timelines
  4. Causal attribution: classify downstream nodes by dependence
  5. Convergence detection: did both timelines reach the same outcome?

The demo runs entirely in a temp directory — no real DanteForge state is modified.
  `);
  process.exit(0);
}

console.log('Dante Time Machine — End-to-End Demo');
console.log('======================================');

const demoDir = await mkdtemp(join(tmpdir(), 'df-time-machine-demo-'));
const storePath = join(demoDir, 'decision-nodes.jsonl');
const sessionId = randomUUID();

try {
  // -------------------------------------------------------------------------
  // Step 1: Record decisions (simulating magic + verify)
  // -------------------------------------------------------------------------
  section('Step 1 — Record decisions (magic + verify run)');

  const store = createDecisionNodeStore(storePath);

  const magicNode = createDecisionNode({
    parentNode: null,
    sessionId,
    timelineId: 'main',
    actor: { type: 'agent', id: 'danteforge-cli', product: 'danteforge' },
    input: { prompt: 'forge: add authentication middleware to Express app' },
    output: {
      result: { filesModified: ['src/middleware/auth.ts', 'src/app.ts'], linesAdded: 48 },
      success: true,
      costUsd: 0.028,
      latencyMs: 3400,
      qualityScore: 82,
      fileStateRef: 'abc1234',
    },
  });

  const verifyNode = createDecisionNode({
    parentNode: magicNode,
    sessionId,
    timelineId: 'main',
    actor: { type: 'agent', id: 'danteforge-cli', product: 'danteforge' },
    input: { prompt: 'verify: check authentication middleware quality' },
    output: {
      result: { pdseScore: 82, allTestsPassed: true, typecheckPassed: true },
      success: true,
      costUsd: 0.004,
      latencyMs: 14600,
      qualityScore: 82,
      fileStateRef: 'abc1234',
    },
  });

  await store.append(magicNode);
  await store.append(verifyNode);
  await store.close();

  print('magic node id', magicNode.id.slice(0, 16) + '…');
  print('magic node hash', magicNode.hash.slice(0, 16) + '…');
  print('verify prevHash === magic hash', verifyNode.prevHash === magicNode.hash);

  // -------------------------------------------------------------------------
  // Step 2: DanteAgents bridge demo
  // -------------------------------------------------------------------------
  section('Step 2 — DanteAgents ForgeOrchestrator bridge');

  const bridge = createDanteAgentsBridge(storePath);
  const steps: StepResultLike[] = [
    { stepId: 'search', output: 'Found 12 relevant sources', success: true, attempts: 1, qualityScore: 90, durationMs: 800 },
    { stepId: 'analyze', output: 'RS256 preferred over HS256 for distributed systems', success: true, attempts: 1, qualityScore: 85, durationMs: 1200 },
    { stepId: 'synthesize', output: 'Final recommendation with code examples', success: true, attempts: 1, qualityScore: 92, durationMs: 600 },
  ];
  const agentResult: ForgeResultLike = {
    success: true,
    response: 'Use RS256 with short-lived tokens and refresh-token rotation.',
    steps,
    metadata: { totalDurationMs: 2600, totalSteps: 3, averageQualityScore: 89, state: 'COMPLETE' },
  };

  const forgeNodes = await bridge.recordForgeResult({
    task: 'Research: best JWT validation strategies for Node.js',
    result: agentResult,
    sessionId: randomUUID(),
    agentId: 'research-agent-1',
  });

  print('ForgeOrchestrator nodes recorded', forgeNodes.length);
  print('root node product', forgeNodes[0]?.actor.product);
  print('step chain intact', forgeNodes.every((n, i) => i === 0 || n.parentId === forgeNodes[i - 1]?.id));

  // -------------------------------------------------------------------------
  // Step 3: Timeline diff
  // -------------------------------------------------------------------------
  section('Step 3 — Timeline diff (original vs counterfactual)');

  const altVerifyNode = createDecisionNode({
    parentNode: magicNode,
    sessionId: randomUUID(),
    timelineId: 'counterfactual-jwt-refresh',
    actor: { type: 'agent', id: 'danteforge-cli', product: 'danteforge' },
    input: { prompt: 'forge: add JWT authentication with refresh-token rotation' },
    output: {
      result: { filesModified: ['src/middleware/auth.ts', 'src/routes/auth.ts'], linesAdded: 72 },
      success: true,
      costUsd: 0.035,
      latencyMs: 4100,
      qualityScore: 91,
      fileStateRef: 'def5678',
    },
  });

  const originalPath = [magicNode, verifyNode];
  const alternatePath = [magicNode, altVerifyNode];

  const diff = diffTimelines(originalPath, alternatePath);
  print('convergent nodes (same in both timelines)', diff.convergent.length);
  print('divergent nodes (changed)', diff.divergent.length);
  print('unreachable nodes', diff.unreachable.length);

  const causalChain = buildCausalChain(magicNode, diff.divergent);
  console.log('  causal chain narrative:');
  causalChain.forEach(line => console.log(`    ${line}`));

  // -------------------------------------------------------------------------
  // Step 4: Causal attribution
  // -------------------------------------------------------------------------
  section('Step 4 — Causal attribution on downstream nodes');

  const attribution = classifyNodesHeuristic(magicNode, [verifyNode], [altVerifyNode]);
  console.log('  attribution results:');
  for (const r of attribution.originalNodes) {
    print(`  original node ${r.node.id.slice(0, 8)}…`, `${r.classification} (confidence: ${r.confidence.toFixed(2)})`);
  }
  print('converged', attribution.converged);
  print('summary', attribution.summary);

  // -------------------------------------------------------------------------
  // Step 5: Convergence detection (independent from attribution)
  // -------------------------------------------------------------------------
  section('Step 5 — Convergence detection');

  const convergenceResult = detectConvergence(originalPath, alternatePath);
  print('did both timelines converge?', convergenceResult.converged);
  if (convergenceResult.convergenceIndex !== undefined) {
    print('convergence index', convergenceResult.convergenceIndex);
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  section('Demo Complete');
  console.log(`
  The Dante Time Machine demo completed successfully:
  ✓ 2 DanteForge decisions (magic + verify) recorded as DecisionNodes
  ✓ ${forgeNodes.length} DanteAgents ForgeOrchestrator steps recorded as linked chain
  ✓ 2 timelines diffed (original vs counterfactual)
  ✓ Downstream nodes classified by causal dependence
  ✓ Convergence detection across both timelines

  In production, these nodes are:
  - Persisted to .danteforge/decision-nodes.jsonl
  - Linked to git commit SHAs (output.fileStateRef)
  - Queryable via:  danteforge time-machine node list
  - Replayable via: danteforge time-machine replay <nodeId> --input "revised prompt"
  `);

} finally {
  await rm(demoDir, { recursive: true, force: true });
}
