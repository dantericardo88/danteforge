// Matrix Kernel — central type re-exports.
// Single import point for all Matrix Kernel contracts.

export * from './project-graph.js';
export * from './dimension-graph.js';
export * from './work-graph.js';
export * from './dependency-graph.js';
export * from './ownership.js';
export * from './lease.js';
export * from './conflict.js';
export * from './agent.js';
export * from './simulation.js';
export * from './gate.js';
export * from './merge.js';
export * from './evidence.js';
export * from './retrospective.js';

// ── Canonical report paths (PRD §26) ────────────────────────────────────────

export const MATRIX_DIR = '.danteforge/matrix';

export const MATRIX_REPORT_PATHS = {
  projectGraph:        `${MATRIX_DIR}/matrix.project-graph.json`,
  dimensionGraph:      `${MATRIX_DIR}/matrix.dimension-graph.json`,
  workGraph:           `${MATRIX_DIR}/matrix.work-graph.json`,
  dependencyGraph:     `${MATRIX_DIR}/matrix.dependency-graph.json`,
  leaseGraph:          `${MATRIX_DIR}/matrix.lease-graph.json`,
  evidenceGraph:       `${MATRIX_DIR}/matrix.evidence-graph.json`,
  simulationPlan:      `${MATRIX_DIR}/matrix.simulation-plan.json`,
  ownershipMap:        `${MATRIX_DIR}/matrix.ownership-map.json`,
  conflicts:           `${MATRIX_DIR}/matrix.conflicts.json`,
  workPackets:         `${MATRIX_DIR}/matrix.work-packets.json`,
  leases:              `${MATRIX_DIR}/matrix.leases.json`,
  agentRuns:           `${MATRIX_DIR}/matrix.agent-runs.json`,
  mailbox:             `${MATRIX_DIR}/matrix.mailbox.json`,
  gateReports:         `${MATRIX_DIR}/matrix.gate-reports.json`,
  redTeamReports:      `${MATRIX_DIR}/matrix.red-team-reports.json`,
  tasteGates:          `${MATRIX_DIR}/matrix.taste-gates.json`,
  mergeDecisions:      `${MATRIX_DIR}/matrix.merge-decisions.json`,
  retrospective:       `${MATRIX_DIR}/matrix.retrospective.json`,
  finalReport:         `${MATRIX_DIR}/matrix.final-report.md`,
  agentMemoryDir:      `${MATRIX_DIR}/agent-memory`,
} as const;

export type MatrixReportName = keyof typeof MATRIX_REPORT_PATHS;
