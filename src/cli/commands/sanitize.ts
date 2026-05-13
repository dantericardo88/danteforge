// DanteSanitize CLI command — break up oversized files until the project is clean
import { logger } from '../../core/logger.js';
import { runSanitize } from '../../core/sanitize-engine.js';
import type { SanitizeEngineOptions, SanitizeEngineResult } from '../../core/sanitize-types.js';
import { checkOnly, undoLastSplit, pruneBackups } from '../../core/sanitize-retention.js';

export interface SanitizeOptions extends SanitizeEngineOptions {
  /** Check-only: exit 1 if any file >threshold; do not modify anything. */
  check?: boolean;
  /** Undo the most recent split. */
  undo?: boolean;
  /** Backup retention in days for `--prune-backups` (default: 7). */
  retentionDays?: number;
  /** Delete backups older than retentionDays without running sanitize. */
  pruneBackups?: boolean;
}

export async function sanitize(options: SanitizeOptions = {}): Promise<SanitizeEngineResult> {
  const cwd = options.cwd ?? process.cwd();

  // ── --check: report violations without modifying anything ──────────────────
  if (options.check) {
    logger.info('[Sanitize] Check mode — scanning for violations (no modifications)');
    const result = await checkOnly({ cwd, threshold: options.threshold, _inspect: options._inspect });
    if (result.ok) {
      logger.success(`[Sanitize] ✓ All files are within the ${result.threshold} LOC threshold`);
      return {
        cyclesRun: 0, filesProcessed: 0, filesSplit: 0, filesSkipped: 0,
        remainingViolations: 0, success: true,
        sessionPath: '',
      };
    }
    logger.error(`[Sanitize] ✗ ${result.violations.length} file(s) exceed ${result.threshold} LOC:`);
    for (const v of result.violations) {
      logger.error(`  ${v.path}  (${v.loc} LOC)`);
    }
    process.exitCode = 1;
    return {
      cyclesRun: 0, filesProcessed: 0, filesSplit: 0,
      filesSkipped: result.violations.length,
      remainingViolations: result.violations.length,
      success: false,
      sessionPath: '',
    };
  }

  // ── --undo: restore the most recent backup ────────────────────────────────
  if (options.undo) {
    logger.info('[Sanitize] Undo mode — restoring most recent backup');
    const result = await undoLastSplit({ cwd });
    if (result.restored.length > 0) {
      logger.success(`[Sanitize] ✓ Restored: ${result.restored.join(', ')}`);
    } else {
      logger.error(`[Sanitize] ✗ Undo failed: ${result.reason ?? 'unknown'}`);
      process.exitCode = 1;
    }
    return {
      cyclesRun: 0, filesProcessed: result.restored.length + result.failed.length,
      filesSplit: 0, filesSkipped: 0, remainingViolations: 0,
      success: result.restored.length > 0,
      sessionPath: '',
    };
  }

  // ── --prune-backups: housekeeping ──────────────────────────────────────────
  if (options.pruneBackups) {
    logger.info('[Sanitize] Pruning old backups');
    const result = await pruneBackups({ cwd, retentionDays: options.retentionDays });
    logger.info(`[Sanitize] Pruned ${result.deleted}/${result.scanned} backups, freed ${(result.totalBytesFreed / 1024).toFixed(1)} KB`);
    return {
      cyclesRun: 0, filesProcessed: result.scanned, filesSplit: 0,
      filesSkipped: result.deleted, remainingViolations: 0,
      success: true,
      sessionPath: '',
    };
  }

  // Early-mode warning for non-dry-run, non-test execution
  if (!options.dryRun && !options.yes && !options._callLLM) {
    logger.warn('');
    logger.warn('⚠  DanteSanitize v2 (Hybrid AST + LLM):');
    logger.warn('   - Tier 1 (deterministic AST mover) handles types/interfaces/enums/pure-functions for free');
    logger.warn('   - Tier 2 (LLM fallback) fires only when AST refuses; not yet benchmarked live');
    logger.warn('   - AST-delta validation catches dropped/invented symbols before disk write');
    logger.warn('   - Frozen files (agent-guard.json) are deferred to platform-kernel workstream');
    logger.warn('   - Run on a git-clean tree, on a feature branch. Pass --yes to suppress this warning.');
    logger.warn('');
  }

  logger.info('[Sanitize] Starting DanteSanitize — scanning for oversized files...');

  const result = await runSanitize(options);

  // Final report
  logger.info('');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(' DanteSanitize — Complete');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info(`  Cycles run:           ${result.cyclesRun}`);
  logger.info(`  Files split:          ${result.filesSplit}`);
  logger.info(`  Files skipped:        ${result.filesSkipped}`);
  logger.info(`  Remaining violations: ${result.remainingViolations}`);
  logger.info('');

  if (result.success) {
    logger.success('[Sanitize] ✓ Project is clean — no files exceed the LOC threshold.');
  } else if (options.dryRun) {
    logger.info('[Sanitize] Dry run complete. Run without --dry-run to apply splits.');
  } else {
    logger.warn(
      `[Sanitize] ${result.remainingViolations} file(s) still exceed the threshold. ` +
      `Run again to continue, or check ${result.sessionPath} for details.`,
    );
  }

  return result;
}
