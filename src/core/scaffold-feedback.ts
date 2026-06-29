// scaffold-feedback.ts — closes the Ornith two-stage loop in the LIVE forge path. best-of-n-forge SELECTS the
// best candidate (execute stage); this folds that selection's MEASURED reward back into the per-task-type
// scaffold (learn stage), so the scaffold library accumulates which orchestration actually produces clean,
// high-op candidates over time. The refine stage (proposeScaffold) then has real reward history to improve on.
//
// Best-effort and isolated: a feedback failure never blocks a forge cycle. The reward is a measured Layer-1
// signal (forgeSelectionReward), never a soft/self score — and applyReward re-checks the trust boundary.

import { applyReward } from './scaffolder.js';
import { newScaffold } from './scaffold-types.js';
import { bestScaffold, saveScaffold } from './scaffold-library.js';
import { forgeSelectionReward, type ForgeSelection } from './best-of-n-forge.js';

/**
 * Record one best-of-N forge cycle's outcome into the scaffold for `taskType` (e.g. the profile). Ensures a
 * v1 scaffold exists, then folds the measured reward (and the chosen candidate's files, for the trust-boundary
 * monitor). Returns the zeroed-reason if the reward was sanitized to 0, else null. Best-effort by design.
 */
export async function recordForgeScaffoldReward(
  taskType: string,
  selection: ForgeSelection,
  cwd: string,
  nowIso: string = new Date().toISOString(),
): Promise<string | null> {
  let scaffold = await bestScaffold(taskType, cwd);
  if (!scaffold) {
    scaffold = newScaffold(taskType, [{ adapter: 'forge', action: 'best-of-n forge cycle' }], nowIso);
    await saveScaffold(scaffold, cwd);
  }
  const reward = forgeSelectionReward(selection);
  const candidateFiles = selection.chosen?.files.map((f) => f.path) ?? [];
  const { zeroedReason } = await applyReward(scaffold, reward, cwd, nowIso, { candidateFiles });
  return zeroedReason;
}
