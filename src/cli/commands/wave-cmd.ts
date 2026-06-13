// wave-cmd.ts — `danteforge wave` — inspect the WaveLedger and show campaign resume plans.
//
// The observable surface for the depth_doctrine cadence ledger (CH-022): a campaign's durable wave
// history is now queryable, and `wave replay` reports exactly where a resumed run would pick up (the
// last successful wave) instead of treating the loop as a black box. Read-only.

import { logger } from '../../core/logger.js';
import { readWaveLedger, reconcileReceipts } from '../../core/wave-ledger.js';
import { planReplay, summarizeRuns } from '../../core/wave-replay.js';

export async function waveList(opts: { cwd?: string; json?: boolean } = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const runs = summarizeRuns(await readWaveLedger(cwd));
  if (opts.json) { process.stdout.write(JSON.stringify(runs, null, 2) + '\n'); return; }
  if (runs.length === 0) { logger.info('[wave] No waves recorded yet (.danteforge/waves/wave-ledger.jsonl is empty).'); return; }
  logger.info(`[wave] ${runs.length} run(s) in the ledger:`);
  for (const r of runs) {
    logger.info(`  ${r.runId}  (${r.loopName})  ${r.completedWaves}/${r.totalWaves} done  last:${r.lastStatus}  ${r.lastActivityAt}`);
  }
}

export async function waveShow(runId: string, opts: { cwd?: string; json?: boolean } = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const waves = reconcileReceipts(await readWaveLedger(cwd))
    .filter(w => w.runId === runId)
    .sort((a, b) => a.waveIndex - b.waveIndex);
  if (opts.json) { process.stdout.write(JSON.stringify(waves, null, 2) + '\n'); return; }
  if (waves.length === 0) { logger.info(`[wave] No waves for run "${runId}".`); return; }
  logger.info(`[wave] run ${runId} — ${waves.length} wave(s):`);
  for (const w of waves) {
    logger.info(`  wave ${w.waveIndex} [${w.waveType}] ${w.status}  ${w.dimensionId ?? ''}  ${w.scoreBefore ?? '?'}→${w.scoreAfter ?? '?'}  ${w.decision ?? ''}`.replace(/\s+$/, ''));
  }
}

export async function waveReplay(runId: string, opts: { cwd?: string; json?: boolean } = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const plan = planReplay(await readWaveLedger(cwd), runId);
  if (opts.json) { process.stdout.write(JSON.stringify(plan, null, 2) + '\n'); return; }
  if (plan.unknown) { logger.warn(`[wave] ${plan.reason}`); process.exitCode = 1; return; }
  logger.info(`[wave] replay plan for ${runId} (${plan.loopName}):`);
  logger.info(`  ${plan.completedWaves}/${plan.totalWaves} completed, ${plan.failedWaves} failed, ${plan.runningWaves} running`);
  logger.info(`  ${plan.reason}`);
  if (!plan.alreadyComplete) {
    logger.info(`  → resume from wave index ${plan.resumeFromIndex}`);
    if (plan.unfinished.length > 0) {
      logger.info(`  unfinished: ${plan.unfinished.map(w => `${w.waveIndex}(${w.status})`).join(', ')}`);
    }
    // Honest boundary: this reports the resume point; auto re-entry into the loop is the CH-022 follow-up.
    logger.info('  (auto re-entry into the loop from this index is the CH-022 follow-up; this command reports the resume point.)');
  }
}
