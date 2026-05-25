import type { Command } from 'commander';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerCouncilCmds(program: Command, _C: () => Promise<Commands>): void {
// ── council ──────────────────────────────────────────────────────────────────

program
  .command('council')
  .description('Multi-LLM council: builder + independent judges. The one who builds never judges. Dispatches real work to Codex, Gemini, Grok Build via subscription CLIs.')
  .option('--goal <goal>', 'Task for the council to tackle')
  .option('--ask <question>', 'Ask all available council members a question (read-only consultation — no code changes)')
  .option('--builder <id>', 'Preferred builder (codex|gemini-cli|grok-build|claude-code) — sequential mode only')
  .option('--loop', 'Continue cycling until --target-dims passes achieved')
  .option('--target-dims <n>', 'Stop after this many council-approved passes (sequential mode)', '1')
  .option('--max-cycles <n>', 'Safety cap on cycles (default 20 in loop mode)', '20')
  .option('--parallel', 'True parallel mode: all members build simultaneously in isolated git worktrees, then cross-judge each other')
  .option('--rounds <n>', 'Number of parallel rounds to run (parallel mode, default: 1)', '1')
  .option('--max-dims <n>', 'Max dimensions to schedule per round (parallel mode)')
  .option('--focus-dims <ids>', 'Comma-separated dimension IDs to target (skips gap ranking, e.g. "testing,spec_workflow_enforcement")')
  .option('--slots-per-member <n>', 'Sub-agents per council member — M members × N slots = M*N parallel worktrees (default: 1)', '1')
  .option('--min-judges <n>', 'Minimum cross-member judges required per candidate (default: 2)', '2')
  .option('--skip-validate', 'Skip running danteforge validate after merges (faster for first runs)')
  .option('--resume <runId>', 'Resume a parallel council run from its last checkpoint (runId from COUNCIL_SESSION_<runId>.json)')
  .option('--discover', 'Only probe and list available council members, then exit')
  .option('--json', 'Emit JSON summary at end')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((opts) => {
    void (async () => {
      try {
        const { runCouncilCommand, discoverCouncil } = await import('./commands/council.js');
        if (opts.discover) {
          const { logger } = await import('../core/logger.js');
          const members = await discoverCouncil();
          for (const m of members) {
            logger.info(`${m.available ? '✓' : '✗'}  ${m.label}`);
          }
          return;
        }
        if (opts.ask) {
          const { runCouncilAsk } = await import('./commands/council-ask.js');
          await runCouncilAsk({
            cwd: opts.cwd as string | undefined,
            question: opts.ask as string,
            json: opts.json as boolean | undefined,
          });
          return;
        }
        if (!opts.goal) throw new Error('--goal or --ask is required. Example: danteforge council --ask "What is the biggest reliability gap?"');

        if (opts.parallel) {
          const { runParallelCouncil } = await import('./commands/council-parallel.js');
          await runParallelCouncil({
            cwd: opts.cwd as string | undefined,
            goal: opts.goal as string,
            maxRounds: opts.rounds ? parseInt(opts.rounds as string, 10) : 1,
            maxDimsPerRound: opts.maxDims ? parseInt(opts.maxDims as string, 10) : undefined,
            loop: opts.loop as boolean | undefined,
            json: opts.json as boolean | undefined,
            skipValidate: opts.skipValidate as boolean | undefined,
            resumeRunId: opts.resume as string | undefined,
            slotsPerMember: opts.slotsPerMember ? parseInt(opts.slotsPerMember as string, 10) : 1,
            minJudges: opts.minJudges ? parseInt(opts.minJudges as string, 10) : 2,
            focusDims: opts.focusDims ? (opts.focusDims as string).split(',').map((s: string) => s.trim()) : undefined,
          });
          return;
        }

        await runCouncilCommand({
          cwd: opts.cwd as string | undefined,
          goal: opts.goal as string,
          builderPref: opts.builder as 'codex' | 'gemini-cli' | 'grok-build' | 'claude-code' | undefined,
          loop: opts.loop as boolean | undefined,
          targetDims: opts.targetDims ? parseInt(opts.targetDims as string, 10) : undefined,
          maxCycles: opts.maxCycles ? parseInt(opts.maxCycles as string, 10) : undefined,
          json: opts.json as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'council');
        process.exitCode = 1;
      }
    })();
  });
}
