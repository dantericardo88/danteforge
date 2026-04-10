// wiki-lint command — run the self-evolution lint cycle on the wiki
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { runLintCycle } from '../../core/wiki-linter.js';
import type { WikiLintOptions } from '../../core/wiki-linter.js';
import type { WikiLintReport } from '../../core/wiki-schema.js';

export interface WikiLintCommandOptions {
  heuristicOnly?: boolean;
  prompt?: boolean;
  cwd?: string;
  _lint?: (opts: WikiLintOptions) => Promise<WikiLintReport>;
}

export async function wikiLintCommand(options: WikiLintCommandOptions = {}): Promise<void> {
  return withErrorBoundary('wiki-lint', async () => {
    const cwd = options.cwd ?? process.cwd();

    if (options.prompt) {
      logger.info('danteforge wiki-lint [--heuristic-only]');
      logger.info('Runs four-pass self-evolution scan: contradictions, staleness, link integrity, pattern synthesis.');
      logger.info('--heuristic-only: skip LLM calls (zero-cost mode)');
      return;
    }

    const lintOpts: WikiLintOptions = {
      cwd,
      heuristicOnly: options.heuristicOnly ?? false,
    };

    logger.info(`Running wiki lint cycle${options.heuristicOnly ? ' (heuristic-only)' : ''}...`);

    const fn = options._lint ?? runLintCycle;
    const report = await fn(lintOpts);

    if (report.totalIssues === 0) {
      logger.success(`Wiki lint: clean — no issues found (${report.passRate * 100}% pass rate)`);
    } else {
      logger.warn(`Wiki lint: ${report.totalIssues} issue(s) found (${(report.passRate * 100).toFixed(1)}% pass rate)`);
    }

    if (report.contradictions.length > 0) {
      logger.warn(`  Contradictions: ${report.contradictions.length}`);
      report.contradictions.filter(c => !c.autoResolved).forEach(c =>
        logger.warn(`    [REVIEW] ${c.entityId}: ${c.claimA.slice(0, 60)} vs ${c.claimB.slice(0, 60)}`)
      );
    }

    if (report.stalePages.length > 0) {
      logger.warn(`  Stale pages: ${report.stalePages.length}`);
      report.stalePages.slice(0, 5).forEach(s =>
        logger.warn(`    ${s.entityId} (${s.daysSinceUpdate} days)`)
      );
    }

    if (report.brokenLinks.length > 0) {
      logger.warn(`  Broken links fixed: ${report.brokenLinks.filter(b => b.skeletonCreated).length} skeleton pages created`);
    }

    if (report.patternSuggestions.length > 0) {
      logger.info(`  Pattern suggestions: ${report.patternSuggestions.length}`);
      report.patternSuggestions.forEach(p => logger.info(`    → ${p.suggestedEntity}`));
    }

    logger.info('Lint report written to .danteforge/wiki/LINT_REPORT.md');
  });
}
