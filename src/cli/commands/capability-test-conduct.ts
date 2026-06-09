// capability-test-conduct.ts — `danteforge capability-test conduct` — the conductor's full decision pass.
//
// Runs the whole honesty front-end over a project with NO human: static audit of every yardstick, then
// the DYNAMIC sensitivity probe on the ones the static pass called REAL (catching decoupled fiction), then
// the self-healing router that decides what each dim needs next (PROCEED / AUTHOR / RESEARCH_LADDER /
// CEILING). It reports the plan — the truthful, executable worklist the autonomous loop would act on. The
// live executor (dispatching the examiner agent to author, the builder to build) is the next layer; this
// plan pass is safe + deterministic and is the conductor's brain running end-to-end.

import fs from 'node:fs';
import path from 'node:path';
import { loadMatrix } from '../../core/compete-matrix.js';
import { logger } from '../../core/logger.js';
import { auditAllCapabilityTests, type YardstickAudit } from '../../matrix/engines/capability-test-integrity.js';
import { verifyDimYardstick } from '../../matrix/engines/capability-test-sensitivity.js';
import { planAllRemediations, MARKET_CAPPED_DIMS, type RemediationAction } from '../../matrix/engines/capability-test-conductor.js';

export interface CapabilityTestConductOptions {
  project?: string;
  json?: boolean;
  /** Cap how many REAL dims to dynamically probe (probes are slow). 0 / undefined = all. */
  limit?: number;
  /** Skip the dynamic probe (static plan only). */
  noProbe?: boolean;
}

export interface ConductPlanRow { dimId: string; action: RemediationAction; staticVerdict: YardstickAudit['verdict']; probed?: string; reason: string }
export interface CapabilityTestConductResult {
  plan: ConductPlanRow[];
  counts: Record<RemediationAction, number>;
  /** Dims the static pass called REAL but the probe demoted to decoupled fiction. */
  probeDemoted: string[];
}

export async function runCapabilityTestConduct(options: CapabilityTestConductOptions = {}): Promise<CapabilityTestConductResult> {
  const cwd = path.resolve(options.project ?? process.cwd());
  const matrix = await loadMatrix(cwd);
  if (!matrix) throw new Error('No compete matrix found. Run `danteforge compete --init` first.');

  const universeDir = path.join(cwd, '.danteforge', 'compete', 'universe');
  const hasLadder = (dimId: string): boolean => {
    try { return fs.readFileSync(path.join(universeDir, `${dimId}.md`), 'utf8').search(/##\s*Score Ladder/i) >= 0; }
    catch { return false; }
  };

  const audits = await auditAllCapabilityTests(matrix as unknown as Parameters<typeof auditAllCapabilityTests>[0], cwd, hasLadder);

  // Dynamic verification: a static REAL verdict is unverified until the probe proves dependence. A STUB
  // result demotes the dim to needsAuthoring so the router treats it as fake, not a passing metric.
  const probeDemoted: string[] = [];
  const probedNote = new Map<string, string>();
  if (!options.noProbe) {
    const real = audits.filter(a => a.verdict === 'REAL_TEST' || a.verdict === 'REAL_PRODUCT_PROBE');
    const toProbe = options.limit ? real.slice(0, options.limit) : real;
    for (const a of toProbe) {
      if (!options.json) logger.info(`  probing ${a.dimId}…`);
      const probe = await verifyDimYardstick(a, cwd);
      probedNote.set(a.dimId, probe.verdict);
      if (probe.verdict === 'STUB') {
        a.verdict = 'SELF_FULFILLING_STUB';
        a.needsAuthoring = true;
        a.reason = `dynamic probe: ${probe.reason}`;
        probeDemoted.push(a.dimId);
      }
    }
  }

  const remediations = planAllRemediations(audits, (d) => MARKET_CAPPED_DIMS.has(d));
  const plan: ConductPlanRow[] = remediations.map((r, i) => ({
    dimId: r.dimId, action: r.action, staticVerdict: audits[i]!.verdict, probed: probedNote.get(r.dimId), reason: r.reason,
  }));
  const counts = plan.reduce((acc, p) => { acc[p.action] = (acc[p.action] ?? 0) + 1; return acc; },
    { PROCEED: 0, AUTHOR_YARDSTICK: 0, RESEARCH_LADDER: 0, CEILING: 0 } as Record<RemediationAction, number>);
  const result: CapabilityTestConductResult = { plan, counts, probeDemoted };

  if (options.json) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result; }

  logger.info('');
  logger.success(`Conductor plan — ${plan.length} dimension(s), no human`);
  logger.info(`  PROCEED ${counts.PROCEED}  ·  AUTHOR_YARDSTICK ${counts.AUTHOR_YARDSTICK}  ·  RESEARCH_LADDER ${counts.RESEARCH_LADDER}  ·  CEILING ${counts.CEILING}`);
  if (probeDemoted.length > 0) {
    logger.warn(`  ${probeDemoted.length} "REAL" metric(s) the dynamic probe demoted to decoupled fiction → now routed to authoring: ${probeDemoted.join(', ')}`);
  }
  const needWork = plan.filter(p => p.action !== 'PROCEED' && p.action !== 'CEILING');
  if (needWork.length > 0) {
    logger.info('');
    logger.info('  Worklist (the loop would act on these autonomously):');
    for (const p of needWork.slice(0, 30)) logger.info(`    ${p.action.padEnd(16)} ${p.dimId}`);
    if (needWork.length > 30) logger.info(`    … and ${needWork.length - 30} more`);
  }
  return result;
}
