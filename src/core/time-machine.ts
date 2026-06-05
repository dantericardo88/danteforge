import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  ZERO_HASH,
  createEvidenceBundle,
  hashDict,
  verifyBundle,
  type EvidenceBundle,
} from '@danteforge/evidence-chain';
import type { CounterfactualReplayResult } from './time-machine-replay.js';
import {
  queryLineProvenance,
  updateLineProvenanceForCommit,
  buildSessionGraph,
  type ProvenanceCommitSource,
} from './time-machine-provenance.js';
import { detectContentType, normalizeRelativePath, sanitizePathSegment } from './time-machine-path-utils.js';

export const TIME_MACHINE_SCHEMA_VERSION = 'danteforge.time-machine.v1' as const;

export type TimeMachineContentType = 'json' | 'markdown' | 'text' | 'binary';
export type TimeMachineQueryKind = 'evidence' | 'dependents' | 'file-history' | 'counterfactual' | 'line-provenance' | 'session-graph';

export interface TimeMachineSnapshotEntry {
  path: string;
  blobHash: string;
  byteLength: number;
  contentType: TimeMachineContentType;
}

export interface TimeMachineRejectedClaim {
  verdictId: string;
  status: 'unsupported' | 'contradicted' | 'opinion';
  claim: string;
}

export interface TimeMachineCausalLinks {
  materials: string[];
  products: string[];
  verdictEvidence: Array<{ verdictId: string; evidenceIds: string[] }>;
  evidenceArtifacts: Array<{ evidenceId: string; artifactId: string }>;
  rejectedClaims: TimeMachineRejectedClaim[];
  alternativesConsidered?: Array<{ verdictId: string; alternatives: string[] }>;
  inputDependencies?: Array<{ verdictId: string; paths: string[]; commitIds: string[] }>;
  outputProducts?: Array<{ verdictId: string; paths: string[] }>;
  sourceCommitIds?: string[];
  counterfactualTraces?: Array<{ verdictId: string; question: string; status: 'preserved' | 'not_preserved'; trace?: string }>;
}

export interface TimeMachineCommit {
  schemaVersion: typeof TIME_MACHINE_SCHEMA_VERSION;
  commitId: string;
  parents: string[];
  runId?: string;
  gitSha: string | null;
  createdAt: string;
  label: string;
  entries: TimeMachineSnapshotEntry[];
  causalLinks: TimeMachineCausalLinks;
  proof: EvidenceBundle<unknown>;
}

export interface CreateTimeMachineCommitOptions {
  cwd?: string;
  paths: string[];
  label: string;
  runId?: string;
  gitSha?: string | null;
  causalLinks?: Partial<TimeMachineCausalLinks>;
  now?: () => string;
}

export interface VerifyTimeMachineReport {
  valid: boolean;
  checkedAt: string;
  root: string;
  head: string | null;
  commitsChecked: number;
  errors: string[];
}

export interface RestoreTimeMachineOptions {
  cwd?: string;
  commitId: string;
  outDir?: string;
  /** Restore to the working tree (cwd) instead of an isolated outDir. Requires confirm=true. */
  toWorkingTree?: boolean;
  /** Required when toWorkingTree=true. Refuses to overwrite the working tree without explicit consent. */
  confirm?: boolean;
}

export interface RestoreTimeMachineResult {
  commitId: string;
  outDir: string;
  restored: TimeMachineSnapshotEntry[];
  /** True when the restore wrote to the working tree (cwd) rather than an isolated outDir. */
  restoredToWorkingTree?: boolean;
}

export interface QueryTimeMachineOptions {
  cwd?: string;
  commitId?: string;
  kind: TimeMachineQueryKind;
  path?: string;
  line?: number;
  /** Required for session-graph queries — the session UUID to build the DAG for */
  session?: string;
}

export interface QueryTimeMachineResult {
  kind: TimeMachineQueryKind;
  status: 'ok' | 'not_preserved';
  message?: string;
  results: Array<Record<string, unknown>>;
}

interface ReflogEntry {
  commitId: string;
  parent: string | null;
  at: string;
  label: string;
}

