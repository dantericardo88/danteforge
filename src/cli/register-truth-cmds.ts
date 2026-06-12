// register-truth-cmds.ts — the trust/DNA command surface (split from register-outcomes-cmds.ts
// for the file-size standard): self-challenge (the gap-finding ledger), author-outcome (the
// productized evidence-scout recipe), and trust-report (every score with its receipts).

import type { Command } from 'commander';

export function registerTruthCmds(program: Command): void {
program
  .command('self-challenge <action>')
  .description('The gap-finding ledger (DNA): add a DEFINED problem (title/problem/evidence/opportunity), list open challenges, solve <id> with a commit, retire <id> with a reason. A defined problem is a solvable one; entries are never silently deleted.')
  .option('--id <id>', 'Challenge id (solve/retire)')
  .option('--title <text>', 'Short name (add)')
  .option('--problem <text>', 'The precisely defined problem (add)')
  .option('--evidence <text>', 'Where it was observed (add)')
  .option('--opportunity <text>', 'What solving it unlocks (add)')
  .option('--resolution <text>', 'Commit sha / receipt / reason (solve, retire)')
  .option('--json', 'Machine-readable output')
  .option('--cwd <path>', 'Project directory')
  .action((action: string, opts) => {
    void (async () => {
      try {
        const { addChallenge, resolveChallenge, loadChallenges } = await import('../core/self-challenge.js');
        const { logger } = await import('../core/logger.js');
        const cwd = (opts.cwd as string | undefined) ?? process.cwd();
        if (action === 'add') {
          const c = await addChallenge(cwd, { title: opts.title as string, problem: opts.problem as string, evidence: opts.evidence as string, opportunity: opts.opportunity as string });
          logger.success(`[self-challenge] ${c.id} opened: ${c.title} — a defined problem is a solvable one.`);
        } else if (action === 'solve' || action === 'retire') {
          const c = await resolveChallenge(cwd, opts.id as string, opts.resolution as string, action === 'solve' ? 'solved' : 'retired');
          logger.success(`[self-challenge] ${c.id} ${c.status}: ${c.resolution}`);
        } else if (action === 'list') {
          const all = await loadChallenges(cwd);
          if (opts.json) { process.stdout.write(JSON.stringify(all, null, 2) + '\n'); return; }
          const open = all.filter(c => c.status === 'open');
          logger.info(`[self-challenge] ${open.length} open / ${all.length} total — ledger: .danteforge/challenges.md`);
          for (const c of open) logger.info(`  ${c.id}  ${c.title} — ${c.problem.slice(0, 100)}`);
          if (open.length === 0) logger.warn('  zero open challenges — that is a smell, not an achievement. Go find the gaps.');
        } else {
          logger.error(`[self-challenge] unknown action "${action}" — use add | list | solve | retire.`);
          process.exitCode = 1;
        }
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'self-challenge');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('author-outcome <dimId>')
  .description('Author an honest T5 product-run outcome from a REAL command: runs it twice, selects stdout patterns stable across both runs and safe for the cli-smoke runner, refuses test runners/help screens/flaky output. The callsite is named by YOU, never invented.')
  .requiredOption('--command <cmd>', 'The real product command (e.g. "node dist/index.js lessons")')
  .requiredOption('--callsite <path>', 'Production src/ file this command exercises')
  .option('--write', 'Write the declaration to matrix.json (default: dry-run)')
  .option('--cwd <path>', 'Project directory')
  .action((dimId: string, opts) => {
    void (async () => {
      try {
        const { authorProductOutcome } = await import('../matrix/engines/outcome-author.js');
        const { logger } = await import('../core/logger.js');
        const r = await authorProductOutcome({
          cwd: (opts.cwd as string | undefined) ?? process.cwd(), dimId,
          command: opts.command as string, callsite: opts.callsite as string,
          write: opts.write as boolean | undefined,
        });
        if (r.ok) {
          logger.success(`[author-outcome] ${r.reason}`);
          if (r.outcome) logger.info(JSON.stringify(r.outcome, null, 2));
        } else {
          logger.error(`[author-outcome] REFUSED: ${r.reason}`);
          process.exitCode = 1;
        }
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'author-outcome');
        process.exitCode = 1;
      }
    })();
  });

program
  .command('trust-report')
  .description('Render every score WITH its receipts (commands, sessions, court status, verbatim ceilings) — the externally-verifiable proof behind the honest number. Read-only.')
  .option('--output <path>', 'Report path (default .danteforge/reports/TRUST_REPORT.md)')
  .option('--json', 'Machine-readable summary')
  .option('--cwd <path>', 'Project directory')
  .action((opts) => {
    void (async () => {
      try {
        const { runTrustReport } = await import('./commands/trust-report.js');
        await runTrustReport({ cwd: opts.cwd as string | undefined, output: opts.output as string | undefined, json: opts.json as boolean | undefined });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'trust-report');
        process.exitCode = 1;
      }
    })();
  });
}
