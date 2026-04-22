// Ship command - paranoid release guidance and planning.
// Fail-closed: CRITICAL findings block ship unless acknowledged.
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { buildShipPlan } from '../../core/ship-engine.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

export async function ship(options: {
  dryRun?: boolean;
  skipReview?: boolean;
  _buildShipPlan?: (cwd: string, isDryRun: boolean) => Promise<import('../../core/ship-engine.js').ShipPlan>;
  _loadState?: () => Promise<import('../../core/state.js').DanteState>;
  _saveState?: (state: import('../../core/state.js').DanteState) => Promise<void>;
} = {}) {
  return withErrorBoundary('ship', async () => {
  const cwd = process.cwd();
  const timestamp = new Date().toISOString();

  logger.info('Building release guidance...');

  const planFn = options._buildShipPlan ?? buildShipPlan;
  const plan = await planFn(cwd, Boolean(options.dryRun));

  if (plan.reviewResult.critical.length > 0) {
    logger.error(`\n${plan.reviewResult.critical.length} CRITICAL finding(s):`);
    for (const finding of plan.reviewResult.critical) {
      logger.error(`  x [${finding.category}] ${finding.filePath}${finding.lineNumber ? `:${finding.lineNumber}` : ''}`);
      logger.error(`    ${finding.description}`);
      logger.error(`    Recommendation: ${finding.recommendation}`);
    }
  }

  if (plan.reviewResult.informational.length > 0) {
    logger.info(`\n${plan.reviewResult.informational.length} INFORMATIONAL finding(s):`);
    for (const finding of plan.reviewResult.informational) {
      logger.info(`  - [${finding.category}] ${finding.filePath}${finding.lineNumber ? `:${finding.lineNumber}` : ''}: ${finding.description}`);
    }
  }

  logger.info(`\nVersion: ${plan.currentVersion} -> ${plan.newVersion} (${plan.bumpLevel})`);
  logger.info(`Commit groups: ${plan.commitGroups.length}`);
  for (const group of plan.commitGroups) {
    logger.info(`  ${group.type}: ${group.files.length} file(s) - "${group.message}"`);
  }

  if (options.dryRun) {
    logger.info('\n[DRY RUN] Guidance generated without additional audit intent.');
  }

  logger.info('This command is guidance-only in GA hardening mode. It does not mutate git history or open PRs.');

  if (plan.reviewResult.critical.length > 0 && !options.skipReview) {
    logger.error('\nShip BLOCKED by CRITICAL findings. Resolve them or use --skip-review (emergency only).');
    process.exitCode = 1;
  }

  try {
    const state = await (options._loadState ?? loadState)();
    const mode = options.dryRun ? 'dry-run' : 'execute';
    state.auditLog.push(
      `${timestamp} | ship: ${mode} ${plan.currentVersion}->${plan.newVersion} (${plan.reviewResult.critical.length} critical, ${plan.reviewResult.informational.length} info)`,
    );
    if (options.skipReview) {
      state.auditLog.push(`${timestamp} | ship: WARNING --skip-review used, bypassing ${plan.reviewResult.critical.length} critical findings`);
    }
    await (options._saveState ?? saveState)(state);
  } catch {
    // State save is best-effort
  }
  });
}
