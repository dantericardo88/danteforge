import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  ZERO_HASH,
  createEvidenceBundle,
  hashDict,
} from '@danteforge/evidence-chain';
import {
  TIME_MACHINE_SCHEMA_VERSION,
  restoreTimeMachineCommit,
  type TimeMachineCausalLinks,
  type TimeMachineCommit,
  type TimeMachineSnapshotEntry,
} from './time-machine.js';
import type { ClassBResult, ClassCResult, TimeMachineValidationScale } from './time-machine-validation.js';

export interface ValidationChain {
  cwd: string;
  commitIds: string[];
  referenceHashes: Map<string, string>;
  referenceBodies: Map<string, string>;
}

export async function buildSyntheticChain(cwd: string, commitCount: number, createdAt: string): Promise<ValidationChain> {
  await resetDir(cwd);
  const root = path.join(cwd, '.danteforge', 'time-machine');
  const blobsDir = path.join(root, 'blobs');
  const commitsDir = path.join(root, 'commits');
  const refsDir = path.join(root, 'refs');
  const indexDir = path.join(root, 'index');
  await fs.mkdir(blobsDir, { recursive: true });
  await fs.mkdir(commitsDir, { recursive: true });
  await fs.mkdir(refsDir, { recursive: true });
  await fs.mkdir(indexDir, { recursive: true });

  const commitIds: string[] = [];
  const referenceHashes = new Map<string, string>();
  const referenceBodies = new Map<string, string>();
  const writeBatch: Promise<void>[] = [];
  const reflogLines: string[] = [];
  const fileHistory: string[] = [];
  const maxWriteConcurrency = 512;
  let parent: string | null = null;
  for (let i = 0; i < commitCount; i += 1) {
    const body = `document-state-${i}\n`;
    const blobHash = sha256(body);
    const entries: TimeMachineSnapshotEntry[] = [{
      path: 'state/document.txt',
      blobHash,
      byteLength: Buffer.byteLength(body),
      contentType: 'text',
    }];
    const verdictId = `verdict_${String(i).padStart(3, '0')}`;
    const causalLinks: TimeMachineCausalLinks = {
      materials: ['state/document.txt'],
      products: ['state/document.txt'],
      verdictEvidence: [{ verdictId, evidenceIds: [`evidence_${String(i).padStart(3, '0')}`] }],
      evidenceArtifacts: [{ evidenceId: `evidence_${String(i).padStart(3, '0')}`, artifactId: `artifact_${String(i).padStart(3, '0')}` }],
      rejectedClaims: [],
    };
    const parents: string[] = parent ? [parent] : [];
    const timestamp = new Date(new Date(createdAt).getTime() + i).toISOString();
    const base: Omit<TimeMachineCommit, 'proof' | 'commitId'> = {
      schemaVersion: TIME_MACHINE_SCHEMA_VERSION,
      parents,
      gitSha: null,
      createdAt: timestamp,
      label: `validation-${i}`,
      entries,
      causalLinks,
    };
    const commitId = `tm_${hashDict(base).slice(0, 24)}`;
    const payload: Omit<TimeMachineCommit, 'proof'> = { ...base, commitId };
    const proof = createEvidenceBundle({
      bundleId: `time_machine_${commitId}`,
      gitSha: null,
      evidence: [payload],
      prevHash: parent ?? ZERO_HASH,
      createdAt: timestamp,
    });
    const commit: TimeMachineCommit = { ...payload, proof };
    writeBatch.push(fs.writeFile(path.join(blobsDir, blobHash), body, 'utf8'));
    writeBatch.push(fs.writeFile(path.join(commitsDir, `${commitId}.json`), `${JSON.stringify(commit)}\n`, 'utf8'));
    if (writeBatch.length >= maxWriteConcurrency) await Promise.all(writeBatch.splice(0));

    commitIds.push(commitId);
    fileHistory.push(commitId);
    referenceHashes.set(commitId, blobHash);
    referenceBodies.set(commitId, body);
    reflogLines.push(JSON.stringify({ commitId, parent, at: timestamp, label: `validation-${i}` }));
    parent = commitId;
  }
  await Promise.all(writeBatch.splice(0));
  if (parent) await fs.writeFile(path.join(refsDir, 'head'), `${parent}\n`, 'utf8');
  await fs.writeFile(path.join(refsDir, 'reflog.jsonl'), `${reflogLines.join('\n')}\n`, 'utf8');
  await fs.writeFile(path.join(indexDir, 'causal-index.json'), JSON.stringify({
    schemaVersion: TIME_MACHINE_SCHEMA_VERSION,
    updatedAt: createdAt,
    verdictEvidence: {},
    evidenceArtifacts: {},
    fileHistory: { 'state/document.txt': fileHistory },
    rejectedClaims: [],
    alternativesConsidered: {},
    inputDependencies: {},
    outputProducts: {},
    sourceCommitIds: {},
  }) + '\n', 'utf8');
  return { cwd, commitIds, referenceHashes, referenceBodies };
}

