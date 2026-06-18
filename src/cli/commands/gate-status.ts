// gate-status — `danteforge gate-status` — preflight the two autonomy gates so flipping them can't STALL the
// climb loop or collapse derived scores (the Phase-2 footgun). Read-only. Reports, from real state, whether
// DANTEFORGE_GROUNDING_GATE and DANTEFORGE_REQUIRE_SIGNED_EVIDENCE are SAFE to enable now, and the safe order.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../../core/logger.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import { externalGroundingReport } from '../../core/external-grounding.js';
import { loadOutcomeEvidence } from '../../matrix/engines/outcome-runner.js';
import { assessGroundingGate, assessSignedEvidence } from '../../core/gate-readiness.js';

export async function gateStatus(opts: { cwd?: string; json?: boolean } = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const matrix = await loadMatrix(cwd);
  if (!matrix) { logger.warn('[gate-status] No compete matrix found.'); process.exitCode = 1; return; }

  const evidence = await loadOutcomeEvidence(cwd);
  const grounding = assessGroundingGate(externalGroundingReport(matrix, evidence).groundedDimIds);

  // Read the raw receipts to check signature coverage (loadOutcomeEvidence may drop unverifiable ones).
  const receipts: Array<{ sig?: unknown }> = [];
  try {
    const dir = join(cwd, '.danteforge', 'outcome-evidence');
    for (const f of await readdir(dir)) {
      if (f.endsWith('.json')) { try { receipts.push(JSON.parse(await readFile(join(dir, f), 'utf8'))); } catch { /* skip */ } }
    }
  } catch { /* no evidence dir */ }
  const signed = assessSignedEvidence(receipts);

  const onG = process.env['DANTEFORGE_GROUNDING_GATE'] === '1';
  const onS = process.env['DANTEFORGE_REQUIRE_SIGNED_EVIDENCE'] === '1';

  if (opts.json) {
    process.stdout.write(JSON.stringify({ groundingGate: { on: onG, ...grounding }, signedEvidence: { on: onS, ...signed } }, null, 2) + '\n');
    return;
  }

  logger.info('[gate-status] autonomy gate readiness (preflight before flipping — wrong order stalls the loop)');
  logger.info(`  DANTEFORGE_GROUNDING_GATE          ${onG ? 'ON ' : 'off'}  | safe to enable: ${grounding.safeToEnable ? 'YES' : 'NO'}`);
  logger.info(`    ${grounding.reason}`);
  logger.info(`  DANTEFORGE_REQUIRE_SIGNED_EVIDENCE ${onS ? 'ON ' : 'off'}  | safe to enable: ${signed.safeToEnable ? 'YES' : 'NO'}`);
  logger.info(`    ${signed.reason}`);
  if (!onG || !onS) {
    logger.info('  safe order: re-sign receipts (if any unsigned) → REQUIRE_SIGNED_EVIDENCE=1 → ground ≥1 dim → GROUNDING_GATE=1');
  }
}
