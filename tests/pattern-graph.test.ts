import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addEdge,
  detectClusters,
  computeClusterBonus,
  buildGraphFromPatterns,
  type PatternGraph,
} from '../src/core/pattern-graph.ts';

describe('addEdge', () => {
  it('T1: adds an edge to an empty graph and populates nodes', () => {
    const empty: PatternGraph = { nodes: [], edges: [] };
    const result = addEdge(empty, { from: 'A', to: 'B', type: 'strengthens', weight: 0.5 });
    assert.equal(result.edges.length, 1);
    assert.equal(result.edges[0].from, 'A');
    assert.equal(result.edges[0].to, 'B');
    assert.equal(result.edges[0].type, 'strengthens');
    assert.ok(result.nodes.includes('A'));
    assert.ok(result.nodes.includes('B'));
  });

  it('T2: deduplicates identical edges (same from/to/type)', () => {
    const empty: PatternGraph = { nodes: [], edges: [] };
    const edge = { from: 'A', to: 'B', type: 'strengthens' as const, weight: 0.5 };
    const once = addEdge(empty, edge);
    const twice = addEdge(once, edge);
    assert.equal(twice.edges.length, 1);
  });
});

describe('detectClusters', () => {
  it('T3: 3 connected patterns form one cluster', () => {
    let graph: PatternGraph = { nodes: [], edges: [] };
    graph = addEdge(graph, { from: 'A', to: 'B', type: 'strengthens', weight: 0.5 });
    graph = addEdge(graph, { from: 'B', to: 'C', type: 'strengthens', weight: 0.5 });
    const clusters = detectClusters(graph);
    assert.equal(clusters.length, 1);
    const cluster = clusters[0];
    assert.deepEqual(cluster.sort(), ['A', 'B', 'C']);
  });

  it('T4: disconnected patterns produce separate clusters', () => {
    let graph: PatternGraph = { nodes: [], edges: [] };
    graph = addEdge(graph, { from: 'A', to: 'B', type: 'strengthens', weight: 0.5 });
    graph = addEdge(graph, { from: 'C', to: 'D', type: 'strengthens', weight: 0.5 });
    const clusters = detectClusters(graph);
    assert.equal(clusters.length, 2);
    const allMembers = clusters.flat().sort();
    assert.deepEqual(allMembers, ['A', 'B', 'C', 'D']);
  });
});

describe('computeClusterBonus', () => {
  it('T5: returns 1.0 when pattern is not in any cluster', () => {
    // A graph with only conflicts edges — no cluster will be formed
    let graph: PatternGraph = { nodes: ['X', 'Y'], edges: [] };
    graph = addEdge(graph, { from: 'X', to: 'Y', type: 'conflicts', weight: 0.8 });
    const bonus = computeClusterBonus('X', graph, ['Y']);
    assert.equal(bonus, 1.0);
  });

  it('T6: returns correct bonus for 2, 3, and 4+ co-patterns', () => {
    // Build a cluster of 5: A-B-C-D-E all strengthens
    let graph: PatternGraph = { nodes: [], edges: [] };
    const names = ['A', 'B', 'C', 'D', 'E'];
    for (let i = 0; i < names.length - 1; i++) {
      graph = addEdge(graph, { from: names[i], to: names[i + 1], type: 'strengthens', weight: 0.5 });
    }

    // 2 co-patterns → 1.2
    const bonus2 = computeClusterBonus('A', graph, ['B', 'C']);
    assert.equal(bonus2, 1.2);

    // 3 co-patterns → 1.5
    const bonus3 = computeClusterBonus('A', graph, ['B', 'C', 'D']);
    assert.equal(bonus3, 1.5);

    // 4+ co-patterns → 2.0
    const bonus4 = computeClusterBonus('A', graph, ['B', 'C', 'D', 'E']);
    assert.equal(bonus4, 2.0);
  });
});

describe('buildGraphFromPatterns', () => {
  it('T7: same-category patterns get strengthens edges', () => {
    const patterns = [
      { patternName: 'error-handling', category: 'resilience' },
      { patternName: 'timeout-guard', category: 'resilience' },
    ];
    const graph = buildGraphFromPatterns(patterns);
    const strengthensEdge = graph.edges.find(
      (e) =>
        e.type === 'strengthens' &&
        ((e.from === 'error-handling' && e.to === 'timeout-guard') ||
          (e.from === 'timeout-guard' && e.to === 'error-handling')),
    );
    assert.ok(strengthensEdge !== undefined, 'expected a strengthens edge between same-category patterns');
    assert.equal(strengthensEdge.weight, 0.5);
  });

  it('T8: mock↔integration patterns get conflicts edge', () => {
    const patterns = [
      { patternName: 'mock-service', category: 'testing' },
      { patternName: 'integration-tests', category: 'testing' },
    ];
    const graph = buildGraphFromPatterns(patterns);
    const conflictsEdge = graph.edges.find(
      (e) => e.type === 'conflicts' && e.from === 'mock-service' && e.to === 'integration-tests',
    );
    assert.ok(conflictsEdge !== undefined, 'expected a conflicts edge from mock to integration pattern');
    assert.equal(conflictsEdge.weight, 0.8);
  });
});
