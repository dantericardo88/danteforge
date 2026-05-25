import type { Command } from 'commander';
import { logger } from '../core/logger.js';
import { formatAndLogError } from '../core/format-error.js';
import { addCwdOption, addJsonOption } from './shared-options.js';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerWikiCmds(program: Command, C: () => Promise<Commands>): void {
addCwdOption(program
  .command('wiki-ingest')
  .description('Ingest raw source files into compiled wiki entity pages')
  .option('--bootstrap', 'Seed wiki from existing .danteforge/ artifacts')
  .option('--prompt', 'Show the command without executing'))
  .action(async (opts) => { void (await C()).wikiIngestCommand({
    bootstrap: opts.bootstrap,
    prompt: opts.prompt,
    cwd: opts.cwd,
  }); });

addCwdOption(program
  .command('wiki-lint')
  .description('Run self-evolution scan: contradictions, staleness, link integrity, pattern synthesis')
  .option('--heuristic-only', 'Skip LLM calls (zero-cost mode)')
  .option('--prompt', 'Show the command without executing'))
  .action(async (opts) => { void (await C()).wikiLintCommand({
    heuristicOnly: opts.heuristicOnly,
    prompt: opts.prompt,
    cwd: opts.cwd,
  }); });

addCwdOption(addJsonOption(program
  .command('wiki-query <topic>')
  .description('Search wiki for entity pages, decisions, and patterns relevant to a topic')))
  .action(async (topic, opts) => { void (await C()).wikiQueryCommand({
    topic,
    json: opts.json,
    cwd: opts.cwd,
  }); });

addCwdOption(addJsonOption(program
  .command('wiki-status')
  .description('Display wiki health metrics: pages, link density, staleness, lint pass rate, anomalies')))
  .action(async (opts) => { void (await C()).wikiStatusCommand({
    json: opts.json,
    cwd: opts.cwd,
  }); });

program
  .command('wiki-export')
  .description('Export compiled wiki as Obsidian vault or static HTML')
  .option('--format <type>', 'Export format: obsidian or html (default: obsidian)', 'obsidian')
  .option('--out <dir>', 'Output directory path')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => { void (await C()).wikiExportCommand({
    format: opts.format as 'obsidian' | 'html',
    out: opts.out,
    cwd: opts.cwd,
  }); });

