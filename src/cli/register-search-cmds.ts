import type { Command } from 'commander';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerSearchCmds(program: Command, _C: () => Promise<Commands>): void {
// ── search (Phase L) ────────────────────────────────────────────────────────

const searchCmd = program
  .command('search')
  .description('Native code-search primitive (Phase L of docs/PRDs/autonomous-frontier-reaching.md).')
  .addHelpText('after', `
Subcommands:
  index                       Build or refresh the code-search index
  find <regex>                Pattern search
  symbol <name>               Symbol declaration lookup
  imports <symbol>            Find production imports of a symbol
  orphans                     Wraps orphan-audit using SearchEngine
  benchmark                   Compare native vs ripgrep engines

Examples:
  danteforge search find "TODO"
  danteforge search symbol createSearchEngine
  danteforge search imports loadMatrix
  danteforge search orphans --json
`);

searchCmd.command('index')
  .description('Build or refresh the search index')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .option('--engine <name>', 'auto | native | ripgrep')
  .action((opts) => {
    void (async () => {
      try {
        const { runSearchIndex } = await import('./commands/search.js');
        await runSearchIndex({
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
          engine: opts.engine as 'auto' | 'native' | 'ripgrep' | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'search index');
        process.exitCode = 1;
      }
    })();
  });

searchCmd.command('find <pattern>')
  .description('Pattern (regex) search')
  .option('--glob <g>', 'Restrict to a file glob')
  .option('--include-tests', 'Include test files in results')
  .option('--max-results <n>', 'Maximum matches to return', '1000')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .option('--engine <name>', 'auto | native | ripgrep')
  .action((pattern: string, opts) => {
    void (async () => {
      try {
        const { runSearchFind } = await import('./commands/search.js');
        await runSearchFind(pattern, {
          glob: opts.glob as string | undefined,
          includeTests: opts.includeTests as boolean | undefined,
          maxResults: opts.maxResults ? parseInt(opts.maxResults as string, 10) : undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
          engine: opts.engine as 'auto' | 'native' | 'ripgrep' | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'search find');
        process.exitCode = 1;
      }
    })();
  });

searchCmd.command('symbol <name>')
  .description('Find declarations of a symbol')
  .option('--glob <g>', 'Restrict to a file glob')
  .option('--include-tests', 'Include test files in results')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .option('--engine <name>', 'auto | native | ripgrep')
  .action((name: string, opts) => {
    void (async () => {
      try {
        const { runSearchSymbol } = await import('./commands/search.js');
        await runSearchSymbol(name, {
          glob: opts.glob as string | undefined,
          includeTests: opts.includeTests as boolean | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
          engine: opts.engine as 'auto' | 'native' | 'ripgrep' | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'search symbol');
        process.exitCode = 1;
      }
    })();
  });

searchCmd.command('imports <symbol>')
  .description('Find production imports of a symbol')
  .option('--include-tests', 'Include test files in results')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .option('--engine <name>', 'auto | native | ripgrep')
  .action((symbol: string, opts) => {
    void (async () => {
      try {
        const { runSearchImports } = await import('./commands/search.js');
        await runSearchImports(symbol, {
          includeTests: opts.includeTests as boolean | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
          engine: opts.engine as 'auto' | 'native' | 'ripgrep' | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'search imports');
        process.exitCode = 1;
      }
    })();
  });

searchCmd.command('orphans')
  .description('Wraps orphan-audit using SearchEngine')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((opts) => {
    void (async () => {
      try {
        const { runSearchOrphans } = await import('./commands/search.js');
        const result = await runSearchOrphans({
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
        if (result.orphans.length > 0) process.exitCode = 1;
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'search orphans');
        process.exitCode = 1;
      }
    })();
  });

searchCmd.command('benchmark')
  .description('Compare native vs ripgrep engine performance')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((opts) => {
    void (async () => {
      try {
        const { runSearchBenchmark } = await import('./commands/search.js');
        await runSearchBenchmark({
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'search benchmark');
        process.exitCode = 1;
      }
    })();
  });

searchCmd.command('hybrid <query...>')
  .description('Phase L.3 hybrid retrieval: BM25 candidates → transformer-embedding rerank (downloads ~80MB on first run).')
  .option('--top-k <n>', 'Number of final hits to return (default 10)', '10')
  .option('--candidate-k <n>', 'BM25 candidate pool size (default 50)', '50')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((queryParts: string[], opts) => {
    void (async () => {
      try {
        const { runSearchHybrid } = await import('./commands/search.js');
        await runSearchHybrid(queryParts.join(' '), {
          topK: parseInt(opts.topK as string, 10),
          candidateK: parseInt(opts.candidateK as string, 10),
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'search hybrid');
        process.exitCode = 1;
      }
    })();
  });

// ── research (Phase N-Q) ────────────────────────────────────────────────────

const researchCmd = program
  .command('research')
  .description('Research-mode crusade infrastructure (Phase N-Q of docs/PRDs/autonomous-frontier-reaching.md).')
  .addHelpText('after', `
Subcommands (read-only):
  status                      Show project-wide research summary
  history <dim>               Show prior research waves for a dim
  caps                        List dims marked architecturally capped

Subcommands (deferred to Phase O):
  resolve <wave-id>           Operator resolution of a conflict (refuses until Phase O)
  replay <wave-id>            Replay a wave from artifacts (refuses until Phase O)

Examples:
  danteforge research status --json
  danteforge research history testing
  danteforge research caps
`);

researchCmd.command('status')
  .description('Show research summary')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((opts) => {
    void (async () => {
      try {
        const { runResearchStatus } = await import('./commands/research.js');
        await runResearchStatus({ json: opts.json as boolean | undefined, cwd: opts.cwd as string | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'research status');
        process.exitCode = 1;
      }
    })();
  });

researchCmd.command('history <dimensionId>')
  .description('Show prior research waves for a dimension')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((dimensionId: string, opts) => {
    void (async () => {
      try {
        const { runResearchHistory } = await import('./commands/research.js');
        await runResearchHistory(dimensionId, { json: opts.json as boolean | undefined, cwd: opts.cwd as string | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'research history');
        process.exitCode = 1;
      }
    })();
  });

researchCmd.command('caps')
  .description('List dims marked architecturally capped')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((opts) => {
    void (async () => {
      try {
        const { runResearchCaps } = await import('./commands/research.js');
        await runResearchCaps({ json: opts.json as boolean | undefined, cwd: opts.cwd as string | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'research caps');
        process.exitCode = 1;
      }
    })();
  });

researchCmd.command('start <dimensionId>')
  .description('Run a research wave for a dimension (Phase O parallel-agent dispatch).')
  .option('--force', 'Force activation even when criteria fail (audit-logged)')
  .option('--real-agents', 'Dispatch real Claude Code subprocesses per role (consumes operator LLM quota). Default: mocked-by-default fixture outputs')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((dimensionId: string, opts) => {
    void (async () => {
      try {
        const { runResearchStart } = await import('./commands/research.js');
        await runResearchStart(dimensionId, {
          force: opts.force as boolean | undefined,
          realAgents: opts.realAgents as boolean | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'research start');
        process.exitCode = 1;
      }
    })();
  });

researchCmd.command('resolve <waveId>')
  .description('Operator resolution of a wave verdict (PROMOTE | CONFLICT | CAP)')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((waveId: string, opts) => {
    void (async () => {
      try {
        const { runResearchResolve } = await import('./commands/research.js');
        await runResearchResolve(waveId, {
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'research resolve');
        process.exitCode = 1;
      }
    })();
  });

researchCmd.command('replay <waveId>')
  .description('Re-run deterministic synthesis on an existing wave\'s artifacts')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((waveId: string, opts) => {
    void (async () => {
      try {
        const { runResearchReplay } = await import('./commands/research.js');
        await runResearchReplay(waveId, { cwd: opts.cwd as string | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'research replay');
        process.exitCode = 1;
      }
    })();
  });
}
