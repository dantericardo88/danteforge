import { createHash } from 'node:crypto';
export const EVIDENCE_CHAIN_SCHEMA_VERSION = 'evidence-chain.v1';
export const ZERO_HASH = '0'.repeat(64);
export function stableJSON(value) {
    return JSON.stringify(normalize(value, new WeakSet()));
}
export function sha256(input) {
    return createHash('sha256').update(input).digest('hex');
}
export function hashDict(value) {
    return sha256(stableJSON(value));
}
function normalize(value, seen, arraySlot = false) {
    if (value === null)
        return null;
    const t = typeof value;
    if (t === 'string' || t === 'boolean')
        return value;
    if (t === 'number') {
        if (!Number.isFinite(value))
            throw new TypeError('stableJSON cannot serialize non-finite numbers');
        return value;
    }
    if (t === 'bigint')
        return value.toString();
    if (t === 'undefined' || t === 'function' || t === 'symbol')
        return arraySlot ? null : undefined;
    if (value instanceof Date)
        return value.toISOString();
    if (Array.isArray(value)) {
        return value.map(item => normalize(item, seen, true) ?? null);
    }
    if (t === 'object') {
        const obj = value;
        if (seen.has(obj))
            throw new TypeError('stableJSON cannot serialize circular structures');
        seen.add(obj);
        const out = {};
        for (const key of Object.keys(obj).sort()) {
            const normalized = normalize(obj[key], seen);
            if (normalized !== undefined)
                out[key] = normalized;
        }
        seen.delete(obj);
        return out;
    }
    return arraySlot ? null : undefined;
}
export class HashChain {
    entries;
    constructor(entries = []) {
        this.entries = entries.map(entry => ({ ...entry }));
    }
    append(payload, options = {}) {
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
    get headHash() {
        return this.entries.length === 0 ? ZERO_HASH : this.entries[this.entries.length - 1].hash;
    }
    toJSON() {
        return this.entries.map(entry => ({ ...entry }));
    }
    verifyIntegrity() {
        return HashChain.verifyEntries(this.entries);
    }
    static verifyEntries(entries) {
        const errors = [];
        let previousHash = ZERO_HASH;
        entries.forEach((entry, index) => {
            if (entry.index !== index)
                errors.push(`entry ${index}: expected index ${index}, got ${entry.index}`);
            if (entry.prevHash !== previousHash)
                errors.push(`entry ${index}: prevHash mismatch`);
            const expected = buildHashChainEntry({
                index: entry.index,
                payload: entry.payload,
                prevHash: entry.prevHash,
                createdAt: entry.createdAt,
            });
            if (entry.payloadHash !== expected.payloadHash)
                errors.push(`entry ${index}: payloadHash mismatch`);
            if (entry.hash !== expected.hash)
                errors.push(`entry ${index}: hash mismatch`);
            previousHash = entry.hash;
        });
        return {
            valid: errors.length === 0,
            errors,
            headHash: entries.length === 0 ? ZERO_HASH : entries[entries.length - 1].hash,
        };
    }
}
function buildHashChainEntry(input) {
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
export class MerkleTree {
    leaves;
    levels;
    constructor(leaves = []) {
        this.leaves = [...leaves];
        this.levels = buildMerkleLevels(this.leaves);
    }
    get root() {
        const top = this.levels[this.levels.length - 1];
        return top?.[0] ?? ZERO_HASH;
    }
    getProof(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this.leaves.length) {
            throw new RangeError(`Merkle leaf index out of range: ${index}`);
        }
        const proof = [];
        let currentIndex = index;
        for (let levelIndex = 0; levelIndex < this.levels.length - 1; levelIndex++) {
            const level = this.levels[levelIndex];
            const isRightNode = currentIndex % 2 === 1;
            const siblingIndex = isRightNode ? currentIndex - 1 : currentIndex + 1;
            const siblingHash = level[siblingIndex] ?? level[currentIndex];
            proof.push({ position: isRightNode ? 'left' : 'right', hash: siblingHash });
            currentIndex = Math.floor(currentIndex / 2);
        }
        return proof;
    }
    static verifyProof(leafHash, proof, expectedRoot) {
        let current = leafHash;
        for (const step of proof) {
            current = step.position === 'left'
                ? sha256(`${step.hash}${current}`)
                : sha256(`${current}${step.hash}`);
        }
        return current === expectedRoot;
    }
}
function buildMerkleLevels(leaves) {
    if (leaves.length === 0)
        return [[ZERO_HASH]];
    const levels = [leaves];
    while (levels[levels.length - 1].length > 1) {
        const level = levels[levels.length - 1];
        const next = [];
        for (let i = 0; i < level.length; i += 2) {
            const left = level[i];
            const right = level[i + 1] ?? left;
            next.push(sha256(`${left}${right}`));
        }
        levels.push(next);
    }
    return levels;
}
export function createReceipt(input) {
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
export function verifyReceipt(receipt) {
    const errors = [];
    const expectedPayloadHash = hashDict(receipt.payload);
    if (receipt.payloadHash !== expectedPayloadHash)
        errors.push('payloadHash mismatch');
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
    if (receipt.hash !== expectedHash)
        errors.push('receipt hash mismatch');
    return {
        valid: errors.length === 0,
        errors,
        expectedHash,
        actualHash: receipt.hash,
    };
}
export class ReceiptChain {
    receipts = [];
    append(input) {
        const receipt = createReceipt({
            ...input,
            prevHash: input.prevHash ?? this.headHash,
        });
        this.receipts.push(receipt);
        return receipt;
    }
    get headHash() {
        return this.receipts.length === 0 ? ZERO_HASH : this.receipts[this.receipts.length - 1].hash;
    }
    toJSON() {
        return this.receipts.map(receipt => ({ ...receipt }));
    }
    verifyIntegrity() {
        return ReceiptChain.verifyReceipts(this.receipts);
    }
    static verifyReceipts(receipts) {
        const errors = [];
        let previousHash = ZERO_HASH;
        receipts.forEach((receipt, index) => {
            const receiptCheck = verifyReceipt(receipt);
            if (!receiptCheck.valid)
                errors.push(...receiptCheck.errors.map(error => `receipt ${index}: ${error}`));
            if (receipt.prevHash !== previousHash)
                errors.push(`receipt ${index}: prevHash mismatch`);
            previousHash = receipt.hash;
        });
        return {
            valid: errors.length === 0,
            errors,
            headHash: receipts.length === 0 ? ZERO_HASH : receipts[receipts.length - 1].hash,
        };
    }
}
export function createEvidenceBundle(input) {
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
export function aggregateChildReceipts(runId, children) {
    const errors = [];
    children.forEach((child, index) => {
        const check = verifyReceipt(child);
        if (!check.valid) {
            errors.push(`child ${index} (${child.receiptId}): ${check.errors.join('; ')}`);
        }
    });
    if (errors.length > 0) {
        throw new Error(`Cannot aggregate invalid child receipt(s): ${errors.join('; ')}`);
    }
    const gitShas = new Set(children.map(child => child.gitSha ?? null));
    const [singleGitSha] = gitShas;
    const childCopies = children.map(child => ({
        ...child,
        payload: cloneStableJson(child.payload),
    }));
    const latestCreatedAt = children
        .map(child => child.createdAt)
        .sort()
        .at(-1);
    return createEvidenceBundle({
        runId,
        bundleId: `aggregate_${runId}`,
        evidence: childCopies,
        prevHash: children.at(-1)?.hash ?? ZERO_HASH,
        createdAt: latestCreatedAt,
        gitSha: gitShas.size === 1 ? singleGitSha : null,
    });
}
function cloneStableJson(value) {
    return JSON.parse(stableJSON(value));
}
export function verifyBundle(bundle) {
    const errors = [];
    const expectedPayloadHash = hashDict(bundle.evidence);
    if (bundle.payloadHash !== expectedPayloadHash)
        errors.push('payloadHash mismatch');
    const expectedEvidenceHashes = bundle.evidence.map(item => hashDict(item));
    if (stableJSON(bundle.evidenceHashes) !== stableJSON(expectedEvidenceHashes))
        errors.push('evidenceHashes mismatch');
    const tree = new MerkleTree(expectedEvidenceHashes);
    if (bundle.merkleRoot !== tree.root)
        errors.push('merkleRoot mismatch');
    if (bundle.inclusionProofs.length !== expectedEvidenceHashes.length) {
        errors.push('inclusionProofs length mismatch');
    }
    else {
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
    if (bundle.hash !== expectedHash)
        errors.push('bundle hash mismatch');
    return {
        valid: errors.length === 0,
        errors,
        expectedHash,
        actualHash: bundle.hash,
    };
}
//# sourceMappingURL=index.js.map