interface CausalIndex {
  schemaVersion: typeof TIME_MACHINE_SCHEMA_VERSION;
  updatedAt: string;
  verdictEvidence: Record<string, string[]>;
  evidenceArtifacts: Record<string, string>;
  fileHistory: Record<string, string[]>;
  rejectedClaims: TimeMachineRejectedClaim[];
  alternativesConsidered: Record<string, string[]>;
  inputDependencies: Record<string, Array<{ paths: string[]; commitIds: string[] }>>;
  outputProducts: Record<string, string[]>;
  sourceCommitIds: Record<string, string[]>;
}

const execFileAsync = promisify(execFile);

export async function createTimeMachineCommit(options: CreateTimeMachineCommitOptions): Promise<TimeMachineCommit> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const root = getTimeMachineRoot(cwd);
  await ensureDirs(root);

  const createdAt = options.now?.() ?? new Date().toISOString();
  const parents = await readHead(cwd).then(head => head ? [head] : []);
  const gitSha = options.gitSha !== undefined ? options.gitSha : await readGitSha(cwd);
  const entries = await snapshotPaths(cwd, root, options.paths);
  if (entries.length === 0) throw new Error('time-machine commit has no files to snapshot');

  const inferred = await inferCausalLinks(cwd, entries);
  const causalLinks = mergeCausalLinks(inferred, options.causalLinks);
  const baseWithoutId = {
    schemaVersion: TIME_MACHINE_SCHEMA_VERSION,
    parents,
    ...(options.runId ? { runId: options.runId } : {}),
    gitSha,
    createdAt,
    label: options.label,
    entries,
    causalLinks,
  };
  const commitId = `tm_${hashDict(baseWithoutId).slice(0, 24)}`;
  const proofPayload = {
    schemaVersion: TIME_MACHINE_SCHEMA_VERSION,
    commitId,
    parents,
    ...(options.runId ? { runId: options.runId } : {}),
    gitSha,
    createdAt,
    label: options.label,
    entries,
    causalLinks,
  };
  const proof = createEvidenceBundle({
    runId: options.runId,
    bundleId: `time_machine_${commitId}`,
    gitSha,
    evidence: [proofPayload],
    prevHash: parents[0] ?? ZERO_HASH,
    createdAt,
  });
  const commit: TimeMachineCommit = { ...proofPayload, proof };

  await fs.writeFile(commitPath(cwd, commitId), JSON.stringify(commit, null, 2) + '\n', 'utf8');
  await writeHead(cwd, commitId);
  await appendReflog(cwd, { commitId, parent: parents[0] ?? null, at: createdAt, label: options.label });
  // Hot path: update BOTH derived indexes incrementally for THIS commit only.
  // The old full-history rebuilds (loadCommitsInReflogOrder + per-commit clone)
  // were O(total history) per commit and OOMed at 3316 commits.
  await updateCausalIndexForCommit(cwd, commit);
  await updateLineProvenanceForCommitBestEffort(cwd, commit);
  return commit;
}

export async function loadTimeMachineCommit(options: { cwd?: string; commitId: string }): Promise<TimeMachineCommit> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const raw = await fs.readFile(commitPath(cwd, options.commitId), 'utf8');
  return JSON.parse(raw) as TimeMachineCommit;
}

const VERIFY_CONCURRENCY = 64;

