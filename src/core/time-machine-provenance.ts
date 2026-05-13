import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { DecisionNode } from './decision-node.js';
import type { TimeMachineCommit, TimeMachineSnapshotEntry } from './time-machine.js';

export interface LineProvenanceRecord {
  commitId: string;
  label: string;
  createdAt: string;
  sourceLine: number;
}

export interface LineProvenanceIndex {
  schemaVersion: 'danteforge.time-machine.provenance.v1';
  updatedAt: string;
  commits: Record<string, { files: Record<string, LineProvenanceRecord[]> }>;
}

export interface LineProvenanceQueryResult extends LineProvenanceRecord {
  path: string;
  line: number;
  decisionNode?: {
    id: string;
    sessionId: string;
    timelineId: string;
    timestamp: string;
    actor: DecisionNode['actor'];
    prompt: string;
  };
}

export async function writeLineProvenanceIndex(options: {
  cwd: string;
  root: string;
  commits: TimeMachineCommit[];
}): Promise<LineProvenanceIndex> {
  const index = await buildLineProvenanceIndex(options);
  await fs.mkdir(path.join(options.root, 'index'), { recursive: true });
  await fs.writeFile(indexPath(options.root), JSON.stringify(index, null, 2) + '\n', 'utf8');
  return index;
}

export async function queryLineProvenance(options: {
  cwd: string;
  root: string;
  commits: TimeMachineCommit[];
  commitId: string;
  filePath: string;
  line: number;
}): Promise<LineProvenanceQueryResult | null> {
  const normalized = normalizePath(options.filePath);
  const index = await loadOrBuildLineProvenanceIndex(options);
  const record = index.commits[options.commitId]?.files[normalized]?.[options.line - 1];
  if (!record) return null;
  const decisionNode = await findDecisionNodeForCommit(options.cwd, record.commitId);
  return {
    ...record,
    path: normalized,
    line: options.line,
    ...(decisionNode ? { decisionNode } : {}),
  };
}

async function loadOrBuildLineProvenanceIndex(options: {
  cwd: string;
  root: string;
  commits: TimeMachineCommit[];
}): Promise<LineProvenanceIndex> {
  try {
    const raw = await fs.readFile(indexPath(options.root), 'utf8');
    const parsed = JSON.parse(raw) as LineProvenanceIndex;
    const knownIds = new Set(options.commits.map(commit => commit.commitId));
    const hasAllCommits = options.commits.every(commit => parsed.commits[commit.commitId]);
    if (hasAllCommits && Object.keys(parsed.commits).every(commitId => knownIds.has(commitId))) return parsed;
  } catch {
    // Rebuild below from canonical commit objects and blobs.
  }
  return writeLineProvenanceIndex(options);
}

async function buildLineProvenanceIndex(options: {
  root: string;
  commits: TimeMachineCommit[];
}): Promise<LineProvenanceIndex> {
  const currentFiles = new Map<string, LineProvenanceRecord[]>();
  const currentLines = new Map<string, string[]>();
  const commits: LineProvenanceIndex['commits'] = {};

  for (const commit of options.commits) {
    for (const entry of commit.entries) {
      if (entry.contentType === 'binary') continue;
      const lines = await readEntryLines(options.root, entry);
      const previousLines = currentLines.get(entry.path) ?? [];
      const previousRecords = currentFiles.get(entry.path) ?? [];
      const records = attributeLines(previousLines, previousRecords, lines, commit);
      currentLines.set(entry.path, lines);
      currentFiles.set(entry.path, records);
    }
    commits[commit.commitId] = { files: cloneFileMap(currentFiles) };
  }

  return {
    schemaVersion: 'danteforge.time-machine.provenance.v1',
    updatedAt: new Date().toISOString(),
    commits,
  };
}

function attributeLines(
  previousLines: string[],
  previousRecords: LineProvenanceRecord[],
  nextLines: string[],
  commit: TimeMachineCommit,
): LineProvenanceRecord[] {
  if (previousLines.length === 0 || previousRecords.length === 0) {
    return nextLines.map((_, index) => recordForCommit(commit, index + 1));
  }
  const matches = lcsLineMatches(previousLines, nextLines);
  return nextLines.map((_, index) => {
    const previousIndex = matches.get(index);
    if (previousIndex !== undefined && previousRecords[previousIndex]) {
      return previousRecords[previousIndex]!;
    }
    return recordForCommit(commit, index + 1);
  });
}

