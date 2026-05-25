import type { Command } from 'commander';
import { formatAndLogError } from '../core/format-error.js';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerCorePipelineCmds(program: Command, C: () => Promise<Commands>): void {
program
  .command('status')
  .description('Show convergence dashboard: dimensions, cost, OSS harvest stats, next cycle plan')
  .action(async () => {
    const { status, renderStatus } = await import('./commands/status.js');
    const report = await status();
    console.log(renderStatus(report));
  });

program
  .command('local-harvest [paths...]')
  .description('Harvest patterns from local private repos, folders, and zip archives')
  .option('--config <path>', 'YAML config file listing sources (.danteforge/local-sources.yaml)')
  .option('--depth <level>', 'shallow | medium | full (default: medium)', 'medium')
  .option('--prompt', 'Show harvest plan without executing')
  .option('--dry-run', 'Detect source types without reading')
  .option('--max-sources <n>', 'Maximum sources to analyze (default: 5)', '5')
  .action(async (paths, opts) => (await C()).localHarvest(paths ?? [], {
    config: opts.config,
    depth: opts.depth,
    prompt: opts.prompt,
    dryRun: opts.dryRun,
    maxSources: parseInt(opts.maxSources, 10),
  }));

program
  .command('autoresearch <goal>')
  .description('Autonomous metric-driven optimization loop â€" plan, rewrite, execute, evaluate, keep winners')
  .option('--metric <metric>', 'How to measure success (e.g., "startup time ms", "bundle size KB")')
  .option('--measurement-command <command>', 'Explicit command that prints the metric as a number')
  .option('--time <budget>', 'Time budget (e.g., "4h", "30m")', '4h')
  .option('--prompt', 'Generate a copy-paste prompt instead of executing')
  .option('--dry-run', 'Show the experiment plan without running')
  .option('--allow-dirty', 'Allow execution on a dirty git working tree (unsafe; disabled by default)')
  .action(async (goal, opts) => (await C()).autoResearch(goal, {
    metric: opts.metric,
    measurementCommand: opts.measurementCommand,
    time: opts.time,
    prompt: opts.prompt,
    dryRun: opts.dryRun,
    allowDirty: opts.allowDirty,
  }));

program
  .command('harvest [goal]')
  .description('Discover and learn from OSS patterns. --level selects depth: light=focused pattern, standard=bounded OSS pass, deep=OSS+local+universe refresh.')
  .option('--level <level>', 'Canonical intensity: light | standard | deep')
  .option('--source <type>', 'Source type: oss | local | mixed (default: oss)')
  .option('--max-repos <n>', 'Max repos for OSS harvest', '8')
  .option('--depth <level>', 'Local harvest depth: shallow | medium | full', 'medium')
  .option('--until-saturation', 'deep only: loop OSS cycles until new-feature yield drops (two consecutive lean cycles stops the loop)')
  .option('--max-cycles <n>', 'Max cycles for --until-saturation (default: 5)', '5')
  .option('--saturation-threshold <n>', 'Min new features per cycle before cycle is "lean" (default: 3)', '3')
  .option('--optimize <metric>', 'Metric-driven mode: run autoresearch targeting this metric (noise-margin aware)')
  .option('--prompt', 'Display the 5-step copy-paste template without calling the LLM')
  .option('--lite', 'Run in SEP-LITE mode (Steps 1-3 + 5 only, 2-3 donors, 2-4 organs)')
  .action(async (goal, opts) => {
    if (opts.level || opts.optimize) {
      return (await C()).canonicalHarvest(goal as string | undefined, {
        level: opts.level as string | undefined,
        source: opts.source as string | undefined,
        maxRepos: opts.maxRepos ? parseInt(opts.maxRepos as string, 10) : undefined,
        prompt: opts.prompt as boolean | undefined,
        depth: opts.depth as string | undefined,
        untilSaturation: opts.untilSaturation as boolean | undefined,
        maxCycles: opts.maxCycles ? parseInt(opts.maxCycles as string, 10) : undefined,
        saturationThreshold: opts.saturationThreshold ? parseInt(opts.saturationThreshold as string, 10) : undefined,
        optimize: opts.optimize as string | undefined,
      });
    }
    return (await C()).harvest(goal as string ?? '', { prompt: opts.prompt as boolean | undefined, lite: opts.lite as boolean | undefined });
  });

program
  .command('premium [subcommand]')
  .description('Manage premium tier, license, and audit trail')
  .option('--key <key>', 'License key for activation')
  .option('--tier <tier>', 'License tier for keygen: pro or enterprise', 'pro')
  .option('--days <n>', 'Days until expiry for keygen (default: 365)', '365')
  .action(async (subcommand, opts) => (await C()).premium(subcommand ?? 'status', { key: opts.key, tier: opts.tier, days: opts.days }));

program
  .command('mcp-server')
  .description('Start DanteForge MCP server over stdio — for Claude Code, Codex, Cursor')
  .action(async () => {
    // Direct dynamic import: MCP server has a large dependency graph (SDK,
    // all MCP tool handlers). Importing it only when explicitly invoked
    // keeps --help / --version / score at minimal startup cost.
    const { mcpServer } = await import('./commands/mcp-server.js');
    await mcpServer();
  });

program
  .command('publish-check')
  .description('Pre-publish validation gate â€" 12 parallel checks before npm publish')
  .option('--json', 'Output machine-readable JSON')
  .action(async (opts) => (await C()).publishCheck({ json: opts.json }));

program
  .command('proof')
  .description('Proof of value â€" raw prompt vs structured artifacts, or pipeline/convergence evidence report')
  .option('--prompt <text>', 'Raw prompt to compare against structured artifacts')
  .option('--pipeline', 'Generate structured pipeline execution evidence report')
  .option('--convergence', 'Generate structured convergence & self-healing evidence report')
  .option('--verify <file>', 'Verify an evidence-chain receipt, bundle, chain, or proof-bearing JSON file')
  .option('--verify-all <dir>', 'Recursively verify every receipt under <dir>; report corpus integrity stats')
  .option('--skip-git', 'Skip current git SHA binding check during proof verification')
  .option('--strict-git-binding', 'Require manifest gitSha to equal HEAD (snapshot mode); default is ancestor continuity')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .option('--semantic', 'LLM-enhanced PDSE scoring')
  .option('--since <date>', 'Score arc since date or git SHA (e.g. "yesterday", "2026-04-01", a commit SHA)')
  .option('--summary', 'Human-readable agent activity provenance summary')
  .action(async (opts) => (await C()).proof({ prompt: opts.prompt, pipeline: opts.pipeline, convergence: opts.convergence, verify: opts.verify, verifyAll: opts.verifyAll, skipGit: opts.skipGit, strictGitBinding: opts.strictGitBinding, cwd: opts.cwd, semantic: opts.semantic, since: opts.since, summary: opts.summary }));

program
  .command('integration-health')
  .description('Check integration health: git remote, LLM provider, STATE.yaml freshness, MCP surface')
  .option('--json', 'Output results as JSON to stdout')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action(async (opts) => (await C()).integrationHealth({ json: opts.json, cwd: opts.cwd }));

program
  .command('error-rate')
  .description('Show error frequency from .danteforge/error-log.jsonl — total, top codes, most-failing commands')
  .option('--window <minutes>', 'Time window in minutes (default: 60)', parseInt)
  .option('--json', 'Output machine-readable JSON')
  .option('--clear', 'Clear the error log')
  .option('--watch', 'Tail the log live — polls every 2 seconds, prints new entries')
  .addHelpText('after', `
Examples:
  danteforge error-rate                 Show errors from the last 60 minutes
  danteforge error-rate --window 1440   Show last 24 hours
  danteforge error-rate --json          Machine-readable JSON output
  danteforge error-rate --clear         Reset the error log
  danteforge error-rate --watch         Live tail (Ctrl+C to stop)
`)
  .action(async (opts) => {
    try {
      const { errorRate } = await import('./commands/error-rate.js');
      await errorRate({
        window: opts.window as number | undefined,
        json: opts.json as boolean | undefined,
        clear: opts.clear as boolean | undefined,
        watch: opts.watch as boolean | undefined,
      });
    } catch (err) {
      const { formatAndLogError } = await import('../core/format-error.js');
      formatAndLogError(err, 'error-rate');
      process.exitCode = 1;
    }
  });

program
  .command('pipeline-status')
  .description('Show spec-driven pipeline health: stage timeline, spec drift, and spec quality score')
  .option('--json', 'Output machine-readable JSON')
  .option('--cwd <path>', 'Project root directory (defaults to cwd)')
  .action(async (opts) => { await (await C()).pipelineStatus({ json: opts.json as boolean | undefined, cwd: opts.cwd as string | undefined }); });

program
  .command('startup-bench')
  .description('Measure CLI startup latency — runs --version N times, reports min/max/mean/p95, saves .danteforge/startup-bench.json')
  .option('--iterations <n>', 'Number of timed runs (default: 10)', '10')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge startup-bench                  Run 10 iterations and show results
  danteforge startup-bench --iterations 5   Run 5 iterations (faster, less stable)
  DANTEFORGE_PERF=1 danteforge --version    Print startup time for a single run
`)
  .action(async (opts) => {
    try {
      const { runStartupBench } = await import('./commands/startup-bench.js');
      const result = await runStartupBench({
        iterations: parseInt(opts.iterations as string, 10),
        cwd: opts.cwd as string | undefined,
      });
      process.exitCode = result.exitCode;
    } catch (err) {
      formatAndLogError(err, 'startup-bench');
      process.exitCode = 1;
    }
  });

program
  .command('batch-check')
  .description('Per-file quality scan: lines, JSDoc coverage, any-type usage, TODO count')
  .option('--pattern <glob>', 'Glob pattern for files to check (default: src/**/*.ts)')
  .option('--min-score <n>', 'Exit 1 if any file scores below N (0-10)', parseFloat)
  .option('--json', 'Output machine-readable JSON')
  .option('--cwd <path>', 'Project root directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge batch-check                          # scan all src/**/*.ts
  danteforge batch-check --min-score 7            # fail if any file scores below 7
  danteforge batch-check --pattern "tests/**/*.ts" --json
  danteforge batch-check --cwd /path/to/project`)
  .action(async (opts) => {
    try {
      const { batchCheck } = await import('./commands/batch-check.js');
      const result = await batchCheck({
        pattern: opts.pattern as string | undefined,
        minScore: opts.minScore as number | undefined,
        json: opts.json as boolean | undefined,
        cwd: opts.cwd as string | undefined,
      });
      if (!result.passed) process.exitCode = 1;
    } catch (err) {
      formatAndLogError(err, 'batch-check');
      process.exitCode = 1;
    }
  });

