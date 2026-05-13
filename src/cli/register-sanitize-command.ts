// DanteSanitize CLI registration — extracted to keep register-late-commands.ts under 750 LOC
import type { Command } from 'commander';

export function registerSanitizeCommand(program: Command): void {
  program
    .command('sanitize')
    .description('Break up oversized files (>750 LOC). v2 Hybrid AST + LLM with deterministic Tier 1 mover.')
    .option('--cwd <path>', 'Target project directory (default: current directory)')
    .option('--threshold <n>', 'LOC hard limit — files above this are split (default: 750)', parseInt)
    .option('--max-cycles <n>', 'Safety cycle limit (default: 50)', parseInt)
    .option('--max-tokens <n>', 'Cumulative LLM token budget for Tier 2 fallback (default: 200000)', parseInt)
    .option('--dry-run', 'Show what would be split without writing files')
    .option('--check', 'Report violations and exit 1 if any exist; do not modify anything')
    .option('--undo', 'Restore the most recent backup (best-effort revert of last split)')
    .option('--prune-backups', 'Delete backup files older than --retention-days')
    .option('--retention-days <n>', 'Backup retention in days (default: 7)', parseInt)
    .option('--yes', 'Skip interactive confirmation prompts')
    .option('--skip-typecheck', 'Skip tsc verification after each split')
    .option('--pattern <glob>', 'Only process files whose path contains this string')
    .option('--skip-pattern <glob>', 'Skip files whose path contains this string')
    .action(async (opts) => {
      try {
        const { sanitize } = await import('./commands/sanitize.js');
        await sanitize({
          cwd: opts.cwd as string | undefined,
          threshold: opts.threshold as number | undefined,
          maxCycles: opts.maxCycles as number | undefined,
          maxTokens: opts.maxTokens as number | undefined,
          dryRun: opts.dryRun as boolean | undefined,
          check: opts.check as boolean | undefined,
          undo: opts.undo as boolean | undefined,
          pruneBackups: opts.pruneBackups as boolean | undefined,
          retentionDays: opts.retentionDays as number | undefined,
          yes: opts.yes as boolean | undefined,
          skipTypecheck: opts.skipTypecheck as boolean | undefined,
          pattern: opts.pattern as string | undefined,
          skipPattern: opts.skipPattern as string | undefined,
        });
      } catch (err) {
        const { formatAndLogError } = await import('../core/format-error.js');
        formatAndLogError(err, 'sanitize');
        process.exitCode = 1;
      }
    });
}
