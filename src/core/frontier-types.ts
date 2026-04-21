// frontier-types.ts — Type contracts for the DanteForge Frontier Gap Engine
// Claim -> Skeptic Objection -> Gap Type -> Required Proof -> Re-score

export type GapType = 'capability' | 'proof' | 'reliability' | 'productization';

export type FrontierStatus =
  | 'catch-up'            // obvious gap still exists vs competitors
  | 'near-frontier'       // mostly there, but skeptic objection still valid
  | 'frontier-complete'   // parity gap effectively closed
  | 'creativity-frontier'; // no parity gap left; next gains come from originality

export interface SkepticObjection {
  text: string;
  gapType: GapType;
  severity: number;      // 0–10 leverage score (higher = more urgent)
  requiredProof: string;
  proofArtifacts?: string[];
  nextJustifiedScore: number;
  whatRemainsAfter?: string;
}

export interface FrontierDimension {
  id: string;
  label: string;
  currentClaim: string;
  currentScore: number;
  competitorBestScore: number;
  competitorBestName: string;
  objection: SkepticObjection;
  status: FrontierStatus;
  leverage: number;       // composite rank score (weight × severity × closability)
}

export interface FrontierReport {
  timestamp: string;
  projectName: string;
  overallSelfScore: number;
  dimensions: FrontierDimension[];
  topObjections: FrontierDimension[];   // top 5 by leverage
  doNotWorkOn: FrontierDimension[];     // lowest-leverage items
}

export type RaiseVerdict =
  | 'build more'
  | 'validate more'
  | 'harden more'
  | 'package story and raise';

export interface RaiseReadinessReport {
  verdict: RaiseVerdict;
  isRaiseReady: boolean;
  overallSelfScore: number;
  killerObjections: Array<{ label: string; objection: string; gapType: GapType }>;
  fixIn3to7Days: Array<{ label: string; proof: string }>;
  gapTypeBreakdown: Record<GapType, number>;
}
