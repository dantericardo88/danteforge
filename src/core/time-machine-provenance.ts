import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import type { DecisionNode, DecisionNodeStore } from './decision-node.js';
import type { TimeMachineCommit, TimeMachineSnapshotEntry } from './time-machine.js';

export const PROVENANCE_SCHEMA_VERSION = 'danteforge.time-machine.provenance.v2' as const;

export interface LineProvenanceRecord {
  commitId: string;
  label: string;
  createdAt: string;
  sourceLine: number;
}

/** Per-file provenance as of one commit. `blobHash` lets an incremental update
 *  read this version's text later to diff the NEXT version — so the index is
 *  self-sufficient and the hot path never has to reload commit objects. */
export interface LineProvenanceFileNode {
  blobHash: string;
  records: LineProvenanceRecord[];
}

/** A commit stores ONLY the files it touched (a DELTA), plus its parent so a
 *  query can walk back to the nearest ancestor that touched a file. This is what
 *  makes the index O(edited content) instead of O(commits × files × lines) — the
 *  unbounded full-clone-per-commit model was the 500+ MB / OOM root cause. */
export interface LineProvenanceCommitNode {
  parent: string | null;
  files: Record<string, LineProvenanceFileNode>;
}

export interface LineProvenanceIndex {
  schemaVersion: typeof PROVENANCE_SCHEMA_VERSION;
  updatedAt: string;
  commits: Record<string, LineProvenanceCommitNode>;
}

/** How the provenance engine pulls commits without holding all of them in
 *  memory: list ids cheaply (from the reflog), load one at a time for a
 *  streaming rebuild. Supplied by time-machine.ts. */
