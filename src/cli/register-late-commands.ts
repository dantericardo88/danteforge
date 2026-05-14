import type { Command } from 'commander';
import { logger } from '../core/logger.js';
import { formatAndLogError } from '../core/format-error.js';
import { registerSanitizeCommand } from './register-sanitize-command.js';
import { addCwdOption, addJsonOption } from './shared-options.js';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerLateCommands(program: Command, C: () => Promise<Commands>): void {
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
          const icon = f.mutationScore >= 0.7 ? 'âœ“' : f.mutationScore >= 0.5 ? '~' : 'âœ—';
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

program
  .command('matrix')
  .description('Matrix Development engine: status, claim, propose, merge, and dimension ascent')
  .argument('<action>', 'status | claim | propose | merge | ascend')
  .option('--top <n>', 'number of dimensions to show for status', parseInt, 4)
  .option('--dimension <id-or-number>', 'dimension id, label, or 1-based number')
  .option('--agent <name>', 'agent/tool name for claims, proposals, and merges')
  .option('--score <n>', 'proposed score for propose/ascend', parseFloat)
  .option('--rationale <text>', 'evidence-backed rationale for the proposed score')
  .option('--evidence <path>', 'evidence path; repeat with comma-separated paths for multiple artifacts')
  .option('--policy <policy>', 'harsh-min | latest | manual', 'harsh-min')
  .option('--cwd <path>', 'project directory')
  .action(async (action, opts) => {
    (async () => {
      try {
        const evidence = opts.evidence ? String(opts.evidence).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined;
        const commands = await C();
        const common = {
          cwd: opts.cwd as string | undefined,
          top: opts.top as number | undefined,
          dimension: opts.dimension as string | undefined,
          agent: opts.agent as string | undefined,
          score: opts.score as number | undefined,
          rationale: opts.rationale as string | undefined,
          evidence,
          policy: opts.policy as 'harsh-min' | 'latest' | 'manual',
        };
        if (action === 'status') return commands.matrixStatus(common);
        if (action === 'claim') return commands.matrixClaim(common);
        if (action === 'propose') return commands.matrixPropose(common);
        if (action === 'merge') return commands.matrixMerge(common);
        if (action === 'ascend') return commands.matrixAscend(common);
        throw new Error(`Unknown matrix action: ${action}`);
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'matrix');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('compete')
  .description('Benchmark against peers and close competitive gaps. --level selects depth: light=assess, standard=assess+universe, deep=full CHL loop.')
  .option('--level <level>', 'Canonical intensity: light | standard | deep')
  .option('--raise-ready', 'Raise-readiness: skeptic objection scoring + frontier classification')
  .option('--action <type>', 'Sub-action: add | dossier')
  .option('--name <name>', 'Competitor name for add/dossier sub-actions')
  .option('--refresh', 'Force rebuild of feature universe after assessment')
  .option('--init', 'Bootstrap CHL matrix from a competitor scan (Phase 1: INVENTORY)')
  .option('--sprint', 'Identify top gap and generate /inferno masterplan (Phase 3: SOURCE)')
  .option('--rescore <score>', 'Update dimension score after a sprint, e.g. "ux_polish=7.5" or "ux_polish=7.5,sha"')
  .option('--report', 'Generate full CHL report at .danteforge/compete/COMPETE_REPORT.md')
  .option('--json', 'Machine-readable output')
  .option('--skip-verify', 'Skip verify receipt check (use when certifying without running verify)')
  .option('--validate', 'Cross-check matrix self-scores against latest harsh-scorer assessment')
  .option('--sync-scores', 'Sync all matrix self-scores from the live strict scorer (eliminates drift automatically)')
  .option('--auto', 'Run autonomous sprint+rescore loop (up to 5 cycles, stops when all gaps closed)')
  .option('--remove-competitor <name>', 'Remove a competitor from the matrix and recompute gaps')
  .option('--drop-dimension <id>', 'Remove a scoring dimension from the matrix')
  .option('--exclude <id>', 'De-prioritize a dimension: sprint/work-packet/gap-rank engines skip it but scoring continuity is preserved')
  .option('--include <id>', 'Reverse a previous --exclude: re-enable the dimension for sprints and work-packets')
  .option('--amend <dim_score>', 'Manually set a market dim self-score: dim_id=score (0â€“10), e.g. "semantic_memory=5.5"')
  .option('--amend-file <path>', 'Batch-update market dim scores from a JSON file: { "dim_id": score, ... }')
  .option('--edit', 'Interactive matrix amendment session')
  .option('--reset', 'Replace the competitors array in matrix.json (requires --preset or --use-canonical). Backs up the old matrix first.')
  .option('--use-canonical', 'With --reset: auto-resolve the project preset from package.json / state.project (DanteForge → dev-tool-optimizer; DanteCode → coding-assistant; etc.)')
  .option('--preset <name>', 'With --reset: apply a specific preset. Values: coding-assistant | dev-tool-optimizer | agent-framework')
  .option('--calibrate', 'Run adversarial scorer and apply inflated-verdict corrections to matrix self-scores')
  .option('--check-all-nine', 'Check if all dimensions ≥ target (default 9.0); exits 0=all green, 1=gaps remain. Writes .danteforge/GOAL_STATUS.json for /goal integration.')
  .option('--next-dims <n>', 'Output JSON of N weakest dimensions below target — used by /goal-loop-matrix to feed /matrixdev', parseInt)
  .option('--target <score>', 'Override 9.0 victory threshold for --check-all-nine, --auto, and --next-dims', parseFloat)
  .option('--yes', 'Skip the confirmation gate in --auto mode and --calibrate')
  .addHelpText('after', `
Examples:
  danteforge compete                           Show ranked gap table vs competitors
  danteforge compete --init                    Bootstrap competitor matrix from a scan
  danteforge compete --sprint                  Generate /inferno masterplan for top gap
  danteforge compete --rescore "ux_polish=8.5" Update score after a sprint
  danteforge compete --auto                    Autonomous sprint+rescore loop (5 cycles)
  danteforge compete --check-all-nine          Machine-readable 9.0 victory check (for CI)
  danteforge compete --level deep              Full CHL: assess + universe + sprint loop
  danteforge compete --json                    Machine-readable gap table for scripting
`)
  .action(async (opts) => {
    if (opts.level || opts.raiseReady || opts.action) {
      return (await C()).canonicalCompete({
        level: opts.level as string | undefined,
        json: opts.json as boolean | undefined,
        refresh: opts.refresh as boolean | undefined,
        yes: opts.yes as boolean | undefined,
        raiseReady: opts.raiseReady as boolean | undefined,
        action: opts.action as 'add' | 'dossier' | undefined,
        name: opts.name as string | undefined,
      });
    }
    void (async () => {
      try {
        const { compete } = await import('./commands/compete.js');
        const result = await compete({
          init: opts.init as boolean | undefined,
          sprint: opts.sprint as boolean | undefined,
          rescore: opts.rescore as string | undefined,
          report: opts.report as boolean | undefined,
          json: opts.json as boolean | undefined,
          skipVerify: opts.skipVerify as boolean | undefined,
          validate: opts.validate as boolean | undefined,
          syncScores: opts.syncScores as boolean | undefined,
          auto: opts.auto as boolean | undefined,
          amend: opts.amend as string | undefined,
          amendFile: opts.amendFile as string | undefined,
          removeCompetitor: opts.removeCompetitor as string | undefined,
          dropDimension: opts.dropDimension as string | undefined,
          excludeDimension: opts.exclude as string | undefined,
          includeDimension: opts.include as string | undefined,
          edit: opts.edit as boolean | undefined,
          reset: opts.reset as boolean | undefined,
          useCanonical: opts.useCanonical as boolean | undefined,
          preset: opts.preset as string | undefined,
          calibrate: opts.calibrate as boolean | undefined,
          checkAllNine: opts.checkAllNine as boolean | undefined,
          nextDims: opts.nextDims as number | undefined,
          target: opts.target as number | undefined,
          yes: opts.yes as boolean | undefined,
        });
        if (opts.json) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        }
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'compete');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('peers')
  .description('Diagnose which peer preset is resolved for the current project (and the competitor list /universe + /compete will use). Helps verify scoping when running DanteForge in sibling projects.')
  .option('--preset <name>', 'Print a specific preset\'s list (coding-assistant | dev-tool-optimizer | agent-framework)')
  .option('--all', 'Print every preset\'s list')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory override (default: current dir)')
  .action((opts) => {
    void (async () => {
      try {
        const { peers } = await import('./commands/peers.js');
        await peers({
          cwd: opts.cwd as string | undefined,
          preset: opts.preset as string | undefined,
          showAll: opts.all as boolean | undefined,
          json: opts.json as boolean | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'peers');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('cofl')
  .description('Competitive Operator Forge Loop: 10-phase disciplined system to learn from OSS operator tools, forge improvements, and prove progress vs closed-source leaders')
  .option('--universe', 'Phases 1-2: refresh + partition competitor universe into roles (direct_peer / specialist_teacher / reference_teacher)')
  .option('--harvest', 'Phase 3: extract operator patterns from teacher set (requires LLM)')
  .option('--prioritize', 'Phase 5: rank opportunities by operator leverage score')
  .option('--guards', 'Run all 7 anti-failure guardrail checks')
  .option('--reframe', 'Phase 10: assess strategic position (preferred? coherent? inflating rows?)')
  .option('--report', 'Write COFL_REPORT.md to .danteforge/cofl/')
  .option('--auto', 'Run all phases in sequence (advisory â€” forge step prints recommendation)')
  .option('--dry-run', 'Print plan without executing')
  .option('--json', 'Machine-readable output')
  .action((opts) => {
    void (async () => {
      try {
        const { cofl } = await import('./commands/cofl.js');
        const result = await cofl({
          universe: opts.universe as boolean | undefined,
          harvest: opts.harvest as boolean | undefined,
          prioritize: opts.prioritize as boolean | undefined,
          guards: opts.guards as boolean | undefined,
          reframe: opts.reframe as boolean | undefined,
          report: opts.report as boolean | undefined,
          auto: opts.auto as boolean | undefined,
          dryRun: opts.dryRun as boolean | undefined,
          json: opts.json as boolean | undefined,
        });
        if (opts.json && result) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
        }
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'cofl');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('ascend')
  .alias('auto-improve')
  .description('Autonomous quality ascent: drives all achievable competitive dimensions to target (default 9.0/10)')
  .option('--target <n>', 'target score for all dimensions (0-10)', parseFloat, 9.0)
  .option('--max-cycles <n>', 'max total improvement cycles', parseInt, 60)
  .option('--dry-run', 'print plan without executing')
  .option('--interactive', 'ask questions to define competitive universe (requires TTY)')
  .option('--forge-provider <provider>', 'LLM provider for forge cycles (e.g. claude, grok, openai)')
  .option('--scorer-provider <provider>', 'LLM provider for adversarial critique after each forge cycle')
  .option('--max-dim-retries <n>', 'max times to retry same dimension after critic is unsatisfied (default: 2)', parseInt, 2)
  .option('--adversarial-gating', 'require adversarial score agreement before declaring convergence')
  .option('--adversary-tolerance <n>', 'acceptable gap between self and adversarial score for convergence (default: 0.5)', parseFloat, 0.5)
  .option('--yes', 'Skip the competitive landscape confirmation gate')
  .option('--retro-interval <n>', 'cycles between automatic retro runs during loop (default: 5)', parseInt, 5)
  .option('--no-auto-harvest', 'skip OSS harvest receipt bootstrap at ascend start')
  .option('--no-verify-loop', 'skip mid-loop verify pass before first cycle')
  .option('--advisory', 'write guidance files per dimension without executing forge (preview mode)')
  .action((opts) => {
    void (async () => {
      try {
        const { ascend } = await import('./commands/ascend.js');
        await ascend({
          target: opts.target as number | undefined,
          maxCycles: opts.maxCycles as number | undefined,
          dryRun: opts.dryRun as boolean | undefined,
          interactive: opts.interactive as boolean | undefined,
          forgeProvider: opts.forgeProvider as string | undefined,
          scorerProvider: opts.scorerProvider as string | undefined,
          maxDimRetries: opts.maxDimRetries as number | undefined,
          adversarialGating: opts.adversarialGating as boolean | undefined,
          adversaryTolerance: opts.adversaryTolerance as number | undefined,
          yes: opts.yes as boolean | undefined,
          retroInterval: opts.retroInterval as number | undefined,
          autoHarvest: opts.autoHarvest as boolean | undefined,
          verifyLoop: opts.verifyLoop as boolean | undefined,
          executeMode: opts.advisory ? 'advisory' : 'forge',
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'ascend');
        process.exitCode = 1;
      }
    })();
  });

// Sanitize command extracted to its own file to keep register-late-commands.ts under 750 LOC
registerSanitizeCommand(program);

program
  .command('converge')
  .description('TypeScript-owned convergence loop â€” runs until all dims >= target. No LLM stop/continue.')
  .option('--target <score>', 'Target per dimension (default: 9.0)', parseFloat, 9.0)
  .option('--max-cycles <n>', 'Safety cap on cycles (default: 200)', parseInt, 200)
  .option('--check-only', 'Report pass/fail without improvements (exit 0=pass, 1=fail)')
  .option('--dim <dims>', 'Comma-separated dimension IDs to check (default: all 20)')
  .option('--escalate-after <n>', 'Stuck cycles before party escalation (default: 3)', parseInt, 3)
  .option('--cwd <path>', 'Working directory')
  .action(async (opts) => {
    try {
      const { runConverge } = await import('../core/converge-engine.js');
      const dims = opts.dim
        ? opts.dim.split(',').map((d: string) => d.trim())
        : undefined;
      const result = await runConverge({
        cwd: opts.cwd as string | undefined,
        target: opts.target as number,
        maxCycles: opts.maxCycles as number,
        checkOnly: opts.checkOnly as boolean | undefined,
        dims,
        escalateAfter: opts.escalateAfter as number,
      });
      process.exitCode = result.exitCode;
    } catch (err) {
      formatAndLogError(err, 'converge');
      process.exitCode = 1;
    }
  });

addCwdOption(addJsonOption(program
  .command('measure')
  .description('Unified quality measurement â€” all scores in one consistent view. --level selects depth: light=fast metrics, standard=full dashboard (default), deep=+retro+nextStep.')
  .option('--level <level>', 'Canonical intensity: light | standard | deep', 'standard')
  .option('--full', 'Show all 20 scoring dimensions (default: 8 builder dims only)')
  .option('--certify', 'Generate tamper-evident certificate hash and save to .danteforge/measure-cert.json')
  .option('--compare <name>', 'Add a competitor comparison column')))
  .action(async (opts) => {
    try {
      const { measure: measureCmd } = await import('./commands/measure.js');
      await measureCmd({
        level: opts.level as 'light' | 'standard' | 'deep',
        json: opts.json as boolean | undefined,
        full: opts.full as boolean | undefined,
        certify: opts.certify as boolean | undefined,
        compare: opts.compare as string | undefined,
        cwd: opts.cwd as string | undefined,
      });
    } catch (err) {
      formatAndLogError(err, 'measure');
      process.exitCode = 1;
    }
  });

program
  .command('score')
  .description('Compatibility alias for measure. Defaults to --level light.')
  .option('--level <level>', 'Canonical intensity: light | standard | deep', 'light')
  .option('--full', 'Show all 20 scoring dimensions')
  .option('--json', 'Machine-readable JSON output')
  .option('--certify', 'Generate tamper-evident certificate hash and save to .danteforge/measure-cert.json')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge score                  Fast score (< 5 seconds, no LLM)
  danteforge score --full           Show all 20 quality dimensions
  danteforge score --json           Machine-readable JSON for CI/scripting
  danteforge score --level deep     Deep analysis with LLM-enhanced scoring
  danteforge score --certify        Pin score with a tamper-evident certificate hash
  danteforge score --cwd ./my-app   Score a different project directory
`)
  .action(async (opts) => {
    try {
      const { measure: measureCmd } = await import('./commands/measure.js');
      await measureCmd({
        level: opts.level as 'light' | 'standard' | 'deep',
        full: opts.full as boolean | undefined,
        json: opts.json as boolean | undefined,
        certify: opts.certify as boolean | undefined,
        cwd: opts.cwd as string | undefined,
      });
    } catch (err) {
      formatAndLogError(err, 'score');
      process.exitCode = 1;
    }
  });

program
  .command('quality')
  .description('Visual quality scorecard: dimension bars, P0 gaps, and automation ceilings')
  .option('--json', 'Output machine-readable JSON with score, dimensions, P0 gaps, and badge markdown')
  .action((opts) => {
    void (async () => {
      try {
        const { quality } = await import('./commands/quality.js');
        await quality({ json: opts.json as boolean | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'quality');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('prime')
  .description('Generate .danteforge/PRIME.md â€” 200-word session brief for Claude Code')
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
  danteforge go “improve security”  Target a specific dimension in the improvement cycle
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
  .description('Guided 5-minute setup: init â†’ constitution â†’ first spark â†’ quality score')
  .option('--simple', 'Template-based setup â€” no LLM needed, under 90 seconds')
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
