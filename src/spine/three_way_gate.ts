export type {
  EvidenceCheck,
  EvidenceGateContext,
  GateInputs,
  GateName,
  GateResult,
  GateStatus,
  ThreeWayGate,
} from '@danteforge/three-way-gate';

export {
  PRODUCTION_THRESHOLD,
  defaultEvidenceCheck,
  defaultPolicyGate,
  evaluateThreeWayGate,
  harshScoreGate,
} from '@danteforge/three-way-gate';
