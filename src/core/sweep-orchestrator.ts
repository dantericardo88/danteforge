// sweep-orchestrator — the outer campaign loop. PURE SCHEDULING over band-state: it decides which
// dims to push and in what order, and delegates every actual action to an existing executor. It owns
// NO scoring, court, or outcome logic (those live in promote-score / the courts / depth-wave).
//
// Hybrid breadth-first (council-settled):
//   Phase 1 — sweep every below-5 dim to 5 (dim-dispatch surgical + harden bridge).
//   Phase 2 — PILOT a few 5→7 dims via depth-wave; if the pilot moves nothing, STOP (the 5→7
//             machinery isn't working on these dims — don't burn a full sweep).
//   Phase 3 — sweep the remaining 5→7 dims via depth-wave.
//   Phase 4 — delegate every ≥7 dim's 7→9 push to ascend-frontier (the whole frontier loop).
// Autonomy never targets above 9.0.

import { logger } from './logger.js';
import { snapshotBands, bandCounts, type DimScoreBucket } from './dim-band.js';
import { clampAutonomousTarget } from './autonomy-cap.js';
import type { CompeteMatrix } from './compete-matrix.js';

export interface SweepDeps {
  loadMatrix: (cwd: string) => Promise<CompeteMatrix | null>;
  /** Dispatch sub-target dims (dim-dispatch) — surgical→autoresearch+promote, harden bridge, feature queue. */
  runDispatch: (cwd: string, target: number) => Promise<void>;
  /** Depth-wave one dim (validate → derived → promote) — the 5→7 unlock. Returns whether it advanced. */
  runDepthWave: (cwd: string, dimId: string) => Promise<{ promoted: boolean }>;
  /** Hand the 7→9 push to ascend-frontier (whole-frontier loop). */
  runAscendFrontier: (cwd: string) => Promise<void>;
}

export interface SweepOpts {
  target?: number;
  pilotSize?: number;
}

export interface SweepResult {
  phasesRun: string[];
  bandsBefore: Record<DimScoreBucket, number>;
  bandsAfter: Record<DimScoreBucket, number>;
  stoppedEarly?: string;
  /** Dims that were depth-waved but did NOT advance — surfaced for re-triage on the next cycle. */
  stalledDims: string[];
}

export async function runFullSweep(cwd: string, opts: SweepOpts, deps: SweepDeps): Promise<SweepResult> {
  const target = clampAutonomousTarget(opts.target ?? 9.0);
  const phases: string[] = [];
  const stalled = new Set<string>();
  let stoppedEarly: string | undefined;
  const snapshot = async () => { const m = await deps.loadMatrix(cwd); return m ? snapshotBands(m) : []; };

  const bandsBefore = bandCounts(await snapshot());
  let bands = await snapshot();

  // Phase 1 — to 5.
  if (bands.some(b => b.band === 'below5')) {
    logger.info('[sweep] Phase 1: dispatch sub-5 dims to 5.0');
    await deps.runDispatch(cwd, 5.0);
    phases.push('to-5');
    bands = await snapshot();
  }

  if (target > 5.0) {
    const fiveToSeven = bands.filter(b => b.band === 'fiveToSeven');
    if (fiveToSeven.length > 0) {
      // Phase 2 — pilot.
      const pilot = fiveToSeven.slice(0, opts.pilotSize ?? 2);
      logger.info(`[sweep] Phase 2: pilot ${pilot.length} dim(s) to 7 via depth-wave`);
      let advanced = 0;
      for (const p of pilot) { if ((await deps.runDepthWave(cwd, p.id)).promoted) advanced++; else stalled.add(p.id); }
      phases.push('pilot-7');
      if (advanced === 0) {
        stoppedEarly = 'pilot moved nothing — the 5→7 machinery is not advancing these dims (likely need feature work / outcomes authored)';
        logger.warn(`[sweep] ${stoppedEarly}`);
      } else {
        // Phase 3 — sweep the rest.
        const remaining = (await snapshot()).filter(b => b.band === 'fiveToSeven');
        logger.info(`[sweep] Phase 3: sweep ${remaining.length} remaining dim(s) to 7`);
        for (const r of remaining) { if (!(await deps.runDepthWave(cwd, r.id)).promoted) stalled.add(r.id); }
        phases.push('sweep-7');
        bands = await snapshot();
      }
    }
  }

  // Phase 4 — 7→9.
  if (!stoppedEarly && target > 7.0 && bands.some(b => b.band === 'sevenToNine')) {
    logger.info('[sweep] Phase 4: delegate 7→9 to ascend-frontier');
    await deps.runAscendFrontier(cwd);
    phases.push('depth-9');
  }

  if (stalled.size > 0) logger.warn(`[sweep] ${stalled.size} dim(s) stalled at 5→7 — will be re-triaged next cycle: ${[...stalled].join(', ')}`);
  return { phasesRun: phases, bandsBefore, bandsAfter: bandCounts(await snapshot()), stalledDims: [...stalled], ...(stoppedEarly ? { stoppedEarly } : {}) };
}
