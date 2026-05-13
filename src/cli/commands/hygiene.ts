import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import {
  cleanGeneratedAgentState,
  ensureProjectIgnores,
  inspectProjectHygiene,
} from '../../core/project-ignores.js';
import {
  inspectSourceFileSizes,
  writeFileSizeRefactorPlan,
} from '../../core/file-size-hygiene.js';

export interface HygieneOptions {
  fix?: boolean;
  clean?: boolean;
  dryRun?: boolean;
  force?: boolean;
  sizeReport?: boolean;
  sizePlan?: boolean;
  cwd?: string;
}

function logInspection(report: Awaited<ReturnType<typeof inspectProjectHygiene>>): void {
  for (const ignore of report.ignoreFiles) {
    if (ignore.missingEntries.length === 0) {
      logger.success(`[OK] ${ignore.file}: agent cache ignores are covered`);
    } else {
      logger.warn(`[WARN] ${ignore.file}: missing ${ignore.missingEntries.length} hygiene pattern(s)`);
    }
  }

  if (report.cleanupCandidates.length === 0) {
    logger.success('[OK] Generated agent caches: no cleanup candidates found');
    return;
  }

  logger.warn(`[WARN] Generated agent caches: ${report.cleanupCandidates.length} cleanup candidate(s)`);
  for (const candidate of report.cleanupCandidates.slice(0, 20)) {
    logger.info(`  ${candidate.kind}: ${candidate.relativePath}`);
  }
  if (report.cleanupCandidates.length > 20) {
    logger.info(`  ...and ${report.cleanupCandidates.length - 20} more`);
  }
}

async function logFileSizeReport(cwd: string, writePlan: boolean): Promise<void> {
  const report = await inspectSourceFileSizes(cwd);
  const overTarget = report.files
    .filter(file => file.loc > report.summary.idealLimit)
    .sort((a, b) => b.loc - a.loc);

  if (overTarget.length === 0) {
    logger.success('[OK] Source file sizes: all files are at or below the 500 LOC target');
  } else {
    logger.warn(`[WARN] Source file sizes: ${overTarget.length} file(s) exceed the 500 LOC target`);
    for (const file of overTarget.slice(0, 20)) {
      const label = file.status === 'legacy' ? 'LEGACY' : file.status.toUpperCase();
      logger.info(`  ${label.padEnd(6)} ${String(file.loc).padStart(5)} LOC  ${file.relativePath}`);
    }
    if (overTarget.length > 20) {
      logger.info(`  ...and ${overTarget.length - 20} more`);
    }
  }

  if (writePlan) {
    const planPath = await writeFileSizeRefactorPlan(cwd, report);
    logger.success(`File-size refactor plan written: ${planPath}`);
  }
}

export async function hygiene(options: HygieneOptions = {}): Promise<void> {
  return withErrorBoundary('hygiene', async () => {
    const cwd = options.cwd ?? process.cwd();
    logger.success('DanteForge Hygiene - Agent Cache Safety');

    if (options.fix) {
      await ensureProjectIgnores(cwd, { configureGit: true });
      logger.success('Ignore files and safe local Git config repaired.');
    }

    const report = await inspectProjectHygiene(cwd);
    logInspection(report);

    if (options.clean) {
      const dryRun = options.dryRun ?? true;
      const cleanup = await cleanGeneratedAgentState(cwd, {
        dryRun,
        force: options.force,
      });
      if (cleanup.actions.length === 0) {
        logger.success('[OK] Cleanup: nothing to remove');
      } else {
        for (const action of cleanup.actions) {
          const label = action.status === 'would-remove'
            ? 'Would remove'
            : action.status === 'removed'
              ? 'Removed'
              : 'Skipped';
          logger[action.status === 'skipped' ? 'warn' : 'info'](
            `${label}: ${action.relativePath}${action.reason ? ` (${action.reason})` : ''}`,
          );
        }
      }
      if (dryRun) {
        logger.info('Dry run complete. Re-run with --clean --no-dry-run to remove generated caches.');
      }
    }

    if (options.sizeReport || options.sizePlan) {
      await logFileSizeReport(cwd, options.sizePlan === true);
    }
  });
}
