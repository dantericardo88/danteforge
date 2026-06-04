// depth-wave — the 5→7 unlock. A breadth wave (autoresearch) gets a dim's capability_test passing
// (ceiling 5). A DEPTH wave runs the dim's declared OUTCOMES via `validate`, which writes fresh
// evidence → loadMatrix derives the higher tier score (T4 = production callsite → 7), and then promotes
// `self` up to that derived value through the writeVerifiedScore gate. Depth waves write zero new
// production code — they RUN things and turn passing outcomes into a visible score. Pure orchestration;
// the validate run + capability_test are seamed.

import { promoteVerifiedScore } from './promote-score.js';
import type { CompeteMatrix } from './compete-matrix.js';

export interface DepthWaveDeps {
  /** Run `danteforge validate <dim>` — executes declared outcomes, writes evidence + scores.derived. */
  runValidate: (cwd: string, dimId: string) => Promise<void>;
  /** Reload the matrix so derived reflects the fresh outcome evidence. */
  loadMatrix: (cwd: string) => Promise<CompeteMatrix | null>;
  saveMatrix: (matrix: CompeteMatrix, cwd: string) => Promise<void>;
  /** Re-check the dim's capability_test (the gate's backstop needs to know it still passes for self > 5). */
  capabilityTestPassed: (cwd: string, dimId: string) => Promise<boolean>;
}

export interface DepthWaveResult {
  dimId: string;
  before: number;
  after: number;
  promoted: boolean;
  reason: string;
}

export async function runDepthWave(cwd: string, dimId: string, deps: DepthWaveDeps): Promise<DepthWaveResult> {
  await deps.runValidate(cwd, dimId);
  const matrix = await deps.loadMatrix(cwd);
  if (!matrix) return { dimId, before: 0, after: 0, promoted: false, reason: 'no matrix.json' };
  const passed = await deps.capabilityTestPassed(cwd, dimId);
  const r = promoteVerifiedScore(matrix, dimId, { capabilityTestPassed: passed, agent: 'depth-wave' });
  if (r.promoted) await deps.saveMatrix(matrix, cwd);
  return { dimId, before: r.before, after: r.after, promoted: r.promoted, reason: r.reason };
}