function lcsLineMatches(previous: string[], next: string[]): Map<number, number> {
  const rows = previous.length + 1;
  const cols = next.length + 1;
  const table = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = previous.length - 1; i >= 0; i -= 1) {
    for (let j = next.length - 1; j >= 0; j -= 1) {
      table[i]![j] = previous[i] === next[j]
        ? table[i + 1]![j + 1]! + 1
        : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  const matches = new Map<number, number>();
  let i = 0;
  let j = 0;
  while (i < previous.length && j < next.length) {
    if (previous[i] === next[j]) {
      matches.set(j, i);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return matches;
}

async function readEntryLines(root: string, entry: TimeMachineSnapshotEntry): Promise<string[]> {
  const content = await fs.readFile(path.join(root, 'blobs', entry.blobHash), 'utf8');
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function recordForCommit(commit: TimeMachineCommit, sourceLine: number): LineProvenanceRecord {
  return {
    commitId: commit.commitId,
    label: commit.label,
    createdAt: commit.createdAt,
    sourceLine,
  };
}

function cloneFileMap(files: Map<string, LineProvenanceRecord[]>): Record<string, LineProvenanceRecord[]> {
  const out: Record<string, LineProvenanceRecord[]> = {};
  for (const [filePath, records] of files.entries()) {
    out[filePath] = records.map(record => ({ ...record }));
  }
  return out;
}

// ── Decision-node lookup cache ─────────────────────────────────────────────
//
// `findDecisionNodeForCommit` is on the hot path for line-provenance queries
// (`queryLineProvenance` calls it once per query, and a typical war-room or
// time-machine UI emits dozens of queries per session). The naive impl read
// the entire `decision-nodes.jsonl` store on every call — O(n) per query,
// where n is the total decision-node history. That scaled badly: a session
// with 100 line queries against a 5000-node store re-read ~500MB cumulative.
//
// This module-level cache builds a `Map<fileStateRef, DecisionNodeSummary>`
// once per (cwd, store-mtime) pair, then serves all subsequent queries in
// O(1). The cache invalidates automatically when the JSONL's mtime changes
// (so a fresh recording isn't masked by a stale cache).
//
// Use `clearProvenanceCache()` for explicit invalidation in tests or
// long-running processes that mutate the store outside the normal append
// path.

type DecisionNodeSummary = NonNullable<LineProvenanceQueryResult['decisionNode']>;

interface CacheEntry {
  mtimeMs: number;
  /** Last time this entry was read (hit or build). Drives LRU eviction. */
  lastAccessMs: number;
  byFileStateRef: Map<string, DecisionNodeSummary>;
}

const DECISION_NODE_CACHE: Map<string, CacheEntry> = new Map();

interface CacheCounters {
  hits: number;
  misses: number;
  rebuilds: number;
  evictions: number;
}

const CACHE_COUNTERS: CacheCounters = { hits: 0, misses: 0, rebuilds: 0, evictions: 0 };

/**
 * Drop the in-memory decision-node lookup cache. Call between tests, or
 * after an out-of-band mutation to `<cwd>/.danteforge/decision-nodes.jsonl`
 * that wouldn't show up in mtime.
 *
 * Counters survive a `clearProvenanceCache()` so a TUI can show
 * "cache reset; lifetime hits=N" — use `resetProvenanceCacheStats()` to
 * zero them out explicitly.
 */
export function clearProvenanceCache(): void {
  DECISION_NODE_CACHE.clear();
}

export interface ProvenanceCacheStats {
  /** Number of distinct decision-node stores currently indexed. */
  stores: number;
  /** Total decision-node entries the cache is holding across all stores. */
  entries: number;
  /** Cumulative hits since process start or last `resetProvenanceCacheStats()`. */
  hits: number;
  /** Cumulative misses since process start or last `resetProvenanceCacheStats()`. */
  misses: number;
  /** How many times the cache rebuilt an entry due to mtime change. */
  rebuilds: number;
  /** How many entries were evicted by `pruneProvenanceCache`. */
  evictions: number;
  /** Hit rate in [0, 1], or `null` when no lookups have happened yet. */
  hitRate: number | null;
}

/**
 * Cache introspection — used by the war-room dashboard and `danteforge
 * doctor --live` to surface whether the in-process provenance cache is
 * doing useful work. Returns store counts, entry counts, and lifetime
 * hit/miss counters so an operator can verify the cache is actually
 * serving lookups (not just sitting unused).
 */
export function getProvenanceCacheStats(): ProvenanceCacheStats {
  let entries = 0;
  for (const e of DECISION_NODE_CACHE.values()) entries += e.byFileStateRef.size;
  const total = CACHE_COUNTERS.hits + CACHE_COUNTERS.misses;
  return {
    stores: DECISION_NODE_CACHE.size,
    entries,
    hits: CACHE_COUNTERS.hits,
    misses: CACHE_COUNTERS.misses,
    rebuilds: CACHE_COUNTERS.rebuilds,
    evictions: CACHE_COUNTERS.evictions,
    hitRate: total === 0 ? null : CACHE_COUNTERS.hits / total,
  };
}

/**
 * Zero the cache hit/miss/rebuild/eviction counters without touching the
 * entries themselves. Useful when a long-running session wants to measure
 * cache performance for a specific time window (e.g. one war-room render).
 */
export function resetProvenanceCacheStats(): void {
  CACHE_COUNTERS.hits = 0;
  CACHE_COUNTERS.misses = 0;
  CACHE_COUNTERS.rebuilds = 0;
  CACHE_COUNTERS.evictions = 0;
}

/**
 * Evict cache entries down to `maxStores` using LRU order (least recently
 * accessed first). A no-op when the cache is already at or below the cap.
 *
 * Long-running TUI sessions can call this once per render tick to keep
 * the cache bounded — without it, the decision-node cache grows linearly
 * with the number of distinct projects visited in a single process.
 *
 * Returns the number of entries actually evicted.
 */
export function pruneProvenanceCache(maxStores: number): number {
  if (!Number.isFinite(maxStores) || maxStores < 0) {
    throw new TypeError(`pruneProvenanceCache: maxStores must be a non-negative finite number, got ${maxStores}`);
  }
  if (DECISION_NODE_CACHE.size <= maxStores) return 0;

  // Sort entries oldest-access first; evict the head until we're at the cap.
  const ordered = [...DECISION_NODE_CACHE.entries()].sort(
    (a, b) => a[1].lastAccessMs - b[1].lastAccessMs,
  );
  let evicted = 0;
  for (const [key] of ordered) {
    if (DECISION_NODE_CACHE.size <= maxStores) break;
    DECISION_NODE_CACHE.delete(key);
    evicted += 1;
  }
  CACHE_COUNTERS.evictions += evicted;
  return evicted;
}

async function findDecisionNodeForCommit(
  cwd: string,
  commitId: string,
): Promise<DecisionNodeSummary | undefined> {
  const storePath = path.join(cwd, '.danteforge', 'decision-nodes.jsonl');
  if (!existsSync(storePath)) return undefined;

  // Cache key is the absolute store path; mtime guards staleness.
  let entry = DECISION_NODE_CACHE.get(storePath);
  let currentMtime: number;
  try {
    const stat = await fs.stat(storePath);
    currentMtime = stat.mtimeMs;
  } catch {
    // If we can't stat, fall back to an uncached read so we never serve
    // stale data on a removed-then-restored store.
    return findDecisionNodeUncached(storePath, commitId);
  }

  if (!entry || entry.mtimeMs !== currentMtime) {
    CACHE_COUNTERS.misses += 1;
    if (entry) CACHE_COUNTERS.rebuilds += 1;
    entry = await buildDecisionNodeIndex(storePath, currentMtime);
    DECISION_NODE_CACHE.set(storePath, entry);
  } else {
    CACHE_COUNTERS.hits += 1;
    entry.lastAccessMs = Date.now();
  }
  return entry.byFileStateRef.get(commitId);
}

async function buildDecisionNodeIndex(storePath: string, mtimeMs: number): Promise<CacheEntry> {
  const byFileStateRef = new Map<string, DecisionNodeSummary>();
  const lastAccessMs = Date.now();
  const raw = await fs.readFile(storePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const node = JSON.parse(line) as DecisionNode;
      const fsRef = node.output?.fileStateRef;
      if (!fsRef) continue;
      // Last write wins — JSONL grows append-only, so later entries override
      // earlier ones for the same fileStateRef (e.g. a re-record of the
      // same commit).
      byFileStateRef.set(fsRef, {
        id: node.id,
        sessionId: node.sessionId,
        timelineId: node.timelineId,
        timestamp: node.timestamp,
        actor: node.actor,
        prompt: node.input.prompt,
      });
    } catch {
      // Skip malformed lines; provenance queries should stay best-effort.
    }
  }
  return { mtimeMs, lastAccessMs, byFileStateRef };
}

/**
 * Fallback path used only when `fs.stat` on the store fails. Mirrors the
 * pre-cache behavior so a transiently-missing stat doesn't return wrong
 * results — just slower ones.
 */
async function findDecisionNodeUncached(
  storePath: string,
  commitId: string,
): Promise<DecisionNodeSummary | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(storePath, 'utf8');
  } catch {
    return undefined;
  }
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const node = JSON.parse(line) as DecisionNode;
      if (node.output?.fileStateRef === commitId) {
        return {
          id: node.id,
          sessionId: node.sessionId,
          timelineId: node.timelineId,
          timestamp: node.timestamp,
          actor: node.actor,
          prompt: node.input.prompt,
        };
      }
    } catch {
      // skip
    }
  }
  return undefined;
}

