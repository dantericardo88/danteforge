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
  try {
    return await runAscendFn({
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
    return {
      cyclesRun: 0,
      dimensionsImproved: 0,
      dimensionsAtTarget: 0,
      ceilingReports: [],
      finalScore: 0,
      success: false,
    };
  }
}
