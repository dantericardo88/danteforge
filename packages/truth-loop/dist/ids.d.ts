import { sha256 } from '@danteforge/evidence-chain';
export declare function nextRunId(rootDir: string, now?: Date): string;
export declare function newArtifactId(): string;
export declare function newEvidenceId(): string;
export declare function newClaimId(): string;
export declare function newVerdictId(runId: string): string;
export declare function newNextActionId(runId: string): string;
export declare function newBudgetEnvelopeId(runId: string): string;
export { sha256 };
//# sourceMappingURL=ids.d.ts.map