import type { Command } from 'commander';

type Commands = Awaited<typeof import('./commands/index.js')>;

function parseMemberSlots(spec: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const part of spec.split(',')) {
    const colon = part.lastIndexOf(':');
    if (colon > 0) {
      const id = part.slice(0, colon).trim();
      const n = parseInt(part.slice(colon + 1).trim(), 10);
      if (id && !isNaN(n) && n > 0) result[id] = n;
    }
  }
  return result;
}

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
  .option('--member-slots <spec>', 'Per-member slot overrides, e.g. "claude-code:4,codex:4,grok-build:2" (overrides --slots-per-member for named members)')
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
            memberSlots: opts.memberSlots ? parseMemberSlots(opts.memberSlots as string) : undefined,
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

// ── council-frontier-loop ─────────────────────────────────────────────────────

program
  .command('council-frontier-loop')
  .description('Continuous quality ratchet: research → build → verify → confirm → loop until all dims reach target. Claude builds, Codex researches+confirms, Grok verifies (minimal usage).')
  .option('--goal <goal>', 'Build goal injected into every forge prompt')
  .option('--target <n>', 'Score target per dimension (default: 9)', '9')
  .option('--max-iterations <n>', 'Max loop iterations before stopping (default: 100)', '100')
  .option('--builder <id>', 'Builder member (default: claude-code)', 'claude-code')
  .option('--researchers <ids>', 'Comma-separated researcher members (default: codex,grok-build)', 'codex,grok-build')
  .option('--verifier <id>', 'Checklist verifier — binary pass/fail per item (default: grok-build)', 'grok-build')
  .option('--confirmer <id>', 'Final verdict confirmer (default: codex)', 'codex')
  .option('--oss-harvest-path <path>', 'Path to OSS harvest directory (default: X:\\Projects\\OSSHarvest)')
  .option('--skip-research', 'Skip research phase — use existing forge briefs only')
  .option('--skip-validate', 'Skip post-merge validate (faster, no receipts)')
  .option('--min-gap <n>', 'Minimum gap to include (default: 0)', '0')
  .option('--json', 'Emit JSON result at end')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((opts) => {
    void (async () => {
      try {
        const { runFrontierLoopCommand } = await import('./commands/council-frontier-loop.js');
        await runFrontierLoopCommand({
          cwd: opts.cwd as string | undefined,
          goal: opts.goal as string | undefined,
          target: opts.target ? parseFloat(opts.target as string) : 9.0,
          maxIterations: opts.maxIterations ? parseInt(opts.maxIterations as string, 10) : 100,
          builder: opts.builder as string | undefined,
          researchers: opts.researchers as string | undefined,
          verifier: opts.verifier as string | undefined,
          confirmer: opts.confirmer as string | undefined,
          ossHarvestPath: opts.ossHarvestPath as string | undefined,
          skipResearch: opts.skipResearch as boolean | undefined,
          skipValidate: opts.skipValidate as boolean | undefined,
          minGap: opts.minGap ? parseFloat(opts.minGap as string) : 0,
          json: opts.json as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'council-frontier-loop');
        process.exitCode = 1;
      }
    })();
  });

// ── council-crusade ───────────────────────────────────────────────────────────

program
  .command('council-crusade')
  .description('Autonomous multi-agent frontier push: council loops over weakest dims until target score reached. Combines council --parallel with outer scoring loop.')
  .option('--goal <goal>', 'Mission statement for each council pass')
  .option('--target <n>', 'Score target per dimension (default: 9)', '9')
  .option('--passes <n>', 'Maximum outer loop passes (default: 5)', '5')
  .option('--rounds-per-pass <n>', 'Council rounds per pass (default: 2)', '2')
  .option('--dims-per-pass <n>', 'Max dimensions per pass (default: 4)', '4')
  .option('--slots-per-member <n>', 'Sub-agents per council member (default: 2)', '2')
  .option('--member-slots <spec>', 'Per-member slot overrides, e.g. "claude-code:4,codex:4,grok-build:2" (overrides --slots-per-member for named members)')
  .option('--min-judges <n>', 'Min cross-member judges per candidate (default: 2)', '2')
  .option('--focus-dims <ids>', 'Comma-separated dim IDs to restrict to')
  .option('--skip-validate', 'Skip post-merge validate (faster for testing)')
  .option('--dry-run', 'Print plan without running')
  .option('--json', 'Emit JSON summary')
  .option('--cwd <path>', 'Project directory')
  .action((opts) => {
    void (async () => {
      try {
        const { runCouncilCrusade } = await import('./commands/council-crusade.js');
        await runCouncilCrusade({
          cwd: opts.cwd as string | undefined,
          goal: opts.goal as string | undefined,
          target: opts.target ? parseInt(opts.target as string, 10) : 9,
          maxPasses: opts.passes ? parseInt(opts.passes as string, 10) : 5,
          maxRoundsPerPass: opts.roundsPerPass ? parseInt(opts.roundsPerPass as string, 10) : 2,
          maxDimsPerPass: opts.dimsPerPass ? parseInt(opts.dimsPerPass as string, 10) : 4,
          slotsPerMember: opts.slotsPerMember ? parseInt(opts.slotsPerMember as string, 10) : 2,
          memberSlots: opts.memberSlots ? parseMemberSlots(opts.memberSlots as string) : undefined,
          minJudges: opts.minJudges ? parseInt(opts.minJudges as string, 10) : 2,
          focusDims: opts.focusDims ? (opts.focusDims as string).split(',').map((s: string) => s.trim()) : undefined,
          skipValidate: opts.skipValidate as boolean | undefined,
          dryRun: opts.dryRun as boolean | undefined,
          json: opts.json as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'council-crusade');
        process.exitCode = 1;
      }
    })();
  });
}
