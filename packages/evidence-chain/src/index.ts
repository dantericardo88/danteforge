import { createHash } from 'node:crypto';

export const EVIDENCE_CHAIN_SCHEMA_VERSION = 'evidence-chain.v1' as const;
export const ZERO_HASH = '0'.repeat(64);

export type VerificationStatus = 'unverified' | 'valid' | 'invalid';

export interface VerificationResult {
  valid: boolean;
  errors: string[];
  expectedHash?: string;
  actualHash?: string;
}

export interface ProofEnvelope {
  schemaVersion: typeof EVIDENCE_CHAIN_SCHEMA_VERSION;
  runId?: string;
  receiptId?: string;
  gitSha: string | null;
  createdAt: string;
  payloadHash: string;
  prevHash: string;
  merkleRoot?: string;
  verificationStatus: VerificationStatus;
}

type JsonLike =
  | null
  | string
  | number
  | boolean
  | JsonLike[]
  | { [key: string]: JsonLike };

export function stableJSON(value: unknown): string {
  return JSON.stringify(normalize(value, new WeakSet<object>()));
}

export function sha256(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hashDict(value: unknown): string {
  return sha256(stableJSON(value));
}

function normalize(value: unknown, seen: WeakSet<object>, arraySlot = false): JsonLike | undefined {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value as string | boolean;
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('stableJSON cannot serialize non-finite numbers');
    return value as number;
  }
  if (t === 'bigint') return (value as bigint).toString();
  if (t === 'undefined' || t === 'function' || t === 'symbol') return arraySlot ? null : undefined;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map(item => normalize(item, seen, true) ?? null);
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) throw new TypeError('stableJSON cannot serialize circular structures');
    seen.add(obj);
    const out: Record<string, JsonLike> = {};
    for (const key of Object.keys(obj).sort()) {
      const normalized = normalize(obj[key], seen);
      if (normalized !== undefined) out[key] = normalized;
    }
    seen.delete(obj);
    return out;
  }
  return arraySlot ? null : undefined;
}

export interface HashChainEntry<T = unknown> {
  index: number;
  payload: T;
  payloadHash: string;
  prevHash: string;
  hash: string;
  createdAt: string;
}

export interface HashChainAppendOptions {
  createdAt?: string;
}

export class HashChain<T = unknown> {
  private readonly entries: HashChainEntry<T>[];

  constructor(entries: HashChainEntry<T>[] = []) {
    this.entries = entries.map(entry => ({ ...entry }));
  }

  append(payload: T, options: HashChainAppendOptions = {}): HashChainEntry<T> {
    const prevHash = this.headHash;
    const entry = buildHashChainEntry({
      index: this.entries.length,
      payload,
      prevHash,
      createdAt: options.createdAt ?? new Date().toISOString(),
    });
    this.entries.push(entry);
    return { ...entry };
  }

  get headHash(): string {
    return this.entries.length === 0 ? ZERO_HASH : this.entries[this.entries.length - 1]!.hash;
  }

  toJSON(): HashChainEntry<T>[] {
    return this.entries.map(entry => ({ ...entry }));
  }

  verifyIntegrity(): VerificationResult & { headHash: string } {
    return HashChain.verifyEntries(this.entries);
  }

  static verifyEntries<TEntry = unknown>(entries: HashChainEntry<TEntry>[]): VerificationResult & { headHash: string } {
    const errors: string[] = [];
    let previousHash = ZERO_HASH;

    entries.forEach((entry, index) => {
      if (entry.index !== index) errors.push(`entry ${index}: expected index ${index}, got ${entry.index}`);
      if (entry.prevHash !== previousHash) errors.push(`entry ${index}: prevHash mismatch`);
      const expected = buildHashChainEntry({
        index: entry.index,
        payload: entry.payload,
        prevHash: entry.prevHash,
        createdAt: entry.createdAt,
      });
      if (entry.payloadHash !== expected.payloadHash) errors.push(`entry ${index}: payloadHash mismatch`);
      if (entry.hash !== expected.hash) errors.push(`entry ${index}: hash mismatch`);
      previousHash = entry.hash;
    });

    return {
      valid: errors.length === 0,
      errors,
      headHash: entries.length === 0 ? ZERO_HASH : entries[entries.length - 1]!.hash,
    };
  }
}

function buildHashChainEntry<T>(input: { index: number; payload: T; prevHash: string; createdAt: string }): HashChainEntry<T> {
  const payloadHash = hashDict(input.payload);
  const hash = hashDict({
    index: input.index,
    payloadHash,
    prevHash: input.prevHash,
    createdAt: input.createdAt,
  });
  return {
    index: input.index,
    payload: input.payload,
    payloadHash,
    prevHash: input.prevHash,
    hash,
    createdAt: input.createdAt,
  };
}

export interface MerkleProofStep {
  position: 'left' | 'right';
  hash: string;
}

