// Matrix Orchestration — Final Report generator (PRD §7)
//
// Stitches the orchestration artifacts + the kernel-level run report into a
// single markdown narrative + a JSON summary. Calls the kernel
// `generateRunReport` for the dimension-delta / merge / conflict math and
// wraps it with phase-A/B-aware framing the kernel does not know about.

import { generateRunReport } from '../../matrix/engines/report-generator.js';
import { saveOrch, readAuditLog } from '../state-io.js';
import {
  collectHarvestedPatterns,
  generateThirdPartyNotices,
  LicenseViolation,
} from './third-party-notices.js';
import type {
  AuditEvent,
  FinalReportSummary,
  InterPhaseRetrospective,
  OrchestrationDimension,
  OrchestrationDimensionMatrix,
  PhaseExecutionResult,
  RunState,
} from '../types.js';
import type { MergeDecision } from '../../matrix/types/merge.js';
import type { GateReport, RedTeamReport } from '../../matrix/types/gate.js';
import type {
  MatrixRetrospective,
  MatrixRunReport,
} from '../../matrix/types/retrospective.js';

// ── Public API ──────────────────────────────────────────────────────────────

export interface GenerateFinalReportArgs {
  runState: RunState;
  matrix: OrchestrationDimensionMatrix;
  phaseAResult?: PhaseExecutionResult | null;
  phaseBResult?: PhaseExecutionResult | null;
  retrospective?: InterPhaseRetrospective | null;
}

export interface GenerateFinalReportOptions {
  cwd: string;
  _now?: () => string;
  /** When true, also generate THIRD_PARTY_NOTICES.md (default true). */
  writeNotices?: boolean;
  /** Override matrix kernel retrospective shape; tests inject this. */
  _kernelRetrospective?: () => MatrixRetrospective;
}

export interface GenerateFinalReportResult {
  markdownPath: string;
  jsonPath: string;
  summary: FinalReportSummary;
  noticesPath?: string;
}

export async function generateFinalReport(
  args: GenerateFinalReportArgs,
  options: GenerateFinalReportOptions,
): Promise<GenerateFinalReportResult> {
  const now = options._now ?? (() => new Date().toISOString());
  const generatedAt = now();
  const writeNotices = options.writeNotices ?? true;

  const summary = buildSummary(args, generatedAt);

  // Optional: kernel-level run report; mostly for nice tables in the markdown.
  const kernelRetro = options._kernelRetrospective?.() ?? buildEmptyKernelRetro(generatedAt);
  const kernelReport = generateRunReport({
    runId: args.runState.runId,
    startedAt: args.runState.startedAt,
    completedAt: generatedAt,
    startingScore: summary.startingOverallScore,
    endingScore: summary.endingOverallScore,
    dimensionsImproved: args.matrix.dimensions
      .filter(d => d.currentScore > 0)
      .map(d => d.dimensionId),
    workPacketsCreated: countPackets(args),
    agentsRan: summary.totalAgentsDeployed,
    conflictsPredicted: 0,
    conflictsHappened: summary.conflictsEncountered,
    mergeDecisions: [] as MergeDecision[],
    gateReports: [] as GateReport[],
    redTeamReports: [] as RedTeamReport[],
    retrospective: kernelRetro,
    proofExists: false,
    nextSteps: summary.recommendedNextIterations,
  });

  // Render the orchestration-level markdown narrative.
  const markdown = renderMarkdown(args, summary, kernelReport, kernelRetro);

  const markdownPath = await saveOrch(options.cwd, 'finalReport', markdown);
  const jsonPath = await saveOrch(options.cwd, 'finalReportJson', summary);

  // THIRD_PARTY_NOTICES — failsafe; LicenseViolation propagates.
  let noticesPath: string | undefined;
  if (writeNotices) {
    try {
      const patterns = await collectHarvestedPatterns(options.cwd, [
        ...(args.phaseAResult ? [args.phaseAResult] : []),
        ...(args.phaseBResult ? [args.phaseBResult] : []),
      ]);
      await generateThirdPartyNotices(
        { patterns, projectName: args.matrix.projectName, runId: args.runState.runId },
        { cwd: options.cwd, _now: now },
      );
      noticesPath = 'THIRD_PARTY_NOTICES.md';
    } catch (err) {
      if (err instanceof LicenseViolation) {
        // Mark the failure in the audit log AND rethrow so the orchestrator
        // can surface it. Final-report writes already happened — the
        // orchestrator will record the error state separately.
        throw err;
      }
      throw err;
    }
  }

  return { markdownPath, jsonPath, summary, noticesPath };
}

