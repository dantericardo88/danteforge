// ascend — Fully autonomous scoring and self-improving loop.
// Drives all achievable competitive dimensions to target (default: 9.0/10).
// If no competitive matrix exists, defines the universe first (interactive or auto).
import { logger } from '../../core/logger.js';
import { formatAndLogError } from '../../core/format-error.js';
import { runAscend, type AscendEngineOptions, type AscendResult } from '../../core/ascend-engine.js';

export type { AscendResult };

export interface AscendOptions {
  cwd?: string;
  target?: number;       // default: 9.0
  maxCycles?: number;    // default: 60
  dryRun?: boolean;
  interactive?: boolean;
  forgeProvider?: string;
  scorerProvider?: string;
  maxDimRetries?: number;
  /** Require adversarial score agreement before declaring convergence */
  adversarialGating?: boolean;
  /** How much lower adversarial score is acceptable vs target (default: 0.5) */
  adversaryTolerance?: number;
  /** Skip the confirmation gate */
  yes?: boolean;
  /** Cycles between automatic retro runs during ascend loop (default: 5) */
  retroInterval?: number;
  /** Set false to skip OSS harvest receipt bootstrap (--no-auto-harvest) */
  autoHarvest?: boolean;
  /** Set false to skip mid-loop verify pass (--no-verify-loop) */
  verifyLoop?: boolean;
  /** After the run, convene the adversarial council readiness gate (multi-lens gap-hunt → READY/NOT_READY,
   *  blocking gaps recorded to the ledger). Makes the frontier loop end with builder-never-judges scrutiny. */
  councilGate?: boolean;
  /** Reviewer provider for the council gate — must differ from the forge/build provider to certify (builder-never-judges). */
  reviewerProvider?: string;
  /**
   * Execution mode: 'advisory' (default) writes guidance only; 'forge' calls
   * `danteforge forge "<goal>"` directly for each dimension, bypassing tasks/PLAN.md.
   */
  executeMode?: 'advisory' | 'forge';
  _executeCommand?: (cmd: string, cwd: string) => Promise<{ success: boolean }>;
  /** Injection seam for testing — replaces the full runAscend engine */
  _runAscend?: (opts: AscendEngineOptions) => Promise<AscendResult>;
}

export async function ascend(options: AscendOptions = {}): Promise<AscendResult> {
  const cwd = options.cwd ?? process.cwd();
  const runAscendFn = options._runAscend ?? runAscend;

  // --- Decision-node: record start (best-effort) ---
  let _dnStartNodeId: string | undefined;
  const _dnT0 = Date.now();
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession(cwd);
    const _dnStart = await recordDecision({ session: _dnSess, actorType: 'agent', prompt: `ascend: drive to ${options.target ?? 9.0}`, context: { target: options.target, maxCycles: options.maxCycles }, result: 'in-progress', success: false });
    _dnStartNodeId = _dnStart.id;
  } catch { /* never block ascend */ }

  let _dnResult: AscendResult | undefined;
  try {
    _dnResult = await runAscendFn({
      cwd,
      target: options.target,
      maxCycles: options.maxCycles,
      dryRun: options.dryRun,
      interactive: options.interactive,
      forgeProvider: options.forgeProvider,
      scorerProvider: options.scorerProvider,
      maxDimRetries: options.maxDimRetries,
      adversarialGating: options.adversarialGating,
      adversaryTolerance: options.adversaryTolerance,
      yes: options.yes,
      retroInterval: options.retroInterval,
      autoHarvest: options.autoHarvest,
      verifyLoop: options.verifyLoop,
      executeMode: options.executeMode,
      _executeCommand: options._executeCommand,
    });
  } catch (err) {
    formatAndLogError(err, 'ascend');
    logger.error('[ascend] Failed. See above for details.');
    _dnResult = { cyclesRun: 0, dimensionsImproved: 0, dimensionsAtTarget: 0, ceilingReports: [], finalScore: 0, success: false };
  } finally {
    // --- Decision-node: record completion (best-effort) ---
    try {
      const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
      const _dnSess = getSession(cwd);
      await recordDecision({ session: _dnSess, parentNodeId: _dnStartNodeId, actorType: 'agent', prompt: `ascend: drive to ${options.target ?? 9.0} [complete]`, context: { cyclesRun: _dnResult?.cyclesRun, success: _dnResult?.success }, result: _dnResult?.success ? 'target-reached' : 'max-cycles', success: _dnResult?.success ?? false, latencyMs: Date.now() - _dnT0, ...(_dnResult?.finalScore !== undefined ? { qualityScore: _dnResult.finalScore * 10 } : {}) });
    } catch { /* best-effort */ }
    // Post-ascend auto-sanitize: split any file that crossed the 750-LOC threshold (best-effort)
    try {
      const { postWaveSanitize } = await import('../../core/auto-sanitize.js');
      await postWaveSanitize({ cwd });
    } catch { /* best-effort */ }
  }
  // Council readiness gate (opt-in): end the frontier run with an adversarial multi-lens gap-hunt rather than
  // a score alone. Records blocking gaps to the ledger; never blocks the return value.
  if (options.councilGate) {
    logger.info('[ascend] Convening the council readiness gate…');
    try {
      const { councilReview } = await import('./council-review.js');
      // reportOnly: a converged ascend is not marked failed merely because the council found a follow-up gap —
      // the gaps are recorded to the ledger and surfaced, but ascend's own exit status is preserved.
      await councilReview({ cwd, reportOnly: true, reviewerProvider: options.reviewerProvider });
    } catch (e) { logger.warn(`[ascend] council gate error (non-fatal): ${e instanceof Error ? e.message : String(e)}`); }
  }
  return _dnResult ?? { cyclesRun: 0, dimensionsImproved: 0, dimensionsAtTarget: 0, ceilingReports: [], finalScore: 0, success: false };
}
