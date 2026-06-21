import type { Command } from 'commander';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerCoreIntelCmds(program: Command, C: () => Promise<Commands>): void {
program
  .command('tech-decide')
  .description('Guided tech stack selection - 3-5 options per category with pros/cons')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--auto', 'Accept all recommended defaults without interactive review')
  .action((...a: unknown[]) => void C().then(c => (c.techDecide as (...x: unknown[]) => unknown)(...a)));

program
  .command('lessons [correction]')
  .description('Self-improving lessons - capture corrections, view rules, auto-compact')
  .option('--prompt', 'Generate a copy-paste prompt instead of auto-executing')
  .option('--compact', 'Force compaction of lessons file')
  .option('--velocity', 'Show improvement velocity trend across sprint history')
  .option('--dedupe', 'Remove near-duplicate lessons from lessons.md')
  .action((...a: unknown[]) => void C().then(c => (c.lessons as (...x: unknown[]) => unknown)(...a)));

program
  .command('awesome-scan')
  .description('Discover, classify, and import skills across all sources')
  .option('--source <path>', 'Scan an external directory for skills')
  .option('--domain <type>', 'Filter by domain (security|fullstack|devops|ux|backend|frontend|data|testing|architecture|general)')
  .option('--install', 'Import compatible external skills')
  .action((...a: unknown[]) => void C().then(c => (c.awesomeScan as (...x: unknown[]) => unknown)(...a)));

program
  .command('profile [subcommand] [arg]')
  .description('Model personality profiles â€" view learned behavioral patterns per model')
  .option('--prompt', 'Generate a copy-paste prompt instead of displaying')
  .addHelpText('after', '\nSubcommands: (none)=summary, compare, report, weakness <model>, recommend <task>')
  .action(async (subcommand, arg, opts) => (await C()).profile(subcommand, arg, { prompt: opts.prompt }));

program
  .command('autoforge [goal]')
  .description('Deterministic auto-orchestration of the full DanteForge pipeline')
  .option('--dry-run', 'Show plan without executing')
  .option('--max-waves <n>', 'Max steps before checkpoint', '3')
  .option('--profile <type>', 'quality | balanced | budget', 'balanced')
  .option('--parallel', 'Run forge steps in parallel lanes when execution begins')
  .option('--worktree', 'Run forge steps in an isolated git worktree')
  .option('--light', 'Skip hard gates')
  .option('--prompt', 'Generate copy-paste prompt describing what autoforge would do')
  .option('--score-only', 'Score existing artifacts and write AUTOFORGE_GUIDANCE.md — no execution')
  .option('--auto', 'Run autonomous loop until 95% completion or BLOCKED state')
  .option('--force', 'Override one BLOCKED artifact for one cycle (logged to audit trail)')
  .option('--pause-at <score>', 'Pause the loop when average PDSE score reaches this value')
  .option('--confirm', 'Pause for human approval before executing (policy gate)')
  .option('--no-predictor', 'Disable Article XV forward prediction layer (saves ~$0.03/wave, loses causal coherence signal)')
  .option('--target <score>', 'Loop until displayScore >= target (default: 9.0 when --auto)')
  .option('--dimension <name>', 'Focus improvement on one scoring dimension')
  .option('--resume', 'Resume from .danteforge/checkpoint.json')
  .option('--adversarial', 'Enable adversarial score gate between cycles')
  .action(async (goal, opts) => {
    // Direct dynamic import: autoforge loads the full pipeline engine
    // (autoforge-loop, complexity-classifier, convergence engine). Deferring
    // this import keeps all non-autoforge commands at minimal startup cost.
    const { autoforge } = await import('./commands/autoforge.js');
    return autoforge(goal, {
      dryRun: opts.dryRun,
      maxWaves: parseInt(opts.maxWaves, 10),
      light: opts.light,
      prompt: opts.prompt,
      scoreOnly: opts.scoreOnly,
      auto: opts.auto,
      force: opts.force,
      profile: opts.profile,
      parallel: opts.parallel,
      worktree: opts.worktree,
      pauseAt: opts.pauseAt !== undefined ? parseInt(opts.pauseAt, 10) : undefined,
      confirm: opts.confirm,
      noPredictor: opts.predictor === false,
      target: opts.target !== undefined ? parseFloat(opts.target as string) : undefined,
      dimension: opts.dimension as string | undefined,
      resume: opts.resume as boolean | undefined,
      adversarial: opts.adversarial as boolean | undefined,
    });
  });

program
  .command('resume')
  .description('Resume a paused autoforge loop from the last checkpoint')
  .action(async () => (await C()).resumeAutoforge());

program
  .command('retro')
  .description('Project retrospective with metrics, delta scoring, and trend tracking')
  .option('--summary', 'Print trend summary of last 5 retros')
  .option('--cwd <path>', 'Project directory')
  .action((...a: unknown[]) => void C().then(c => (c.retro as (...x: unknown[]) => unknown)(...a)));

program
  .command('maturity')
  .description('Assess current code maturity level with founder-friendly quality report')
  .option('--preset <level>', 'Target preset level (spark|ember|canvas|magic|blaze|nova|inferno)')
  .option('--json', 'Output JSON instead of plain text')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => (await C()).maturity({
    preset: opts.preset,
    json: opts.json,
    cwd: opts.cwd,
  }));