export class MerkleTree {
  private readonly leaves: string[];
  private readonly levels: string[][];

  constructor(leaves: string[] = []) {
    this.leaves = [...leaves];
    this.levels = buildMerkleLevels(this.leaves);
  }

  get root(): string {
    const top = this.levels[this.levels.length - 1];
    return top?.[0] ?? ZERO_HASH;
  }

  getProof(index: number): MerkleProofStep[] {
    if (!Number.isInteger(index) || index < 0 || index >= this.leaves.length) {
      throw new RangeError(`Merkle leaf index out of range: ${index}`);
    }

    const proof: MerkleProofStep[] = [];
    let currentIndex = index;
    for (let levelIndex = 0; levelIndex < this.levels.length - 1; levelIndex++) {
      const level = this.levels[levelIndex]!;
      const isRightNode = currentIndex % 2 === 1;
      const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;
      const siblingHash = level[siblingIndex] ?? level[currentIndex]!;
      proof.push({ position: isRightNode ? 'left' : 'right', hash: siblingHash });
      currentIndex = Math.floor(currentIndex / 2);
    }
    return proof;
  }

  static verifyProof(leafHash: string, proof: MerkleProofStep[], expectedRoot: string): boolean {
    let current = leafHash;
    for (const step of proof) {
      current = step.position === 'left'
        ? sha256(`${step.hash}${current}`)
        : sha256(`${current}${step.hash}`);
    }
    return current === expectedRoot;
  }
}

function buildMerkleLevels(leaves: string[]): string[][] {
  if (leaves.length === 0) return [[ZERO_HASH]];
  const levels = [leaves];
  while (levels[levels.length - 1]!.length > 1) {
    const level = levels[levels.length - 1]!;
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!;
      const right = level[i + 1] ?? left;
      next.push(sha256(`${left}${right}`));
    }
    levels.push(next);
  }
  return levels;
}

export interface CreateReceiptInput<T = unknown> {
  runId?: string;
  receiptId?: string;
  gitSha?: string | null;
  action: string;
  payload: T;
  prevHash?: string;
  createdAt?: string;
  merkleRoot?: string;
}

export interface Receipt<T = unknown> extends ProofEnvelope {
  receiptId: string;
  action: string;
  payload: T;
  hash: string;
}

export function createReceipt<T = unknown>(input: CreateReceiptInput<T>): Receipt<T> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const payloadHash = hashDict(input.payload);
  const receiptId = input.receiptId ?? `rcpt_${sha256(`${createdAt}:${input.action}:${payloadHash}`).slice(0, 16)}`;
  const base = {
    schemaVersion: EVIDENCE_CHAIN_SCHEMA_VERSION,
    ...(input.runId ? { runId: input.runId } : {}),
    receiptId,
    gitSha: input.gitSha ?? null,
    createdAt,
    payloadHash,
    prevHash: input.prevHash ?? ZERO_HASH,
    ...(input.merkleRoot ? { merkleRoot: input.merkleRoot } : {}),
    action: input.action,
  };
  return {
    ...base,
    verificationStatus: 'unverified',
    payload: input.payload,
    hash: hashDict(base),
  };
}

export function verifyReceipt(receipt: Receipt<unknown>): VerificationResult {
  const errors: string[] = [];
  const expectedPayloadHash = hashDict(receipt.payload);
  if (receipt.payloadHash !== expectedPayloadHash) errors.push('payloadHash mismatch');
  const expectedBase = {
    schemaVersion: receipt.schemaVersion,
    ...(receipt.runId ? { runId: receipt.runId } : {}),
    receiptId: receipt.receiptId,
    gitSha: receipt.gitSha ?? null,
    createdAt: receipt.createdAt,
    payloadHash: receipt.payloadHash,
    prevHash: receipt.prevHash,
    ...(receipt.merkleRoot ? { merkleRoot: receipt.merkleRoot } : {}),
    action: receipt.action,
  };
  const expectedHash = hashDict(expectedBase);
  if (receipt.hash !== expectedHash) errors.push('receipt hash mismatch');
  return {
    valid: errors.length === 0,
    errors,
    expectedHash,
    actualHash: receipt.hash,
  };
}

export class ReceiptChain<T = unknown> {
  private readonly receipts: Receipt<T>[] = [];

  append(input: CreateReceiptInput<T>): Receipt<T> {
    const receipt = createReceipt({
      ...input,
      prevHash: input.prevHash ?? this.headHash,
    });
    this.receipts.push(receipt);
    return receipt;
  }

  get headHash(): string {
    return this.receipts.length === 0 ? ZERO_HASH : this.receipts[this.receipts.length - 1]!.hash;
  }

  toJSON(): Receipt<T>[] {
    return this.receipts.map(receipt => ({ ...receipt }));
  }

