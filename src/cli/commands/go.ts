// go — Daily driver: run the self-improve loop with no flags required.
// Usage: danteforge go [goal]
// One word. Equivalent to `danteforge self-improve --max-cycles 5 --min-score 9.0`.

import { logger } from '../../core/logger.js';
import type { SelfImproveOptions, SelfImproveResult } from './self-improve.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GoOptions {
  goal?: string;
  cwd?: string;
  // Injection seams
  _runSelfImprove?: (opts: SelfImproveOptions) => Promise<SelfImproveResult>;
  _stdout?: (line: string) => void;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function go(options: GoOptions = {}): Promise<void> {
  const emit = options._stdout ?? ((line: string) => logger.info(line));
  const cwd = options.cwd ?? process.cwd();

  emit('');
  emit('  Starting improvement loop — target: 9.0/10, max 5 cycles');
  if (options.goal) {
    emit(`  Goal: ${options.goal}`);
  }
  emit('');

  const runSelfImprove = options._runSelfImprove ?? defaultRunSelfImprove;

  const result = await runSelfImprove({
    goal: options.goal,
    maxCycles: 5,
    minScore: 9.0,
    cwd,
  });

  emit('');
  emit(`  Before: ${result.initialScore.toFixed(1)}/10`);
  emit(`  After:  ${result.finalScore.toFixed(1)}/10  (${result.cyclesRun} cycle${result.cyclesRun !== 1 ? 's' : ''})`);

  if (result.achieved) {
    emit('  Target reached — 9.0+ achieved.');
  } else {
    const reason = result.stopReason === 'plateau-unresolved'
      ? 'Plateau detected — try `danteforge inferno` for deeper work.'
      : `Stopped after ${result.cyclesRun} cycles. Run again to continue.`;
    emit(`  ${reason}`);
  }
  emit('');
}

async function defaultRunSelfImprove(opts: SelfImproveOptions): Promise<SelfImproveResult> {
  const { selfImprove } = await import('./self-improve.js');
  return selfImprove(opts);
}