program
  .command('ship [action]')
  .description("Release guidance: verify â†' QA â†' publish preflight pipeline (action: ci-setup)")
  .option('--level <level>', 'Depth: light (verify only) | standard (default) | deep (+ publishCheck)')
  .option('--dry-run', 'Run full pipeline without publishing')
  .option('--browse', 'Open browser preview during QA')
  .option('--skip-review', 'Skip pre-landing review (emergency only, logged to audit)')
  .option('--cwd <path>', 'Working directory')
  .action((action, opts) => {
    void (async () => {
      try {
        const { canonicalShip } = await import('./commands/canonical.js');
        await canonicalShip({
          action: action as 'ci-setup' | undefined,
          level: opts.level as 'light' | 'standard' | 'deep' | undefined,
          dryRun: opts.dryRun as boolean | undefined,
          withBrowse: opts.browse as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'ship');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('oss')
  .description('Auto-detect project, search OSS, clone, license-gate, scan, extract patterns, report')
  .option('--prompt', 'Generate a copy-paste research plan prompt instead of executing')
  .option('--dry-run', 'Show what would be searched without cloning')
  .option('--max-repos <n>', 'Maximum repos to clone and analyze (default: 8)', '8')
  .action(async (opts) => (await C()).ossResearcher({
    prompt: opts.prompt,
    dryRun: opts.dryRun,
    maxRepos: opts.maxRepos,
  }));

program
  .command('oss-deep [url-or-path]')
  .description('Deep systematic extraction from a single OSS repo (persistent cache, full src read)')
  .option('--prompt', 'Show extraction plan without executing')
  .option('--include-git-log', 'Include commit history analysis for top 5 files (slower)')
  .option('--max-files <n>', 'Max critical files to read in full (default: 20)', '20')
  .action(async (urlOrPath, opts) => {
    const { ossDeepCommand } = await import('./commands/oss-deep.js');
    await ossDeepCommand(urlOrPath ?? '', {
      prompt: opts.prompt,
      includeGitLog: opts.includeGitLog,
      maxFiles: opts.maxFiles,
    });
  });

program
  .command('oss-intel')
  .description('Multi-repo systematic harvest â€" builds ADOPTION_QUEUE.md from harvest-queue.json')
  .option('--max-repos <n>', 'Max repos to deep-extract per run (default: 5)', '5')
  .option('--prompt', 'Show harvest plan without executing')
  .action(async (opts) => {
    const { ossIntel } = await import('./commands/oss-intel.js');
    await ossIntel({ maxRepos: parseInt(opts.maxRepos, 10), promptMode: opts.prompt });
  });

program
  .command('intel')
  .description('Real-time competitor weakness intelligence from GitHub, HN, and Reddit')
  .option('--competitor <name>', 'Fetch intelligence for one competitor only (partial match)')
  .option('--opportunities', 'Show ranked opportunity table (default: on)')
  .option('--github-only', 'Skip HackerNews and Reddit fetchers (faster)')
  .option('--save', 'Write report to .danteforge/compete/weakness-intelligence.json')
  .option('--watch', 'Poll every 6 hours continuously')
  .option('--top <n>', 'Number of top signals/opportunities to display (default: 10)', '10')
  .option('--timeout <ms>', 'Per-source timeout in milliseconds (default: 20000)', '20000')
  .action(async (opts) => {
    const { intelCommand } = await import('./commands/intel.js');
    await intelCommand({
      competitor: opts.competitor,
      opportunities: opts.opportunities !== false,
      githubOnly: opts.githubOnly,
      save: opts.save,
      watch: opts.watch,
      topN: parseInt(opts.top, 10),
      timeoutMs: parseInt(opts.timeout, 10),
    });
  });

program
  .command('gate-status')
  .description('Preflight the autonomy gates (GROUNDING_GATE / REQUIRE_SIGNED_EVIDENCE) — whether each is SAFE to flip now, so the wrong order cannot stall the loop (read-only)')
  .option('--json', 'Machine-readable output')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    const { gateStatus } = await import('./commands/gate-status.js');
    await gateStatus({ json: opts.json, cwd: opts.cwd });
  });

program
  .command('autonomy')
  .description('Where this matrix is on the path to maximal honest autonomy — per-dim posture + machine-autonomous coverage (read-only)')
  .option('--json', 'Machine-readable output')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    const { autonomyStatus } = await import('./commands/autonomy.js');
    await autonomyStatus({ json: opts.json, cwd: opts.cwd });
  });

program
  .command('autonomy-loop')
  .description('Run the autonomous council-loop: climb while contamination-resistant grounding moves, pause on a degraded panel, stop+decompose at the capability ceiling (never a wall)')
  .option('--max-cycles <n>', 'Safety cap on cycles (default 10)')
  .option('--ceiling-patience <n>', 'Consecutive no-progress cycles before the honest capability-ceiling stop (default 2)')
  .option('--cycle-command <cmd>', 'Build step run each cycle (the capability climb); omit for a DRY measurement-only run')
  .option('--require-quorum', 'Convene a live council quorum each cycle (slow); omit to assume quorum for dry runs')
  .option('--token-budget <n>', 'Hard token ceiling (output tokens); omit for unbounded')
  .option('--json', 'Machine-readable output')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    const { runAutonomyLoopCommand } = await import('./commands/autonomy-loop.js');
    await runAutonomyLoopCommand({
      cwd: opts.cwd,
      maxCycles: opts.maxCycles ? parseInt(opts.maxCycles as string, 10) : undefined,
      ceilingPatience: opts.ceilingPatience ? parseInt(opts.ceilingPatience as string, 10) : undefined,
      tokenBudget: opts.tokenBudget ? parseInt(opts.tokenBudget as string, 10) : null,
      cycleCommand: opts.cycleCommand as string | undefined,
      requireQuorum: opts.requireQuorum as boolean | undefined,
      json: opts.json as boolean | undefined,
    });
  });