export async function verifyTimeMachine(options: { cwd?: string; stopOnFirstError?: boolean; focusCommitIds?: string[] } = {}): Promise<VerifyTimeMachineReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const root = getTimeMachineRoot(cwd);
  const errors: string[] = [];
  const commitIds = await listCommitIds(cwd);
  const commitIdSet = new Set(commitIds);
  const head = await readHead(cwd);
  const reflog = await readReflog(cwd);

  if (head && !commitIdSet.has(head)) errors.push(`head points to missing commit: ${head}`);
  for (const reflogEntry of reflog) {
    if (!commitIdSet.has(reflogEntry.commitId)) errors.push(`reflog references missing commit: ${reflogEntry.commitId}`);
  }

  reflog.forEach((entry, index) => {
    const expectedParent = index === 0 ? null : reflog[index - 1]!.commitId;
    if (entry.parent !== expectedParent) errors.push(`reflog ${index}: parent mismatch`);
  });

  if (options.stopOnFirstError && errors.length > 0) {
    return {
      valid: false,
      checkedAt: new Date().toISOString(),
      root,
      head,
      commitsChecked: 0,
      errors,
    };
  }

  const verifiedBlobs = new Set<string>();
  const inFlightBlobs = new Map<string, Promise<{ ok: boolean; reason?: string }>>();
  if (options.stopOnFirstError) {
    const orderedIds = options.focusCommitIds && options.focusCommitIds.length > 0
      ? options.focusCommitIds.filter(commitId => commitIdSet.has(commitId))
      : reflog.length > 0 ? reflog.map(entry => entry.commitId).filter(commitId => commitIdSet.has(commitId)) : commitIds;
    let commitsChecked = 0;
    for (const commitId of orderedIds) {
      commitsChecked += 1;
      try {
        const commit = await loadTimeMachineCommit({ cwd, commitId });
        const commitErrors = await verifyCommit(cwd, commit, { verifiedBlobs, inFlightBlobs, commitIdSet });
        if (commitErrors.length > 0) {
          errors.push(...commitErrors);
          return {
            valid: false,
            checkedAt: new Date().toISOString(),
            root,
            head,
            commitsChecked,
            errors,
          };
        }
      } catch (err) {
        errors.push(`${commitId}: ${err instanceof Error ? err.message : String(err)}`);
        return {
          valid: false,
          checkedAt: new Date().toISOString(),
          root,
          head,
          commitsChecked,
          errors,
        };
      }
    }
    return {
      valid: true,
      checkedAt: new Date().toISOString(),
      root,
      head,
      commitsChecked,
      errors,
    };
  }

  const commitResults = await mapWithConcurrency(commitIds, VERIFY_CONCURRENCY, async commitId => {
    try {
      const commit = await loadTimeMachineCommit({ cwd, commitId });
      return await verifyCommit(cwd, commit, { verifiedBlobs, inFlightBlobs, commitIdSet });
    } catch (err) {
      return [`${commitId}: ${err instanceof Error ? err.message : String(err)}`];
    }
  });
  for (const commitErrors of commitResults) errors.push(...commitErrors);

  return {
    valid: errors.length === 0,
    checkedAt: new Date().toISOString(),
    root,
    head,
    commitsChecked: commitIds.length,
    errors,
  };
}

export async function restoreTimeMachineCommit(options: RestoreTimeMachineOptions): Promise<RestoreTimeMachineResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const commit = await loadTimeMachineCommit({ cwd, commitId: options.commitId });
  const errors = await verifyCommit(cwd, commit);
  if (errors.length > 0) throw new Error(`cannot restore invalid time-machine commit: ${errors.slice(0, 3).join('; ')}`);

  if (options.toWorkingTree && !options.confirm) {
    throw new Error('refusing to restore to working tree without confirm=true; pass --confirm on the CLI or { confirm: true } in code');
  }
  if (options.toWorkingTree && options.outDir) {
    throw new Error('toWorkingTree and outDir are mutually exclusive');
  }

  const outDir = options.toWorkingTree
    ? cwd
    : options.outDir
      ? path.resolve(options.outDir)
      : path.resolve(cwd, '.danteforge', 'time-machine', 'restores', commit.commitId);
  for (const entry of commit.entries) {
    const target = path.resolve(outDir, entry.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(blobPath(cwd, entry.blobHash), target);
  }
  return {
    commitId: commit.commitId,
    outDir,
    restored: commit.entries,
    restoredToWorkingTree: options.toWorkingTree === true,
  };
}