program
  .command('self-assess')
  .description('Capture machine-verifiable quality metrics for this project and diff against previous baseline')
  .option('--llm-score <n>', 'LLM-assigned quality score to blend with objective metrics (default: 7.0)', '7.0')
  .option('--no-compare', 'Skip comparison against previous baseline')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    (async () => {
      try {
        const { runSelfAssess } = await import('./commands/self-assess.js');
        await runSelfAssess({
          llmScore: parseFloat(opts.llmScore ?? '7.0'),
          compareBaseline: opts.compare !== false,
          cwd: opts.cwd,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'self-assess');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('share-patterns')
  .description('Export anonymised pattern attribution data as a portable bundle for team sharing')
  .option('--min-samples <n>', 'Minimum adoption samples to include a pattern (default: 1)', '1')
  .option('--cwd <path>', 'Project directory')
  .action(async (opts) => {
    (async () => {
      try {
        const { runSharePatterns } = await import('./commands/share-patterns.js');
        await runSharePatterns({
          minSamples: parseInt(opts.minSamples ?? '1', 10),
          cwd: opts.cwd,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'share-patterns');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('import-patterns <bundle-file>')
  .description('Import a shared pattern bundle into the local global pattern library')
  .option('--trust-factor <n>', 'Trust weight for imported evidence (default: 0.5)', '0.5')
  .option('--cwd <path>', 'Project directory')
  .action(async (bundleFile, opts) => {
    (async () => {
      try {
        const { runImportPatterns } = await import('./commands/import-patterns.js');
        await runImportPatterns(bundleFile, {
          trustFactor: parseFloat(opts.trustFactor ?? '0.5'),
          cwd: opts.cwd,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'import-patterns');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('ci-report')
  .description('Run CI attribution gate: capture metrics, diff vs baseline, attribute regressions to recently adopted patterns')
  .option('--window <days>', 'Days back to attribute regressions', '7')
  .option('--threshold <score>', 'Score drop that triggers failure', '0.5')
  .option('--no-update', 'Do not update the baseline snapshot after running')
  .action(async (_opts) => {
    (async () => {
      try {
        const { runCIReportCommand } = await import('./commands/ci-report.js');
        await runCIReportCommand({
          cwd: process.cwd(),
          window: parseInt(_opts.window ?? '7'),
          threshold: parseFloat(_opts.threshold ?? '0.5'),
          noUpdate: !_opts.update,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'ci-report');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('external-validate <projects...>')
  .description('Validate DanteForge quality metrics against external open-source projects (calibration check)')
  .option('--tier <mapping>', 'Comma-separated label:tier pairs e.g. lodash:high,underscore:medium')
  .action(async (projectUrls: string[], _opts) => {
    (async () => {
      try {
        const { runExternalValidation } = await import('./commands/external-validate.js');
        const tierMap: Record<string, 'high' | 'medium' | 'low'> = {};
        if (_opts.tier) {
          for (const pair of (_opts.tier as string).split(',')) {
            const [label, tier] = pair.split(':');
            if (label && tier) tierMap[label.trim()] = tier.trim() as 'high' | 'medium' | 'low';
          }
        }
        const projects = projectUrls.map(url => {
          const label = url.split('/').pop() ?? url;
          return { label, url, expectedTier: tierMap[label] ?? 'medium' as const };
        });
        const report = await runExternalValidation(projects, { cwd: process.cwd() });
        for (const line of report.summary) {
          const { logger } = await import('../core/logger.js');
          logger.info(line);
        }
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'external-validate');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('self-mutate')
  .description('Run mutation testing on DanteForge\'s own core files to validate test quality. Reports per-file mutation score and overall gate pass/fail.')
  .option('--min-score <n>', 'Minimum mutation score to pass gate (0-1)', '0.6')
  .option('--max-mutants <n>', 'Max mutants tested per file', '10')
  .action(async (_opts) => {
    (async () => {
      try {
        const { runSelfMutate } = await import('./commands/self-mutate.js');
        const { logger } = await import('../core/logger.js');
        const result = await runSelfMutate({
          cwd: process.cwd(),
          minMutationScore: parseFloat(_opts.minScore ?? '0.6'),
          maxMutantsPerFile: parseInt(_opts.maxMutants ?? '10'),
        });
        logger.info(`\nSelf-Mutate Results:`);
        for (const f of result.perFile) {
          const icon = f.mutationScore >= 0.7 ? 'âœ"' : f.mutationScore >= 0.5 ? '~' : 'âœ—';
          logger.info(`  ${icon} ${f.file}: ${(f.mutationScore * 100).toFixed(0)}% (${f.killed}/${f.total} killed)`);
        }
        logger.info(`\nOverall mutation score: ${(result.overallScore * 100).toFixed(0)}%`);
        logger.info(`Gate: ${result.gatePass ? 'PASS' : 'FAIL'} (min ${(result.minMutationScore * 100).toFixed(0)}%)`);
        logger.info(`Report: ${result.reportPath}`);
        if (!result.gatePass) process.exitCode = 1;
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'self-mutate');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('refused-patterns')
  .description('List, add, or remove patterns from the refused (blocklist) store')
  .option('--add <name>', 'Manually block a pattern by name')
  .option('--remove <name>', 'Unblock a pattern by name')
  .option('--clear', 'Clear the entire refused-patterns blocklist')
  .action(async (opts) => {
    void (async () => {
      try {
        const { runRefusedPatterns } = await import('./commands/refused-patterns.js');
        await runRefusedPatterns({
          add: opts.add as string | undefined,
          remove: opts.remove as string | undefined,
          clear: opts.clear as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'refused-patterns');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('respec')
  .description('Re-run specification with lessons learned and refused patterns injected')
  .action(async () => {
    void (async () => {
      try {
        const { runRespec } = await import('./commands/respec.js');
        const result = await runRespec();
        if (!result.revised) process.exitCode = 1;
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'respec');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('cross-synthesize')
  .description('Synthesize winning patterns from attribution history to escape a plateau')
  .option('--window <n>', 'Number of recent attribution records to analyze (default: 10)', '10')
  .action(async (opts) => {
    void (async () => {
      try {
        const { runCrossSynthesize } = await import('./commands/cross-synthesize.js');
        const result = await runCrossSynthesize({ window: parseInt(opts.window as string, 10) });
        if (!result.written) process.exitCode = 1;
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'cross-synthesize');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('flow')
  .description('Show the 5 DanteForge workflows and what to run next')
  .option('--interactive', 'Get a personalized workflow recommendation')
  .action(async (opts) => {
    void (async () => {
      try {
        const { runFlow } = await import('./commands/flow.js');
        await runFlow({ interactive: opts.interactive as boolean | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'flow');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('guide')
  .description('Generate a project-specific guide at .danteforge/GUIDE.md')
  .action(async () => {
    void (async () => {
      try {
        const { runGuide } = await import('./commands/guide.js');
        const result = await runGuide();
        logger.info(`Guide written: ${result.guidePath}`);
        logger.info('Load in Claude Code: @.danteforge/GUIDE.md');
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'guide');
        process.exitCode = 1;
      }
    })();
  });
}
