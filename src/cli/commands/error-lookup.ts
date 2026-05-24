// error-lookup.ts — CLI surface for the existing src/core/error-catalog.ts.
// Lists all DF-CATEGORY-NNN codes or shows detail for a specific one.

import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import {
  ERROR_CATALOG,
  getCatalogedError,
  formatCatalogedError,
  type CatalogedError,
  type ErrorCategory,
} from '../../core/error-catalog.js';

// ── Filtering / grouping ──────────────────────────────────────────────────────

const CATEGORY_ORDER: ErrorCategory[] = ['setup', 'config', 'workflow', 'execution', 'verification'];

function groupByCategory(entries: CatalogedError[]): Record<ErrorCategory, CatalogedError[]> {
  const out = { setup: [], config: [], workflow: [], execution: [], verification: [] } as
    Record<ErrorCategory, CatalogedError[]>;
  for (const e of entries) out[e.category].push(e);
  return out;
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function formatCatalogIndex(filter?: ErrorCategory): string {
  const entries = Object.values(ERROR_CATALOG);
  const filtered = filter ? entries.filter(e => e.category === filter) : entries;
  const grouped = groupByCategory(filtered);

  const lines: string[] = [];
  lines.push(chalk.bold('\nDanteForge Error Catalog'));
  lines.push(chalk.dim('─'.repeat(50)));
  lines.push('');
  lines.push(chalk.dim(`  ${filtered.length} cataloged errors${filter ? ` in category "${filter}"` : ''}`));
  lines.push('');

  for (const category of CATEGORY_ORDER) {
    const inCategory = grouped[category];
    if (inCategory.length === 0) continue;
    lines.push(chalk.bold(`  ${category.toUpperCase()}:`));
    for (const e of inCategory) {
      lines.push(`    ${chalk.cyan(e.code)}  ${e.title}`);
    }
    lines.push('');
  }

  lines.push(chalk.dim(`  Run "danteforge error-lookup <code>" for full details.`));
  return lines.join('\n');
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

export async function runErrorLookup(
  code: string | undefined,
  opts: { json?: boolean; category?: string } = {},
): Promise<void> {
  if (!code) {
    if (opts.json) {
      const entries = Object.values(ERROR_CATALOG);
      const filtered = opts.category
        ? entries.filter(e => e.category === opts.category)
        : entries;
      process.stdout.write(JSON.stringify(filtered, null, 2) + '\n');
    } else {
      const category = opts.category && CATEGORY_ORDER.includes(opts.category as ErrorCategory)
        ? (opts.category as ErrorCategory)
        : undefined;
      logger.info(formatCatalogIndex(category));
    }
    return;
  }

  const normalized = code.toUpperCase();
  const entry = getCatalogedError(normalized);
  if (!entry) {
    const message = `Unknown error code: ${code}`;
    if (opts.json) {
      process.stdout.write(JSON.stringify({ error: 'unknown_code', code: normalized }, null, 2) + '\n');
    } else {
      logger.error(message);
      logger.info('Run "danteforge error-lookup" with no argument to see all codes.');
    }
    process.exitCode = 1;
    return;
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(entry, null, 2) + '\n');
  } else {
    logger.info(formatCatalogedError(entry));
  }
}
