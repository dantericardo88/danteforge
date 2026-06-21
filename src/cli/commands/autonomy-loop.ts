// autonomy-loop — `danteforge autonomy-loop` — the operator's autonomous council-loop, wired to real
// dependencies. This is the culmination: runAutonomousLoop (the tested decision brain + no-walls ceiling
// decomposition) driven by REAL grounding measured from the matrix's contamination-resistant receipts, a
// REAL council quorum gate, and a pluggable build step. It loops while contamination-resistant grounding
// MOVES, pauses on a degraded panel, and stops honestly at the capability ceiling — decomposing that ceiling
// into tracked sub-problems instead of walling.
//
// The grounding signal is read from passing contamination-resistant receipts (external-grounding.ts), NOT a
// self-score — so the loop climbs a gradient it cannot author. Until the first such receipt exists the signal
// is 0 and the loop honestly reports a ceiling on cycle 1 (and decomposes it). After the first receipt lands
// the signal moves off 0 and the loop takes its first real step.

import { logger } from '../../core/logger.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import { externalGroundingReport } from '../../core/external-grounding.js';
import { loadOutcomeEvidence } from '../../matrix/engines/outcome-runner.js';
import { runAutonomousLoop, type LoopRunnerDeps, type LoopRunSummary } from '../../core/autonomous-loop-runner.js';
import type { ChildObstacle } from '../../core/obstacle-decomposition.js';

export interface AutonomyLoopOptions {
  cwd?: string;
  maxCycles?: number;
  ceilingPatience?: number;
  tokenBudget?: number | null;
  /** Shell command run as the build step each cycle (the capability climb). Omit → dry run (no build). */
  cycleCommand?: string;
  /** Require a live council quorum each cycle (slow, real). Omit → assume quorum (for dry/measurement runs). */
  requireQuorum?: boolean;
  json?: boolean;
  /** Seam: override grounding measurement (tests). */
  _measureGrounding?: () => Promise<number>;
  /** Seam: override the build step (tests). */
  _runCycle?: (cycle: number) => Promise<void>;
}

/** The honest gradient: fraction of dimensions carrying a passing CONTAMINATION-RESISTANT receipt. Moves off
 *  0 only when a real swe-bench-live (etc.) receipt exists — never on a self-score. */
async function measureContaminationResistantGrounding(cwd: string): Promise<number> {
  const matrix = await loadMatrix(cwd);
  if (!matrix) return 0;
  const evidence = await loadOutcomeEvidence(cwd);
  const r = externalGroundingReport(matrix, evidence);
  return r.totalDims > 0 ? r.contaminationResistantGroundedDims / r.totalDims : 0;
}

/** No-walls: at the ceiling, the un-grounded groundable dims ARE the next sub-problems to attack. */
async function proposeUngroundedDims(cwd: string): Promise<ChildObstacle[]> {
  const matrix = await loadMatrix(cwd);
  if (!matrix) return [];
  const evidence = await loadOutcomeEvidence(cwd);
  const r = externalGroundingReport(matrix, evidence);
  const grounded = new Set(r.contaminationResistantGroundedDimIds);
  return (matrix.dimensions as Array<{ id: string }>)
    .filter(d => !grounded.has(d.id))
    .slice(0, 5)
    .map(d => ({
      kind: `ground-${d.id}`,
      signal: `Dimension "${d.id}" has no contamination-resistant receipt — find/register a real external benchmark it can be graded against`,
      rationale: `the autonomy loop can only climb dims anchored to external evidence it cannot author; grounding ${d.id} adds a real gradient`,
    }));
}

export async function runAutonomyLoopCommand(opts: AutonomyLoopOptions = {}): Promise<LoopRunSummary> {
  const cwd = opts.cwd ?? process.cwd();
  const dry = !opts.cycleCommand && !opts._runCycle;

  const deps: LoopRunnerDeps = {
    measureGrounding: opts._measureGrounding ?? (() => measureContaminationResistantGrounding(cwd)),
    checkQuorum: async () => {
      if (!opts.requireQuorum) return true; // measurement/dry runs don't convene the panel every cycle
      const { runCouncilAsk } = await import('./council-ask.js');
      const r = await runCouncilAsk({ cwd, question: 'Autonomy-loop cycle gate: is the panel able to convene to validate progress? Reply briefly.' });
      return r.quorumMet;
    },
    runCycle: opts._runCycle ?? (async (cycle: number) => {
      if (!opts.cycleCommand) { logger.info(`[autonomy-loop] cycle ${cycle}: DRY (no --cycle-command) — measuring only`); return; }
      const { execFile } = await import('node:child_process');
      const { promisify } = await import('node:util');
      logger.info(`[autonomy-loop] cycle ${cycle}: running build step: ${opts.cycleCommand}`);
      await promisify(execFile)(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
        process.platform === 'win32' ? ['/c', opts.cycleCommand] : ['-c', opts.cycleCommand],
        { cwd, timeout: 3 * 3600 * 1000, maxBuffer: 64 * 1024 * 1024 }).catch(() => { /* build step failure → no grounding gain → handled by the brain */ });
    }),
    tokensSpent: () => 0, // budget metering not yet wired; tokenBudget=null = unbounded
    log: (m: string) => logger.info(m),
    proposeCeilingChildren: () => proposeUngroundedDims(cwd),
  };

  logger.info(`[autonomy-loop] starting${dry ? ' (DRY — measurement only, no build step)' : ''} — grounding gradient = contamination-resistant receipts`);
  const summary = await runAutonomousLoop(deps, {
    maxCycles: opts.maxCycles ?? 10,
    ceilingPatience: opts.ceilingPatience ?? 2,
    tokenBudget: opts.tokenBudget ?? null,
  });

  if (opts.json) { process.stdout.write(JSON.stringify(summary, null, 2) + '\n'); return summary; }
  logger.info(`[autonomy-loop] ${summary.status.toUpperCase()} after ${summary.cyclesRun} cycle(s): ${summary.finalReason}`);
  logger.info(`  grounding ${summary.groundingStart.toFixed(3)} → ${summary.groundingEnd.toFixed(3)}${summary.ceilingHit ? ' (capability ceiling)' : ''}`);
  if (summary.ceilingDecomposition?.resolution.kind === 'decomposed') {
    const kids = summary.ceilingDecomposition.resolution.children;
    logger.info(`  ceiling decomposed into ${kids.length} sub-problem(s) — not a wall:`);
    for (const k of kids) logger.info(`    - ${k.kind}: ${k.signal}`);
  } else if (summary.ceilingDecomposition?.resolution.kind === 'escalated') {
    logger.info(`  ceiling escalated: ${summary.ceilingDecomposition.resolution.escalation.reason}`);
  }
  return summary;
}
