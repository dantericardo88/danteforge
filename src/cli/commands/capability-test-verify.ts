// capability-test-verify.ts — `danteforge capability-test verify` — the DYNAMIC honesty pass.
//
// The audit is static (classifies by command shape + wiring). This pass goes further: for every dim the
// static auditor passed as REAL, it EXECUTES the sensitivity probe (break the wired callsite → a genuine
// yardstick must flip to failing). It catches the decoupled / self-fulfilling metrics a static pass
// cannot — the class the red-team proved was the residual hole — autonomously, at scale, with no human.

import fs from 'node:fs';
import path from 'node:path';
import { loadMatrix } from '../../core/compete-matrix.js';
import { logger } from '../../core/logger.js';
import { auditAllCapabilityTests, type YardstickAudit } from '../../matrix/engines/capability-test-integrity.js';
import { verifyDimYardstick, type SensitivityVerdict } from '../../matrix/engines/capability-test-sensitivity.js';

export interface CapabilityTestVerifyOptions {
  project?: string;
  json?: boolean;
  /** Cap how many REAL dims to probe this run (probes are slow — each runs the test twice). */
  limit?: number;
}

export interface VerifyDimResult {
  dimId: string;
  staticVerdict: YardstickAudit['verdict'];
  probe: SensitivityVerdict;
  reason: string;
}

export interface CapabilityTestVerifyResult {
  results: VerifyDimResult[];
  counts: Record<SensitivityVerdict, number>;
  /** Dims the STATIC auditor called REAL but the probe proved DECOUPLED — fiction the static pass missed. */
  decoupled: string[];
}

export async function runCapabilityTestVerify(options: CapabilityTestVerifyOptions = {}): Promise<CapabilityTestVerifyResult> {
  const cwd = path.resolve(options.project ?? process.cwd());
  const matrix = await loadMatrix(cwd);
  if (!matrix) throw new Error('No compete matrix found. Run `danteforge compete --init` first.');

  const universeDir = path.join(cwd, '.danteforge', 'compete', 'universe');
  const hasLadder = (dimId: string): boolean => {
    try { return fs.readFileSync(path.join(universeDir, `${dimId}.md`), 'utf8').search(/##\s*Score Ladder/i) >= 0; }
    catch { return false; }
  };

  const audits = await auditAllCapabilityTests(matrix as unknown as Parameters<typeof auditAllCapabilityTests>[0], cwd, hasLadder);
  const real = audits.filter(a => a.verdict === 'REAL_TEST' || a.verdict === 'REAL_PRODUCT_PROBE');
  const toProbe = options.limit ? real.slice(0, options.limit) : real;

  const results: VerifyDimResult[] = [];
  for (const a of toProbe) {
    if (!options.json) logger.info(`  probing ${a.dimId}…`);
    const probe = await verifyDimYardstick(a, cwd);
    results.push({ dimId: a.dimId, staticVerdict: a.verdict, probe: probe.verdict, reason: probe.reason });
  }

  const counts = { GENUINE: 0, STUB: 0, BASELINE_RED: 0, INCONCLUSIVE: 0 } as Record<SensitivityVerdict, number>;
  for (const r of results) counts[r.probe]++;
  const decoupled = results.filter(r => r.probe === 'STUB').map(r => r.dimId);
  const result: CapabilityTestVerifyResult = { results, counts, decoupled };

  if (options.json) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result; }

  logger.info('');
  logger.success(`Dynamic yardstick verification — probed ${results.length} REAL dim(s)`);
  logger.info(`  GENUINE ${counts.GENUINE}  ·  STUB ${counts.STUB}  ·  BASELINE_RED ${counts.BASELINE_RED}  ·  INCONCLUSIVE ${counts.INCONCLUSIVE}`);
  if (decoupled.length > 0) {
    logger.info('');
    logger.error(`  ${decoupled.length} dim(s) the static auditor called REAL are DECOUPLED fiction (pass even with their callsite broken):`);
    for (const d of decoupled) logger.error(`    ✗ ${d}`);
    logger.info('  These must be re-authored — the conductor re-routes them to AUTHOR_YARDSTICK.');
  } else if (results.length > 0) {
    logger.info('  All probed REAL yardsticks are GENUINE or honestly inconclusive — no decoupled fiction found.');
  }
  return result;
}