export function resolveClassFMaxCommits(scale: TimeMachineValidationScale, explicitMaxCommits?: number): number {
  if (explicitMaxCommits !== undefined) {
    if (!Number.isSafeInteger(explicitMaxCommits) || explicitMaxCommits < 1) {
      throw new Error('maxCommits must be a positive safe integer');
    }
    return explicitMaxCommits;
  }
  const env = process.env.DANTEFORGE_TIME_MACHINE_VALIDATE_MAX_COMMITS;
  if (env !== undefined) {
    const parsed = Number(env);
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new Error('DANTEFORGE_TIME_MACHINE_VALIDATE_MAX_COMMITS must be a positive safe integer');
    }
    return parsed;
  }
  return scale === 'smoke' ? 100 : 10_000;
}

export function classFCounts(scale: TimeMachineValidationScale, cap: number): number[] {
  const standard = scale === 'smoke'
    ? [100]
    : scale === 'prd'
      ? [10_000, 100_000]
      : [10_000, 100_000, 1_000_000];
  const runnable = standard.filter(count => count <= cap);
  return runnable.length > 0 ? runnable : [cap];
}

interface BenchmarkChainBuild {
  completed: boolean;
  completedCommits: number;
  buildMs: number;
  chain: ValidationChain;
  failureReason?: string;
}