program
  .command('run-pipeline')
  .description('Full unattended pipeline: specify, clarify, plan, tasks, forge, verify')
  .option('--spec <idea>', 'Idea or path to seed the specify stage')
  .option('--yes', 'Skip all confirmation prompts (fully unattended)')
  .option('--max-phases <n>', 'Maximum forge phases to run (default: 3)', parseInt)
  .option('--cwd <path>', 'Project root directory (defaults to cwd)')
  .action(async (opts) => {
    try {
      const { runPipeline } = await import('./commands/run-pipeline.js');
      const result = await runPipeline({
        spec: opts.spec as string | undefined,
        yes: opts.yes as boolean | undefined,
        maxPhases: opts.maxPhases as number | undefined,
        cwd: opts.cwd as string | undefined,
      });
      if (result.stagesFailed.length > 0) process.exitCode = 1;
    } catch (err) {
      formatAndLogError(err, 'run-pipeline');
      process.exitCode = 1;
    }
  });

program
  .command('export')
  .description('Export project state as a JSON bundle for sharing or backup')
  .option('--output <path>', 'Output file path (default: .danteforge/export-<timestamp>.json)')
  .option('--include-history', 'Include last 3 .danteforge/snapshots/ entries')
  .option('--cwd <path>', 'Project root directory (defaults to cwd)')
  .action(async (opts) => {
    try {
      const { exportState } = await import('./commands/export.js');
      await exportState({
        output: opts.output as string | undefined,
        includeHistory: opts.includeHistory as boolean | undefined,
        cwd: opts.cwd as string | undefined,
      });
    } catch (err) {
      formatAndLogError(err, 'export');
      process.exitCode = 1;
    }
  });