export async function persistCounterfactualReplayTrace(options: {
  cwd?: string;
  replayResult: CounterfactualReplayResult;
  question: string;
  verdictId?: string;
  now?: () => string;
}): Promise<TimeMachineCommit> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const timelineId = options.replayResult.newTimelineId || 'alternate';
  const safeTimelineId = sanitizePathSegment(timelineId);
  const traceDir = path.join(cwd, '.danteforge', 'evidence', 'time-machine-counterfactual-traces', safeTimelineId);
  await fs.mkdir(traceDir, { recursive: true });
  const tracePath = path.join(traceDir, 'counterfactual-result.json');
  await fs.writeFile(tracePath, JSON.stringify(options.replayResult, null, 2) + '\n', 'utf8');

  const traceRelPath = normalizeRelativePath(path.relative(cwd, tracePath));
  const verdictId = options.verdictId ?? `counterfactual_${safeTimelineId}`;
  const sourceCommitIds = [
    options.replayResult.branchPoint.output.fileStateRef,
    options.replayResult.artifacts?.restoreCommitId,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0);

  return createTimeMachineCommit({
    cwd,
    paths: [traceRelPath],
    label: `counterfactual replay ${timelineId}`,
    causalLinks: {
      materials: sourceCommitIds,
      products: [traceRelPath],
      sourceCommitIds,
      counterfactualTraces: [{
        verdictId,
        question: options.question,
        status: 'preserved',
        trace: traceRelPath,
      }],
    },
    now: options.now,
  });
}

export async function queryTimeMachine(options: QueryTimeMachineOptions): Promise<QueryTimeMachineResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const commitId = options.commitId ?? await readHead(cwd) ?? undefined;

  if (options.kind === 'session-graph') {
    if (!options.session) throw new Error('session-graph query requires --session <sessionId>');
    const { createDecisionNodeStore } = await import('./decision-node.js');
    const storePath = path.join(cwd, '.danteforge', 'decision-nodes.jsonl');
    const store = createDecisionNodeStore(storePath);
    const graph = await buildSessionGraph(options.session, store);
    return {
      kind: 'session-graph',
      status: 'ok',
      results: [graph as unknown as Record<string, unknown>],
    };
  }

  if (options.kind === 'counterfactual') {
    if (commitId) {
      const commit = await loadTimeMachineCommit({ cwd, commitId });
      const traces = commit.causalLinks.counterfactualTraces ?? [];
      if (traces.length > 0) {
        return { kind: 'counterfactual', status: 'ok', results: traces };
      }
    }
    return {
      kind: 'counterfactual',
      status: 'not_preserved',
      message: 'Counterfactual reasoning traces are not preserved by Time Machine v0.1.',
      results: [],
    };
  }

  if (options.kind === 'file-history') {
    if (!options.path) throw new Error('file-history query requires --path');
    const normalized = normalizeRelativePath(options.path);
    const index = await readCausalIndex(cwd);
    const indexedHistory = index?.fileHistory[normalized];
    if (indexedHistory) {
      const reflog = await readReflog(cwd);
      const reflogById = new Map(reflog.map(entry => [entry.commitId, entry]));
      return {
        kind: 'file-history',
        status: 'ok',
        results: indexedHistory.map(commitId => {
          const entry = reflogById.get(commitId);
          return {
            commitId,
            label: entry?.label ?? '',
            createdAt: entry?.at ?? '',
          };
        }),
      };
    }
    // Index missing this file — self-heal by rebuilding the causal index
    // (STREAMING, bounded memory), then read it back. The old fallback loaded
    // all commits at once, which is the OOM the index exists to avoid.
    await writeCausalIndex(cwd);
    const rebuilt = await readCausalIndex(cwd);
    const rebuiltHistory = rebuilt?.fileHistory[normalized] ?? [];
    const reflogFallback = await readReflog(cwd);
    const reflogFallbackById = new Map(reflogFallback.map(entry => [entry.commitId, entry]));
    return {
      kind: 'file-history',
      status: 'ok',
      results: rebuiltHistory.map(commitId => {
        const entry = reflogFallbackById.get(commitId);
        return { commitId, label: entry?.label ?? '', createdAt: entry?.at ?? '' };
      }),
    };
  }

  if (options.kind === 'line-provenance') {
    if (!options.path) throw new Error('line-provenance query requires --path');
    if (!options.line || options.line < 1) throw new Error('line-provenance query requires --line >= 1');
    if (!commitId) throw new Error('line-provenance query requires a commit');
    const result = await queryLineProvenance({
      cwd,
      root: getTimeMachineRoot(cwd),
      source: provenanceCommitSource(cwd),
      commitId,
      filePath: options.path,
      line: options.line,
    });
    return result
      ? { kind: 'line-provenance', status: 'ok', results: [result as unknown as Record<string, unknown>] }
      : {
          kind: 'line-provenance',
          status: 'ok',
          message: `No line provenance found for ${normalizeRelativePath(options.path)}:${options.line} at ${commitId}.`,
          results: [],
        };
  }

  if (!commitId) throw new Error(`${options.kind} query requires a commit`);
  const commit = await loadTimeMachineCommit({ cwd, commitId });

  if (options.kind === 'evidence') {
    return { kind: 'evidence', status: 'ok', results: commit.causalLinks.verdictEvidence };
  }

  const commits = await loadCommitsInReflogOrder(cwd);
  return {
    kind: 'dependents',
    status: 'ok',
    results: commits
      .filter(candidate => candidate.parents.includes(commit.commitId) || (candidate.causalLinks.sourceCommitIds ?? []).includes(commit.commitId))
      .map(candidate => ({ commitId: candidate.commitId, label: candidate.label, createdAt: candidate.createdAt })),
  };
}

