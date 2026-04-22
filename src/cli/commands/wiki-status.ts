// wiki-status command — display wiki health metrics
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { getWikiHealth } from '../../core/wiki-engine.js';
import type { WikiEngineOptions } from '../../core/wiki-engine.js';
import type { WikiHealth } from '../../core/wiki-schema.js';

export interface WikiStatusCommandOptions {
  json?: boolean;
  cwd?: string;
  _getHealth?: (opts: WikiEngineOptions) => Promise<WikiHealth | null>;
}

export async function wikiStatusCommand(options: WikiStatusCommandOptions = {}): Promise<void> {
  return withErrorBoundary('wiki-status', async () => {
    const cwd = options.cwd ?? process.cwd();
    const fn = options._getHealth ?? getWikiHealth;
    const health = await fn({ cwd });

    if (!health) {
      logger.warn('Wiki not initialized. Run `danteforge wiki-ingest --bootstrap` to get started.');
      return;
    }

    if (options.json) {
      process.stdout.write(JSON.stringify(health, null, 2) + '\n');
      return;
    }

    const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

    logger.info('━━━ Wiki Health ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(`Pages:          ${health.pageCount}`);
    logger.info(`Link density:   ${health.linkDensity.toFixed(2)} avg links/page`);
    logger.info(`Orphan pages:   ${pct(health.orphanRatio)} (${health.orphanRatio <= 0.05 ? '✓ OK' : '⚠ High'})`);
    logger.info(`Stale pages:    ${pct(health.stalenessScore)} (${health.stalenessScore <= 0.1 ? '✓ OK' : '⚠ High'})`);
    logger.info(`Lint pass rate: ${pct(health.lintPassRate)} (${health.lintPassRate >= 0.95 ? '✓ OK' : '⚠ Below target'})`);
    logger.info(`Last lint:      ${health.lastLint ?? 'Never'}`);

    if (health.anomalyCount > 0) {
      logger.warn(`⚠  PDSE anomalies: ${health.anomalyCount} active — run \`danteforge wiki-status --json\` for details`);
    } else {
      logger.info(`PDSE anomalies: none`);
    }

    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  });
}
