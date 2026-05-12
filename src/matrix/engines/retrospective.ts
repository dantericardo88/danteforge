// Matrix Kernel — Retrospective generator (Phase 12 of PRD §23)
//
// Aggregates the outputs of a Matrix run into a learning document: provider
// performance, conflict patterns, gate effectiveness, high-risk files, and
// recommendations for the next run.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentRunResult } from '../types/agent.js';
import type { GateReport, RedTeamReport } from '../types/gate.js';
import type { MergeDecision } from '../types/merge.js';
import type { ConflictReport } from '../types/conflict.js';
import type {
  MatrixRetrospective,
  ProviderPerformance,
  ConflictPattern,
  GateEffectiveness,
} from '../types/retrospective.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';

export interface GenerateRetrospectiveOptions {
  runId: string;
  startedAt: string;
  completedAt?: string;
  agentRuns: AgentRunResult[];
  gateReports: GateReport[];
  redTeamReports: RedTeamReport[];
  mergeDecisions: MergeDecision[];
  conflictReport: ConflictReport;
  _now?: () => string;
}

export function generateRetrospective(
  options: GenerateRetrospectiveOptions,
): MatrixRetrospective {
  const now = options._now ?? (() => new Date().toISOString());
  const providerPerformance = computeProviderPerformance(options);
  const conflictPatterns = computeConflictPatterns(options.conflictReport);
  const gateEffectiveness = computeGateEffectiveness(options.gateReports);
  const highRiskFiles = computeHighRiskFiles(options.conflictReport, options.mergeDecisions);

  const bestProvider = pickBest(providerPerformance);
  const weakestGate = pickWeakest(gateEffectiveness);
  const mostReliableGate = pickReliable(gateEffectiveness);
  const highestConflictArea = highRiskFiles[0] ?? '(none)';
  const mergeBottleneck = computeMergeBottleneck(options.mergeDecisions);

  return {
    runId: options.runId,
    generatedAt: now(),
    startedAt: options.startedAt,
    completedAt: options.completedAt ?? now(),

    bestPerformingProvider: bestProvider,
    highestConflictArea,
    mostReliableGate,
    weakestGate,
    mergeBottleneck,

    providerPerformance,
    conflictPatterns,
    gateEffectiveness,
    highRiskFiles,

    recommendedNextRunChanges: buildRecommendations({
      providerPerformance,
      conflictPatterns,
      mergeDecisions: options.mergeDecisions,
    }),
  };
}

export async function writeRetrospective(
  retro: MatrixRetrospective,
  cwd?: string,
): Promise<string> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.retrospective);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(retro, null, 2), 'utf8');
  return outPath;
}

// ── Aggregators ─────────────────────────────────────────────────────────────

function computeProviderPerformance(options: GenerateRetrospectiveOptions): ProviderPerformance[] {
  const map = new Map<string, ProviderPerformance>();
  for (const run of options.agentRuns) {
    // Derive provider from lease — we infer via the runId prefix shape
    const provider = inferProvider(run);
    const entry = map.get(provider) ?? {
      provider, runsAttempted: 0, runsSucceeded: 0, runsFailed: 0,
      avgTokensPerRun: 0, avgRuntimeMinutes: 0,
      conflictsCaused: 0, redTeamFailures: 0,
    };
    entry.runsAttempted++;
    if (run.status === 'completed') entry.runsSucceeded++;
    else if (run.status === 'failed' || run.status === 'timed_out') entry.runsFailed++;
    if (run.tokensConsumed) entry.avgTokensPerRun = (entry.avgTokensPerRun + run.tokensConsumed) / 2;
    const durMs = new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime();
    if (!isNaN(durMs)) entry.avgRuntimeMinutes = (entry.avgRuntimeMinutes + durMs / 60_000) / 2;
    map.set(provider, entry);
  }

  // Add red-team failure counts
  for (const rt of options.redTeamReports) {
    if (rt.status === 'failed') {
      const run = options.agentRuns.find(r => r.leaseId === rt.leaseId);
      const provider = run ? inferProvider(run) : 'unknown';
      const entry = map.get(provider);
      if (entry) entry.redTeamFailures++;
    }
  }

  return Array.from(map.values());
}

function inferProvider(run: AgentRunResult): string {
  if (run.runId.startsWith('fakerun.')) return 'fake';
  if (run.runId.startsWith('shellrun.')) return 'shell';
  // Otherwise the leaseId encodes provider: "lease.<dim>.<provider>.<stamp>"
  const parts = run.leaseId.split('.');
  return parts.length >= 4 ? parts[parts.length - 2]! : 'unknown';
}