function getTimeMachineRoot(cwd: string): string {
  return path.resolve(cwd, '.danteforge', 'time-machine');
}

async function ensureDirs(root: string): Promise<void> {
  await fs.mkdir(path.join(root, 'blobs'), { recursive: true });
  await fs.mkdir(path.join(root, 'commits'), { recursive: true });
  await fs.mkdir(path.join(root, 'refs'), { recursive: true });
  await fs.mkdir(path.join(root, 'index'), { recursive: true });
}

async function snapshotPaths(cwd: string, root: string, inputPaths: string[]): Promise<TimeMachineSnapshotEntry[]> {
  const files = new Set<string>();
  for (const input of inputPaths) {
    const absolute = path.resolve(cwd, input);
    assertInsideCwd(cwd, absolute);
    const discovered = await collectFiles(absolute, root);
    for (const file of discovered) files.add(file);
  }

  const entries: TimeMachineSnapshotEntry[] = [];
  for (const file of [...files].sort()) {
    const bytes = await fs.readFile(file);
    const blobHash = sha256Bytes(bytes);
    const target = blobPath(cwd, blobHash);
    if (!existsSync(target)) await fs.writeFile(target, bytes);
    entries.push({
      path: toRepoPath(cwd, file),
      blobHash,
      byteLength: bytes.byteLength,
      contentType: detectContentType(file),
    });
  }
  return entries;
}

async function collectFiles(target: string, timeMachineRoot: string): Promise<string[]> {
  const stat = await fs.stat(target);
  if (stat.isFile()) return shouldSkip(target, timeMachineRoot) ? [] : [target];
  if (!stat.isDirectory()) return [];

  const out: string[] = [];
  const entries = await fs.readdir(target, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(target, entry.name);
    if (shouldSkip(full, timeMachineRoot)) continue;
    if (entry.isDirectory()) out.push(...await collectFiles(full, timeMachineRoot));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function shouldSkip(target: string, timeMachineRoot: string): boolean {
  const normalized = target.replace(/\\/g, '/');
  return normalized.includes('/.git/')
    || normalized.endsWith('/.git')
    || normalized.startsWith(timeMachineRoot.replace(/\\/g, '/'))
    || normalized.includes('/node_modules/')
    || normalized.includes('/dist/');
}

function assertInsideCwd(cwd: string, target: string): void {
  const rel = path.relative(cwd, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`time-machine paths must be inside cwd: ${target}`);
  }
}

async function inferCausalLinks(cwd: string, entries: TimeMachineSnapshotEntry[]): Promise<TimeMachineCausalLinks> {
  const evidenceRecords: Array<{ evidenceId: string; artifactId: string }> = [];
  const verdicts: Array<{ verdictId: string; unsupportedClaims?: string[]; contradictedClaims?: string[]; opinionClaims?: string[] }> = [];

  for (const entry of entries) {
    const absolute = path.resolve(cwd, entry.path);
    if (entry.path.endsWith('/evidence/evidence.jsonl')) {
      const lines = (await fs.readFile(absolute, 'utf8')).split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const parsed = JSON.parse(line) as { evidenceId?: string; artifactId?: string };
        if (parsed.evidenceId && parsed.artifactId) evidenceRecords.push({ evidenceId: parsed.evidenceId, artifactId: parsed.artifactId });
      }
    }
    if (entry.path.endsWith('/verdict/verdict.json')) {
      const parsed = JSON.parse(await fs.readFile(absolute, 'utf8')) as {
        verdictId?: string;
        unsupportedClaims?: string[];
        contradictedClaims?: string[];
        opinionClaims?: string[];
      };
      if (parsed.verdictId) verdicts.push({
        verdictId: parsed.verdictId,
        unsupportedClaims: parsed.unsupportedClaims,
        contradictedClaims: parsed.contradictedClaims,
        opinionClaims: parsed.opinionClaims,
      });
    }
  }

  return {
    materials: entries.map(entry => entry.path),
    products: entries.map(entry => entry.path),
    verdictEvidence: verdicts.map(verdict => ({
      verdictId: verdict.verdictId,
      evidenceIds: evidenceRecords.map(record => record.evidenceId),
    })),
    evidenceArtifacts: evidenceRecords,
    rejectedClaims: verdicts.flatMap(verdict => [
      ...(verdict.unsupportedClaims ?? []).map(claim => ({ verdictId: verdict.verdictId, status: 'unsupported' as const, claim })),
      ...(verdict.contradictedClaims ?? []).map(claim => ({ verdictId: verdict.verdictId, status: 'contradicted' as const, claim })),
      ...(verdict.opinionClaims ?? []).map(claim => ({ verdictId: verdict.verdictId, status: 'opinion' as const, claim })),
    ]),
  };
}