function indexPath(root: string): string {
  return path.join(root, 'index', 'line-provenance-index.json');
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '');
}

// ── Session Graph ─────────────────────────────────────────────────────────────

export interface SessionGraphNode {
  id: string;
  parentId: string | null;
  timelineId: string;
  timestamp: string;
  prompt: string;
  /** IDs of child nodes (parent → child edges) */
  children: string[];
}

export interface SessionGraph {
  schemaVersion: 'danteforge.time-machine.session-graph.v1';
  sessionId: string;
  nodes: Record<string, SessionGraphNode>;
  /** Root node ids (parentId is null or parent is in a different session) */
  roots: string[];
  /** Timeline IDs present in this session */
  timelines: string[];
}

/**
 * Build a DAG of DecisionNodes for a given session.
 * Edges are parent→child via node.causal.dependentOn and node.parentId.
 * Re-gent pattern: session DAG enables fork/rewind browsing.
 */
export async function buildSessionGraph(
  sessionId: string,
  store: import('./decision-node.js').DecisionNodeStore,
): Promise<SessionGraph> {
  const nodes = await store.getBySession(sessionId);

  const nodeMap: Record<string, SessionGraphNode> = {};
  const timelinesSet = new Set<string>();

  for (const node of nodes) {
    nodeMap[node.id] = {
      id: node.id,
      parentId: node.parentId,
      timelineId: node.timelineId,
      timestamp: node.timestamp,
      prompt: node.input.prompt,
      children: [],
    };
    timelinesSet.add(node.timelineId);
  }

  // Wire child edges: use parentId first, then causal.dependentOn as supplementary
  const sessionIds = new Set(nodes.map(n => n.id));
  for (const node of nodes) {
    if (node.parentId && sessionIds.has(node.parentId)) {
      nodeMap[node.parentId]!.children.push(node.id);
    }
    for (const depId of node.causal?.dependentOn ?? []) {
      if (depId !== node.parentId && sessionIds.has(depId)) {
        if (!nodeMap[depId]!.children.includes(node.id)) {
          nodeMap[depId]!.children.push(node.id);
        }
      }
    }
  }

  const roots = nodes
    .filter(n => !n.parentId || !sessionIds.has(n.parentId))
    .map(n => n.id);

  return {
    schemaVersion: 'danteforge.time-machine.session-graph.v1',
    sessionId,
    nodes: nodeMap,
    roots,
    timelines: [...timelinesSet],
  };
}

