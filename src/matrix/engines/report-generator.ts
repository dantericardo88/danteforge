// Matrix Kernel — Final Run Report generator (Phase 12 of PRD §26)
//
// Aggregates all 17 graph/report JSONs + the retrospective into the final
// matrix.final-report.md markdown document.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { MatrixRunReport } from '../types/retrospective.js';
import type { MergeDecision } from '../types/merge.js';
import type { GateReport, RedTeamReport } from '../types/gate.js';
import type { MatrixRetrospective } from '../types/retrospective.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';

export interface GenerateFinalReportOptions {
  runId: string;
  startedAt: string;
  completedAt: string;

  startingScore: number;
  endingScore: number;
  dimensionsImproved: string[];

  workPacketsCreated: number;
  agentsRan: number;
  conflictsPredicted: number;
  conflictsHappened: number;
  mergeDecisions: MergeDecision[];
  gateReports: GateReport[];
  redTeamReports: RedTeamReport[];

  retrospective: MatrixRetrospective;

  branchesRolledBack?: number;
  proofExists?: boolean;
  nextSteps?: string[];
}

export function generateRunReport(
  options: GenerateFinalReportOptions,
): MatrixRunReport {
  const branchesMerged = options.mergeDecisions.filter(d => d.decision === 'APPROVED').length;
  const branchesRejected = options.mergeDecisions.length - branchesMerged;

  return {
    runId: options.runId,
    startedAt: options.startedAt,
    completedAt: options.completedAt,

    startingScore: options.startingScore,
    endingScore: options.endingScore,
    dimensionsImproved: options.dimensionsImproved,

    workPacketsCreated: options.workPacketsCreated,
    agentsRan: options.agentsRan,
    conflictsPredicted: options.conflictsPredicted,
    conflictsHappened: options.conflictsHappened,
    branchesRejected,
    branchesMerged,
    branchesRolledBack: options.branchesRolledBack ?? 0,

    reportPaths: {
      projectGraph: MATRIX_REPORT_PATHS.projectGraph,
      dimensionGraph: MATRIX_REPORT_PATHS.dimensionGraph,
      workGraph: MATRIX_REPORT_PATHS.workGraph,
      dependencyGraph: MATRIX_REPORT_PATHS.dependencyGraph,
      leaseGraph: MATRIX_REPORT_PATHS.leaseGraph,
      evidenceGraph: MATRIX_REPORT_PATHS.evidenceGraph,
      simulationPlan: MATRIX_REPORT_PATHS.simulationPlan,
      conflicts: MATRIX_REPORT_PATHS.conflicts,
      gateReports: MATRIX_REPORT_PATHS.gateReports,
      redTeamReports: MATRIX_REPORT_PATHS.redTeamReports,
      tasteGates: MATRIX_REPORT_PATHS.tasteGates,
      mergeDecisions: MATRIX_REPORT_PATHS.mergeDecisions,
      retrospective: MATRIX_REPORT_PATHS.retrospective,
      finalReport: MATRIX_REPORT_PATHS.finalReport,
    },

    proofExists: options.proofExists ?? true,
    nextSteps: options.nextSteps ?? options.retrospective.recommendedNextRunChanges,
  };
}

export function renderFinalReport(report: MatrixRunReport, retrospective: MatrixRetrospective): string {
  const lines: string[] = [];
  lines.push(`# Matrix Run Report — ${report.runId}`);
  lines.push('');
  lines.push(`**Started:** ${report.startedAt}`);
  lines.push(`**Completed:** ${report.completedAt}`);
  lines.push('');
  lines.push('## Score Delta');
  lines.push('');
  lines.push(`| Metric | Before | After | Δ |`);
  lines.push(`|--------|--------|-------|---|`);
  lines.push(`| Overall | ${report.startingScore.toFixed(2)} | ${report.endingScore.toFixed(2)} | ${(report.endingScore - report.startingScore).toFixed(2)} |`);
  lines.push('');
  lines.push(`**Dimensions improved:** ${report.dimensionsImproved.length} — ${report.dimensionsImproved.join(', ') || '(none)'}`);
  lines.push('');
  lines.push('## Activity');
  lines.push('');
  lines.push(`| What | Count |`);
  lines.push(`|------|-------|`);
  lines.push(`| Work packets created | ${report.workPacketsCreated} |`);
  lines.push(`| Agents ran | ${report.agentsRan} |`);
  lines.push(`| Conflicts predicted | ${report.conflictsPredicted} |`);
  lines.push(`| Conflicts happened | ${report.conflictsHappened} |`);
  lines.push(`| Branches merged | ${report.branchesMerged} |`);
  lines.push(`| Branches rejected | ${report.branchesRejected} |`);
  lines.push(`| Branches rolled back | ${report.branchesRolledBack} |`);
  lines.push('');
  lines.push('## Retrospective Highlights');
  lines.push('');
  lines.push(`- Best provider: **${retrospective.bestPerformingProvider}**`);
  lines.push(`- Highest-conflict area: **${retrospective.highestConflictArea}**`);
  lines.push(`- Most reliable gate: **${retrospective.mostReliableGate}**`);
  lines.push(`- Weakest gate: **${retrospective.weakestGate}**`);
  lines.push(`- Merge bottleneck: ${retrospective.mergeBottleneck}`);
  lines.push('');
  lines.push('## Recommendations for Next Run');
  lines.push('');
  for (const rec of retrospective.recommendedNextRunChanges) {
    lines.push(`- ${rec}`);
  }
  lines.push('');
  lines.push('## Reports');
  lines.push('');
  for (const [name, p] of Object.entries(report.reportPaths)) {
    if (!p) continue;
    lines.push(`- \`${name}\` → \`${p}\``);
  }
  lines.push('');
  lines.push(`**Proof exists:** ${report.proofExists ? '✓' : '✗'}`);
  return lines.join('\n') + '\n';
}

export async function writeFinalReport(
  report: MatrixRunReport,
  retrospective: MatrixRetrospective,
  cwd?: string,
): Promise<string> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.finalReport);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  const md = renderFinalReport(report, retrospective);
  await fs.writeFile(outPath, md, 'utf8');
  return outPath;
}