program
  .command('ratify')
  .description('Vouch for a subjective harvested bar (capability/demand) — the human-ratify half of autonomy; lists candidates, signs the chosen one into the ratified-signals store')
  .option('--dim <id>', 'Dimension whose subjective bar to ratify')
  .option('--index <n>', 'Index of the candidate to ratify (omit to list)')
  .option('--as <operator>', 'Your operator id (who is vouching) — required to ratify')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    const { ratifyCommand } = await import('./commands/ratify.js');
    await ratifyCommand({ dim: opts.dim, index: opts.index, as: opts.as, cwd: opts.cwd });
  });

program
  .command('leaderboard-fetch')
  .description('Re-fetch published benchmark frontier numbers from real leaderboards, sign them (CH-030), write leaderboards.json — the objective bar anchor')
  .option('--dim <id>', 'Fetch only the source(s) for one matrix dimension')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    const { leaderboardFetch } = await import('./commands/leaderboard-fetch.js');
    await leaderboardFetch({ dim: opts.dim, cwd: opts.cwd });
  });

program
  .command('oss-clean')
  .description('Purge OSS clone cache (.danteforge/oss-repos/ and oss-deep/)')
  .option('--dry-run', 'Show what would be deleted without deleting')
  .action(async (opts) => {
    const { ossClean } = await import('./commands/oss-clean.js');
    await ossClean({ dryRun: opts.dryRun });
  });