function mergeCausalLinks(base: TimeMachineCausalLinks, override: Partial<TimeMachineCausalLinks> | undefined): TimeMachineCausalLinks {
  if (!override) return base;
  return {
    ...base,
    ...override,
    materials: override.materials ?? base.materials,
    products: override.products ?? base.products,
    verdictEvidence: override.verdictEvidence ?? base.verdictEvidence,
    evidenceArtifacts: override.evidenceArtifacts ?? base.evidenceArtifacts,
    rejectedClaims: override.rejectedClaims ?? base.rejectedClaims,
  };
}

interface VerifyCommitCache {
  verifiedBlobs: Set<string>;
  inFlightBlobs: Map<string, Promise<{ ok: boolean; reason?: string }>>;
  /** Pass 30: when provided, parent-existence checks consult this set instead of doing existsSync per parent. Eliminates 100K sync syscalls in the typical 100K-commit verify. */
  commitIdSet?: Set<string>;
}

async function verifyBlobOnce(cwd: string, expectedHash: string, expectedByteLength: number, cache?: VerifyCommitCache): Promise<{ ok: boolean; reason?: string }> {
  if (cache?.verifiedBlobs.has(expectedHash)) return { ok: true };
  if (cache?.inFlightBlobs.has(expectedHash)) {
    return cache.inFlightBlobs.get(expectedHash)!;
  }
  const work = (async () => {
    try {
      const blob = await fs.readFile(blobPath(cwd, expectedHash));
      const actualHash = sha256Bytes(blob);
      if (actualHash !== expectedHash) return { ok: false, reason: 'blob hash mismatch' };
      if (blob.byteLength !== expectedByteLength) return { ok: false, reason: 'byteLength mismatch' };
      cache?.verifiedBlobs.add(expectedHash);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'missing blob' };
    }
  })();
  if (cache) {
    cache.inFlightBlobs.set(expectedHash, work);
    work.finally(() => cache.inFlightBlobs.delete(expectedHash));
  }
  return work;
}