export async function buildBenchmarkChain(cwd: string, commitCount: number, createdAt: string, deadlineMs?: number): Promise<BenchmarkChainBuild> {
  const start = Date.now();
  await resetDir(cwd);
  const root = path.join(cwd, '.danteforge', 'time-machine');
  const blobsDir = path.join(root, 'blobs');
  const commitsDir = path.join(root, 'commits');
  const refsDir = path.join(root, 'refs');
  const indexDir = path.join(root, 'index');
  await fs.mkdir(blobsDir, { recursive: true });
  await fs.mkdir(commitsDir, { recursive: true });
  await fs.mkdir(refsDir, { recursive: true });
  await fs.mkdir(indexDir, { recursive: true });

  const body = 'benchmark-state\n';
  const blobHash = sha256(body);
  await fs.writeFile(path.join(blobsDir, blobHash), body, 'utf8');
  const entries: TimeMachineSnapshotEntry[] = [{
    path: 'state/document.txt',
    blobHash,
    byteLength: Buffer.byteLength(body),
    contentType: 'text',
  }];
  const causalLinks: TimeMachineCausalLinks = {
    materials: ['state/document.txt'],
    products: ['state/document.txt'],
    verdictEvidence: [],
    evidenceArtifacts: [],
    rejectedClaims: [],
  };

  const commitIds: string[] = [];
  const referenceHashes = new Map<string, string>();
  const referenceBodies = new Map<string, string>();
  const writeBatch: Promise<void>[] = [];
  const reflogLines: string[] = [];
  const fileHistory: string[] = [];
  const maxWriteConcurrency = 512;
  let parent: string | null = null;
  let completedCommits = 0;

  for (let i = 0; i < commitCount; i += 1) {
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
      await Promise.all(writeBatch.splice(0));
      if (reflogLines.length > 0) await fs.writeFile(path.join(refsDir, 'reflog.jsonl'), `${reflogLines.join('\n')}\n`, 'utf8');
      if (parent) await fs.writeFile(path.join(refsDir, 'head'), `${parent}\n`, 'utf8');
      return {
        completed: false,
        completedCommits,
        buildMs: Date.now() - start,
        chain: { cwd, commitIds, referenceHashes, referenceBodies },
        failureReason: `Class F time budget exhausted after ${completedCommits}/${commitCount} commits`,
      };
    }

    const parents: string[] = parent ? [parent] : [];
    const base = {
      schemaVersion: TIME_MACHINE_SCHEMA_VERSION,
      parents,
      gitSha: null,
      createdAt,
      label: `validation-${i}`,
      entries,
      causalLinks,
    };
    const commitId: string = `tm_${hashDict(base).slice(0, 24)}`;
    const payload: Omit<TimeMachineCommit, 'proof'> = { ...base, commitId };
    const proof = createEvidenceBundle({
      bundleId: `time_machine_${commitId}`,
      gitSha: null,
      evidence: [payload],
      prevHash: parent ?? ZERO_HASH,
      createdAt,
    });
    const commit: TimeMachineCommit = { ...payload, proof };
    const commitJson = `${JSON.stringify(commit)}\n`;
    writeBatch.push(fs.writeFile(path.join(commitsDir, `${commitId}.json`), commitJson, 'utf8'));
    if (writeBatch.length >= maxWriteConcurrency) await Promise.all(writeBatch.splice(0));

    commitIds.push(commitId);
    fileHistory.push(commitId);
    referenceHashes.set(commitId, sha256(body));
    referenceBodies.set(commitId, body);
    reflogLines.push(JSON.stringify({ commitId, parent, at: createdAt, label: `validation-${i}` }));
    parent = commitId;
    completedCommits += 1;
  }

  await Promise.all(writeBatch.splice(0));
  if (parent) await fs.writeFile(path.join(refsDir, 'head'), `${parent}\n`, 'utf8');
  await fs.writeFile(path.join(refsDir, 'reflog.jsonl'), `${reflogLines.join('\n')}\n`, 'utf8');
  await fs.writeFile(path.join(indexDir, 'causal-index.json'), JSON.stringify({
    schemaVersion: TIME_MACHINE_SCHEMA_VERSION,
    updatedAt: createdAt,
    verdictEvidence: {},
    evidenceArtifacts: {},
    fileHistory: { 'state/document.txt': fileHistory },
    rejectedClaims: [],
    alternativesConsidered: {},
    inputDependencies: {},
    outputProducts: {},
    sourceCommitIds: {},
  }) + '\n', 'utf8');

  return {
    completed: true,
    completedCommits,
    buildMs: Date.now() - start,
    chain: { cwd, commitIds, referenceHashes, referenceBodies },
  };
}

export async function buildDecisionChain(cwd: string, commitCount: number, createdAt: string): Promise<ValidationChain> {
  await resetDir(cwd);
  const commitIds: string[] = [];
  const referenceHashes = new Map<string, string>();
  const referenceBodies = new Map<string, string>();
  let parent: string | null = null;
  for (let i = 0; i < commitCount; i += 1) {
    const verdictId = `verdict_${String(i).padStart(3, '0')}`;
    const evidenceId = `evidence_${String(i).padStart(3, '0')}`;
    const artifactId = `artifact_${String(i).padStart(3, '0')}`;
    const body = `decision-${i}\n`;
    const causalLinks: Partial<TimeMachineCausalLinks> = {
      verdictEvidence: [{ verdictId, evidenceIds: [evidenceId] }],
      evidenceArtifacts: [{ evidenceId, artifactId }],
      rejectedClaims: i === Math.min(30, commitCount - 1) || i === 3
        ? [{ verdictId, status: 'unsupported', claim: 'all work is complete without evidence' }]
        : [],
      alternativesConsidered: [{ verdictId, alternatives: [`option-a-${i}`, `option-b-${i}`] }],
      inputDependencies: [{ verdictId, paths: ['state/decision-ledger.md'], commitIds: parent ? [parent] : [] }],
      outputProducts: [{ verdictId, paths: ['state/decision-ledger.md'] }],
      sourceCommitIds: parent ? [parent] : [],
    };
    const commit = await buildValidationCommit(cwd, i, parent, createdAt, causalLinks, body, 'state/decision-ledger.md');
    commitIds.push(commit.commitId);
    referenceHashes.set(commit.commitId, sha256(body));
    referenceBodies.set(commit.commitId, body);
    parent = commit.commitId;
  }
  return { cwd, commitIds, referenceHashes, referenceBodies };
}

