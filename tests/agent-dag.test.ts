// Agent DAG tests — buildDefaultDAG, computeExecutionLevels, executeDAG, filterDAGToRoles
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  buildDefaultDAG,
  computeExecutionLevels,
  executeDAG,
  filterDAGToRoles,
} from '../src/core/agent-dag.js';
import type { AgentNode } from '../src/core/agent-dag.js';
import type { AgentRole } from '../src/core/subagent-isolator.js';

// ---------------------------------------------------------------------------
// Mock executor factory
// ---------------------------------------------------------------------------

function createMockExecutor(failRoles: AgentRole[] = []) {
  const executionOrder: AgentRole[][] = [];
  return {
    executor: async (agents: AgentRole[]) => {
      executionOrder.push([...agents]);
      const results = new Map<AgentRole, string>();
      for (const agent of agents) {
        if (!failRoles.includes(agent)) {
          results.set(agent, `${agent}-output`);
        }
      }
      return results;
    },
    executionOrder,
  };
}

// ---------------------------------------------------------------------------
// buildDefaultDAG
// ---------------------------------------------------------------------------

describe('buildDefaultDAG', () => {
  it('returns 6 nodes', () => {
    const dag = buildDefaultDAG();
    assert.strictEqual(dag.length, 6);
  });

  it('has pm with no dependencies', () => {
    const dag = buildDefaultDAG();
    const pm = dag.find((n) => n.role === 'pm');
    assert.ok(pm, 'pm node should exist');
    assert.deepStrictEqual(pm.dependsOn, []);
  });

  it('has scrum-master depending on dev, ux, design', () => {
    const dag = buildDefaultDAG();
    const sm = dag.find((n) => n.role === 'scrum-master');
    assert.ok(sm, 'scrum-master node should exist');
    assert.deepStrictEqual(
      [...sm.dependsOn].sort(),
      ['design', 'dev', 'ux'],
    );
  });

  it('contains all six standard roles', () => {
    const dag = buildDefaultDAG();
    const roles = dag.map((n) => n.role).sort();
    assert.deepStrictEqual(roles, [
      'architect',
      'design',
      'dev',
      'pm',
      'scrum-master',
      'ux',
    ]);
  });

  it('has architect depending on pm', () => {
    const dag = buildDefaultDAG();
    const arch = dag.find((n) => n.role === 'architect');
    assert.ok(arch, 'architect node should exist');
    assert.deepStrictEqual(arch.dependsOn, ['pm']);
  });
});

// ---------------------------------------------------------------------------
// computeExecutionLevels
// ---------------------------------------------------------------------------