async function verifyCommit(cwd: string, commit: TimeMachineCommit, cache?: VerifyCommitCache): Promise<string[]> {
  const errors: string[] = [];
  if (commit.schemaVersion !== TIME_MACHINE_SCHEMA_VERSION) errors.push(`${commit.commitId}: schemaVersion mismatch`);
  const { proof: _proof, ...payload } = commit;
  const expectedCommitId = `tm_${hashDict({
    schemaVersion: commit.schemaVersion,
    parents: commit.parents,
    ...(commit.runId ? { runId: commit.runId } : {}),
    gitSha: commit.gitSha,
    createdAt: commit.createdAt,
    label: commit.label,
    entries: commit.entries,
    causalLinks: commit.causalLinks,
  }).slice(0, 24)}`;
  if (commit.commitId !== expectedCommitId) errors.push(`${commit.commitId}: commitId mismatch`);

  const bundle = verifyBundle(commit.proof);
  if (!bundle.valid) errors.push(...bundle.errors.map(error => `${commit.commitId}: proof ${error}`));
  const expectedPayloadHash = hashDict([payload]);
  if (commit.proof.payloadHash !== expectedPayloadHash) errors.push(`${commit.commitId}: proof payloadHash mismatch`);

  for (const parent of commit.parents) {
    const present = cache?.commitIdSet
      ? cache.commitIdSet.has(parent)
      : existsSync(commitPath(cwd, parent));
    if (!present) errors.push(`${commit.commitId}: missing parent ${parent}`);
  }
  for (const entry of commit.entries) {
    const result = await verifyBlobOnce(cwd, entry.blobHash, entry.byteLength, cache);
    if (!result.ok) errors.push(`${commit.commitId}: ${result.reason ?? 'blob verification failed'} for ${entry.path}`);
  }
  return errors;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers: Promise<void>[] = [];
  for (let w = 0; w < workerCount; w += 1) {
    workers.push((async () => {
      while (true) {
        const i = cursor;
        cursor += 1;
        if (i >= items.length) return;
        results[i] = await mapper(items[i] as T, i);
      }
    })());
  }
  await Promise.all(workers);
  return results;
}

function emptyCausalIndex(): CausalIndex {
  return {
    schemaVersion: TIME_MACHINE_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    verdictEvidence: {},
    evidenceArtifacts: {},
    fileHistory: {},
    rejectedClaims: [],
    alternativesConsidered: {},
    inputDependencies: {},
    outputProducts: {},
    sourceCommitIds: {},
  };
}

// Merge ONE commit's causal links into the index. Applied in reflog (append)
// order this is byte-for-byte equivalent to a full rebuild: every field is
// either an order-stable last-write-wins assign (keyed by an id the commit
// owns) or an in-order append. That equivalence is what lets the hot path
// update incrementally — O(1) in history — instead of reloading all commits.
function mergeCommitIntoCausalIndex(index: CausalIndex, commit: TimeMachineCommit): void {
  for (const item of commit.causalLinks.verdictEvidence) index.verdictEvidence[item.verdictId] = item.evidenceIds;
  for (const item of commit.causalLinks.evidenceArtifacts) index.evidenceArtifacts[item.evidenceId] = item.artifactId;
  for (const entry of commit.entries) {
    const history = index.fileHistory[entry.path] ?? [];
    history.push(commit.commitId);
    index.fileHistory[entry.path] = history;
  }
  index.rejectedClaims.push(...commit.causalLinks.rejectedClaims);
  for (const item of commit.causalLinks.alternativesConsidered ?? []) {
    index.alternativesConsidered[item.verdictId] = item.alternatives;
  }
  for (const item of commit.causalLinks.inputDependencies ?? []) {
    const deps = index.inputDependencies[item.verdictId] ?? [];
    deps.push({ paths: item.paths, commitIds: item.commitIds });
    index.inputDependencies[item.verdictId] = deps;
  }
  for (const item of commit.causalLinks.outputProducts ?? []) {
    index.outputProducts[item.verdictId] = item.paths;
  }
  if (commit.causalLinks.sourceCommitIds?.length) {
    index.sourceCommitIds[commit.commitId] = commit.causalLinks.sourceCommitIds;
  }
}

