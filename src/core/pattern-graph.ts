/**
 * Pattern Constellation Engine
 * Directed graph of patterns with strengthens/requires/conflicts edges.
 * Detects clusters and applies cluster bonuses to adoption scoring.
 */

export type PatternEdge = {
  from: string;
  to: string;
  type: 'strengthens' | 'requires' | 'conflicts';
  weight: number;
};

export type PatternGraph = {
  nodes: string[];
  edges: PatternEdge[];
};

/**
 * Adds an edge to the graph, preventing duplicates (same from/to/type).
 */
export function addEdge(graph: PatternGraph, edge: PatternEdge): PatternGraph {
  const exists = graph.edges.some(
    (e) => e.from === edge.from && e.to === edge.to && e.type === edge.type,
  );
  if (exists) return graph;

  const nodes = new Set(graph.nodes);
  nodes.add(edge.from);
  nodes.add(edge.to);

  return {
    nodes: Array.from(nodes),
    edges: [...graph.edges, edge],
  };
}

/**
 * Detects clusters of tightly-connected patterns using SCC (Tarjan's algorithm)
 * combined with Kahn's topological-sort-style reachability.
 * Returns array of clusters (each cluster is an array of pattern names).
 * Singleton nodes are included as single-element clusters only if they have edges.
 */
export function detectClusters(graph: PatternGraph): string[][] {
  // Build adjacency using only non-conflicts edges (strengthens + requires form clusters)
  const adj = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    adj.set(node, new Set());
  }
  for (const edge of graph.edges) {
    if (edge.type === 'conflicts') continue;
    adj.get(edge.from)?.add(edge.to);
    // For cluster detection treat as undirected
    adj.get(edge.to)?.add(edge.from);
  }

  // Union-Find for connected components
  const parent = new Map<string, string>();
  const rank = new Map<string, number>();

  function find(x: string): string {
    if (!parent.has(x)) {
      parent.set(x, x);
      rank.set(x, 0);
    }
    if (parent.get(x) !== x) {
      parent.set(x, find(parent.get(x)!));
    }
    return parent.get(x)!;
  }

  function union(x: string, y: string): void {
    const px = find(x);
    const py = find(y);
    if (px === py) return;
    const rx = rank.get(px) ?? 0;
    const ry = rank.get(py) ?? 0;
    if (rx < ry) {
      parent.set(px, py);
    } else if (rx > ry) {
      parent.set(py, px);
    } else {
      parent.set(py, px);
      rank.set(px, rx + 1);
    }
  }

  // Initialize all nodes
  for (const node of graph.nodes) {
    find(node);
  }

  // Union connected nodes via non-conflict edges
  for (const [node, neighbors] of adj.entries()) {
    for (const neighbor of neighbors) {
      union(node, neighbor);
    }
  }

  // Group by root
  const clusters = new Map<string, string[]>();
  for (const node of graph.nodes) {
    const root = find(node);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root)!.push(node);
  }

  // Only return clusters with 2+ members, or singletons that have any non-conflict edges
  const nodesWithEdges = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.type !== 'conflicts') {
      nodesWithEdges.add(edge.from);
      nodesWithEdges.add(edge.to);
    }
  }

  const result: string[][] = [];
  for (const cluster of clusters.values()) {
    if (cluster.length >= 2 || cluster.some((n) => nodesWithEdges.has(n))) {
      result.push(cluster.sort());
    }
  }

  return result;
}

/**
 * Returns a multiplier based on how many patterns in the same cluster
 * as `patternName` are also in `adoptedPatterns`:
 *   0 co-patterns → 1.0
 *   1 co-pattern  → 1.0 (no bonus for a lone pair by default)
 *   2 co-patterns → 1.2
 *   3 co-patterns → 1.5
 *   4+ co-patterns → 2.0
 */
export function computeClusterBonus(
  patternName: string,
  graph: PatternGraph,
  adoptedPatterns: string[],
): number {
  const clusters = detectClusters(graph);
  const adopted = new Set(adoptedPatterns);

  // Find the cluster containing this pattern
  const myCluster = clusters.find((c) => c.includes(patternName));
  if (!myCluster) return 1.0;

  // Count co-patterns (others in same cluster that are adopted)
  const coPatterns = myCluster.filter((p) => p !== patternName && adopted.has(p));
  const count = coPatterns.length;

  if (count >= 4) return 2.0;
  if (count === 3) return 1.5;
  if (count === 2) return 1.2;
  return 1.0;
}

/**
 * Auto-builds a graph from a list of patterns:
 * - Patterns in the same category get 'strengthens' edges (weight 0.5)
 * - Patterns containing "circuit-breaker" and "retry" get a 'requires' edge (weight 1.0)
 * - Patterns containing "mock" get 'conflicts' edges with patterns containing "integration" (weight 0.8)
 */
export function buildGraphFromPatterns(
  patterns: Array<{ patternName: string; category: string }>,
): PatternGraph {
  let graph: PatternGraph = { nodes: [], edges: [] };

  // Add all nodes
  for (const p of patterns) {
    if (!graph.nodes.includes(p.patternName)) {
      graph = { ...graph, nodes: [...graph.nodes, p.patternName] };
    }
  }

  // Same-category → strengthens edges (avoid self-loops, avoid duplicates via addEdge)
  const byCategory = new Map<string, string[]>();
  for (const p of patterns) {
    if (!byCategory.has(p.category)) byCategory.set(p.category, []);
    byCategory.get(p.category)!.push(p.patternName);
  }

  for (const [, members] of byCategory.entries()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        graph = addEdge(graph, {
          from: members[i],
          to: members[j],
          type: 'strengthens',
          weight: 0.5,
        });
      }
    }
  }

  // circuit-breaker ↔ retry → requires edges
  const circuitBreakers = patterns
    .filter((p) => p.patternName.includes('circuit-breaker'))
    .map((p) => p.patternName);
  const retryPatterns = patterns
    .filter((p) => p.patternName.includes('retry'))
    .map((p) => p.patternName);

  for (const cb of circuitBreakers) {
    for (const retry of retryPatterns) {
      graph = addEdge(graph, { from: cb, to: retry, type: 'requires', weight: 1.0 });
    }
  }

  // mock ↔ integration → conflicts edges
  const mockPatterns = patterns
    .filter((p) => p.patternName.includes('mock'))
    .map((p) => p.patternName);
  const integrationPatterns = patterns
    .filter((p) => p.patternName.includes('integration'))
    .map((p) => p.patternName);

  for (const mock of mockPatterns) {
    for (const intg of integrationPatterns) {
      graph = addEdge(graph, { from: mock, to: intg, type: 'conflicts', weight: 0.8 });
    }
  }

  return graph;
}
