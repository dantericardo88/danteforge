export declare const EVIDENCE_CHAIN_SCHEMA_VERSION: "evidence-chain.v1";
export declare const ZERO_HASH: string;
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
export declare function stableJSON(value: unknown): string;
export declare function sha256(input: string | Uint8Array): string;
export declare function hashDict(value: unknown): string;
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
export declare class HashChain<T = unknown> {
    private readonly entries;
    constructor(entries?: HashChainEntry<T>[]);
    append(payload: T, options?: HashChainAppendOptions): HashChainEntry<T>;
    get headHash(): string;
    toJSON(): HashChainEntry<T>[];
    verifyIntegrity(): VerificationResult & {
        headHash: string;
    };
    static verifyEntries<TEntry = unknown>(entries: HashChainEntry<TEntry>[]): VerificationResult & {
        headHash: string;
    };
}
export interface MerkleProofStep {
    position: 'left' | 'right';
    hash: string;
}
export declare class MerkleTree {
    private readonly leaves;
    private readonly levels;
    constructor(leaves?: string[]);
    get root(): string;
    getProof(index: number): MerkleProofStep[];
    static verifyProof(leafHash: string, proof: MerkleProofStep[], expectedRoot: string): boolean;
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
export declare function createReceipt<T = unknown>(input: CreateReceiptInput<T>): Receipt<T>;
export declare function verifyReceipt(receipt: Receipt<unknown>): VerificationResult;
export declare class ReceiptChain<T = unknown> {
    private readonly receipts;
    append(input: CreateReceiptInput<T>): Receipt<T>;
    get headHash(): string;
    toJSON(): Receipt<T>[];
    verifyIntegrity(): VerificationResult & {
        headHash: string;
    };
    static verifyReceipts<TReceipt = unknown>(receipts: Receipt<TReceipt>[]): VerificationResult & {
        headHash: string;
    };
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
export declare function createEvidenceBundle<T = unknown>(input: CreateEvidenceBundleInput<T>): EvidenceBundle<T>;
export declare function aggregateChildReceipts(runId: string, children: Receipt<unknown>[]): EvidenceBundle<Receipt<unknown>>;
export declare function verifyBundle(bundle: EvidenceBundle<unknown>): VerificationResult;
//# sourceMappingURL=index.d.ts.map