function computeConflictPatterns(conflictReport: ConflictReport): ConflictPattern[] {
  const map = new Map<string, ConflictPattern>();
  for (const c of conflictReport.conflicts) {
    const pattern = `${c.type} on ${(c.affectedPaths ?? []).slice(0, 2).join(', ') || '(unknown)'}`;
    const entry = map.get(pattern) ?? {
      pattern, occurrences: 0, affectedAreas: [],
      recommendedMitigation: mitigationFor(c.type),
    };
    entry.occurrences++;
    for (const p of c.affectedPaths ?? []) {
      if (!entry.affectedAreas.includes(p)) entry.affectedAreas.push(p);
    }
    map.set(pattern, entry);
  }
  return Array.from(map.values());
}

function mitigationFor(type: string): string {
  switch (type) {
    case 'file_overlap': return 'Sequence the merges; split overlapping packets';
    case 'protected_path_violation': return 'Require platform-kernel workstream for changes';
    case 'duplicate_subsystem': return 'Consolidate ownership of the subsystem to one packet';
    case 'symbol_overlap': return 'Rename one of the conflicting symbols pre-merge';
    case 'ownership_violation': return 'Reassign the owning workstream or expand ownership';
    default: return 'Review packet ownership and sequence the merges';
  }
}

function computeGateEffectiveness(reports: GateReport[]): GateEffectiveness[] {
  const map = new Map<string, GateEffectiveness>();
  for (const r of reports) {
    for (const check of r.checks) {
      const entry = map.get(check.name) ?? {
        gateName: check.name, triggered: 0, caughtIssues: 0, falsePositives: 0,
      };
      entry.triggered++;
      if (check.status === 'failed') entry.caughtIssues++;
      map.set(check.name, entry);
    }
  }
  return Array.from(map.values());
}

function computeHighRiskFiles(
  conflictReport: ConflictReport,
  _mergeDecisions: MergeDecision[],
): string[] {
  void _mergeDecisions;
  const counts = new Map<string, number>();
  for (const c of conflictReport.conflicts) {
    for (const p of c.affectedPaths ?? []) {
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([p]) => p);
}

function pickBest(perfs: ProviderPerformance[]): string {
  if (perfs.length === 0) return '(none)';
  return [...perfs]
    .sort((a, b) => (b.runsSucceeded / Math.max(1, b.runsAttempted)) - (a.runsSucceeded / Math.max(1, a.runsAttempted)))[0]!.provider;
}

function pickWeakest(gates: GateEffectiveness[]): string {
  if (gates.length === 0) return '(none)';
  // Weakest = gate that triggered but caught few issues relative to its triggers
  return [...gates]
    .sort((a, b) => (a.caughtIssues / Math.max(1, a.triggered)) - (b.caughtIssues / Math.max(1, b.triggered)))[0]!.gateName;
}

function pickReliable(gates: GateEffectiveness[]): string {
  if (gates.length === 0) return '(none)';
  return [...gates]
    .sort((a, b) => (b.caughtIssues / Math.max(1, b.triggered)) - (a.caughtIssues / Math.max(1, a.triggered)))[0]!.gateName;
}

function computeMergeBottleneck(decisions: MergeDecision[]): string {
  const blockedCount = decisions.filter(d => d.decision.startsWith('BLOCKED_')).length;
  if (blockedCount > decisions.length / 2) return 'More than half of merges blocked by gates';
  const needsRepair = decisions.filter(d => d.decision === 'NEEDS_REPAIR').length;
  if (needsRepair > 0) return `${needsRepair} merge(s) failed post-merge verification`;
  return 'No significant bottleneck';
}

function buildRecommendations(input: {
  providerPerformance: ProviderPerformance[];
  conflictPatterns: ConflictPattern[];
  mergeDecisions: MergeDecision[];
}): string[] {
  const recs: string[] = [];
  for (const perf of input.providerPerformance) {
    if (perf.runsFailed > perf.runsSucceeded) {
      recs.push(`Provider "${perf.provider}" had more failures than successes; consider routing differently`);
    }
  }
  for (const pattern of input.conflictPatterns) {
    if (pattern.occurrences >= 2) {
      recs.push(`Repeat conflict pattern: ${pattern.pattern} — ${pattern.recommendedMitigation}`);
    }
  }
  const rejected = input.mergeDecisions.filter(d => d.decision === 'REJECTED' || d.decision.startsWith('BLOCKED_')).length;
  if (rejected > 0 && input.mergeDecisions.length > 0) {
    recs.push(`${rejected}/${input.mergeDecisions.length} branches blocked or rejected — review pre-flight verification`);
  }
  if (recs.length === 0) {
    recs.push('Clean run — no immediate recommendations. Consider increasing wave size next run.');
  }
  return recs;
}
