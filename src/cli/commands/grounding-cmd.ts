// grounding-cmd.ts — `danteforge grounding` — how much of the matrix is externally grounded (#6).
//
// Surfaces the deepest honesty signal: the fraction of the headline corroborated by evidence the
// grader could not author (a registered external benchmark) vs self-attested. Read-only.

import { logger } from '../../core/logger.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import { externalGroundingReport } from '../../core/external-grounding.js';

export async function grounding(opts: { cwd?: string; json?: boolean } = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const matrix = await loadMatrix(cwd);
  if (!matrix) { logger.warn('[grounding] No compete matrix found.'); process.exitCode = 1; return; }
  const report = externalGroundingReport(matrix);
  if (opts.json) { process.stdout.write(JSON.stringify(report, null, 2) + '\n'); return; }
  logger.info(`[grounding] external-grounding ratio: ${Math.round(report.weightedGroundingRatio * 100)}% (weighted) · ${report.externallyGroundedDims}/${report.totalDims} dims`);
  logger.info(`  ${report.summary}`);
  if (report.externallyGroundedDims === 0) {
    logger.info('  → To ground a dimension against the world, run a registered external benchmark and');
    logger.info('    attach its receipt (input_source: external-benchmark). The gate reserves 9.5 for it.');
  }
}
