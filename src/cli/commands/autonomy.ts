// autonomy — `danteforge autonomy` — where this matrix sits on the path to maximal honest autonomy.
// Read-only. Reports the per-dimension posture (who must act for it to climb), the machine-autonomous
// coverage, and the honest framing that literal 100% is unreachable (the irreducible residue). Answers
// "out of 100, where are we" without self-flattery — it reads passing external receipts, not declarations.

import { logger } from '../../core/logger.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import { isContaminationResistantlyGrounded } from '../../core/external-grounding.js';
import { loadOutcomeEvidence } from '../../matrix/engines/outcome-runner.js';
import { autonomyReport } from '../../core/autonomy-status.js';

export async function autonomyStatus(opts: { cwd?: string; json?: boolean } = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const matrix = await loadMatrix(cwd);
  if (!matrix) { logger.warn('[autonomy] No compete matrix found.'); process.exitCode = 1; return; }
  const evidence = await loadOutcomeEvidence(cwd);
  const dims = matrix.dimensions.map((d: { id: string; scores?: { derived?: number } }) => ({ id: d.id, derived: d.scores?.derived ?? 0 }));
  // Honest coverage uses CONTAMINATION-RESISTANT grounding only — a chain-proof pass (HumanEval) does not
  // count as machine-autonomous (CH-044). So a flattering receipt cannot inflate the autonomy number.
  const groundedIds = new Set(
    matrix.dimensions.filter((d: unknown) => isContaminationResistantlyGrounded(d as never, evidence)).map((d: { id: string }) => d.id),
  );
  const r = autonomyReport(dims, groundedIds);

  if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); return; }

  const pct = (x: number) => `${Math.round(x * 100)}%`;
  logger.info('[autonomy] where this matrix is on the path to maximal honest autonomy');
  logger.info(`  machine-autonomous COVERAGE: ${pct(r.machineAutonomousCoverage)} (${r.machineGrounded}/${r.total} dims carry a passing external receipt — the machine grounds + climbs these with no human per cycle)`);
  logger.info(`  of the GROUNDABLE dims (excluding ${r.ontologicallyCapped} ontologically-capped): ${pct(r.groundableCoverage)} grounded`);
  logger.info('  posture breakdown:');
  logger.info(`    machine-grounded     ${r.machineGrounded}  — autonomous now (re-fetch bar → grade → climb)`);
  logger.info(`    self-attested        ${r.selfAttested}  — need an external anchor (a benchmark) or a one-time human ratify; honest ceiling ~8 until then`);
  logger.info(`    ontologically-capped ${r.ontologicallyCapped}  — need real-world evidence that doesn't exist yet (adoption/spend); never fully autonomous`);
  if (r.machineGrounded > 0) {
    logger.info(`  grounded: ${r.dims.filter(d => d.posture === 'machine-grounded').map(d => d.id).join(', ')}`);
  }
  logger.info('  honest ceiling: 100% is unreachable — the top ~15 is irreducible (ratify-the-yardstick-on-drift +');
  logger.info('    hold-standing + the externality of the trust anchor). The reachable maximum is ~85.');
  logger.info('  to move COVERAGE up: ground more dims against registered external benchmarks (cloud grade), then');
  logger.info('    `danteforge ratify` the subjective bars. Each grounded dim is one more that needs zero human/cycle.');
}