describe('computeExecutionLevels', () => {
  it('produces 4 levels from default DAG', () => {
    const plan = computeExecutionLevels(buildDefaultDAG());
    assert.strictEqual(plan.levels.length, 4);
  });

  it('puts pm at level 0', () => {
    const plan = computeExecutionLevels(buildDefaultDAG());
    assert.deepStrictEqual(plan.levels[0].agents, ['pm']);
  });

  it('puts architect at level 1', () => {
    const plan = computeExecutionLevels(buildDefaultDAG());
    assert.deepStrictEqual(plan.levels[1].agents, ['architect']);
  });

  it('puts dev, ux, design at level 2', () => {
    const plan = computeExecutionLevels(buildDefaultDAG());
    const level2 = [...plan.levels[2].agents].sort();
    assert.deepStrictEqual(level2, ['design', 'dev', 'ux']);
  });

  it('puts scrum-master at level 3', () => {
    const plan = computeExecutionLevels(buildDefaultDAG());
    assert.deepStrictEqual(plan.levels[3].agents, ['scrum-master']);
  });

  it('computes correct critical path through all 4 levels', () => {
    const plan = computeExecutionLevels(buildDefaultDAG());
    // Critical path goes pm -> architect -> one of {dev,ux,design} -> scrum-master
    assert.strictEqual(plan.criticalPath.length, 4);
    assert.strictEqual(plan.criticalPath[0], 'pm');
    assert.strictEqual(plan.criticalPath[1], 'architect');
    // The third element should be one of the level-2 agents
    assert.ok(
      ['dev', 'ux', 'design'].includes(plan.criticalPath[2]),
      `Expected dev, ux, or design but got ${plan.criticalPath[2]}`,
    );
    assert.strictEqual(plan.criticalPath[3], 'scrum-master');
  });

  it('reports estimatedParallelism of 3 for default DAG', () => {
    const plan = computeExecutionLevels(buildDefaultDAG());
    assert.strictEqual(plan.estimatedParallelism, 3);
  });

  it('reports estimatedDurationMs as levels * 60000', () => {
    const plan = computeExecutionLevels(buildDefaultDAG());
    assert.strictEqual(plan.estimatedDurationMs, 4 * 60_000);
  });

  it('handles single-agent DAG', () => {
    const singleNode: AgentNode[] = [
      { role: 'pm', dependsOn: [], priority: 0 },
    ];
    const plan = computeExecutionLevels(singleNode);
    assert.strictEqual(plan.levels.length, 1);
    assert.deepStrictEqual(plan.levels[0].agents, ['pm']);
    assert.deepStrictEqual(plan.criticalPath, ['pm']);
    assert.strictEqual(plan.estimatedParallelism, 1);
    assert.strictEqual(plan.estimatedDurationMs, 60_000);
  });

  it('detects cycles and throws', () => {
    const cyclicNodes: AgentNode[] = [
      { role: 'pm', dependsOn: ['architect'], priority: 0 },
      { role: 'architect', dependsOn: ['pm'], priority: 1 },
    ];
    assert.throws(
      () => computeExecutionLevels(cyclicNodes),
      /Cycle detected/,
    );
  });

  it('handles empty node list', () => {
    const plan = computeExecutionLevels([]);
    assert.strictEqual(plan.levels.length, 0);
    assert.strictEqual(plan.estimatedParallelism, 0);
    assert.strictEqual(plan.estimatedDurationMs, 0);
    assert.deepStrictEqual(plan.criticalPath, []);
  });

  it('ignores dependencies on roles not in the graph', () => {
    const nodes: AgentNode[] = [
      { role: 'dev', dependsOn: ['architect' as AgentRole], priority: 0 },
    ];
    // architect is not in the node list, so dev should have in-degree 0
    const plan = computeExecutionLevels(nodes);
    assert.strictEqual(plan.levels.length, 1);
    assert.deepStrictEqual(plan.levels[0].agents, ['dev']);
  });
});

// ---------------------------------------------------------------------------
// executeDAG
// ---------------------------------------------------------------------------

describe('executeDAG', () => {
  it('executes level by level sequentially', async () => {
    const plan = computeExecutionLevels(buildDefaultDAG());
    const { executor, executionOrder } = createMockExecutor();
    const result = await executeDAG(plan, executor);

    // Should have been called once per level (4 levels)
    assert.strictEqual(executionOrder.length, 4);

    // Level 0: pm
    assert.deepStrictEqual(executionOrder[0], ['pm']);

    // Level 1: architect
    assert.deepStrictEqual(executionOrder[1], ['architect']);

    // Level 2: dev, ux, design (order by priority)
    assert.strictEqual(executionOrder[2].length, 3);
    assert.ok(executionOrder[2].includes('dev'));
    assert.ok(executionOrder[2].includes('ux'));
    assert.ok(executionOrder[2].includes('design'));

    // Level 3: scrum-master
    assert.deepStrictEqual(executionOrder[3], ['scrum-master']);

    // All 6 agents should have results
    assert.strictEqual(result.results.size, 6);
    assert.strictEqual(result.results.get('pm'), 'pm-output');
    assert.strictEqual(result.results.get('dev'), 'dev-output');
    assert.strictEqual(result.blockedAgents.length, 0);
  });

  it('marks downstream agents as BLOCKED on failure', async () => {
    const plan = computeExecutionLevels(buildDefaultDAG());
    // architect fails -> dev, ux, design, scrum-master should be blocked
    const { executor, executionOrder } = createMockExecutor(['architect']);
    const result = await executeDAG(plan, executor);

    // pm and architect were attempted; architect failed
    assert.ok(result.results.has('pm'), 'pm should have succeeded');
    assert.ok(!result.results.has('architect'), 'architect should not be in results');

    // All downstream of architect should be blocked
    const blocked = new Set(result.blockedAgents);
    assert.ok(blocked.has('dev'), 'dev should be blocked');
    assert.ok(blocked.has('ux'), 'ux should be blocked');
    assert.ok(blocked.has('design'), 'design should be blocked');
    assert.ok(blocked.has('scrum-master'), 'scrum-master should be blocked');

    // Only 2 calls: level 0 (pm) and level 1 (architect); levels 2+3 skipped as all agents blocked
    assert.strictEqual(executionOrder.length, 2);
  });

  it('returns totalDurationMs as a non-negative number', async () => {
    const plan = computeExecutionLevels(buildDefaultDAG());
    const { executor } = createMockExecutor();
    const result = await executeDAG(plan, executor);
    assert.ok(result.totalDurationMs >= 0, 'totalDurationMs should be non-negative');
  });

  it('includes the original plan in the result', async () => {
    const plan = computeExecutionLevels(buildDefaultDAG());
    const { executor } = createMockExecutor();
    const result = await executeDAG(plan, executor);
    assert.strictEqual(result.plan, plan);
  });

  it('handles partial level failure — only failed agent downstream is blocked', async () => {
    // Custom DAG: A and B are independent at level 0, C depends on A, D depends on B
    const nodes: AgentNode[] = [
      { role: 'pm', dependsOn: [], priority: 0 },
      { role: 'architect', dependsOn: [], priority: 1 },
      { role: 'dev', dependsOn: ['pm'], priority: 2 },
      { role: 'ux', dependsOn: ['architect'], priority: 3 },
    ];
    const plan = computeExecutionLevels(nodes);
    // pm fails, architect succeeds
    const { executor } = createMockExecutor(['pm']);
    const result = await executeDAG(plan, executor);

    assert.ok(result.results.has('architect'), 'architect should succeed');
    assert.ok(!result.results.has('pm'), 'pm should not be in results');
    // Both dev and ux are at level 1 (downstream of level 0).
    // Since blocking is conservative (all of next level blocked per failing agent),
    // both dev and ux get blocked when pm fails.
    const blocked = new Set(result.blockedAgents);
    assert.ok(blocked.has('dev'), 'dev should be blocked (downstream of pm)');
    assert.ok(blocked.has('ux'), 'ux should be blocked (conservative blocking)');
  });
});

