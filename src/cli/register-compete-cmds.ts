import type { Command } from 'commander';
import { formatAndLogError } from '../core/format-error.js';
import { registerSanitizeCommand } from './register-sanitize-command.js';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerCompeteCmds(program: Command, C: () => Promise<Commands>): void {
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
  .option('--amend <dim_score>', 'Manually set a market dim self-score: dim_id=score (0â€"10), e.g. "semantic_memory=5.5"')
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
  .option('--auto', 'Run all phases in sequence (advisory â€" forge step prints recommendation)')
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
}
