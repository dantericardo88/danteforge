import type { Command } from 'commander';
import { runConverge } from '../../core/converge-engine.js';
import type { ConvergeOptions } from '../../core/converge-engine-types.js';
import type { ScoringDimension } from '../../core/harsh-scorer.js';

export function registerConvergeCommand(program: Command): void {
  program
    .command('converge')
    .description(
      'TypeScript-owned convergence loop — runs until all dims >= target. No LLM stop/continue.',
    )
    .option('--target <score>', 'Target per dimension (default: 9.0)', parseFloat, 9.0)
    .option('--max-cycles <n>', 'Safety cap on cycles (default: 200)', parseInt, 200)
    .option(
      '--check-only',
      'Report pass/fail without running improvements (exit 0=pass, 1=fail)',
    )
    .option(
      '--dim <dims>',
      'Comma-separated dimension IDs to check (default: all 20)',
    )
    .option(
      '--escalate-after <n>',
      'Stuck cycles before party escalation (default: 3)',
      parseInt,
      3,
    )
    .option('--cwd <path>', 'Working directory (default: process.cwd())')
    .action(async (opts: {
      target: number;
      maxCycles: number;
      checkOnly?: boolean;
      dim?: string;
      escalateAfter: number;
      cwd?: string;
    }) => {
      const dims = opts.dim
        ? (opts.dim.split(',').map(d => d.trim()) as ScoringDimension[])
        : undefined;

      const convergeOpts: ConvergeOptions = {
        cwd: opts.cwd,
        target: opts.target,
        maxCycles: opts.maxCycles,
        checkOnly: opts.checkOnly ?? false,
        dims,
        escalateAfter: opts.escalateAfter,
      };

      const _cwd = opts.cwd ?? process.cwd();
      // --- Decision-node: record start (best-effort) ---
      let _dnStartNodeId: string | undefined;
      const _dnT0 = Date.now();
      try {
        const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
        const _dnSess = getSession(_cwd);
        const _dnStart = await recordDecision({ session: _dnSess, actorType: 'agent', prompt: 'converge: convergence loop', context: { cwd: _cwd }, result: 'in-progress', success: false });
        _dnStartNodeId = _dnStart.id;
      } catch { /* never block */ }

      const result = await runConverge(convergeOpts);
      process.exitCode = result.exitCode;

      // --- Decision-node: record completion (best-effort) ---
      try {
        const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
        const _dnSess = getSession(_cwd);
        await recordDecision({ session: _dnSess, parentNodeId: _dnStartNodeId, actorType: 'agent', prompt: 'converge: convergence loop [complete]', result: 'converge complete', success: true, latencyMs: Date.now() - _dnT0 });
      } catch { /* best-effort */ }
    });
}
