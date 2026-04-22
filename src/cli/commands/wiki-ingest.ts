// wiki-ingest command — ingest raw source files into compiled wiki entity pages
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { initWiki, wikiIngest, wikiBootstrap } from '../../core/wiki-engine.js';
import type { WikiEngineOptions } from '../../core/wiki-engine.js';

export interface WikiIngestCommandOptions {
  bootstrap?: boolean;
  prompt?: boolean;
  cwd?: string;
  _ingest?: (opts: WikiEngineOptions) => Promise<{ blocked?: true; reason?: string; processed: string[]; entityPages: string[]; errors: string[] }>;
  _bootstrap?: (opts: WikiEngineOptions) => Promise<{ ingested: string[]; skipped: string[] }>;
}

export async function wikiIngestCommand(options: WikiIngestCommandOptions = {}): Promise<void> {
  return withErrorBoundary('wiki-ingest', async () => {
    const cwd = options.cwd ?? process.cwd();

    if (options.prompt) {
      if (options.bootstrap) {
        logger.info('danteforge wiki-ingest --bootstrap');
        logger.info('Seeds wiki from existing .danteforge/ artifacts (CONSTITUTION.md, SPEC.md, PLAN.md, TASKS.md, lessons.md).');
      } else {
        logger.info('danteforge wiki-ingest');
        logger.info('Scans .danteforge/raw/ for new/changed files and ingests them into compiled wiki entity pages.');
      }
      return;
    }

    const engineOpts: WikiEngineOptions = { cwd };

    // Initialize wiki directories (idempotent)
    await initWiki(engineOpts);

    if (options.bootstrap) {
      logger.info('Bootstrapping wiki from existing artifacts...');
      const fn = options._bootstrap ?? wikiBootstrap;
      const result = await fn(engineOpts);
      logger.success(`Bootstrap complete: ${result.ingested.length} artifacts ingested, ${result.skipped.length} skipped`);
      if (result.ingested.length > 0) {
        result.ingested.forEach(a => logger.info(`  ✓ ${a}`));
      }
      if (result.skipped.length > 0) {
        result.skipped.forEach(a => logger.info(`  - ${a} (not found)`));
      }
      return;
    }

    logger.info('Scanning raw/ for new files to ingest...');
    const fn = options._ingest ?? wikiIngest;
    const result = await fn(engineOpts);

    if (result.blocked) {
      logger.error(`BLOCKED: ${result.reason}`);
      process.exitCode = 1;
      return;
    }

    if (result.processed.length === 0) {
      logger.info('No new or changed files found in raw/');
      return;
    }

    logger.success(`Ingested ${result.processed.length} files → ${result.entityPages.length} entity pages`);
    if (result.errors.length > 0) {
      logger.warn(`${result.errors.length} errors:`);
      result.errors.slice(0, 5).forEach(e => logger.warn(`  ${e}`));
    }
  });
}