program
  .command('oss-sync')
  .description('Matrix-aware OSS restore — re-clones any missing repos, optionally pulls updates on stale ones')
  .option('--update', 'Also git-pull repos already on disk that are older than --stale-days')
  .option('--stale-days <n>', 'Days before a repo is considered stale for --update (default: 7)', '7')
  .option('--dry-run', 'Show what would happen without cloning or pulling')
  .action(async (opts) => {
    const { ossSync } = await import('./commands/oss-sync.js');
    await ossSync({
      update: opts.update,
      staleDays: opts.staleDays ? parseInt(opts.staleDays, 10) : undefined,
      dryRun: opts.dryRun,
    });
  });

program
  .command('oss-loop')
  .description('Competitive landscape discovery loop — runs until no new OSS repos found (plateau), then oss-sync to restore all')
  .option('--plateau-passes <n>', 'Consecutive empty passes before stopping (default: 3)', '3')
  .option('--max-passes <n>', 'Hard pass cap regardless of plateau (default: 20)', '20')
  .option('--max-repos-per-pass <n>', 'New repos to clone per pass (default: 5)', '5')
  .option('--discovery-file <path>', 'Host-generated JSON candidate repo file; skips configured CLI LLM calls')
  .option('--no-sync', 'Skip final oss-sync after discovery completes')
  .option('--dry-run', 'Show discovery plan without cloning')
  .action(async (opts) => {
    const { ossLoop } = await import('./commands/oss-loop.js');
    await ossLoop({
      discoveryFile: opts.discoveryFile,
      plateauPasses: parseInt(opts.plateauPasses, 10),
      maxPasses: parseInt(opts.maxPasses, 10),
      maxReposPerPass: parseInt(opts.maxReposPerPass, 10),
      syncAtEnd: opts.sync !== false,
      dryRun: opts.dryRun,
    });
  });

program
  .command('titan-harvest-loop')
  .description('Clean-room harvest loop — analyzes GPL/AGPL repos queued by oss-loop, extracts patterns via LLM without copying code')
  .option('--max-repos <n>', 'Max repos to analyze per run (default: 10)', '10')
  .option('--dry-run', 'Show plan without cloning or calling LLM')
  .action(async (opts) => {
    const { titanHarvestLoop } = await import('./commands/titan-harvest-loop.js');
    await titanHarvestLoop({
      maxReposPerRun: parseInt(opts.maxRepos, 10),
      dryRun: opts.dryRun,
    });
  });

program
  .command('eval')
  .description('LLM output evaluation — run a golden test suite against the configured LLM, exit 1 on failure (CI-ready)')
  .option('--suite <file>', 'Path to eval suite JSON file (default: built-in smoke suite)')
  .option('--dim <id>', 'Filter cases to a specific matrix dimension')
  .option('--ci', 'Exit 1 if any test fails (for CI pipelines)')
  .option('--dry-run', 'Show plan without calling LLM')
  .action(async (opts) => {
    const { runEval } = await import('./commands/eval.js');
    await runEval({ suiteFile: opts.suite, dimension: opts.dim, ci: opts.ci, dryRun: opts.dryRun });
  });

program
  .command('daemon')
  .description('Autonomous improvement daemon — runs crusade/autoresearch continuously until score target reached or time limit hit')
  .option('--strategy <s>', 'crusade | autoresearch | adaptive (default: adaptive)', 'adaptive')
  .option('--target <n>', 'Score target to stop at (default: 9.0)', '9.0')
  .option('--time <m>', 'Wall-clock time limit in minutes (default: 240)', '240')
  .option('--interval <m>', 'Minutes between passes (default: 5)', '5')
  .option('--intel-cycle <n>', 'Run competitor intel cycle every N improvements (0=off, default: 3)', '3')
  .option('--dry-run', 'Show plan without executing')
  .action(async (opts) => {
    const { runDaemon } = await import('./commands/daemon.js');
    await runDaemon({
      strategy: opts.strategy,
      target: parseFloat(opts.target),
      timeLimitMinutes: parseInt(opts.time, 10),
      intervalMinutes: parseInt(opts.interval, 10),
      intelCycleEvery: parseInt(opts.intelCycle, 10),
      dryRun: opts.dryRun,
    });
  });