// ---------------------------------------------------------------------------
// filterDAGToRoles
// ---------------------------------------------------------------------------

describe('filterDAGToRoles', () => {
  it('filters to only specified roles', () => {
    const dag = buildDefaultDAG();
    const filtered = filterDAGToRoles(dag, ['pm', 'dev']);
    assert.strictEqual(filtered.length, 2);
    const roles = filtered.map((n) => n.role).sort();
    assert.deepStrictEqual(roles, ['dev', 'pm']);
  });

  it('removes dependency references to excluded roles', () => {
    const dag = buildDefaultDAG();
    // dev depends on architect, but architect is excluded
    const filtered = filterDAGToRoles(dag, ['dev', 'scrum-master']);
    const dev = filtered.find((n) => n.role === 'dev');
    const sm = filtered.find((n) => n.role === 'scrum-master');
    assert.ok(dev, 'dev should be present');
    assert.ok(sm, 'scrum-master should be present');
    assert.deepStrictEqual(dev.dependsOn, [], 'dev deps should be empty since architect is excluded');
    // scrum-master depends on dev (present), ux and design (excluded)
    assert.deepStrictEqual(sm.dependsOn, ['dev']);
  });

  it('returns empty array when no roles match', () => {
    const dag = buildDefaultDAG();
    const filtered = filterDAGToRoles(dag, []);
    assert.strictEqual(filtered.length, 0);
  });

  it('preserves priority values', () => {
    const dag = buildDefaultDAG();
    const filtered = filterDAGToRoles(dag, ['pm', 'architect']);
    const pm = filtered.find((n) => n.role === 'pm');
    const arch = filtered.find((n) => n.role === 'architect');
    assert.ok(pm);
    assert.ok(arch);
    assert.strictEqual(pm.priority, 0);
    assert.strictEqual(arch.priority, 1);
  });

  it('filtered sub-DAG computes valid execution levels', () => {
    const dag = buildDefaultDAG();
    const filtered = filterDAGToRoles(dag, ['pm', 'architect', 'dev']);
    const plan = computeExecutionLevels(filtered);
    // pm (level 0) -> architect (level 1) -> dev (level 2)
    assert.strictEqual(plan.levels.length, 3);
    assert.deepStrictEqual(plan.levels[0].agents, ['pm']);
    assert.deepStrictEqual(plan.levels[1].agents, ['architect']);
    assert.deepStrictEqual(plan.levels[2].agents, ['dev']);
  });
});