program
  .command('crusade')
  .description('Multi-pass OSS harvest + goal-gated forge loop — runs until score target is reached or max cycles exhausted')
  .requiredOption('--goal <text>', 'The goal to pursue each forge wave')
  .option('--domains <csv>', 'Comma-separated OSS domains to harvest (default: dimension name)')
  .option('--dimension <name>', 'Score dimension to track (default: security)', 'security')
  .option('--target <n>', 'Target score to reach (default: 9.0)', parseFloat)
  .option('--max-cycles <n>', 'Maximum cycles before stopping (default: 10)', parseInt)
  .option('--max-oss-passes <n>', 'Maximum OSS harvest passes per cycle (default: 5)', parseInt)
  .option('--frontier', 'Frontier mode: push N dimensions in parallel to 9+ with autoresearch on stall')
  .option('--parallel <n>', 'Number of parallel dimensions in frontier mode (default: 4)', parseInt)
  .option('--max-dim-cycles <n>', 'Per-dimension cycle cap in frontier mode (default: 15)', parseInt)
  .option('--loop', 'Keep re-ranking and repeating passes until every dimension hits 9+ (fully autonomous)')
  .option('--verify-cap', 'Run capability_test before declaring a dimension done (governed mode)')
  .option('--cwd <path>', 'Working directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge crusade --goal "security hardening" --dimension security --target 9.5
  danteforge crusade --frontier --parallel 4 --loop --verify-cap --goal "Push all dimensions to 9+"
`)
  .action(async (opts) => {
    try {
      if (opts.frontier) {
        const { runFrontierCrusade } = await import('./commands/crusade.js');
        const result = await runFrontierCrusade({
          goal: opts.goal as string,
          parallel: opts.parallel as number | undefined,
          target: opts.target as number | undefined,
          maxDimCycles: opts.maxDimCycles as number | undefined,
          loop: opts.loop as boolean | undefined,
          verifyCap: opts.verifyCap as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
        process.exitCode = result.status === 'ALL_DONE' ? 0 : 2;
      } else {
        const { runCrusade } = await import('./commands/crusade.js');
        const result = await runCrusade({
          goal: opts.goal as string,
          domains: opts.domains as string | undefined,
          dimension: opts.dimension as string | undefined,
          target: opts.target as number | undefined,
          maxCycles: opts.maxCycles as number | undefined,
          maxOssPasses: opts.maxOssPasses as number | undefined,
          cwd: opts.cwd as string | undefined,
        });
        if (result.status === 'CRUSADE_COMPLETE') process.exitCode = 0;
        else if (result.status === 'CRUSADE_MAX_CYCLES') process.exitCode = 2;
        else process.exitCode = 1;
      }
    } catch (err) {
      formatAndLogError(err, 'crusade');
      process.exitCode = 1;
    }
  });

program
  .command('evidence-scaffold')
  .description('Auto-populate capability_test blocks in matrix.json so scores above 5.0 are provable')
  .option('--dry-run', 'Print what would change without writing')
  .option('--project-type <type>', 'Project type: npm (default), go, python, custom')
  .option('--cwd <path>', 'Working directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge evidence-scaffold
  danteforge evidence-scaffold --dry-run
  danteforge evidence-scaffold --project-type go
`)
  .action(async (opts) => {
    try {
      const { runEvidenceScaffold } = await import('./commands/evidence-scaffold.js');
      await runEvidenceScaffold({
        dryRun: opts.dryRun as boolean | undefined,
        projectType: opts.projectType as 'npm' | 'go' | 'python' | 'custom' | undefined,
        cwd: opts.cwd as string | undefined,
      });
    } catch (err) {
      formatAndLogError(err, 'evidence-scaffold');
      process.exitCode = 1;
    }
  });