export interface ProvenanceCommitSource {
  listCommitIds: () => Promise<string[]>;
  loadCommit: (commitId: string) => Promise<TimeMachineCommit>;
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

// v2 lives in a NEW file so the (possibly gigantic) v1 line-provenance-index.json
// is never parsed — loading it would OOM by itself (it grew past 500 MB under the
// old full-clone-per-commit model). The legacy file is deleted on the first v2 write.
const INDEX_FILENAME = 'line-provenance-index-v2.json';
const LEGACY_INDEX_FILENAME = 'line-provenance-index.json';

// Per-file LCS is O(prev × next); cap it so one giant file can't become a compute
// bomb. Past the cap, attribute every line to the current commit (coarser, safe).
const LCS_LINE_CAP = 4000;

// Skip files where per-line provenance is meaningless AND ruinously expensive:
// bulk machine-generated evidence/receipts that get re-snapshotted wholesale on
// every validate/forge cycle (thousands of files × thousands of commits = the
// compute bomb + the 500 MB index), the time-machine store itself, and oversized
// blobs. Real source/docs/ledger files are kept.
function isProvenanceWorthy(entry: TimeMachineSnapshotEntry): boolean {
  if (entry.contentType === 'binary') return false;
  if (entry.byteLength > 512 * 1024) return false;
  const p = entry.path.replace(/\\/g, '/');
  if (p.includes('.danteforge/outcome-evidence/')) return false;
  if (p.includes('.danteforge/time-machine/')) return false;
  if (p.includes('.danteforge/harden-receipts/')) return false;
  if (p.includes('.danteforge/reports/')) return false;
  if (p.includes('/evidence-export/')) return false;
  return true;
}

function freshIndex(): LineProvenanceIndex {
  return { schemaVersion: PROVENANCE_SCHEMA_VERSION, updatedAt: '', commits: {} };
}

/**
 * Full rebuild — STREAMING. Loads one commit at a time (never the whole reflog
 * array) and writes per-commit DELTAS (only the provenance-worthy files that
 * commit touched). Used for repair + the lazy self-heal on query, NOT on the
 * commit hot path. Peak memory is the working set of tracked source files, not
 * commits × files.
 */
export async function writeLineProvenanceIndex(options: {
  root: string;
  source: ProvenanceCommitSource;
}): Promise<LineProvenanceIndex> {
  const index = await rebuildStreaming(options.root, options.source);
  await persistIndex(options.root, index);
  // Reclaim the legacy v1 monster (can be hundreds of MB) — best-effort.
  await fs.rm(path.join(options.root, 'index', LEGACY_INDEX_FILENAME), { force: true }).catch(() => {});
  return index;
}

/**
 * Hot-path incremental append: index ONLY the provenance-worthy files the new
 * commit touched, diffing against the nearest ancestor already in the index.
 * O(touched worthy files) — never reloads history, never rebuilds. This replaced
 * the per-commit full rebuild that loaded all commits and OOMed at 3316.
 */
export async function updateLineProvenanceForCommit(options: {
  root: string;
  commit: TimeMachineCommit;
}): Promise<void> {
  const index = (await readIndexFile(options.root)) ?? freshIndex();
  await appendCommit(options.root, index, options.commit);
  await persistIndex(options.root, index);
}

export async function queryLineProvenance(options: {
  cwd: string;
  root: string;
  source: ProvenanceCommitSource;
  commitId: string;
  filePath: string;
  line: number;
}): Promise<LineProvenanceQueryResult | null> {
  const normalized = normalizePath(options.filePath);
  const index = await loadOrBuildIndex(options.root, options.source);
  const node = findFileNode(index, options.commitId, normalized);
  const record = node?.records[options.line - 1];
  if (!record) return null;
  const decisionNode = await findDecisionNodeForCommit(options.cwd, record.commitId);
  return {
    ...record,
    path: normalized,
    line: options.line,
    ...(decisionNode ? { decisionNode } : {}),
  };
}

// Return the cached index iff it is v2 AND covers exactly the full commit set
// (no missing, no extra). Otherwise rebuild (streaming). A partial/hot-path index
// is never served to a query — the gate forces a one-time full rebuild, after
// which incremental appends keep it complete.
async function loadOrBuildIndex(root: string, source: ProvenanceCommitSource): Promise<LineProvenanceIndex> {
  const existing = await readIndexFile(root);
  if (existing) {
    const ids = await source.listCommitIds();
    const known = new Set(ids);
    const hasAll = ids.every(id => existing.commits[id]);
    const noExtra = Object.keys(existing.commits).every(id => known.has(id));
    if (hasAll && noExtra) return existing;
  }
  return writeLineProvenanceIndex({ root, source });
}

async function rebuildStreaming(root: string, source: ProvenanceCommitSource): Promise<LineProvenanceIndex> {
  const index = freshIndex();
  const currentLines = new Map<string, string[]>();
  const currentRecords = new Map<string, LineProvenanceRecord[]>();
  for (const commitId of await source.listCommitIds()) {
    let commit: TimeMachineCommit;
    try { commit = await source.loadCommit(commitId); } catch { continue; }
    const parent = commit.parents[0] ?? null;
    const files: Record<string, LineProvenanceFileNode> = {};
    for (const entry of commit.entries) {
      if (!isProvenanceWorthy(entry)) continue;
      const key = normalizePath(entry.path);
      const nextLines = await readBlobLines(root, entry.blobHash).catch(() => [] as string[]);
      const records = attribute(currentLines.get(key) ?? [], currentRecords.get(key) ?? [], nextLines, commit);
      currentLines.set(key, nextLines);
      currentRecords.set(key, records);
      files[key] = { blobHash: entry.blobHash, records };
    }
    index.commits[commit.commitId] = { parent, files };
  }
  return index;
}

async function appendCommit(root: string, index: LineProvenanceIndex, commit: TimeMachineCommit): Promise<void> {
  const parent = commit.parents[0] ?? null;
  const files: Record<string, LineProvenanceFileNode> = {};
  for (const entry of commit.entries) {
    if (!isProvenanceWorthy(entry)) continue;
    const key = normalizePath(entry.path);
    const nextLines = await readBlobLines(root, entry.blobHash).catch(() => [] as string[]);
    const prev = findFileNode(index, parent, key);
    const prevLines = prev ? await readBlobLines(root, prev.blobHash).catch(() => [] as string[]) : [];
    const records = attribute(prevLines, prev?.records ?? [], nextLines, commit);
    files[key] = { blobHash: entry.blobHash, records };
  }
  index.commits[commit.commitId] = { parent, files };
}

// Walk from `startCommitId` toward root; return the file's records as of the
// nearest ancestor that touched it. Unchanged lines keep the commitId that
// originally introduced them (attribute() reuses records by reference), so the
// answer matches the old full-clone model for every (commit, path, line).
function findFileNode(index: LineProvenanceIndex, startCommitId: string | null, key: string): LineProvenanceFileNode | undefined {
  let id = startCommitId;
  const seen = new Set<string>();
  while (id && !seen.has(id)) {
    seen.add(id);
    const node = index.commits[id];
    if (!node) return undefined;
    const fileNode = node.files[key];
    if (fileNode) return fileNode;
    id = node.parent;
  }
  return undefined;
}

function attribute(
  previousLines: string[],
  previousRecords: LineProvenanceRecord[],
  nextLines: string[],
  commit: TimeMachineCommit,
): LineProvenanceRecord[] {
  if (previousLines.length === 0 || previousRecords.length === 0) {
    return nextLines.map((_, index) => recordForCommit(commit, index + 1));
  }
  if (previousLines.length > LCS_LINE_CAP || nextLines.length > LCS_LINE_CAP) {
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

async function readBlobLines(root: string, blobHash: string): Promise<string[]> {
  const content = await fs.readFile(path.join(root, 'blobs', blobHash), 'utf8');
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

async function readIndexFile(root: string): Promise<LineProvenanceIndex | null> {
  try {
    const raw = await fs.readFile(indexPath(root), 'utf8');
    const parsed = JSON.parse(raw) as LineProvenanceIndex;
    if (parsed.schemaVersion !== PROVENANCE_SCHEMA_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function persistIndex(root: string, index: LineProvenanceIndex): Promise<void> {
  index.updatedAt = new Date().toISOString();
  await fs.mkdir(path.join(root, 'index'), { recursive: true });
  await fs.writeFile(indexPath(root), JSON.stringify(index) + '\n', 'utf8');
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
  return path.join(root, 'index', INDEX_FILENAME);
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
