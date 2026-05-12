// Matrix Kernel — Dashboard snapshot loader (shared by VS Code webview + CLI TUI)
//
// Reads the canonical matrix state files and assembles a compact
// MatrixDashboardSnapshot that both the VS Code war-room webview and the
// terminal `danteforge war-room` command render. Each render surface
// transforms the same snapshot — they never re-implement the loading logic.
//
// File-level resilience: every read is best-effort. Missing or malformed
// files are recorded in `snapshot.errors` so the renderer can warn the user
// without the whole dashboard going dark.

import fs from 'node:fs/promises';
import path from 'node:path';

export interface MatrixDashboardSnapshot {
  /** Workspace root for context paths. */
  workspaceRoot: string;
  /** Run identifier from the latest plan, if known. */
  runId?: string;
  /** Wave summary derived from the simulation plan. */
  waves: Array<{
    waveNumber: number;
    description: string;
    workPacketIds: string[];
    estimatedTokens: number;
    estimatedUsdLow: number;
    estimatedUsdHigh: number;
  }>;
  /** Lease counts by status. */
  leaseCounts: Record<string, number>;
  /** Latest gate-report verdicts. */
  gateReports: Array<{
    leaseId: string;
    status: string;
    passed: number;
    failed: number;
  }>;
  /** Latest merge decisions. */
  mergeDecisions: Array<{
    candidateId: string;
    outcome: string;
  }>;
  /** Pending mailbox messages — used by the TUI for the "active coordination" panel. */
  mailbox: Array<{
    messageId: string;
    type: string;
    fromLease: string;
    toLease: string;
    summary: string;
    impact: string;
    status: string;
    createdAt: string;
  }>;
  /** Top retrospective highlights. */
  retro?: {
    bestPerformingProvider?: string;
    weakestGate?: string;
    recommendedNextRunChanges?: string[];
  };
  /** Wall-clock when this snapshot was loaded. */
  loadedAt: string;
  /** Per-file load errors (file → message), surfaced so the dashboard never silently lies. */
  errors: Record<string, string>;
}

export interface LoadSnapshotOptions {
  workspaceRoot: string;
  /** Injection seam for tests: replaces fs.readFile. */
  _readFile?: (p: string) => Promise<string>;
}

const MATRIX_REL = '.danteforge/matrix';
const FILES = {
  simulationPlan: 'matrix.simulation-plan.json',
  leaseGraph: 'matrix.lease-graph.json',
  gateReports: 'matrix.gate-reports.json',
  mergeDecisions: 'matrix.merge-decisions.json',
  retrospective: 'matrix.retrospective.json',
  mailbox: 'matrix.mailbox.json',
} as const;

export async function loadMatrixDashboardSnapshot(
  options: LoadSnapshotOptions,
): Promise<MatrixDashboardSnapshot> {
  const errors: Record<string, string> = {};
  const readFile = options._readFile ?? defaultReadFile;
  const read = async <T,>(file: string): Promise<T | null> => {
    try {
      const raw = await readFile(path.join(options.workspaceRoot, MATRIX_REL, file));
      return JSON.parse(raw) as T;
    } catch (err) {
      errors[file] = err instanceof Error ? err.message : String(err);
      return null;
    }
  };

  type PlanShape = { runId?: string; waves?: Array<{ waveNumber: number; description: string; workPacketIds: string[]; estimatedTokens: number; estimatedUsdLow: number; estimatedUsdHigh: number }> };
  type LeaseShape = { leases?: Array<{ status: string }> };
  type GatesShape = { reports?: Array<{ leaseId: string; status: string; checks?: Array<{ status: string }> }> };
  // Merge decisions store the verdict under either `decision` (current kernel
  // output) or `outcome` (older surface); honor both.
  type MergeShape = { decisions?: Array<{ candidateId: string; outcome?: string; decision?: string }> };
  type RetroShape = { runId?: string; bestPerformingProvider?: string; weakestGate?: string; recommendedNextRunChanges?: string[] };
  type MailboxShape = { messages?: Array<{ messageId: string; type: string; fromLease: string; toLease: string; summary: string; impact?: string; status: string; createdAt: string }> };

  const plan = await read<PlanShape>(FILES.simulationPlan);
  const leases = await read<LeaseShape>(FILES.leaseGraph);
  const gates = await read<GatesShape>(FILES.gateReports);
  const merges = await read<MergeShape>(FILES.mergeDecisions);
  const retro = await read<RetroShape>(FILES.retrospective);
  const mailbox = await read<MailboxShape>(FILES.mailbox);

  const leaseCounts: Record<string, number> = {};
  for (const lease of leases?.leases ?? []) {
    leaseCounts[lease.status] = (leaseCounts[lease.status] ?? 0) + 1;
  }

  const gateReports = (gates?.reports ?? []).map(r => {
    const checks = r.checks ?? [];
    return {
      leaseId: r.leaseId,
      status: r.status,
      passed: checks.filter(c => c.status === 'passed').length,
      failed: checks.filter(c => c.status === 'failed').length,
    };
  });

  return {
    workspaceRoot: options.workspaceRoot,
    runId: plan?.runId ?? retro?.runId,
    waves: plan?.waves ?? [],
    leaseCounts,
    gateReports,
    mergeDecisions: (merges?.decisions ?? []).map(d => ({
      candidateId: d.candidateId,
      outcome: d.outcome ?? d.decision ?? 'unknown',
    })),
    mailbox: (mailbox?.messages ?? []).map(m => ({
      messageId: m.messageId,
      type: m.type,
      fromLease: m.fromLease,
      toLease: m.toLease,
      summary: m.summary,
      impact: m.impact ?? 'informational',
      status: m.status,
      createdAt: m.createdAt,
    })),
    retro: retro ? {
      bestPerformingProvider: retro.bestPerformingProvider,
      weakestGate: retro.weakestGate,
      recommendedNextRunChanges: retro.recommendedNextRunChanges,
    } : undefined,
    loadedAt: new Date().toISOString(),
    errors,
  };
}

async function defaultReadFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf8');
}

/** Files the war-room watches for live refresh. Caller resolves to absolute paths. */
export function dashboardWatchFiles(workspaceRoot: string): string[] {
  return Object.values(FILES).map(f => path.join(workspaceRoot, MATRIX_REL, f));
}