async function writeCausalIndexFile(cwd: string, index: CausalIndex): Promise<void> {
  index.updatedAt = new Date().toISOString();
  await fs.writeFile(path.join(getTimeMachineRoot(cwd), 'index', 'causal-index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
}

// Incremental hot-path update: merge ONLY the just-created commit into the
// existing index. O(1) in history — replaces the all-commits reload that OOMed
// at 3316 commits.
async function updateCausalIndexForCommit(cwd: string, commit: TimeMachineCommit): Promise<void> {
  const index = (await readCausalIndex(cwd)) ?? emptyCausalIndex();
  mergeCommitIntoCausalIndex(index, commit);
  await writeCausalIndexFile(cwd, index);
}

// Full rebuild — STREAMING (one commit resident at a time, never the whole
// 3316-commit array). Used only for repair and the file-history lazy self-heal,
// not the commit hot path.
async function writeCausalIndex(cwd: string): Promise<void> {
  const index = emptyCausalIndex();
  for (const entry of await readReflog(cwd)) {
    if (!existsSync(commitPath(cwd, entry.commitId))) continue;
    const commit = await loadTimeMachineCommit({ cwd, commitId: entry.commitId });
    mergeCommitIntoCausalIndex(index, commit);
  }
  await writeCausalIndexFile(cwd, index);
}

// Streaming commit source for the provenance engine — lists ids cheaply from
// the reflog and loads one commit at a time, so neither a rebuild nor a query
// ever materializes the whole history.
function provenanceCommitSource(cwd: string): ProvenanceCommitSource {
  return {
    listCommitIds: async () => {
      const reflog = await readReflog(cwd);
      return reflog.filter(entry => existsSync(commitPath(cwd, entry.commitId))).map(entry => entry.commitId);
    },
    loadCommit: (commitId: string) => loadTimeMachineCommit({ cwd, commitId }),
  };
}

async function updateLineProvenanceForCommitBestEffort(cwd: string, commit: TimeMachineCommit): Promise<void> {
  try {
    await updateLineProvenanceForCommit({ root: getTimeMachineRoot(cwd), commit });
  } catch {
    // Derived provenance is rebuildable; a failed index write must not break snapshot capture.
  }
}

async function loadCommitsInReflogOrder(cwd: string): Promise<TimeMachineCommit[]> {
  const reflog = await readReflog(cwd);
  const present = reflog.filter(entry => existsSync(commitPath(cwd, entry.commitId)));
  return mapWithConcurrency(present, VERIFY_CONCURRENCY, entry => loadTimeMachineCommit({ cwd, commitId: entry.commitId }));
}

async function listCommitIds(cwd: string): Promise<string[]> {
  const dir = path.join(getTimeMachineRoot(cwd), 'commits');
  try {
    return (await fs.readdir(dir))
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

async function readCausalIndex(cwd: string): Promise<CausalIndex | null> {
  try {
    const raw = await fs.readFile(path.join(getTimeMachineRoot(cwd), 'index', 'causal-index.json'), 'utf8');
    return JSON.parse(raw) as CausalIndex;
  } catch {
    return null;
  }
}

async function readHead(cwd: string): Promise<string | null> {
  try {
    const head = (await fs.readFile(path.join(getTimeMachineRoot(cwd), 'refs', 'head'), 'utf8')).trim();
    return head || null;
  } catch {
    return null;
  }
}

async function writeHead(cwd: string, commitId: string): Promise<void> {
  await fs.writeFile(path.join(getTimeMachineRoot(cwd), 'refs', 'head'), `${commitId}\n`, 'utf8');
}

async function appendReflog(cwd: string, entry: ReflogEntry): Promise<void> {
  await fs.appendFile(path.join(getTimeMachineRoot(cwd), 'refs', 'reflog.jsonl'), JSON.stringify(entry) + '\n', 'utf8');
}

async function readReflog(cwd: string): Promise<ReflogEntry[]> {
  try {
    const raw = await fs.readFile(path.join(getTimeMachineRoot(cwd), 'refs', 'reflog.jsonl'), 'utf8');
    return raw.split(/\r?\n/).filter(Boolean).map(line => {
      const parsed = JSON.parse(line) as Partial<ReflogEntry>;
      return {
        commitId: parsed.commitId ?? '',
        parent: parsed.parent ?? null,
        at: parsed.at ?? '',
        label: parsed.label ?? '',
      };
    });
  } catch {
    return [];
  }
}

function blobPath(cwd: string, blobHash: string): string {
  return path.join(getTimeMachineRoot(cwd), 'blobs', blobHash);
}

function commitPath(cwd: string, commitId: string): string {
  return path.join(getTimeMachineRoot(cwd), 'commits', `${commitId}.json`);
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toRepoPath(cwd: string, absolute: string): string {
  return normalizeRelativePath(path.relative(cwd, absolute));
}

async function readGitSha(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}
