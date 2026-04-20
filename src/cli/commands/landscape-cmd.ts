// src/cli/commands/landscape-cmd.ts — CLI handlers for landscape/ranking/gap/diff

import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import type { LandscapeMatrix } from '../../dossier/types.js';

export interface LandscapeOptions {
  cwd?: string;
  selfId?: string;           // default: "dantescode"
  // Injection seams
  _buildLandscape?: typeof import('../../dossier/landscape.js').buildLandscape;
  _loadLandscape?: typeof import('../../dossier/landscape.js').loadLandscape;
}

export async function landscapeBuild(options: LandscapeOptions = {}): Promise<void> {
  return withErrorBoundary('landscape', async () => {
    const cwd = options.cwd ?? process.cwd();
    const { buildLandscape: defaultBuild } = await import('../../dossier/landscape.js');
    const buildFn = options._buildLandscape ?? defaultBuild;

    logger.info('[Landscape] Assembling competitive landscape from dossiers...');
    const matrix = await buildFn(cwd, {}, options.selfId ?? 'dantescode');
    printLandscapeSummary(matrix);
    logger.success('[Landscape] Saved to .danteforge/COMPETITIVE_LANDSCAPE.md');
  });
}

export async function landscapeDiff(options: LandscapeOptions = {}): Promise<void> {
  return withErrorBoundary('landscape diff', async () => {
    const cwd = options.cwd ?? process.cwd();
    const { loadLandscape: defaultLoad } = await import('../../dossier/landscape.js');
    const loadFn = options._loadLandscape ?? defaultLoad;

    const landscape = await loadFn(cwd);
    if (!landscape) {
      logger.error('[Landscape] No landscape found. Run: danteforge landscape');
      return;
    }
    logger.info(`[Landscape] Last generated: ${landscape.generatedAt.slice(0, 16)}`);
    logger.info(`[Landscape] Rubric version: ${landscape.rubricVersion}`);
    logger.info('[Landscape] Run `danteforge landscape` to regenerate and compare.');
  });
}

export async function landscapeRanking(options: LandscapeOptions = {}): Promise<void> {
  return withErrorBoundary('landscape ranking', async () => {
    const cwd = options.cwd ?? process.cwd();
    const { loadLandscape: defaultLoad } = await import('../../dossier/landscape.js');
    const loadFn = options._loadLandscape ?? defaultLoad;

    const landscape = await loadFn(cwd);
    if (!landscape) {
      logger.error('[Landscape] No landscape found. Run: danteforge landscape');
      return;
    }

    logger.info('\nCompetitive Rankings:');
    logger.info('─'.repeat(50));
    landscape.rankings.forEach((r, i) => {
      const marker = r.competitor === (options.selfId ?? 'dantescode') ? ' ← YOU' : '';
      logger.info(
        `  ${String(i + 1).padStart(2)}. ${r.displayName.padEnd(22)} ${r.composite.toFixed(1)}/10  (${r.type})${marker}`,
      );
    });
    logger.info('─'.repeat(50));
  });
}

export async function landscapeGap(options: LandscapeOptions & { target?: string } = {}): Promise<void> {
  return withErrorBoundary('landscape gap', async () => {
    const cwd = options.cwd ?? process.cwd();
    const selfId = options.target ?? options.selfId ?? 'dantescode';
    const { loadLandscape: defaultLoad } = await import('../../dossier/landscape.js');
    const loadFn = options._loadLandscape ?? defaultLoad;

    const landscape = await loadFn(cwd);
    if (!landscape) {
      logger.error('[Landscape] No landscape found. Run: danteforge landscape');
      return;
    }

    if (!landscape.gapAnalysis || landscape.gapAnalysis.length === 0) {
      logger.info(`[Landscape] No gaps > 1.0 found for ${selfId}. Well done!`);
      return;
    }

    logger.info(`\nGap Analysis for ${selfId}:`);
    logger.info('─'.repeat(60));
    for (const gap of landscape.gapAnalysis) {
      logger.info(
        `  Dim ${gap.dim}: ${gap.dcScore.toFixed(1)} → ${gap.leader} at ${gap.leaderScore.toFixed(1)}  (gap: ${gap.gap.toFixed(1)})`,
      );
    }
    logger.info('─'.repeat(60));
    logger.info(`\nRun: danteforge dossier build dantescode  to refresh self-scores`);
  });
}

function printLandscapeSummary(matrix: LandscapeMatrix): void {
  logger.info(`\nLandscape generated: ${matrix.generatedAt.slice(0, 16)}`);
  logger.info(`Rubric version: ${matrix.rubricVersion}  |  Competitors: ${matrix.competitors.length}`);
  logger.info('\nTop rankings:');
  matrix.rankings.slice(0, 5).forEach((r, i) => {
    logger.info(`  ${i + 1}. ${r.displayName.padEnd(22)} ${r.composite.toFixed(1)}/10`);
  });
  if (matrix.rankings.length > 5) {
    logger.info(`  ... (${matrix.rankings.length - 5} more)`);
  }
}
