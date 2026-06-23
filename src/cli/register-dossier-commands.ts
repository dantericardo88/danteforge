import type { Command } from 'commander';

type Commands = Awaited<typeof import('./commands/index.js')>;

export function registerDossierCommands(program: Command, _C: () => Promise<Commands>): void {
// â”€â”€ finish: report each dim vs its HONEST ceiling + whether the project is FINISHED â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
program
  .command('finish')
  .description('Report each dimension vs its HONEST ceiling (market→5, no-demand→8.0, demand-bound→9) + whether the project is FINISHED')
  .option('--json', 'machine-readable output')
  .option('--cwd <path>', 'project directory')
  .action((opts) => {
    void (async () => {
      try {
        const { runFinishCli } = await import('./commands/finish.js');
        const o = opts as { json?: boolean; cwd?: string };
        await runFinishCli({ json: o.json, cwd: o.cwd });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'finish');
        process.exitCode = 1;
      }
    })();
  });

// â”€â”€ Dossier command group â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const dossierGroup = program
  .command('dossier')
  .description('Competitor dossier management â€” build source-backed evidence + scores');

dossierGroup
  .command('build [competitor]')
  .description('Build or refresh a competitor dossier')
  .option('--all', 'Rebuild all competitors in registry')
  .option('--sources <urls>', 'Comma-separated source URLs (override registry)')
  .option('--since <duration>', 'Skip if dossier fresher than duration (e.g. 7d)')
  .action((competitor, opts) => {
    void (async () => {
      try {
        const { dossierBuild } = await import('./commands/dossier.js');
        await dossierBuild(competitor as string | undefined, {
          all: opts.all as boolean | undefined,
          sources: opts.sources as string | undefined,
          since: opts.since as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'dossier build');
        process.exitCode = 1;
      }
    })();
  });

dossierGroup
  .command('diff <competitor>')
  .description('Show what changed since last dossier build')
  .action((competitor) => {
    void (async () => {
      try {
        const { dossierDiff } = await import('./commands/dossier.js');
        await dossierDiff(competitor as string);
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'dossier diff');
        process.exitCode = 1;
      }
    })();
  });

dossierGroup
  .command('show <competitor>')
  .description('Pretty-print a competitor dossier')
  .option('--dim <n>', 'Show single dimension evidence')
  .action((competitor, opts) => {
    void (async () => {
      try {
        const { dossierShow } = await import('./commands/dossier.js');
        await dossierShow(competitor as string, { dim: opts.dim as string | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'dossier show');
        process.exitCode = 1;
      }
    })();
  });

dossierGroup
  .command('list')
  .description('List all built dossiers with composite scores')
  .action(() => {
    void (async () => {
      try {
        const { dossierList } = await import('./commands/dossier.js');
        await dossierList();
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'dossier list');
        process.exitCode = 1;
      }
    })();
  });

// â”€â”€ Landscape command group â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const landscapeGroup = program
  .command('landscape')
  .description('Competitive landscape matrix assembled from all dossiers')
  .action(() => {
    void (async () => {
      try {
        const { landscapeBuild } = await import('./commands/landscape-cmd.js');
        await landscapeBuild();
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'landscape');
        process.exitCode = 1;
      }
    })();
  });

landscapeGroup
  .command('diff')
  .description('Show landscape staleness and last-generated metadata')
  .action(() => {
    void (async () => {
      try {
        const { landscapeDiff } = await import('./commands/landscape-cmd.js');
        await landscapeDiff();
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'landscape diff');
        process.exitCode = 1;
      }
    })();
  });

landscapeGroup
  .command('ranking')
  .description('Print sorted competitor rankings table')
  .action(() => {
    void (async () => {
      try {
        const { landscapeRanking } = await import('./commands/landscape-cmd.js');
        await landscapeRanking();
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'landscape ranking');
        process.exitCode = 1;
      }
    })();
  });

landscapeGroup
  .command('gap')
  .description('Show dimensions where DC lags the leader by >1.0')
  .option('--target <id>', 'Target competitor id (default: dantescode)')
  .action((opts) => {
    void (async () => {
      try {
        const { landscapeGap } = await import('./commands/landscape-cmd.js');
        await landscapeGap({ target: (opts as { target?: string }).target });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'landscape gap');
        process.exitCode = 1;
      }
    })();
  });

// â”€â”€ Rubric command group â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const rubricGroup = program
  .command('rubric')
  .description('Scoring rubric management â€” frozen criteria for each dimension');

rubricGroup
  .command('show')
  .description('Print full rubric or single dimension criteria')
  .option('--dim <n>', 'Show criteria for one dimension')
  .action((opts) => {
    void (async () => {
      try {
        const { rubricShow } = await import('./commands/rubric-cmd.js');
        await rubricShow({ dim: (opts as { dim?: string }).dim });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'rubric show');
        process.exitCode = 1;
      }
    })();
  });

rubricGroup
  .command('init')
  .description('Initialize rubric.json (checks if already present)')
  .action(() => {
    void (async () => {
      try {
        const { rubricInit } = await import('./commands/rubric-cmd.js');
        await rubricInit();
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'rubric init');
        process.exitCode = 1;
      }
    })();
  });

