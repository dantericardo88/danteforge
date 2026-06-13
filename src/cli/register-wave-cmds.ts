// register-wave-cmds.ts — `danteforge wave` command group (depth_doctrine WaveLedger inspection).

import type { Command } from 'commander';

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