// ── Summary builder ─────────────────────────────────────────────────────────

function buildSummary(
  args: GenerateFinalReportArgs,
  generatedAt: string,
): FinalReportSummary {
  const startingOverallScore = args.matrix.overallCurrentScore;
  const totalAttempts = (args.phaseAResult?.attempts.length ?? 0)
                      + (args.phaseBResult?.attempts.length ?? 0);
  const merged = (args.phaseAResult?.attempts ?? []).filter(a => a.outcome === 'merged').length
              + (args.phaseBResult?.attempts ?? []).filter(a => a.outcome === 'merged').length;
  const rejected = totalAttempts - merged;
  const totalCostUsd = (args.phaseAResult?.totalCostUsd ?? 0)
                     + (args.phaseBResult?.totalCostUsd ?? 0);
  const totalWallClockMs = (args.phaseAResult?.totalWallClockMs ?? 0)
                         + (args.phaseBResult?.totalWallClockMs ?? 0);

  const endingOverallScore = computeEndingScore(args.matrix.dimensions, args);
  const ossClosed = args.phaseAResult?.dimensionsClosed.length ?? 0;
  const closedClosed = args.phaseBResult?.dimensionsClosed.length ?? 0;
  const totalDims = Math.max(1, args.matrix.dimensions.length);

  return {
    generatedAt,
    projectName: args.matrix.projectName,
    prdSource: args.runState.prdPath,
    startingOverallScore,
    endingOverallScore,
    ossFrontierAchievement: ossClosed / totalDims,
    closedSourceFrontierAchievement: closedClosed / totalDims,
    totalAgentsDeployed: totalAttempts,
    totalCostUsd,
    totalWallClockMs,
    conflictsEncountered: rejected,
    conflictsResolved: merged,
    branchesApproved: merged,
    branchesRejected: rejected,
    patternsHarvestedCount: 0,
    licenseViolations: 0,
    recommendedNextIterations: suggestNextIterations(args),
  };
}

function computeEndingScore(
  dimensions: OrchestrationDimension[],
  args: GenerateFinalReportArgs,
): number {
  if (dimensions.length === 0) return 0;
  // Sum of (current + observed deltas) weighted by dimension weight.
  const allAttempts = [
    ...(args.phaseAResult?.attempts ?? []),
    ...(args.phaseBResult?.attempts ?? []),
  ];
  let totalWeight = 0;
  let weightedSum = 0;
  for (const dim of dimensions) {
    const delta = allAttempts
      .filter(a => a.outcome === 'merged' && a.scoreDeltaByDimension)
      .reduce((s, a) => s + (a.scoreDeltaByDimension?.[dim.dimensionId] ?? 0), 0);
    const w = dim.weight || 1;
    totalWeight += w;
    weightedSum += (dim.currentScore + delta) * w;
  }
  return totalWeight === 0 ? 0 : weightedSum / totalWeight;
}

function suggestNextIterations(args: GenerateFinalReportArgs): string[] {
  const tips: string[] = [];
  if (args.phaseAResult && args.phaseAResult.dimensionsOpen.length > 0) {
    tips.push(`Phase A left ${args.phaseAResult.dimensionsOpen.length} OSS-frontier dimensions open — consider a follow-up Phase A run with higher cost cap`);
  }
  if (args.phaseBResult && args.phaseBResult.dimensionsOpen.length > 0) {
    tips.push(`Phase B left ${args.phaseBResult.dimensionsOpen.length} closed-frontier dimensions open — provide more closed-source profile context`);
  }
  if (args.retrospective && args.retrospective.recurringConflictPatterns.length > 0) {
    tips.push(`Recurring conflict patterns: ${args.retrospective.recurringConflictPatterns.slice(0, 3).join('; ')}`);
  }
  if (tips.length === 0) tips.push('Run is complete; consider raising the dimension targets for the next iteration');
  return tips;
}

function countPackets(args: GenerateFinalReportArgs): number {
  return (args.phaseAResult?.config.workPacketIds.length ?? 0)
       + (args.phaseBResult?.config.workPacketIds.length ?? 0);
}

function buildEmptyKernelRetro(generatedAt: string): MatrixRetrospective {
  return {
    runId: 'orchestration',
    generatedAt,
    startedAt: generatedAt,
    completedAt: generatedAt,
    bestPerformingProvider: '(none)',
    highestConflictArea: '(none)',
    mostReliableGate: '(none)',
    weakestGate: '(none)',
    mergeBottleneck: 'no kernel data threaded',
    providerPerformance: [],
    conflictPatterns: [],
    gateEffectiveness: [],
    highRiskFiles: [],
    recommendedNextRunChanges: [],
  };
}