export async function buildValidationCommit(
  cwd: string,
  index: number,
  parent: string | null,
  createdAt: string,
  causalOverride?: Partial<TimeMachineCausalLinks>,
  body = 'synthetic\n',
  repoPath = 'state/document.txt',
): Promise<TimeMachineCommit> {
  const root = path.join(cwd, '.danteforge', 'time-machine');
  await fs.mkdir(path.join(root, 'blobs'), { recursive: true });
  await fs.mkdir(path.join(root, 'commits'), { recursive: true });
  await fs.mkdir(path.join(root, 'refs'), { recursive: true });
  await fs.mkdir(path.join(root, 'index'), { recursive: true });
  const blobHash = sha256(body);
  await fs.writeFile(path.join(root, 'blobs', blobHash), body, 'utf8');
  const entries: TimeMachineSnapshotEntry[] = [{
    path: repoPath,
    blobHash,
    byteLength: Buffer.byteLength(body),
    contentType: 'text',
  }];
  const verdictId = `verdict_${String(index).padStart(3, '0')}`;
  const causalLinks: TimeMachineCausalLinks = {
    materials: [repoPath],
    products: [repoPath],
    verdictEvidence: [{ verdictId, evidenceIds: [`evidence_${String(index).padStart(3, '0')}`] }],
    evidenceArtifacts: [{ evidenceId: `evidence_${String(index).padStart(3, '0')}`, artifactId: `artifact_${String(index).padStart(3, '0')}` }],
    rejectedClaims: [],
    ...causalOverride,
  };
  const parents = parent ? [parent] : [];
  const timestamp = new Date(new Date(createdAt).getTime() + index).toISOString();
  const base = {
    schemaVersion: TIME_MACHINE_SCHEMA_VERSION,
    parents,
    gitSha: null,
    createdAt: timestamp,
    label: `validation-${index}`,
    entries,
    causalLinks,
  };
  const commitId = `tm_${hashDict(base).slice(0, 24)}`;
  const payload = { ...base, commitId };
  const proof = createEvidenceBundle({
    bundleId: `time_machine_${commitId}`,
    gitSha: null,
    evidence: [payload],
    prevHash: parent ?? ZERO_HASH,
    createdAt: timestamp,
  });
  const commit: TimeMachineCommit = { ...payload, proof };
  await fs.writeFile(path.join(root, 'commits', `${commitId}.json`), JSON.stringify(commit, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(root, 'refs', 'head'), `${commitId}\n`, 'utf8');
  await fs.appendFile(path.join(root, 'refs', 'reflog.jsonl'), JSON.stringify({ commitId, parent, at: timestamp, label: `validation-${index}` }) + '\n', 'utf8');
  return commit;
}

export async function restoreAndCompare(chain: ValidationChain, id: string, index: number, outDir: string): Promise<ClassBResult['restoreScenarios'][number]> {
  const commitId = chain.commitIds[index]!;
  const start = Date.now();
  await restoreTimeMachineCommit({ cwd: chain.cwd, commitId, outDir });
  const restoreMs = Date.now() - start;
  const restored = readFileSync(path.join(outDir, 'state', 'document.txt'), 'utf8');
  return {
    id,
    byteIdentical: sha256(restored) === chain.referenceHashes.get(commitId),
    restoreMs,
    details: `restored ${commitId} at index ${index}`,
  };
}

export async function mutateCommitManifest(chain: ValidationChain, position: number): Promise<void> {
  const commitId = chain.commitIds[position]!;
  const file = commitFile(chain.cwd, commitId);
  const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as TimeMachineCommit;
  parsed.label = `${parsed.label}-tampered`;
  await fs.writeFile(file, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
}

export async function mutateBlob(chain: ValidationChain, position: number): Promise<void> {
  const commit = await loadCommitFile(chain.cwd, chain.commitIds[position]!);
  await fs.writeFile(path.join(chain.cwd, '.danteforge', 'time-machine', 'blobs', commit.entries[0]!.blobHash), 'tampered\n', 'utf8');
}

export async function deleteCommitManifest(chain: ValidationChain, position: number): Promise<void> {
  await fs.rm(commitFile(chain.cwd, chain.commitIds[position]!), { force: true });
}

export async function reorderReflog(chain: ValidationChain, position: number): Promise<void> {
  const reflog = path.join(chain.cwd, '.danteforge', 'time-machine', 'refs', 'reflog.jsonl');
  const lines = (await fs.readFile(reflog, 'utf8')).split(/\r?\n/).filter(Boolean);
  const next = Math.min(position + 1, lines.length - 1);
  [lines[position], lines[next]] = [lines[next]!, lines[position]!];
  await fs.writeFile(reflog, `${lines.join('\n')}\n`, 'utf8');
}

export async function fabricateCommitManifest(chain: ValidationChain, position: number): Promise<void> {
  const commitId = chain.commitIds[position]!;
  const commit = await loadCommitFile(chain.cwd, commitId);
  commit.entries[0] = { ...commit.entries[0]!, byteLength: commit.entries[0]!.byteLength + 1 };
  await fs.writeFile(commitFile(chain.cwd, commitId), JSON.stringify(commit, null, 2) + '\n', 'utf8');
}

export function detectBreakPosition(errors: string[], commitIds: string[], fallback: number): number {
  const joined = errors.join('\n');
  const found = commitIds.findIndex(commitId => joined.includes(commitId));
  return found >= 0 ? found : fallback;
}

export async function loadCommitFile(cwd: string, commitId: string): Promise<TimeMachineCommit> {
  return JSON.parse(await fs.readFile(commitFile(cwd, commitId), 'utf8')) as TimeMachineCommit;
}

export async function loadAllCommits(cwd: string): Promise<TimeMachineCommit[]> {
  const dir = path.join(cwd, '.danteforge', 'time-machine', 'commits');
  const files = (await fs.readdir(dir)).filter(file => file.endsWith('.json')).sort();
  const commits = [];
  for (const file of files) commits.push(JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')) as TimeMachineCommit);
  return commits;
}

export async function causalCompletenessAudit(cwd: string): Promise<ClassCResult['completenessAudit']> {
  const commits = await loadAllCommits(cwd);
  const gapCommitIds: string[] = [];
  for (const commit of commits) {
    const hasEvidence = commit.causalLinks.verdictEvidence.length > 0;
    const hasInputs = (commit.causalLinks.inputDependencies?.length ?? 0) > 0;
    const hasOutputs = (commit.causalLinks.outputProducts?.length ?? 0) > 0;
    const hasAlternatives = (commit.causalLinks.alternativesConsidered?.length ?? 0) > 0;
    if (!hasEvidence || !hasInputs || !hasOutputs || !hasAlternatives) gapCommitIds.push(commit.commitId);
  }
  return { complete: commits.length - gapCommitIds.length, gaps: gapCommitIds.length, gapCommitIds };
}

export function detectFabricatedEvidence(commit: TimeMachineCommit): boolean {
  const knownArtifacts = new Set([...commit.causalLinks.materials, ...commit.causalLinks.products]);
  return commit.causalLinks.evidenceArtifacts.some(item => !knownArtifacts.has(item.artifactId));
}

export function thresholdPass(commitCount: number, verifyMs: number, restoreMs: number, queryMs: number): boolean {
  if (commitCount <= 10_000) return verifyMs < 30_000 && restoreMs < 60_000 && queryMs < 30_000;
  if (commitCount <= 100_000) return verifyMs < 300_000 && restoreMs < 300_000 && queryMs < 60_000;
  return verifyMs < 3_600_000 && restoreMs < 600_000 && queryMs < 300_000;
}

async function resetDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

function commitFile(cwd: string, commitId: string): string {
  return path.join(cwd, '.danteforge', 'time-machine', 'commits', `${commitId}.json`);
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