export interface SessionGraphMetrics {
  /** Total node count. */
  nodeCount: number;
  /** Nodes with no children — terminal states of each branch. */
  leafCount: number;
  /** Nodes with more than one child — divergence points where the
   *  agent forked into multiple timelines. */
  branchPointCount: number;
  /** Distinct timeline IDs present in the session. */
  timelineCount: number;
  /** Longest root-to-leaf depth, 1-indexed (a session with one node
   *  reports `maxDepth = 1`). Returns 0 for an empty graph. */
  maxDepth: number;
}

/**
 * Derive summary metrics from a session graph. Purely additive — does not
 * mutate the input. Designed for war-room headers and `danteforge time-
 * machine session` --metrics, where the dashboard wants a one-glance
 * verdict (e.g. "12 nodes, 3 branches, depth 5") before drilling in.
 */
export function computeSessionGraphMetrics(graph: SessionGraph): SessionGraphMetrics {
  const nodes = Object.values(graph.nodes);
  if (nodes.length === 0) {
    return { nodeCount: 0, leafCount: 0, branchPointCount: 0, timelineCount: graph.timelines.length, maxDepth: 0 };
  }

  let leafCount = 0;
  let branchPointCount = 0;
  for (const node of nodes) {
    if (node.children.length === 0) leafCount += 1;
    if (node.children.length > 1) branchPointCount += 1;
  }

  // Depth: BFS from each root; track max distance. A node is visited at most
  // once per BFS to avoid runaway cost on cyclic data (the schema disallows
  // cycles, but defensive code keeps this safe in the face of corrupt input).
  let maxDepth = 0;
  for (const rootId of graph.roots) {
    const root = graph.nodes[rootId];
    if (!root) continue;
    const queue: Array<{ id: string; depth: number }> = [{ id: rootId, depth: 1 }];
    const seen = new Set<string>([rootId]);
    while (queue.length > 0) {
      const head = queue.shift();
      if (!head) break;
      if (head.depth > maxDepth) maxDepth = head.depth;
      const current = graph.nodes[head.id];
      if (!current) continue;
      for (const childId of current.children) {
        if (seen.has(childId)) continue;
        seen.add(childId);
        queue.push({ id: childId, depth: head.depth + 1 });
      }
    }
  }

  return {
    nodeCount: nodes.length,
    leafCount,
    branchPointCount,
    timelineCount: graph.timelines.length,
    maxDepth,
  };
}
