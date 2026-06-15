// register-wave-cmds.ts — `danteforge wave` command group (depth_doctrine WaveLedger inspection).

import type { Command } from 'commander';

/** `danteforge grounding` — external-grounding ratio (grading-integrity #6). Registered alongside
 *  wave via the same hub; read-only honesty surface. */
export function registerGroundingCmd(program: Command): void {
  program
    .command('grounding')
    .description('How much of the matrix score is externally grounded vs self-attested (depth honesty)')
    .option('--json', 'machine-readable output')
    .action((opts) => {
      void (async () => {
        try {
          const { grounding } = await import('./commands/grounding-cmd.js');
          await grounding({ json: !!(opts as { json?: boolean }).json });
        } catch (err) {
          const { formatAndLogError } = await import('../core/format-error.js');
          formatAndLogError(err, 'grounding');
          process.exitCode = 1;
        }
      })();
    });
}

/** `danteforge harvest-demand` — Phase 6 v1 demand intake: harvest + rank feature-request demand from
 *  GitHub into a backlog that feeds `specify`. The externally-GOAL-grounded roadmap (CH-007). */
export function registerHarvestDemandCmd(program: Command): void {
  program
    .command('harvest-demand')
    .description('Harvest + rank open feature-request demand from competitor/topic GitHub repos into a backlog that feeds specify (CH-007 demand grounding)')
    .option('--repos <slugs>', 'comma-separated owner/repo slugs (default: derived from matrix OSS competitors)')
    .option('--labels <labels>', 'comma-separated issue labels to query (default: enhancement,feature,feature request,help wanted)')
    .option('--limit <n>', 'max issues per (repo,label) query (default: 40)')
    .option('--write', 'persist .danteforge/demand-backlog.json + DEMAND_BACKLOG.md')
    .option('--json', 'machine-readable output')
    .option('--cwd <path>', 'project directory')
    .action((opts) => {
      void (async () => {
        try {
          const { harvestDemandCli } = await import('./commands/harvest-demand-cmd.js');
          const o = opts as { repos?: string; labels?: string; limit?: string; write?: boolean; json?: boolean; cwd?: string };
          await harvestDemandCli({ repos: o.repos, labels: o.labels, limit: o.limit, write: o.write, json: o.json, cwd: o.cwd });
        } catch (err) {
          const { formatAndLogError } = await import('../core/format-error.js');
          formatAndLogError(err, 'harvest-demand');
          process.exitCode = 1;
        }
      })();
    });
}

/** `danteforge demand-spec` — Phase 6 v2 intake→build handoff: turn a ranked demand cluster from the
 *  saved backlog into a specify-ready brief (acceptance criteria from the requesters' own words +
 *  external-demand provenance). Offline; reads .danteforge/demand-backlog.json. */
export function registerDemandSpecCmd(program: Command): void {
  program
    .command('demand-spec')
    .description('Turn a ranked demand cluster (from harvest-demand --write) into a specify-ready brief with requester-sourced acceptance criteria + external provenance')
    .option('--rank <n>', '1-based cluster rank to spec (default: 1 = top demand)')
    .option('--backlog <path>', 'path to demand-backlog.json (default: .danteforge/demand-backlog.json)')
    .option('--write', 'persist .danteforge/demand-specs/<rank>-<theme>.md (+ .json)')
    .option('--json', 'machine-readable output')
    .option('--cwd <path>', 'project directory')
    .action((opts) => {
      void (async () => {
        try {
          const { demandSpecCli } = await import('./commands/demand-spec-cmd.js');
          const o = opts as { rank?: string; backlog?: string; write?: boolean; json?: boolean; cwd?: string };
          await demandSpecCli({ rank: o.rank, backlog: o.backlog, write: o.write, json: o.json, cwd: o.cwd });
        } catch (err) {
          const { formatAndLogError } = await import('../core/format-error.js');
          formatAndLogError(err, 'demand-spec');
          process.exitCode = 1;
        }
      })();
    });
}

export function registerWaveCmds(program: Command): void {
  const wave = program
    .command('wave')
    .description('Inspect the WaveLedger and show campaign resume plans (depth_doctrine cadence)');

  wave
    .command('list')
    .description('List the runs recorded in the wave ledger')
    .option('--json', 'machine-readable output')
    .action((opts) => {
      void (async () => {
        try {
          const { waveList } = await import('./commands/wave-cmd.js');
          await waveList({ json: !!(opts as { json?: boolean }).json });
        } catch (err) {
          const { formatAndLogError } = await import('../core/format-error.js');
          formatAndLogError(err, 'wave list');
          process.exitCode = 1;
        }
      })();
    });

  wave
    .command('show <runId>')
    .description('Show the wave history for one run')
    .option('--json', 'machine-readable output')
    .action((runId: string, opts) => {
      void (async () => {
        try {
          const { waveShow } = await import('./commands/wave-cmd.js');
          await waveShow(runId, { json: !!(opts as { json?: boolean }).json });
        } catch (err) {
          const { formatAndLogError } = await import('../core/format-error.js');
          formatAndLogError(err, 'wave show');
          process.exitCode = 1;
        }
      })();
    });

  wave
    .command('replay <runId>')
    .description('Show where a campaign would RESUME from (the last successful wave)')
    .option('--json', 'machine-readable output')
    .action((runId: string, opts) => {
      void (async () => {
        try {
          const { waveReplay } = await import('./commands/wave-cmd.js');
          await waveReplay(runId, { json: !!(opts as { json?: boolean }).json });
        } catch (err) {
          const { formatAndLogError } = await import('../core/format-error.js');
          formatAndLogError(err, 'wave replay');
          process.exitCode = 1;
        }
      })();
    });
}