program
  .command('score-audit')
  .description('Completion integrity audit: independently verify every dimension score against real evidence, apply 10-tier caps')
  .option('--dimension [ids...]', 'Audit only these dimension ids (repeatable)')
  .option('--apply', 'Write capped scores back to matrix.json (default: dry-run)')
  .option('--skip-cap-tests', 'Skip running capability_test commands (faster, less reliable)')
  .option('--json', 'Emit JSON summary')
  .action(async (opts) => {
    const { runScoreAudit } = await import('./commands/score-audit.js');
    await runScoreAudit({
      dimension: opts.dimension,
      apply: opts.apply ?? false,
      skipCapTests: opts.skipCapTests ?? false,
      json: opts.json ?? false,
    });
  });

program
  .command('harvest-forge')
  .description('Compounding OSS intelligence loop: discover -> extract -> implement -> verify -> repeat')
  .option('--max-cycles <n>', 'Max iteration cycles (default: 10)', '10')
  .option('--target <score>', 'Target convergence score 0-10 (default: 9.0)', '9.0')
  .option('--auto', 'Auto-approve all cycles without human checkpoint')
  .option('--prompt', 'Show the loop plan without executing')
  .option('--max-hours <h>', 'Max wall-clock hours before stopping with budget-exhausted')
  .action(async (opts) => {
    const { harvestForge } = await import('./commands/harvest-forge.js');
    await harvestForge({
      maxCycles: parseInt(opts.maxCycles, 10),
      targetScore: parseFloat(opts.target),
      autoApprove: opts.auto,
      promptMode: opts.prompt,
      maxHours: opts.maxHours ? parseFloat(opts.maxHours) : undefined,
    });
  });

program
  .command('universe-scan')
  .description('Scan competitive universe, derive dimensions, score codebase with evidence')
  .option('--prompt', 'Show scan plan without executing')
  .action(async (opts) => {
    const { universeScan } = await import('./commands/universe-scan.js');
    await universeScan({ promptMode: opts.prompt });
  });

program
  .command('set-goal')
  .description('Set convergence goal: category, competitors, budget, oversight level')
  .option('--prompt', 'Show goal template without writing')
  .option('--no-scan', 'Skip auto universe-scan after goal is set')
  .action(async (opts) => {
    const { setGoal } = await import('./commands/set-goal.js');
    await setGoal({ promptMode: opts.prompt, autoScan: opts.scan !== false });
  });

program
  .command('goal-loop')
  .description('Autonomous cross-project loop: runs compete --auto on each project until all dimensions reach target (9.0). Pairs with Claude Code /goal for fully automated builds.')
  .option('--projects <paths>', 'Comma-separated project paths (defaults to registered projects)')
  .option('--target <score>', 'Victory threshold per dimension (default: 9.0)', parseFloat)
  .option('--max-cycles <n>', 'Total cycle limit across all projects (default: 120)', parseInt)
  .option('--max-cycles-per-project <n>', 'Max cycles on one project before rotating (default: 15)', parseInt)
  .option('--rotation <mode>', 'round-robin | greedy (default: greedy — most gaps first)', 'greedy')
  .option('--yes', 'Skip all confirmation gates (fully autonomous)')
  .option('--prompt', 'Show usage and /goal integration instructions')
  .action(async (opts) => {
    try {
      const { goalLoop } = await import('./commands/goal-loop.js');
      const projects = opts.projects ? (opts.projects as string).split(',').map((p: string) => p.trim()) : [];
      await goalLoop({
        projects,
        target: opts.target as number | undefined,
        maxCycles: opts.maxCycles as number | undefined,
        maxCyclesPerProject: opts.maxCyclesPerProject as number | undefined,
        rotationMode: (opts.rotation as 'round-robin' | 'greedy' | undefined) ?? 'greedy',
        yes: opts.yes as boolean | undefined,
        promptMode: opts.prompt as boolean | undefined,
      });
    } catch (err) {
      const { formatAndLogError } = await import('../core/format-error.js');
      formatAndLogError(err, 'goal-loop');
      process.exitCode = 1;
    }
  });
}