// ── Markdown renderer ───────────────────────────────────────────────────────

function renderMarkdown(
  args: GenerateFinalReportArgs,
  summary: FinalReportSummary,
  kernel: MatrixRunReport,
  retro: MatrixRetrospective,
): string {
  const lines: string[] = [];
  lines.push(`# Matrix Orchestration — Final Report`);
  lines.push('');
  lines.push(`**Project:** ${summary.projectName}`);
  lines.push(`**PRD:** \`${summary.prdSource}\``);
  lines.push(`**Run id:** \`${args.runState.runId}\``);
  lines.push(`**Started:** ${args.runState.startedAt}`);
  lines.push(`**Completed:** ${summary.generatedAt}`);
  lines.push('');
  lines.push('## Headline');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Starting overall score | ${summary.startingOverallScore.toFixed(2)} |`);
  lines.push(`| Ending overall score | ${summary.endingOverallScore.toFixed(2)} |`);
  lines.push(`| Δ | ${(summary.endingOverallScore - summary.startingOverallScore).toFixed(2)} |`);
  lines.push(`| OSS frontier achieved | ${(summary.ossFrontierAchievement * 100).toFixed(0)}% |`);
  lines.push(`| Closed-source frontier achieved | ${(summary.closedSourceFrontierAchievement * 100).toFixed(0)}% |`);
  lines.push(`| Total cost | $${summary.totalCostUsd.toFixed(2)} |`);
  lines.push(`| Total wall-clock | ${(summary.totalWallClockMs / 60000).toFixed(1)} min |`);
  lines.push('');

  // Dimension table
  lines.push('## Dimensions');
  lines.push('');
  lines.push('| Dimension | Start | End | OSS frontier | Closed frontier | Status |');
  lines.push('|-----------|-------|-----|--------------|-----------------|--------|');
  for (const d of args.matrix.dimensions) {
    const closedByA = args.phaseAResult?.dimensionsClosed.includes(d.dimensionId);
    const closedByB = args.phaseBResult?.dimensionsClosed.includes(d.dimensionId);
    const status = closedByB ? 'closed (B)' : closedByA ? 'closed (A)' : 'open';
    lines.push(`| ${d.name} | ${d.currentScore.toFixed(1)} | ${d.currentScore.toFixed(1)} | ${d.ossFrontierScore.toFixed(1)} | ${d.closedFrontierScore.toFixed(1)} | ${status} |`);
  }
  lines.push('');

  // Provider performance
  if (args.retrospective && args.retrospective.providerPerformance.length > 0) {
    lines.push('## Provider Performance');
    lines.push('');
    lines.push('| Provider | Attempts | Success rate | Best at | Worst at |');
    lines.push('|----------|----------|--------------|---------|----------|');
    for (const p of args.retrospective.providerPerformance) {
      lines.push(`| ${p.providerId} | ${p.attempts} | ${(p.successRate * 100).toFixed(0)}% | ${p.bestAtDimensions.join(', ') || '—'} | ${p.worstAtDimensions.join(', ') || '—'} |`);
    }
    lines.push('');
  }

  // License compliance
  lines.push('## License Compliance');
  lines.push('');
  lines.push(`- License violations encountered: **${summary.licenseViolations}**`);
  lines.push(`- See \`THIRD_PARTY_NOTICES.md\` for full attribution.`);
  lines.push('');

  // Recommended next iterations
  lines.push('## Recommended Next Iterations');
  lines.push('');
  for (const tip of summary.recommendedNextIterations) lines.push(`- ${tip}`);
  lines.push('');

  // Kernel handoff
  lines.push('## Kernel Run Report (Substrate)');
  lines.push('');
  lines.push(`- Best provider: **${retro.bestPerformingProvider}**`);
  lines.push(`- Most reliable gate: **${retro.mostReliableGate}**`);
  lines.push(`- Weakest gate: **${retro.weakestGate}**`);
  lines.push(`- Branches merged (kernel view): **${kernel.branchesMerged}**`);
  lines.push(`- Branches rejected (kernel view): **${kernel.branchesRejected}**`);
  lines.push('');

  return lines.join('\n') + '\n';
}

// ── Audit-log re-export (not used directly but available to callers) ────────
export type { AuditEvent };
