import type { Command } from 'commander';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerOpsCmds(program: Command, C: () => Promise<Commands>): void {
program
  .command('supervise [goal]')
  .description('Auto-reengage Supervisor — keep an autonomous engine looping through transient stops without a human')
  .option('--engine <name>', 'Inner loop engine: autoforge | crusade | frontier', 'autoforge')
  .option('--target <score>', 'Loop until the engine reaches this score target', '8')
  .option('--posture <mode>', 'tiered (restart transient, pause on ceiling) | afk | notify', 'tiered')
  .option('--best-of-n <n>', 'Forge cycles generate N candidates and apply the pre-filter-selected best (default 1)')
  .option('--max-restarts <n>', 'Hard cap on total relaunches (convergence backstop)', '100')
  .option('--status', 'Print the current campaign state and exit')
  .option('--stop', 'Signal a running supervisor to halt cleanly on its next turn')
  .option('--install-keepalive', 'Generate an OS keepalive (Task Scheduler/launchd/systemd) so it survives host sleep')
  .option('--dry-run', 'Show what would loop without launching')
  .action((goal: string | undefined, opts) => {
    void (async () => {
      try {
        await (await C()).supervise(goal, {
          engine: opts.engine as string | undefined,
          target: opts.target !== undefined ? parseFloat(opts.target as string) : undefined,
          posture: opts.posture as ('tiered' | 'afk' | 'notify' | undefined),
          bestOfN: opts.bestOfN !== undefined ? parseInt(opts.bestOfN as string, 10) : undefined,
          maxRestarts: opts.maxRestarts !== undefined ? parseInt(opts.maxRestarts as string, 10) : undefined,
          status: opts.status as boolean | undefined,
          stop: opts.stop as boolean | undefined,
          installKeepalive: opts.installKeepalive as boolean | undefined,
          dryRun: opts.dryRun as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'supervise');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('mcp-tools [name]')
  .description('List MCP tools exposed by the DanteForge server. Used by Claude Code / Codex / DanteCode.')
  .option('--json', 'Machine-readable JSON output')
  .option('--category <name>', 'Filter by category (Scoring, Gates, Workflow, etc.)')
  .option('--query <text>', 'Filter by name/description substring')
  .addHelpText('after', `
Examples:
  danteforge mcp-tools                              List all tools grouped by category
  danteforge mcp-tools --category Scoring           Filter by category
  danteforge mcp-tools --query lessons              Substring filter
  danteforge mcp-tools danteforge_score --json      Detailed schema for one tool
`)
  .action((name: string | undefined, opts) => {
    void (async () => {
      try {
        const { runMcpTools } = await import('./commands/mcp-tools.js');
        await runMcpTools(name, {
          json: opts.json as boolean | undefined,
          category: opts.category as string | undefined,
          query: opts.query as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'mcp-tools');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('error-lookup [code]')
  .description('Look up DanteForge error codes (DF-SETUP-001, etc.) and their remedies. List all codes with no argument.')
  .option('--json', 'Output machine-readable JSON')
  .option('--category <name>', 'Filter by category: setup | config | workflow | execution | verification')
  .addHelpText('after', `
Examples:
  danteforge error-lookup                         List all known DF-* error codes
  danteforge error-lookup DF-SETUP-002            Show details for a specific code
  danteforge error-lookup --category workflow     Filter by category
  danteforge error-lookup DF-SETUP-002 --json     Machine-readable output
`)
  .action((code: string | undefined, opts) => {
    void (async () => {
      try {
        const { runErrorLookup } = await import('./commands/error-lookup.js');
        await runErrorLookup(code, {
          json: opts.json as boolean | undefined,
          category: opts.category as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'error-lookup');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('code-health')
  .description('Maintainability report — LOC, JSDoc coverage, TODO markers. Exits 1 on hard-cap or coverage violations.')
  .option('--json', 'Output machine-readable JSON')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge code-health                Show maintainability report
  danteforge code-health --json         Machine-readable for CI
`)
  .action((opts) => {
    void (async () => {
      try {
        const { runCodeHealth } = await import('./commands/code-health.js');
        await runCodeHealth({
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'code-health');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('harness [subcommand]')
  .description('AI coding assistant harness — detect Claude Code/Codex/DanteCode and generate per-assistant briefs')
  .option('--for <name>', 'Target assistant for brief: claude-code | codex | dantecode')
  .option('--output <path>', 'Write brief to file instead of stdout')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Subcommands:
  status                          Show detected assistants and harness state (default)
  brief                           Generate a session brief for the receiving assistant

Examples:
  danteforge harness                          Show which assistants are detected
  danteforge harness brief --for claude-code  Print a Claude Code session brief
  danteforge harness brief --for codex --output .codex/BRIEF.md
`)
  .action((subcommand: string | undefined, opts) => {
    void (async () => {
      try {
        const { runHarness } = await import('./commands/harness.js');
        await runHarness(subcommand, {
          for: opts.for as 'claude-code' | 'codex' | 'dantecode' | undefined,
          output: opts.output as string | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'harness');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('changelog')
  .description('Auto-generate CHANGELOG entries from git conventional commits')
  .option('--from <ref>', 'Starting git ref (default: last tag)')
  .option('--to <ref>', 'Ending git ref (default: HEAD)', 'HEAD')
  .option('--version <label>', 'Version label for the entry (default: YYYY-MM-DD-next)')
  .option('--append', 'Append to CHANGELOG.md instead of showing dry-run')
  .option('--dry', 'Print the entry without writing (default)', true)
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge changelog                     Show what would be added (dry-run)
  danteforge changelog --version 0.6.0 --append   Append to CHANGELOG.md
  danteforge changelog --from v0.5.0 --to v0.6.0  Specific range
`)
  .action((opts) => {
    void (async () => {
      try {
        const { runChangelog } = await import('./commands/changelog.js');
        await runChangelog({
          from: opts.from as string | undefined,
          to: opts.to as string | undefined,
          version: opts.version as string | undefined,
          append: opts.append as boolean | undefined,
          dry: !opts.append,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'changelog');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('prime')
  .description('Generate .danteforge/PRIME.md -- 200-word session brief for Claude Code')
  .option('--copy', 'Show clipboard copy hint after writing')
  .action((opts) => {
    void (async () => {
      try {
        const { prime } = await import('./commands/prime.js');
        await prime({ copy: opts.copy as boolean | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'prime');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('teach <correction>')
  .description('Capture an AI correction into lessons.md and auto-update PRIME.md')
  .action((correction) => {
    void (async () => {
      try {
        const { teach } = await import('./commands/teach.js');
        await teach({ correction });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'teach');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('go [goal]')
  .alias('start')
  .description('Smart entry point: shows project state on existing projects, setup wizard on first run')
  .option('--yes', 'Skip confirmation and run immediately')
  .option('--simple', 'Show only core project quality gaps (hides meta/ecosystem dimensions)')
  .option('--status', 'Show status panel only — no wizard, no improvement offer')
  .option('--fresh', 'Force full setup wizard even when a project already exists')
  .option('--journey', 'Show 5 workflow journey templates and exit')
  .option('--advanced', 'Run init with IDE auto-detection and adversarial scoring setup')
  .addHelpText('after', `
Examples:
  danteforge go                     Show current project state (score, gaps, next step)
  danteforge go --status            State panel only — no improvement offer
  danteforge go --yes               Skip confirmation, run one improvement cycle immediately
  danteforge go "improve security"  Target a specific dimension in the improvement cycle
  danteforge go --simple            Show only core quality gaps (no meta/ecosystem noise)
  danteforge go --fresh             Re-run first-time setup wizard
  danteforge go --journey           Show 5 workflow templates to pick the right flow
`)
  .action((goal, opts) => {
    void (async () => {
      try {
        const { go } = await import('./commands/go.js');
        await go({
          goal: goal as string | undefined,
          yes: opts.yes as boolean | undefined,
          simple: opts.simple as boolean | undefined,
          status: opts.status as boolean | undefined,
          fresh: opts.fresh as boolean | undefined,
          journey: opts.journey as boolean | undefined,
          advanced: opts.advanced as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'go');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('quickstart [idea]')
  .description('Guided 5-minute setup: init -> constitution -> first spark -> quality score')
  .option('--simple', 'Template-based setup -- no LLM needed, under 90 seconds')
  .option('--non-interactive', 'Skip all prompts (for CI or scripted flows)')
  .action((idea, opts) => {
    void (async () => {
      try {
        const { quickstart } = await import('./commands/quickstart.js');
        await quickstart({
          idea: idea as string | undefined,
          simple: opts.simple as boolean | undefined,
          nonInteractive: opts.nonInteractive as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'quickstart');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('community')
  .description('Assess community adoption readiness and optionally generate contributor/onboarding docs')
  .option('--fix', 'Generate the community adoption pack for missing local surfaces')
  .option('--json', 'Output machine-readable JSON')
  .option('--fail-below <percent>', 'Exit non-zero when readiness is below this percentage')
  .option('--cwd <path>', 'Project directory')
  .addHelpText('after', `
Examples:
  danteforge community
  danteforge community --fix
  danteforge community --json --fail-below 80
`)
  .action(async (opts) => {
    try {
      const { community } = await import('./commands/community.js');
      const failBelow = opts.failBelow === undefined ? undefined : parseFloat(opts.failBelow as string);
      const result = await community({
        cwd: opts.cwd as string | undefined,
        fix: opts.fix as boolean | undefined,
        json: opts.json as boolean | undefined,
        failBelow,
      });
      if (!result.passed) process.exitCode = 1;
    } catch (err) {
      const { formatAndLogError } = await import('../core/format-error.js');
      formatAndLogError(err, 'community');
      process.exitCode = 1;
    }
  });

program
  .command('compliance-report')
  .description('Generate a tamper-evident compliance report — audit trail, RBAC, evidence chain')
  .option('--format <fmt>', 'Output format: markdown or json', 'markdown')
  .option('--since <date>', 'Only include events since this date (YYYY-MM-DD)')
  .option('--out <file>', 'Write report to file (default: stdout)')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    try {
      const { runComplianceReport } = await import('./commands/compliance-report.js');
      await runComplianceReport({ format: opts.format, since: opts.since, out: opts.out, cwd: opts.cwd });
    } catch (err) {
      const { formatAndLogError } = await import('../core/format-error.js');
      formatAndLogError(err, 'compliance-report');
      process.exitCode = 1;
    }
  });

program
  .command('harvest-pattern <pattern>')
  .description('Focused OSS pattern harvest with Y/N confirmation per gap')
  .option('--max-repos <n>', 'Max repos to search (default: 5)', '5')
  .option('--url <github-url>', 'Target a specific GitHub repo URL directly (bypass search)')
  .action((pattern, opts) => {
    void (async () => {
      try {
        const { harvestPattern } = await import('./commands/harvest-pattern.js');
        await harvestPattern({
          pattern,
          maxRepos: parseInt(opts.maxRepos as string, 10),
          url: opts.url as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'harvest-pattern');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('build <spec>')
  .description('Execute product work. --level selects depth: light=forge, standard=magic, deep=inferno. Without --level runs the full spec-to-ship wizard.')
  .option('--level <level>', 'Canonical intensity: light | standard | deep')
  .option('--resume', 'Resume from .danteforge/checkpoint.json')
  .option('--target <score>', 'Loop until displayScore >= target (self-improve with plateau detection)')
  .option('--adversarial', 'Enable adversarial score gate between cycles')
  .option('--interactive', 'Confirm before each stage (wizard mode only)')
  .option('--profile <type>', 'quality | balanced | budget', 'balanced')
  .option('--prompt', 'Generate copy-paste prompt instead of executing')
  .option('--worktree', 'Run in an isolated git worktree')
  .option('--isolation', 'Use isolation when preset escalates into party mode')
  .option('--max-repos <n>', 'Max repos for deep OSS harvest', '12')
  .option('--yes', 'Skip competitive matrix confirmation gate')
  .action(async (spec, opts) => {
    if (opts.level || opts.resume || opts.target !== undefined || opts.adversarial) {
      return (await C()).canonicalBuild(spec as string, {
        level: opts.level as string | undefined,
        prompt: opts.prompt as boolean | undefined,
        profile: opts.profile as string | undefined,
        worktree: opts.worktree as boolean | undefined,
        isolation: opts.isolation as boolean | undefined,
        maxRepos: opts.maxRepos ? parseInt(opts.maxRepos as string, 10) : undefined,
        yes: opts.yes as boolean | undefined,
        resume: opts.resume as boolean | undefined,
        target: opts.target !== undefined ? parseFloat(opts.target as string) : undefined,
        adversarial: opts.adversarial as boolean | undefined,
      });
    }
    void (async () => {
      try {
        const { build } = await import('./commands/build.js');
        await build({ spec: spec as string, interactive: opts.interactive as boolean | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'build');
        process.exitCode = 1;
      }
    })();
  });
}