  verifyIntegrity(): VerificationResult & { headHash: string } {
    return ReceiptChain.verifyReceipts(this.receipts);
  }

  static verifyReceipts<TReceipt = unknown>(receipts: Receipt<TReceipt>[]): VerificationResult & { headHash: string } {
    const errors: string[] = [];
    let previousHash = ZERO_HASH;
    receipts.forEach((receipt, index) => {
      const receiptCheck = verifyReceipt(receipt as Receipt<unknown>);
      if (!receiptCheck.valid) errors.push(...receiptCheck.errors.map(error => `receipt ${index}: ${error}`));
      if (receipt.prevHash !== previousHash) errors.push(`receipt ${index}: prevHash mismatch`);
      previousHash = receipt.hash;
    });
    return {
      valid: errors.length === 0,
      errors,
      headHash: receipts.length === 0 ? ZERO_HASH : receipts[receipts.length - 1]!.hash,
    };
  }
}

export interface MerkleInclusionProof {
  index: number;
  leafHash: string;
  proof: MerkleProofStep[];
}

export interface CreateEvidenceBundleInput<T = unknown> {
  runId?: string;
  receiptId?: string;
  bundleId: string;
  gitSha?: string | null;
  evidence: T[];
  prevHash?: string;
  createdAt?: string;
}

export interface EvidenceBundle<T = unknown> extends ProofEnvelope {
  bundleId: string;
  merkleRoot: string;
  evidence: T[];
  evidenceHashes: string[];
  inclusionProofs: MerkleInclusionProof[];
  hash: string;
}

export function createEvidenceBundle<T = unknown>(input: CreateEvidenceBundleInput<T>): EvidenceBundle<T> {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const evidenceHashes = input.evidence.map(item => hashDict(item));
  const tree = new MerkleTree(evidenceHashes);
  const payloadHash = hashDict(input.evidence);
  const receiptId = input.receiptId ?? `bundle_${sha256(`${createdAt}:${input.bundleId}:${payloadHash}`).slice(0, 16)}`;
  const inclusionProofs = evidenceHashes.map((leafHash, index) => ({
    index,
    leafHash,
    proof: tree.getProof(index),
  }));
  const base = {
    schemaVersion: EVIDENCE_CHAIN_SCHEMA_VERSION,
    ...(input.runId ? { runId: input.runId } : {}),
    receiptId,
    bundleId: input.bundleId,
    gitSha: input.gitSha ?? null,
    createdAt,
    payloadHash,
    prevHash: input.prevHash ?? ZERO_HASH,
    merkleRoot: tree.root,
    evidenceHashes,
  };
  return {
    ...base,
    verificationStatus: 'unverified',
    evidence: input.evidence,
    inclusionProofs,
    hash: hashDict(base),
  };
}

export function verifyBundle(bundle: EvidenceBundle<unknown>): VerificationResult {
  const errors: string[] = [];
  const expectedPayloadHash = hashDict(bundle.evidence);
  if (bundle.payloadHash !== expectedPayloadHash) errors.push('payloadHash mismatch');

  const expectedEvidenceHashes = bundle.evidence.map(item => hashDict(item));
  if (stableJSON(bundle.evidenceHashes) !== stableJSON(expectedEvidenceHashes)) errors.push('evidenceHashes mismatch');

  const tree = new MerkleTree(expectedEvidenceHashes);
  if (bundle.merkleRoot !== tree.root) errors.push('merkleRoot mismatch');

  if (bundle.inclusionProofs.length !== expectedEvidenceHashes.length) {
    errors.push('inclusionProofs length mismatch');
  } else {
    for (const proof of bundle.inclusionProofs) {
      if (proof.leafHash !== expectedEvidenceHashes[proof.index]) {
        errors.push(`inclusion proof ${proof.index}: leafHash mismatch`);
        continue;
      }
      if (!MerkleTree.verifyProof(proof.leafHash, proof.proof, bundle.merkleRoot)) {
        errors.push(`inclusion proof ${proof.index}: verification failed`);
      }
    }
  }

  const expectedBase = {
    schemaVersion: bundle.schemaVersion,
    ...(bundle.runId ? { runId: bundle.runId } : {}),
    ...(bundle.receiptId ? { receiptId: bundle.receiptId } : {}),
    bundleId: bundle.bundleId,
    gitSha: bundle.gitSha ?? null,
    createdAt: bundle.createdAt,
    payloadHash: bundle.payloadHash,
    prevHash: bundle.prevHash,
    merkleRoot: bundle.merkleRoot,
    evidenceHashes: bundle.evidenceHashes,
  };
  const expectedHash = hashDict(expectedBase);
  if (bundle.hash !== expectedHash) errors.push('bundle hash mismatch');

  return {
    valid: errors.length === 0,
    errors,
    expectedHash,
    actualHash: bundle.hash,
  };
}
