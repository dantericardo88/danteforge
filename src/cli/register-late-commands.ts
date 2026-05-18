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
  .command('snapshot [name]')
  .description('CLI output snapshot testing — capture and compare command output. Store in .danteforge/snapshots/.')
  .option('--command <cmd>', 'Shell command whose output to snapshot')
  .option('--update', 'Overwrite existing snapshot with current output')
  .option('--timeout <ms>', 'Command timeout in ms (default: 30000)', '30000')
  .option('--list', 'List all saved snapshots')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge snapshot score-json --command “danteforge score --json”
  danteforge snapshot score-json --command “danteforge score --json” --update
  danteforge snapshot --list
`)
  .action((name: string | undefined, opts) => {
    void (async () => {
      try {
        const { runCliSnapshot } = await import('./commands/cli-snapshot.js');
        await runCliSnapshot(name ?? '', opts.command as string ?? '', {
          update: opts.update as boolean | undefined,
          timeout: opts.timeout ? parseInt(opts.timeout as string, 10) : undefined,
          list: opts.list as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'snapshot');
        process.exitCode = 1;
      }
    })();
  });

const dispensationCmd = program
  .command('dispensation')
  .description('Manage operator-approved score dispensations. While any dispensation is active, autonomy is paused globally.')
  .addHelpText('after', `
Subcommands:
  list                              List all dispensations (active + cleared)
  create <dim-id> <reason>          Open a new dispensation against a dimension
  clear <id>                        Mark a dispensation cleared (resume autonomy)

Examples:
  danteforge dispensation list
  danteforge dispensation create security "operator approves T3 cap until external audit closes"
  danteforge dispensation clear disp_1736700000000_abc123
