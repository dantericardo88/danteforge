import type { Command } from 'commander';
import { formatAndLogError } from '../core/format-error.js';
import { addCwdOption, addJsonOption } from './shared-options.js';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerConvergenceCmds(program: Command, _C: () => Promise<Commands>): void {
program
  .command('converge')
  .description('TypeScript-owned convergence loop -- runs until all dims >= target. No LLM stop/continue.')
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
  .description('Unified quality measurement -- all scores in one consistent view. --level selects depth: light=fast metrics, standard=full dashboard (default), deep=+retro+nextStep.')
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
  danteforge snapshot score-json --command "danteforge score --json"
  danteforge snapshot score-json --command "danteforge score --json" --update
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
  .description('Report project frontier state OR drive the project autonomously until 50-100+ dimensions reach genuine frontier (use --drive).')
  .option('--dim <id>', 'Show only one dimension')
  .option('--stuck-threshold <n>', 'Waves-without-progress before a dim is marked stuck (default 3)', '3')
  .option('--require <state>', 'CI gate: exit 0 iff terminal state matches (frontier-reached|progressing|stuck-on-dims|blocked-by-dispensations)')
  .option('--drive', 'Autonomous attainment mode: run hardened crusade loops until --target-dims dimensions meet the full strict frontier criteria')
  .option('--target-dims <n>', 'Goal number of dimensions at strict frontier when using --drive (default 50)', '50')
  .option('--target <score>', 'Per-dimension score target for inner crusade (default 9.0)', '9')
  .option('--parallel <n>', 'Parallel dimensions during drive (default 4)', '4')
  .option('--time <m>', 'Autoresearch minutes per inner cycle (default 45)', '45')
  .option('--max-cycles <n>', 'Max outer attainment cycles in --drive mode (default 20)', '20')
  .option('--json', 'Machine-readable JSON output')
  .option('--cwd <path>', 'Project directory (defaults to cwd)')
  .addHelpText('after', `
Report mode (default):
  Shows current frontier status with strict doctrine evaluation.

Drive mode (--drive):
  The real "1 command" autonomous attainment loop.
  Repeatedly runs harden-crusade, evaluates the full frontier gate (CIP + capability_test + harden + recency + Time Machine), and continues until --target-dims dimensions are genuinely at frontier.

Examples:
  danteforge frontier --drive --target-dims 70
  danteforge frontier --drive --target-dims 100 --parallel 6 --time 60
  danteforge frontier --require frontier-reached --json     # CI gate

See commands/frontier.md for the full autonomous protocol.
`)
  .action((opts) => {
    void (async () => {
      try {
        if (opts.drive) {
          const { runFrontierDrive } = await import('./commands/frontier.js');
          await runFrontierDrive({
            cwd: opts.cwd as string | undefined,
            targetDims: opts.targetDims ? parseInt(opts.targetDims as string, 10) : undefined,
            targetScore: opts.target ? parseFloat(opts.target as string) : undefined,
            parallel: opts.parallel ? parseInt(opts.parallel as string, 10) : undefined,
            maxOuterCycles: opts.maxCycles ? parseInt(opts.maxCycles as string, 10) : undefined,
            timeMinutes: opts.time ? parseInt(opts.time as string, 10) : undefined,
            json: opts.json as boolean | undefined,
          });
          return;
        }

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
}
