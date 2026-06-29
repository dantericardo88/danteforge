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
// ── council-review (mechanized /askcouncil gap-hunt) ──────────────────────────
program
  .command('council-review')
  .description('Adversarial multi-lens gap-hunt — READY/NOT_READY verdict + defined gaps recorded to the ledger (builder-never-judges)')
  .option('--json', 'Machine-readable JSON output')
  .action((opts: Record<string, unknown>) => {
    void (async () => {
      try {
        const { councilReview } = await import('./commands/council-review.js');
        await councilReview({ json: opts['json'] as boolean | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'council-review');
        process.exitCode = 1;
      }
    })();
  });

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
  .option('--members <ids>', 'Comma-separated member IDs to use (e.g. "codex,claude-code"). Overrides DANTEFORGE_COUNCIL_MEMBERS env var.')
  .option('--json', 'Emit JSON summary at end')
  .option('--ask-timeout <seconds>', 'Per-member budget for --ask consultations (default 450; raise for thorough codebase-reading members like claude/codex)')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((opts) => {
    void (async () => {
      try {
        const { runCouncilCommand, discoverCouncil } = await import('./commands/council.js');
        const memberFilter: string[] | undefined = opts.members
          ? (opts.members as string).split(',').map((s: string) => s.trim()).filter(Boolean)
          : undefined;
        if (opts.discover) {
          const { logger } = await import('../core/logger.js');
          const members = await discoverCouncil(memberFilter);
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
            timeoutMs: opts.askTimeout ? Math.round(parseFloat(opts.askTimeout as string) * 1000) : undefined,
            _discover: memberFilter ? () => discoverCouncil(memberFilter) : undefined,
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
  .option('--max-iterations <n>', 'Max loop iterations (default: auto — max(50, N_dims x 3))')
  .option('--builder <id>', 'Builder member (default: claude-code)', 'claude-code')
  .option('--researchers <ids>', 'Comma-separated researcher members (default: claude-code,codex,grok-build)')
  .option('--verifier <id>', 'Checklist verifier — binary pass/fail per item (default: grok-build)', 'grok-build')
  .option('--confirmer <id>', 'Final verdict confirmer (default: codex)', 'codex')
  .option('--oss-harvest-path <path>', 'Path to OSS harvest directory (default: X:\\Projects\\OSSHarvest)')
  .option('--skip-research', 'Skip research phase — use existing forge briefs only')
  .option('--skip-validate', 'Skip post-merge validate (faster, no receipts)')
  .option('--min-gap <n>', 'Minimum gap to include (default: 0)', '0')
  .option('--concurrency <n>', 'Max parallel research calls per researcher (default: 6)', '6')
  .option('--max-retries <n>', 'Max retries per dim on research parse failure (default: 2)', '2')
  .option('--run-de-sloppify', 'Run de-sloppify cleanup after each PASS merge (author-bias elimination)')
  .option('--verify-mode <mode>', 'Verify mode: grok (default, pre-merge checklist) or loop (6-phase gate post-merge)', 'grok')
  .option('--max-dim-fails <n>', 'Skip dim after N consecutive FAILs (default: 10)', '10')
  .option('--skip-dims <ids>', 'Comma-separated dim IDs to exclude (e.g. community_adoption)')
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
          maxIterations: opts.maxIterations ? parseInt(opts.maxIterations as string, 10) : undefined,
          builder: opts.builder as string | undefined,
          researchers: opts.researchers as string | undefined,
          verifier: opts.verifier as string | undefined,
          confirmer: opts.confirmer as string | undefined,
          ossHarvestPath: opts.ossHarvestPath as string | undefined,
          skipResearch: opts.skipResearch as boolean | undefined,
          skipValidate: opts.skipValidate as boolean | undefined,
          minGap: opts.minGap ? parseFloat(opts.minGap as string) : 0,
          researchConcurrencyLimit: opts.concurrency ? parseInt(opts.concurrency as string, 10) : undefined,
          researchMaxRetries: opts.maxRetries ? parseInt(opts.maxRetries as string, 10) : undefined,
          runDeSloppify: opts.runDeSloppify as boolean | undefined,
          verifyMode: (opts.verifyMode as 'grok' | 'loop' | undefined) ?? 'grok',
          maxDimFails: opts.maxDimFails ? parseInt(opts.maxDimFails as string, 10) : 10,
          skipDims: opts.skipDims as string | undefined,
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
// ── council-universe ──────────────────────────────────────────────────────────

program
  .command('council-universe')
  .description('Research competitive universe per dim: council members use web search to define exactly what 9+ looks like for each of the 24 matrix dimensions. Output: .danteforge/compete/universe/<dim_id>.md')
  .option('--dims <ids>', 'Comma-separated dim IDs to research (default: all from matrix)')
  .option('--members <ids>', 'Comma-separated researcher members (default: claude-code,codex)', 'claude-code,codex')
  .option('--no-skip-existing', 'Force re-research even if universe files already exist')
  .option('--skip-verify', 'Skip Phase 2 verification pass (second member checks citations + specificity)')
  .option('--propose-outcomes', 'After research+verify, extract capability-test proposals for danteforge validate')
  .option('--concurrency <n>', 'Max parallel dim research calls (default: 4)', '4')
  .option('--json', 'Emit JSON result at end')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((opts) => {
    void (async () => {
      try {
        const { runCouncilUniverseCommand } = await import('./commands/council-universe.js');
        await runCouncilUniverseCommand({
          cwd: opts.cwd as string | undefined,
          dims: opts.dims as string | undefined,
          members: opts.members as string | undefined,
          skipExisting: opts.skipExisting !== false,
          skipVerify: opts.skipVerify as boolean | undefined,
          proposeOutcomes: opts.proposeOutcomes as boolean | undefined,
          concurrency: opts.concurrency ? parseInt(opts.concurrency as string, 10) : 4,
          json: opts.json as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'council-universe');
        process.exitCode = 1;
      }
    })();
  });

// ── council-universe-apply ────────────────────────────────────────────────────

program
  .command('council-universe-apply')
  .description('Apply verified universe outcome proposals to matrix.json dims. Adds proposed capability_test and outcomes[] entries. Run danteforge validate after to generate receipts.')
  .option('--dims <ids>', 'Comma-separated dim IDs to apply (default: all with proposals)')
  .option('--dry-run', 'Preview changes without writing to matrix.json')
  .option('--no-skip-unverified', 'Apply proposals even for dims without a VERIFIED verdict')
  .option('--json', 'Emit JSON result at end')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((opts) => {
    void (async () => {
      try {
        const { runCouncilUniverseApply } = await import('./commands/council-universe-apply.js');
        await runCouncilUniverseApply({
          cwd: opts.cwd as string | undefined,
          dims: opts.dims as string | undefined,
          dryRun: opts.dryRun as boolean | undefined,
          skipUnverified: opts.skipUnverified !== false,
          json: opts.json as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'council-universe-apply');
        process.exitCode = 1;
      }
    })();
  });

// ── de-sloppify ──────────────────────────────────────────────────────────────

program
  .command('de-sloppify')
  .description('Post-forge cleanup: fresh-context agent removes type-system-only tests, debug artifacts, over-defensive null checks, and dead imports. Author-bias elimination by design.')
  .option('--files <pattern>', 'Comma-separated glob patterns (default: src/**/*.ts,tests/**/*.ts)')
  .option('--dry-run', 'Report what would be removed without editing files')
  .option('--json', 'Emit JSON result at end')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((opts) => {
    void (async () => {
      try {
        const { runDeSloppifyCommand } = await import('./commands/de-sloppify.js');
        await runDeSloppifyCommand({
          cwd: opts.cwd as string | undefined,
          files: opts.files as string | undefined,
          dryRun: opts.dryRun as boolean | undefined,
          json: opts.json as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'de-sloppify');
        process.exitCode = 1;
      }
    })();
  });

// ── verify-loop ───────────────────────────────────────────────────────────────

program
  .command('verify-loop')
  .description('6-phase quality gate: Build -> Typecheck -> Lint -> Tests -> Security -> Diff Review. Runs in sequence; stops on first failure.')
  .option('--dim <id>', 'Focus test phase on a specific dimension')
  .option('--phases <list>', 'Comma-separated subset: build,typecheck,lint,tests,security,diff')
  .option('--continuous', 'Run continuously every --interval-ms milliseconds')
  .option('--interval-ms <n>', 'Interval for continuous mode in ms (default: 900000)', '900000')
  .option('--json', 'Emit JSON result at end')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((opts) => {
    void (async () => {
      try {
        const { runVerifyLoopCommand } = await import('./commands/verify-loop.js');
        await runVerifyLoopCommand({
          cwd: opts.cwd as string | undefined,
          dim: opts.dim as string | undefined,
          phases: opts.phases as string | undefined,
          continuous: opts.continuous as boolean | undefined,
          intervalMs: opts.intervalMs ? parseInt(opts.intervalMs as string, 10) : undefined,
          json: opts.json as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'verify-loop');
        process.exitCode = 1;
      }
    })();
  });
}