program
  .command('evidence-audit')
  .description('Show honest score vs evidence picture across all compete-matrix dimensions')
  .option('--run-tests', 'Execute each capability_test live and show real pass/fail')
  .option('--cwd <path>', 'Working directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge evidence-audit
  danteforge evidence-audit --run-tests
`)
  .action(async (opts) => {
    try {
      const { runEvidenceAudit } = await import('./commands/evidence-audit.js');
      const result = await runEvidenceAudit({
        runTests: opts.runTests as boolean | undefined,
        cwd: opts.cwd as string | undefined,
      });
      process.exitCode = result.wouldBeCapped > 0 ? 1 : 0;
    } catch (err) {
      formatAndLogError(err, 'evidence-audit');
      process.exitCode = 1;
    }
  });

program
  .command('security-scan')
  .description('Scan src/**/*.ts for risky patterns: eval, exec, innerHTML, hardcoded keys, Math.random in security contexts')
  .option('--json', 'Output machine-readable JSON')
  .option('--cwd <path>', 'Project root directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge security-scan               Human-readable findings report
  danteforge security-scan --json        Machine-readable JSON output
  danteforge security-scan --cwd /my/project  Scan a specific project
`)
  .action(async (opts) => {
    try {
      const { securityScan } = await import('./commands/security-scan.js');
      await securityScan({
        json: opts.json as boolean | undefined,
        cwd: opts.cwd as string | undefined,
      });
    } catch (err) {
      formatAndLogError(err, 'security-scan');
      process.exitCode = 1;
    }
  });

program
  .command('schedule <command>')
  .description(
    'Run a danteforge command on a recurring interval (foreground, Ctrl+C to stop). ' +
    'Example: danteforge schedule "compete --calibrate" --interval 60 --max-runs 24',
  )
  .requiredOption('--interval <minutes>', 'Minutes between each run', parseFloat)
  .option('--max-runs <n>', 'Maximum number of runs (default: unlimited)', parseInt)
  .option('--log <path>', 'Log file path (default: .danteforge/schedule.log)')
  .option('--cwd <path>', 'Working directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge schedule "compete --calibrate" --interval 60 --max-runs 24
  danteforge schedule "autoforge --auto" --interval 30 --log /tmp/forge.log
`)
  .action(async (command: string, opts) => {
    try {
      const { schedule } = await import('./commands/schedule.js');
      const result = await schedule(command, {
        intervalMinutes: opts.interval as number,
        maxRuns: opts.maxRuns as number | undefined,
        logFile: opts.log as string | undefined,
        cwd: opts.cwd as string | undefined,
      });
      if (result.runsFailed > 0 && result.runsCompleted === result.runsFailed) {
        process.exitCode = 1;
      }
    } catch (err) {
      formatAndLogError(err, 'schedule');
      process.exitCode = 1;
    }
  });
}
