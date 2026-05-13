/**
 * time-machine-timeline.ts
 *
 * ASCII timeline renderer for CounterfactualReplayResult, plus the
 * re_gent-pattern surfaces that turn a DecisionNodeStore into a real
 * agent-activity provenance log:
 *
 *  - Chain-of-custody integrity verifier
 *  - Provenance coverage metrics
 *  - Per-agent activity log
 *  - Deterministic replay verifier
 *  - Merkle root over a filtered activity slice
 *
 * Every surface here is read-only over the store — adding receipts is the
 * responsibility of decision-node-recorder; this module audits what was
 * recorded.
 */
import { hashDecisionNode } from './decision-node.js';
import type { CounterfactualReplayResult } from './time-machine-replay.js';
import type { DecisionNode, DecisionNodeStore } from './decision-node.js';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return '??:??:??';
  }
}

function statusIcon(node: DecisionNode): string {
  return node.output.success ? '✓' : '✗';
}

function formatNodeRow(prefix: string, node: DecisionNode, promptWidth: number): string {
  const icon = statusIcon(node);
  const prompt = truncate(node.input.prompt, promptWidth);
  return `${prefix} ${icon}  ${prompt}`;
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

/**
 * Render a side-by-side ASCII timeline diff from a CounterfactualReplayResult.
 *
 * @param result  The replay result to render.
 * @param width   Terminal width (default 120).
 */
export function renderAsciiTimeline(result: CounterfactualReplayResult, width = 120): string {
  const bar = '═'.repeat(width);
  const thinBar = '─'.repeat(width);
  const halfWidth = Math.floor((width - 3) / 2); // each column width
  const promptWidth = Math.max(20, halfWidth - 12); // allow for prefix + icon

  const lines: string[] = [];

  // Header
  lines.push(bar);
  lines.push(' Time Machine Timeline Diff');
  const branchShort = result.branchPoint.id.slice(0, 8);
  const origShort = result.originalTimelineId.slice(0, 8);
  const altShort = result.newTimelineId.slice(0, 8);
  lines.push(` Branch: ${branchShort}  Original: ${origShort}  Alternate: ${altShort}`);
  lines.push(bar);
  lines.push('');

  // Branch point
  lines.push(`  ${'─── BRANCH POINT ' + '─'.repeat(Math.max(0, width - 20))}`);
  const bpDate = formatDate(result.branchPoint.timestamp);
  const bpRow = formatNodeRow(`  [${bpDate}]`, result.branchPoint, 60);
  lines.push(bpRow);
  lines.push('');

  // Column headers
  const origHeader = 'ORIGINAL TIMELINE';
  const altHeader = 'ALTERNATE TIMELINE';
  const origPadded = origHeader.padEnd(halfWidth);
  lines.push(`  ${origPadded}   ${altHeader}`);
  lines.push(`  ${thinBar}`);
  lines.push('');

  // Convergent nodes (show in both columns)
  for (const node of result.divergence.convergent) {
    const left = formatNodeRow('≡', node, promptWidth);
    const right = formatNodeRow('≡', node, promptWidth);
    const leftPadded = left.padEnd(halfWidth);
    lines.push(`  ${leftPadded} │ ${right}`);
  }

  // Unreachable nodes (original only — left column)
  for (const node of result.divergence.unreachable) {
    const left = formatNodeRow('✗', node, promptWidth);
    const leftPadded = left.padEnd(halfWidth);
    lines.push(`  ${leftPadded} │`);
  }

  // Divergent nodes (alternate only — right column)
  for (const node of result.divergence.divergent) {
    const right = formatNodeRow('↻', node, promptWidth);
    const leftPadded = ''.padEnd(halfWidth);
    lines.push(`  ${leftPadded} │ ${right}`);
  }

  lines.push('');
  lines.push(`  ${thinBar}`);

  // Summary
  const outcomeLabel = result.outcomeEquivalent ? 'YES' : 'NO';
  lines.push(`  Outcome equivalent: ${outcomeLabel}  (or NO)`
    .replace('  (or NO)', '')
    .replace('(or YES)', '')
  );
  // Simple clean line
  lines[lines.length - 1] = `  Outcome equivalent: ${outcomeLabel}`;

  const convergentCount = result.divergence.convergent.length;
  const divergentCount = result.divergence.divergent.length;
  const unreachableCount = result.divergence.unreachable.length;
  lines.push(`  Convergent: ${convergentCount}  │  Divergent: ${divergentCount}  │  Unreachable: ${unreachableCount}`);
  lines.push(bar);

  return lines.join('\n');
}

// ── Chain-of-Custody Integrity (re_gent pattern) ──────────────────────────────

/** Result of verifying a single node's hash and prev-link. */
export interface NodeIntegrityResult {
  /** Node id under inspection */
  nodeId: string;
  /** True when the node's hash matches a fresh hashDecisionNode() */
  hashValid: boolean;
  /** True when this node's prevHash equals the parent's hash */
  prevHashValid: boolean;
  /** When invalid, a short human-readable reason */
  reason?: string;
}

/** Result of verifying a session's chain-of-custody. */
export interface ChainIntegrityReport {
  /** True when every node in scope verifies and chains to its parent */
  valid: boolean;
  /** Number of nodes inspected (across all sessions if no filter applied) */
  nodesChecked: number;
  /** Number of nodes whose hash didn't match a recomputation */
  hashFailures: number;
  /** Number of nodes whose prevHash didn't match the parent's hash */
  prevHashFailures: number;
  /** Nodes that reference a parentId that does not exist in the store */
  orphanCount: number;
  /** Per-failure detail entries (capped) */
  failures: NodeIntegrityResult[];
  /** True when at least one failure looks like deliberate tampering — a
   *  hash mismatch on a node whose parent verified independently. */
  tamperingDetected: boolean;
}

const INTEGRITY_FAILURE_REPORT_CAP = 50;

/**
 * Verify a single DecisionNode in isolation:
 *  - Recompute the hash from its body + prevHash; compare to stored hash.
 *  - When `parent` is provided, also check prevHash === parent.hash.
 *
 * Pure function. Does no I/O. Safe to call from hot paths.
 */
export function verifyDecisionNode(
  node: DecisionNode,
  parent?: DecisionNode | undefined,
): NodeIntegrityResult {
  const { hash: storedHash, ...rest } = node;
  const expectedHash = hashDecisionNode(rest as Omit<DecisionNode, 'hash'>);
  const hashValid = expectedHash === storedHash;

  let prevHashValid = true;
  let reason: string | undefined;

  if (!hashValid) {
    reason = `hash mismatch: stored ${storedHash.slice(0, 12)} expected ${expectedHash.slice(0, 12)}`;
  }

  if (parent !== undefined && node.prevHash !== parent.hash) {
    prevHashValid = false;
    reason = (reason ? reason + '; ' : '') +
      `prevHash mismatch: stored ${(node.prevHash ?? '(null)').slice(0, 12)} expected ${parent.hash.slice(0, 12)}`;
  }

  return {
    nodeId: node.id,
    hashValid,
    prevHashValid,
    ...(reason ? { reason } : {}),
  };
}

/**
 * Collect every node currently in a DecisionNodeStore. Used by integrity
 * scans and coverage reports when no filter is provided.
 *
 * Seeds from `getByTimeline('main')` then drains via per-session lookups —
 * picks up nodes on any timeline as long as their session has at least
 * one main-timeline node (the typical recording pattern).
 */
export async function collectAllNodes(store: DecisionNodeStore): Promise<DecisionNode[]> {
  await store.size();
  const seenSessions = new Set<string>();
  const mainTimeline = await store.getByTimeline('main');
  for (const node of mainTimeline) seenSessions.add(node.sessionId);

  const out = new Map<string, DecisionNode>();
  for (const node of mainTimeline) out.set(node.id, node);

  for (const sessionId of seenSessions) {
    const sessionNodes = await store.getBySession(sessionId);
    for (const node of sessionNodes) out.set(node.id, node);
  }

  return [...out.values()];
}

/**
 * Verify the entire chain-of-custody of a DecisionNodeStore.
 *
 * Walks every node, recomputes its hash, and validates the prev-link to its
 * parent. Detects tampering, orphan parent references, and chain breaks.
 *
 * Filter options compose with AND:
 *  - `sessionId`  — only verify nodes in that session
 *  - `timelineId` — only verify nodes on that timeline
 *  - `actorId`    — only verify nodes by that actor (per-agent audit)
 */
export async function verifyChainOfCustody(
  store: DecisionNodeStore,
  filter?: {
    sessionId?: string;
    timelineId?: string;
    actorId?: string;
  },
): Promise<ChainIntegrityReport> {
  let candidates: DecisionNode[];
  if (filter?.sessionId) {
    candidates = await store.getBySession(filter.sessionId);
  } else if (filter?.timelineId) {
    candidates = await store.getByTimeline(filter.timelineId);
  } else if (filter?.actorId) {
    candidates = await store.getByActor(filter.actorId);
  } else {
    candidates = await collectAllNodes(store);
  }

  if (filter?.timelineId) candidates = candidates.filter(n => n.timelineId === filter.timelineId);
  if (filter?.actorId) candidates = candidates.filter(n => n.actor.id === filter.actorId);

  const byId = new Map(candidates.map(node => [node.id, node]));
  const parentLookups = new Map<string, DecisionNode | undefined>();
  for (const node of candidates) {
    if (node.parentId && !byId.has(node.parentId) && !parentLookups.has(node.parentId)) {
      parentLookups.set(node.parentId, await store.getById(node.parentId));
    }
  }

  const failures: NodeIntegrityResult[] = [];
  let hashFailures = 0;
  let prevHashFailures = 0;
  let orphanCount = 0;
  let tamperingDetected = false;

  for (const node of candidates) {
    const parent: DecisionNode | undefined = node.parentId
      ? (byId.get(node.parentId) ?? parentLookups.get(node.parentId))
      : undefined;
    const isOrphan = node.parentId !== null && parent === undefined;
    if (isOrphan) orphanCount += 1;

    const result = verifyDecisionNode(node, parent);

    if (!result.hashValid) {
      hashFailures += 1;
      if (parent) {
        const parentSelf = verifyDecisionNode(parent);
        if (parentSelf.hashValid) tamperingDetected = true;
      } else {
        tamperingDetected = true;
      }
    }
    if (!result.prevHashValid) prevHashFailures += 1;

    if (!result.hashValid || !result.prevHashValid) {
      if (failures.length < INTEGRITY_FAILURE_REPORT_CAP) failures.push(result);
    }
  }

  return {
    valid: failures.length === 0 && orphanCount === 0,
    nodesChecked: candidates.length,
    hashFailures,
    prevHashFailures,
    orphanCount,
    failures,
    tamperingDetected,
  };
}

// ── Provenance Coverage Metrics (re_gent pattern) ─────────────────────────────

export interface ProvenanceCoverageReport {
  totalNodes: number;
  /** Nodes whose hash and prev-link verified. */
  integrityRate: number;
  /** Nodes that carry an evidenceRef (cross-ecosystem anchor). */
  evidenceRefRate: number;
  /** Nodes that captured output.fileStateRef (links to time-machine commit). */
  fileStateRefRate: number;
  /** Nodes with non-zero costUsd or latencyMs (observability signals). */
  observabilityRate: number;
  /** Nodes with input.context populated (rich replay metadata). */
  contextRate: number;
  /** Non-root nodes whose causal.dependentOn is populated. */
  causalLinkRate: number;
  /** Aggregate "this provenance store is fully populated" score in [0,1]. */
  coverageScore: number;
  /** Distinct actor ids that have at least one node. */
  actorIds: string[];
  /** Distinct timeline ids observed. */
  timelineIds: string[];
  /** Distinct session ids observed. */
  sessionIds: string[];
}

/**
 * Compute a coverage report over a DecisionNodeStore (optionally filtered to
 * a single session). A high coverage score means every recorded activity
 * emits the receipts needed for downstream tooling: replay, audit, and
 * chain-of-custody verification.
 *
 * The aggregate `coverageScore` weights load-bearing dimensions:
 *   integrity 30%, fileStateRef 20%, causalLink 20%, evidenceRef 15%,
 *   observability 10%, context 5%
 */
export async function computeProvenanceCoverage(
  store: DecisionNodeStore,
  options?: { sessionId?: string },
): Promise<ProvenanceCoverageReport> {
  const nodes = options?.sessionId
    ? await store.getBySession(options.sessionId)
    : await collectAllNodes(store);

  if (nodes.length === 0) {
    return {
      totalNodes: 0,
      integrityRate: 1.0,
      evidenceRefRate: 0,
      fileStateRefRate: 0,
      observabilityRate: 0,
      contextRate: 0,
      causalLinkRate: 0,
      coverageScore: 0,
      actorIds: [],
      timelineIds: [],
      sessionIds: [],
    };
  }

  const integrityReport = await verifyChainOfCustody(
    store,
    options?.sessionId ? { sessionId: options.sessionId } : undefined,
  );
  const integrityRate = (nodes.length - integrityReport.failures.length) / nodes.length;

  let evidenceRefCount = 0;
  let fileStateRefCount = 0;
  let observabilityCount = 0;
  let contextCount = 0;
  let causalLinkCount = 0;
  let nonRootCount = 0;
  const actorIds = new Set<string>();
  const timelineIds = new Set<string>();
  const sessionIds = new Set<string>();

  for (const node of nodes) {
    if (typeof node.evidenceRef === 'string' && node.evidenceRef.length > 0) evidenceRefCount += 1;
    if (typeof node.output.fileStateRef === 'string' && node.output.fileStateRef.length > 0) fileStateRefCount += 1;
    if ((node.output.costUsd ?? 0) > 0 || (node.output.latencyMs ?? 0) > 0) observabilityCount += 1;
    if (node.input.context && Object.keys(node.input.context).length > 0) contextCount += 1;
    if (node.parentId !== null) {
      nonRootCount += 1;
      if ((node.causal?.dependentOn ?? []).length > 0) causalLinkCount += 1;
    }
    actorIds.add(node.actor.id);
    timelineIds.add(node.timelineId);
    sessionIds.add(node.sessionId);
  }

  const evidenceRefRate = evidenceRefCount / nodes.length;
  const fileStateRefRate = fileStateRefCount / nodes.length;
  const observabilityRate = observabilityCount / nodes.length;
  const contextRate = contextCount / nodes.length;
  const causalLinkRate = nonRootCount === 0 ? 1 : causalLinkCount / nonRootCount;

  const coverageScore =
    integrityRate * 0.30 +
    fileStateRefRate * 0.20 +
    causalLinkRate * 0.20 +
    evidenceRefRate * 0.15 +
    observabilityRate * 0.10 +
    contextRate * 0.05;

  return {
    totalNodes: nodes.length,
    integrityRate,
    evidenceRefRate,
    fileStateRefRate,
    observabilityRate,
    contextRate,
    causalLinkRate,
    coverageScore,
    actorIds: [...actorIds].sort(),
    timelineIds: [...timelineIds].sort(),
    sessionIds: [...sessionIds].sort(),
  };
}

// ── Per-Agent Activity Log (re_gent pattern) ──────────────────────────────────

export interface AgentActivityRow {
  actorId: string;
  actorType: DecisionNode['actor']['type'];
  product: DecisionNode['actor']['product'];
  /** Total decisions recorded by this actor in scope. */
  decisionCount: number;
  /** Decisions whose output.success === true. */
  successCount: number;
  /** Aggregate latency across all decisions, in milliseconds. */
  totalLatencyMs: number;
  /** Aggregate cost across all decisions, in USD. */
  totalCostUsd: number;
  /** Earliest timestamp seen for this actor. */
  firstAt: string;
  /** Latest timestamp seen for this actor. */
  lastAt: string;
  /** Distinct timelines this actor participated in. */
  timelines: string[];
  /** Distinct sessions this actor participated in. */
  sessions: string[];
}

/**
 * Build a per-agent activity log from a DecisionNodeStore.
 *
 * One row per `(actor.type, actor.id)` pair, sorted hottest-first.
 * Use options.sessionId / options.timelineId to scope.
 */
export async function buildAgentActivityLog(
  store: DecisionNodeStore,
  options?: { sessionId?: string; timelineId?: string },
): Promise<AgentActivityRow[]> {
  let nodes: DecisionNode[];
  if (options?.sessionId) {
    nodes = await store.getBySession(options.sessionId);
  } else if (options?.timelineId) {
    nodes = await store.getByTimeline(options.timelineId);
  } else {
    nodes = await collectAllNodes(store);
  }
  if (options?.timelineId && options?.sessionId) {
    nodes = nodes.filter(n => n.timelineId === options.timelineId);
  }

  const groups = new Map<string, DecisionNode[]>();
  for (const node of nodes) {
    const key = `${node.actor.type}:${node.actor.id}`;
    const list = groups.get(key) ?? [];
    list.push(node);
    groups.set(key, list);
  }

  const rows: AgentActivityRow[] = [];
  for (const [, list] of groups) {
    if (list.length === 0) continue;
    const first = list[0]!;
    let successCount = 0;
    let totalLatencyMs = 0;
    let totalCostUsd = 0;
    let firstAt = first.timestamp;
    let lastAt = first.timestamp;
    const timelines = new Set<string>();
    const sessions = new Set<string>();
    for (const node of list) {
      if (node.output.success) successCount += 1;
      totalLatencyMs += node.output.latencyMs ?? 0;
      totalCostUsd += node.output.costUsd ?? 0;
      if (node.timestamp < firstAt) firstAt = node.timestamp;
      if (node.timestamp > lastAt) lastAt = node.timestamp;
      timelines.add(node.timelineId);
      sessions.add(node.sessionId);
    }
    rows.push({
      actorId: first.actor.id,
      actorType: first.actor.type,
      product: first.actor.product,
      decisionCount: list.length,
      successCount,
      totalLatencyMs,
      totalCostUsd,
      firstAt,
      lastAt,
      timelines: [...timelines].sort(),
      sessions: [...sessions].sort(),
    });
  }

  rows.sort((a, b) => b.decisionCount - a.decisionCount);
  return rows;
}

// ── Deterministic Replay Verifier (re_gent pattern) ───────────────────────────

export interface ReplayDeterminismReport {
  /** True when the chain is replay-safe (hash-stable and chain-complete). */
  deterministic: boolean;
  /** Total nodes inspected on the chain. */
  chainLength: number;
  /** Hash of the final node after recomputing the whole chain. */
  recomputedHeadHash: string | null;
  /** Hash of the final node as stored. */
  storedHeadHash: string | null;
  /** Number of fileStateRef transitions seen on the chain. */
  fileStateRefTransitions: number;
  /** Specific failure messages (capped). */
  errors: string[];
}

/**
 * Verify that a session's chain (or a subset of it) is deterministic-replayable.
 *
 * Walks from genesis forward, recomputes each hash from prevHash + canonical
 * body, and asserts the chain produces the same head hash as stored. Also
 * asserts the linear chain has no missing parents.
 *
 *  - `headNodeId` — verify only the ancestor chain ending at that node.
 *  - `sessionId`  — verify every node in that session (sorted by timestamp).
 *  - neither      — verify the entire store.
 */
export async function verifyReplayDeterminism(
  store: DecisionNodeStore,
  options?: { sessionId?: string; headNodeId?: string },
): Promise<ReplayDeterminismReport> {
  const errors: string[] = [];
  let fileStateRefTransitions = 0;
  let recomputedHeadHash: string | null = null;
  let storedHeadHash: string | null = null;

  let chain: DecisionNode[];

  if (options?.headNodeId) {
    const head = await store.getById(options.headNodeId);
    if (!head) {
      return {
        deterministic: false,
        chainLength: 0,
        recomputedHeadHash: null,
        storedHeadHash: null,
        fileStateRefTransitions: 0,
        errors: [`headNodeId ${options.headNodeId} not found`],
      };
    }
    const ancestors = await store.getAncestors(head.id);
    chain = [...ancestors.reverse(), head];
  } else if (options?.sessionId) {
    const sessionNodes = await store.getBySession(options.sessionId);
    chain = sessionNodes.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } else {
    chain = await collectAllNodes(store);
    chain.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  if (chain.length === 0) {
    return {
      deterministic: true,
      chainLength: 0,
      recomputedHeadHash: null,
      storedHeadHash: null,
      fileStateRefTransitions: 0,
      errors: [],
    };
  }

  let prevFileStateRef: string | undefined;
  let lastNode: DecisionNode | null = null;

  for (const node of chain) {
    const { hash: storedHash, ...rest } = node;
    const expectedHash = hashDecisionNode(rest as Omit<DecisionNode, 'hash'>);
    if (expectedHash !== storedHash) {
      errors.push(`node ${node.id.slice(0, 8)}: hash mismatch (replay-divergent)`);
    }
    if (node.parentId !== null) {
      const parent = chain.find(n => n.id === node.parentId)
        ?? await store.getById(node.parentId);
      if (!parent) {
        errors.push(`node ${node.id.slice(0, 8)}: missing parent ${node.parentId.slice(0, 8)}`);
      } else if (node.prevHash !== parent.hash) {
        errors.push(`node ${node.id.slice(0, 8)}: prev-link broken (replay-divergent)`);
      }
    }
    const fsRef = node.output.fileStateRef;
    if (typeof fsRef === 'string' && fsRef !== prevFileStateRef) {
      fileStateRefTransitions += 1;
      prevFileStateRef = fsRef;
    }
    lastNode = node;
  }

  if (lastNode) {
    storedHeadHash = lastNode.hash;
    const { hash: _h, ...rest } = lastNode;
    recomputedHeadHash = hashDecisionNode(rest as Omit<DecisionNode, 'hash'>);
  }

  return {
    deterministic: errors.length === 0 && recomputedHeadHash === storedHeadHash,
    chainLength: chain.length,
    recomputedHeadHash,
    storedHeadHash,
    fileStateRefTransitions,
    errors: errors.slice(0, 50),
  };
}

// ── Merkle root over an agent activity log (re_gent pattern) ──────────────────

export interface AgentActivityMerkleRoot {
  /** SHA-256 hex of the canonical merkle root. */
  root: string;
  /** Number of leaves (== nodes the root covers). */
  leafCount: number;
  /** Optional filter that produced these leaves. */
  filter?: { sessionId?: string; timelineId?: string; actorId?: string };
}

/**
 * Compute a Merkle root over a filtered set of decision-node hashes.
 *
 * Leaves are the node hashes, ordered by `(timestamp, id)` so the same input
 * produces the same root across processes. An external auditor can verify
 * "session X has not been tampered with since merkle root R" by recomputing
 * this root from the JSONL and comparing.
 */
export async function computeAgentActivityMerkleRoot(
  store: DecisionNodeStore,
  filter?: { sessionId?: string; timelineId?: string; actorId?: string },
): Promise<AgentActivityMerkleRoot> {
  const { createHash } = await import('node:crypto');

  let nodes: DecisionNode[];
  if (filter?.sessionId) {
    nodes = await store.getBySession(filter.sessionId);
  } else if (filter?.timelineId) {
    nodes = await store.getByTimeline(filter.timelineId);
  } else if (filter?.actorId) {
    nodes = await store.getByActor(filter.actorId);
  } else {
    nodes = await collectAllNodes(store);
  }

  if (filter?.timelineId) nodes = nodes.filter(n => n.timelineId === filter.timelineId);
  if (filter?.actorId) nodes = nodes.filter(n => n.actor.id === filter.actorId);

  nodes.sort((a, b) => {
    const t = a.timestamp.localeCompare(b.timestamp);
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });

  if (nodes.length === 0) {
    const emptyRoot = createHash('sha256').update('').digest('hex');
    return { root: emptyRoot, leafCount: 0, ...(filter ? { filter } : {}) };
  }

  let level: string[] = nodes.map(n => n.hash);
  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = (i + 1 < level.length ? level[i + 1]! : left);
      next.push(createHash('sha256').update(left + right).digest('hex'));
    }
    level = next;
  }

  return {
    root: level[0]!,
    leafCount: nodes.length,
    ...(filter ? { filter } : {}),
  };
}