`);

dispensationCmd
  .command('list')
  .description('List all dispensations (active block autonomy)')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((opts) => {
    void (async () => {
      try {
        const { runDispensationCommand } = await import('./commands/dispensation.js');
        await runDispensationCommand({
          subcommand: 'list',
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'dispensation list');
        process.exitCode = 1;
      }
    })();
  });

dispensationCmd
  .command('create <dimensionId> <reason>')
  .description('Create a dispensation against a dimension (pauses autonomy globally until cleared)')
  .option('--user <name>', 'Operator id for audit trail')
  .option('--ttl <duration>', 'Auto-expiry duration (e.g. "7d", "24h", "30m"). After expiry the dispensation auto-clears.')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((dimensionId: string, reason: string, opts) => {
    void (async () => {
      try {
        const { runDispensationCommand } = await import('./commands/dispensation.js');
        await runDispensationCommand({
          subcommand: 'create',
          dimensionId, reason,
          user: opts.user as string | undefined,
          ttl: opts.ttl as string | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'dispensation create');
        process.exitCode = 1;
      }
    })();
  });

dispensationCmd
  .command('clear <id>')
  .description('Clear a dispensation (resumes autonomy if this was the last active one)')
  .option('--user <name>', 'Operator id for audit trail')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((id: string, opts) => {
    void (async () => {
      try {
        const { runDispensationCommand } = await import('./commands/dispensation.js');
        await runDispensationCommand({
          subcommand: 'clear',
          dispensationId: id,
          user: opts.user as string | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'dispensation clear');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('frontier')
  .description('Report project frontier state: per-dim status + terminal verdict (frontier-reached | stuck-on-dims | blocked-by-dispensations | progressing). Phase H Slice 4.')
  .option('--dim <id>', 'Show only one dimension')
  .option('--stuck-threshold <n>', 'Waves-without-progress before a dim is marked stuck (default 3)', '3')
  .option('--require <state>', 'CI gate: exit 0 iff terminal state matches (frontier-reached|progressing|stuck-on-dims|blocked-by-dispensations)')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
A dim is at frontier iff THREE conjunction conditions hold:
  1. All outcomes at declared_ceiling pass
  2. No active dispensation against the dim
  3. production-usage-fresh passes (or declared_ceiling < T3)

The project's terminal state is one of:
  frontier-reached         all eligible dims at frontier (exit 0)
  stuck-on-dims            >=1 dim halted after N waves (exit 1)
  blocked-by-dispensations operator overrides outstanding (exit 1)
  progressing              still working (exit 1)

CI gate examples:
  danteforge frontier --require frontier-reached --json   release-blocker
  danteforge frontier --require progressing --json        sanity check the loop isn't stuck

See docs/CAPABILITY-TIERS.md for the per-tier contracts.
`)
  .action((opts) => {
    void (async () => {
      try {
        const { runFrontierCommand } = await import('./commands/frontier.js');
        const requireState = opts.require as string | undefined;
        const valid = ['frontier-reached', 'progressing', 'stuck-on-dims', 'blocked-by-dispensations'];
        if (requireState && !valid.includes(requireState)) {
          throw new Error(`--require: unknown state "${requireState}". Use one of: ${valid.join(', ')}`);
        }
        await runFrontierCommand({
          dim: opts.dim as string | undefined,
          stuckThreshold: opts.stuckThreshold ? parseInt(opts.stuckThreshold as string, 10) : undefined,
          requireState: requireState as 'frontier-reached' | 'progressing' | 'stuck-on-dims' | 'blocked-by-dispensations' | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'frontier');
        process.exitCode = 1;
      }
    })();
  });

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
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((dimensionId: string, opts) => {
    void (async () => {
      try {
        const { runResearchStart } = await import('./commands/research.js');
        await runResearchStart(dimensionId, {
          force: opts.force as boolean | undefined,
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

program
  .command('outcomes')
  .description('Run declared outcomes per dimension. Score = derived from evidence (Phase F+G). Replaces writable scores entirely once dims migrate.')
  .option('--dim <id>', 'Run only on this dimension')
  .option('--tier <name>', 'Run only outcomes of this tier (T0..T6)')
  .option('--force-cold', 'Force re-execution even when cached evidence exists for this SHA')
  .option('--status', 'Report current evidence + derived scores without re-running')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
The outcome system replaces writable scores. Each dim declares outcomes — shell
commands that must exit 0 to "prove" a tier. The derived score is computed from
which outcomes pass, never written. Inflation becomes structurally impossible.

Examples:
  danteforge outcomes                Run all outcomes across all dims
  danteforge outcomes --status       Show current derived scores from cached evidence
  danteforge outcomes --dim security Run only the security dim
  danteforge outcomes --tier T1      Run only T1 (compiles-cold) outcomes
  danteforge outcomes --force-cold   Bypass gitSha cache

Evidence is written to .danteforge/outcome-evidence/<sha>-<dim>-<outcome>.json.
See ~/.claude/plans/dapper-hatching-aurora.md for the design.
`)
  .action((opts) => {
    void (async () => {
      try {
        const { runOutcomesCli } = await import('./commands/outcomes.js');
        await runOutcomesCli({
          dim: opts.dim as string | undefined,
          tier: opts.tier as string | undefined,
          forceCold: opts.forceCold as boolean | undefined,
          status: opts.status as boolean | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'outcomes');
        process.exitCode = 1;
      }
    })();
  });

const hardenCmd = program
  .command('harden')
  .description('Deterministic hardening checks (Phase C of Capability Ladder). Catches orphan modules, claim/reality mismatches, hardcoded fallbacks. Cannot be gamed by LLM agents.')
  .option('--dim <id>', 'Run only on this dimension')
  .option('--check <id>', 'Run only this check: orphan-audit | claim-auditor | hardcoded-fallback | import-resolves | functional-diff')
  .option('--gate', 'Exit 1 if any dimension above the 7.0 threshold fails (CI mode)')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge harden                              All checks, all dims above 7.0
  danteforge harden --dim security               One dim only
  danteforge harden --check orphan-audit         One check across all dims
  danteforge harden --gate                       CI mode — exits 1 on any fail
  danteforge harden migrate                      Dry-run: infer capability_callsite per dim
  danteforge harden migrate --apply              Write inferred callsites to matrix.json

The harden gate fires automatically inside mergeScoreProposals at score ≥ 7.0.
This command is the operator-facing entry point and the CI gate.
`)
  .action((opts) => {
    void (async () => {
      try {
        const { runHardenCommand } = await import('./commands/harden.js');
        await runHardenCommand({
          dim: opts.dim as string | undefined,
          check: opts.check as undefined,
          gate: opts.gate as boolean | undefined,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'harden');
        process.exitCode = 1;
      }
    })();
  });

hardenCmd
  .command('migrate')
  .description('Infer capability_callsite + test_callsite for each dim from its capability_test command. Dry-run by default; use --apply to write.')
  .option('--apply', 'Write inferred callsites to matrix.json (default: dry-run only)')
  .option('--accept-low', 'Also apply low-confidence inferences (default: high+medium only)')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .action((opts) => {
    void (async () => {
      try {
        const { runHardenMigrateCommand } = await import('./commands/harden.js');
        const acceptConfidence: Array<'high' | 'medium' | 'low'> = opts.acceptLow
          ? ['high', 'medium', 'low']
          : ['high', 'medium'];
        await runHardenMigrateCommand({
          apply: opts.apply as boolean | undefined,
          acceptConfidence,
          json: opts.json as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'harden migrate');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('probe')
  .description('Cold-build runtime probe — the T1 gate of the Capability Ladder. Auto-detects turbo/pnpm/lerna/npm.')
  .option('--tier <name>', 'Probe tier (T0|T1|T2|T3-T6). Default T1 (cold compile).', 'T1')
  .option('--json', 'Machine-readable JSON output')
  .option('--no-cache', 'Force cold run even if cached evidence exists for this SHA', true)
  .option('--timeout-ms <n>', 'Probe timeout (default 15 min)')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge probe                             Cold T1 build at repo root
  danteforge probe --tier T2                   Run tests cold
  danteforge probe --json > probe.json         Machine-readable output
  danteforge probe --cwd ../DanteAgents        Probe a sibling project

Evidence is written to .danteforge/runtime-evidence/<sha>-<tier>.json.
The Capability Ladder gate caps any dimension score above:
  T0=1.0  T1=4.0  T2=5.0  T3=6.0  T4=7.0  T5=8.0  T6=8.5
`)
  .action((opts) => {
    void (async () => {
      try {
        const { runProbeCommand } = await import('./commands/probe.js');
        await runProbeCommand({
          tier: opts.tier as string | undefined,
          json: opts.json as boolean | undefined,
          forceCold: opts.noCache !== false,
          noCache: opts.noCache !== false,
          cwd: opts.cwd as string | undefined,
          timeoutMs: opts.timeoutMs ? parseInt(opts.timeoutMs as string, 10) : undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'probe');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('honest-rescore')
  .description('Reality-check the competitive matrix against runtime evidence. Writes a .honest.json file, never mutates matrix.json.')
  .option('--json', 'Machine-readable JSON output')
  .option('--regrade', 'Mandatory skeptic regrade: run harden gate against every dim, reset wavesSinceLastRegrade')
  .option('--index-fresh', 'Force fresh search index for regrade (Phase M.5; default: true)', true)
  .option('--no-index-fresh', 'Skip fresh-indexing for forensic replay against historical SHA')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Examples:
  danteforge honest-rescore                          Reality-check the current matrix
  danteforge honest-rescore --json                   Machine-readable output for CI
  danteforge honest-rescore --regrade                Skeptic regrade (default index-fresh)
  danteforge honest-rescore --regrade --no-index-fresh   Skip fresh index (forensic replay)
  danteforge honest-rescore --cwd ../DanteAgents

Reads .danteforge/runtime-evidence/<sha>-<tier>.json files (run danteforge probe
first) and applies the Capability Ladder tier caps. Writes:
  .danteforge/compete/matrix.honest.json    Copy with self scores clamped
  .danteforge/compete/matrix.honest.diff.md Per-dimension diff report

--regrade (Phase M.5): rebuilds the SearchEngine index fresh on every run so
the skeptic regrade sees the current SHA's code without cached lookups from
prior waves. The whole point of regrade is a skeptic look — caching is
hostile to that.

matrix.json itself is NEVER modified. Operator must copy if satisfied.
`)
  .action((opts) => {
    void (async () => {
      try {
        const { runHonestRescoreCommand } = await import('./commands/honest-rescore.js');
        await runHonestRescoreCommand({
          json: opts.json as boolean | undefined,
          regrade: opts.regrade as boolean | undefined,
          indexFresh: opts.indexFresh as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'honest-rescore');
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
