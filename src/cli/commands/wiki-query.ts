// wiki-query command — search wiki for entity pages relevant to a topic
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { query } from '../../core/wiki-engine.js';
import type { WikiQueryOptions } from '../../core/wiki-engine.js';
import type { WikiQueryResult } from '../../core/wiki-schema.js';

export interface WikiQueryCommandOptions {
  topic: string;
  json?: boolean;
  cwd?: string;
  _query?: (topic: string, opts: WikiQueryOptions) => Promise<WikiQueryResult[]>;
}

export async function wikiQueryCommand(options: WikiQueryCommandOptions): Promise<void> {
  return withErrorBoundary('wiki-query', async () => {
    const cwd = options.cwd ?? process.cwd();
    const fn = options._query ?? query;

    const results = await fn(options.topic, { cwd });

    if (options.json) {
      process.stdout.write(JSON.stringify(results, null, 2) + '\n');
      return;
    }

    if (results.length === 0) {
      logger.info(`No wiki results found for: "${options.topic}"`);
      logger.info('Tip: run `danteforge wiki-ingest` to populate the wiki first.');
      return;
    }

    logger.info(`Wiki results for: "${options.topic}" (${results.length} found)\n`);

    for (const result of results) {
      const scoreBar = '█'.repeat(Math.round(result.score * 10)).padEnd(10, '░');
      const tagStr = result.tags?.length ? ` [${result.tags.slice(0, 3).join(', ')}]` : '';
      logger.info(`${scoreBar} ${result.entityId} (${result.entityType})${tagStr}`);
      if (result.excerpt) {
        logger.info(`  ${result.excerpt.slice(0, 120)}`);
      }
      if (result.sources?.length > 0) {
        logger.info(`  Sources: ${result.sources.slice(0, 2).join(', ')}`);
      }
      logger.info('');
    }
  });
}