// ── Per-Agent ASCII Activity Render ───────────────────────────────────────────

/**
 * Render an agent activity log as a compact ASCII table for war-room
 * dashboards. One row per agent, columns: type/id, count, success rate,
 * latency, cost, timeline coverage.
 *
 * Width is the rough column budget; falls back to a sensible default.
 */
export function renderAgentActivityTable(rows: AgentActivityRow[], width = 100): string {
  if (rows.length === 0) return '  (no agent activity recorded)';

  const idColW = Math.max(10, Math.min(28, Math.floor(width * 0.28)));
  const lines: string[] = [];

  const bar = '─'.repeat(width);
  lines.push(bar);
  lines.push(` Per-Agent Activity Log (${rows.length} agent${rows.length === 1 ? '' : 's'})`);
  lines.push(bar);
  lines.push(`  ${'AGENT'.padEnd(idColW)}  COUNT  SUCC%   LATENCY(ms)  COST(USD)   TIMELINES`);
  lines.push(`  ${'─'.repeat(idColW)}  ─────  ─────   ───────────  ──────────  ─────────`);

  for (const row of rows) {
    const agentLabel = `${row.actorType}:${row.actorId}`.slice(0, idColW);
    const successRate = row.decisionCount === 0
      ? '  - '
      : `${Math.round((row.successCount / row.decisionCount) * 100).toString().padStart(3)}%`;
    const latency = row.totalLatencyMs.toString().padStart(11);
    const cost = row.totalCostUsd.toFixed(4).padStart(10);
    const count = row.decisionCount.toString().padStart(5);
    lines.push(`  ${agentLabel.padEnd(idColW)}  ${count}  ${successRate}     ${latency}  ${cost}  ${row.timelines.length}`);
  }

  lines.push(bar);
  return lines.join('\n');
}
