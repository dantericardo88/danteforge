import type { Artifact } from '@danteforge/truth-loop';
export type GateName = 'forge_policy' | 'evidence_chain' | 'harsh_score';
export type GateStatus = 'green' | 'yellow' | 'red';
export interface GateResult {
    gate: GateName;
    status: GateStatus;
    reason: string;
}
export interface ThreeWayGate {
    results: GateResult[];
    overall: GateStatus;
    blockingReasons: string[];
}
export declare const PRODUCTION_THRESHOLD = 9;
export interface GateInputs {
    artifacts: Artifact[];
    scores: Record<string, number>;
    requiredDimensions: string[];
    policyGate?: (output: unknown) => GateResult;
    evidenceCheck?: EvidenceCheck;
    gitSha?: string | null;
    /**
     * Map of dimension -> known structural cap. When a dim score is below 9.0
     * but at-or-above its declared cap, the harsh-score gate treats it as
     * "passing the cap" rather than "below threshold".
     */
    structuralCaps?: Record<string, number>;
    /**
     * When true, "cap-aware pass" cases produce an `overall: green` rather than
     * `yellow`.
     */
    treatCapAsGreen?: boolean;
}
export interface EvidenceGateContext {
    gitSha?: string | null;
}
export type EvidenceCheck = (artifacts: Artifact[], context: EvidenceGateContext) => GateResult;
export declare function evaluateThreeWayGate(g: GateInputs): ThreeWayGate;
export declare function defaultPolicyGate(_: unknown): GateResult;
export declare function defaultEvidenceCheck(artifacts: Artifact[], context?: EvidenceGateContext): GateResult;
export declare function harshScoreGate(scores: Record<string, number>, requiredDimensions: string[], structuralCaps?: Record<string, number>): GateResult;
//# sourceMappingURL=index.d.ts.map