rubricGroup
  .command('validate')
  .description('Check all dossiers have evidence for each rubric dimension')
  .action(() => {
    void (async () => {
      try {
        const { rubricValidate } = await import('./commands/rubric-cmd.js');
        await rubricValidate();
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'rubric validate');
        process.exitCode = 1;
      }
    })();
  });

rubricGroup
  .command('add-dim')
  .description('Add a new dimension to the rubric')
  .option('--name <name>', 'Dimension name')
  .action((opts) => {
    void (async () => {
      try {
        const { rubricAddDim } = await import('./commands/rubric-cmd.js');
        await rubricAddDim({ name: (opts as { name?: string }).name });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'rubric add-dim');
        process.exitCode = 1;
      }
    })();
  });

// â”€â”€ rubric-score group â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const rubricScoreGroup = program
  .command('rubric-score')
  .description('Triple-rubric scoring: internal_optimistic, public_defensible, hostile_diligence');

rubricScoreGroup
  .option('--matrix <id>', 'Matrix ID (default: product-28)')
  .option('--subject <name>', 'Subject being scored (e.g. DanteCode)')
  .option('--evidence <path>', 'Path to JSON evidence file')
  .option('--rubrics <list>', 'Comma-separated rubric IDs (default: all three)')
  .option('--out <path>', 'Output path prefix (creates .md + .json)')
  .action((opts) => {
    void (async () => {
      try {
        const { rubricScore } = await import('./commands/score-rubric.js');
        await rubricScore({
          matrix: (opts as { matrix?: string }).matrix,
          subject: (opts as { subject?: string }).subject,
          evidence: (opts as { evidence?: string }).evidence,
          rubrics: (opts as { rubrics?: string }).rubrics,
          out: (opts as { out?: string }).out,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'rubric-score');
        process.exitCode = 1;
      }
    })();
  });

rubricScoreGroup
  .command('diff')
  .description('Compare two scoring snapshots and report changes')
  .requiredOption('--before <path>', 'Path to before JSON snapshot')
  .requiredOption('--after <path>', 'Path to after JSON snapshot')
  .option('--out <path>', 'Write diff report to file')
  .action((opts) => {
    void (async () => {
      try {
        const { rubricScoreDiff } = await import('./commands/score-rubric.js');
        await rubricScoreDiff({
          before: (opts as { before: string }).before,
          after: (opts as { after: string }).after,
          out: (opts as { out?: string }).out,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'rubric-score diff');
        process.exitCode = 1;
      }
    })();
  });

// â”€â”€ dantecode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
program
  .command('dantecode')
  .description('Install or update DanteCode VS Code extension, wired to the latest DanteForge build (PRD-26 + quality layer)')
  .option('--dantecode-path <path>', 'Path to DanteCode repo (default: ../DanteCode sibling)')
  .option('--dry-run', 'Print what would be done without executing')
  .action(async (opts) => {
    try {
      const { spawn } = await import('node:child_process');
      const { resolve, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const scriptDir = dirname(fileURLToPath(import.meta.url));
      const installerPath = resolve(scriptDir, '..', '..', 'scripts', 'install-dantecode.mjs');
      const args: string[] = [];
      if ((opts as { dantecodePath?: string }).dantecodePath) {
        args.push(`--dantecode-path=${(opts as { dantecodePath: string }).dantecodePath}`);
      }
      if ((opts as { dryRun?: boolean }).dryRun) {
        const { logger } = await import('../core/logger.js');
        logger.info(`Would run: node ${installerPath} ${args.join(' ')}`);
        return;
      }
      await new Promise<void>((res, rej) => {
        const child = spawn(process.execPath, [installerPath, ...args], { stdio: 'inherit' });
        child.on('close', (code) => (code === 0 ? res() : rej(new Error(`installer exited ${code}`))));
      });
    } catch (err) {
      const { formatAndLogError } = await import('../core/format-error.js');
      formatAndLogError(err, 'dantecode');
      process.exitCode = 1;
    }
  });

program
  .command('evidence [action]')
  .description('Proof chains, Time Machine, causal attribution, evidence export')
  .option('--node-id <id>', 'Decision node ID for branch action')
  .option('--cwd <path>', 'Working directory')
  .action((action, opts) => {
    void (async () => {
      try {
        const { canonicalEvidence } = await import('./commands/canonical.js');
        await canonicalEvidence({
          action: action as 'verify' | 'export' | 'certify' | 'timeline' | 'branch' | 'causal' | undefined,
          nodeId: opts.nodeId as string | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'evidence');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('knowledge [action]')
  .description('Lessons, synthesis, wiki, explain, pattern federation')
  .option('--entry <text>', 'Lesson entry text (for learn action)')
  .option('--target <path>', 'File or term to explain')
  .option('--topic <topic>', 'Wiki topic to search')
  .option('--write', 'Write mode for wiki action')
  .option('--cwd <path>', 'Working directory')
  .action((action, opts) => {
    void (async () => {
      try {
        const { canonicalKnowledge } = await import('./commands/canonical.js');
        await canonicalKnowledge({
          action: action as 'learn' | 'prime' | 'explain' | 'wiki' | 'synthesize' | 'share' | undefined,
          entry: opts.entry as string | undefined,
          target: opts.target as string | undefined,
          topic: opts.topic as string | undefined,
          write: opts.write as boolean | undefined,
          cwd: opts.cwd as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'knowledge');
        process.exitCode = 1;
      }
    })();
  });

}
