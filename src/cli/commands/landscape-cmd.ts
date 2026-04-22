// src/cli/commands/landscape-cmd.ts - CLI handlers for landscape/ranking/gap/diff

import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import type { LandscapeMatrix } from '../../dossier/types.js';

export interface LandscapeOptions {
  cwd?: string;
  selfId?: string;
  _buildLandscape?: typeof import('../../dossier/landscape.js').buildLandscape;
  _loadLandscape?: typeof import('../../dossier/landscape.js').loadLandscape;
  _loadPreviousLandscape?: typeof import('../../dossier/landscape.js').loadPreviousLandscape;
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
    const {
      diffLandscape,
      loadLandscape: defaultLoad,
      loadPreviousLandscape: defaultLoadPrevious,
    } = await import('../../dossier/landscape.js');
    const loadFn = options._loadLandscape ?? defaultLoad;
    const loadPreviousFn = options._loadPreviousLandscape ?? defaultLoadPrevious;

    const current = await loadFn(cwd);
    if (!current) {
      logger.error('[Landscape] No landscape found. Run: danteforge landscape');
      return;
    }

    const previous = await loadPreviousFn(cwd);
    if (!previous) {
      logger.info(`[Landscape] Last generated: ${current.generatedAt.slice(0, 16)}`);
      logger.info(`[Landscape] Rubric version: ${current.rubricVersion}`);
      logger.info('[Landscape] No previous snapshot found yet. Rebuild the landscape again to compare changes.');
      return;
    }

    const delta = diffLandscape(previous, current);
    logger.info(`[Landscape] Diff ${delta.previousGeneratedAt.slice(0, 16)} -> ${delta.currentGeneratedAt.slice(0, 16)}`);

    if (delta.newCompetitors.length > 0) {
      logger.info(`[Landscape] New competitors: ${delta.newCompetitors.join(', ')}`);
    }

    if (delta.removedCompetitors.length > 0) {
      logger.info(`[Landscape] Removed competitors: ${delta.removedCompetitors.join(', ')}`);
    }

    if (delta.rankingChanges.length === 0) {
      logger.info('[Landscape] No ranking or composite changes detected.');
      return;
    }

    logger.info('[Landscape] Ranking changes:');
    for (const change of delta.rankingChanges) {
      const beforeRank = change.beforeRank === null ? 'new' : `#${change.beforeRank}`;
      const afterRank = change.afterRank === null ? 'removed' : `#${change.afterRank}`;
      const compositeDelta =
        change.compositeDelta === 0
          ? '0.0'
          : `${change.compositeDelta > 0 ? '+' : ''}${change.compositeDelta.toFixed(1)}`;
      logger.info(
        `  ${change.displayName}: ${beforeRank} -> ${afterRank} | composite ${compositeDelta}`,
      );
    }
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
    logger.info('-'.repeat(60));

    // Load COFL registry to annotate each competitor with their COFL role (best-effort)
    const roleLookup: Record<string, string> = {};
    try {
      const { loadCoflRegistry } = await import('../../core/cofl-engine.js');
      const cwd = options.cwd ?? process.cwd();
      const registry = await loadCoflRegistry(cwd);
      for (const c of registry.partition.directPeers) roleLookup[c.toLowerCase()] = 'peer';
      for (const c of registry.partition.specialistTeachers) roleLookup[c.toLowerCase()] = 'teacher:spec';
      for (const c of registry.partition.referenceTeachers) roleLookup[c.toLowerCase()] = 'teacher:ref';
    } catch { /* registry not yet built — no role tags */ }

    landscape.rankings.forEach((ranking, index) => {
      const marker = ranking.competitor === (options.selfId ?? 'dantescode') ? ' ← YOU' : '';
      const coflRole = roleLookup[ranking.competitor.toLowerCase()] ?? roleLookup[ranking.displayName.toLowerCase()];
      const roleTag = coflRole ? ` [${coflRole}]` : '';
      logger.info(
        `  ${String(index + 1).padStart(2)}. ${ranking.displayName.padEnd(22)} ${ranking.composite.toFixed(1)}/10  (${ranking.type})${roleTag}${marker}`,
      );
    });
    logger.info('-'.repeat(60));
    if (Object.keys(roleLookup).length > 0) {
      logger.info('  COFL roles: [peer]=scoreboard target  [teacher:ref]=OSS pattern source  [teacher:spec]=specialist borrow');
      logger.info('  Run `danteforge cofl --universe` to refresh role classification.');
    } else {
      logger.info('  Run `danteforge cofl --universe` to classify competitors by COFL role.');
    }
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
    logger.info('-'.repeat(60));
    for (const gap of landscape.gapAnalysis) {
      logger.info(
        `  Dim ${gap.dim}: ${gap.dcScore.toFixed(1)} -> ${gap.leader} at ${gap.leaderScore.toFixed(1)}  (gap: ${gap.gap.toFixed(1)})`,
      );
    }
    logger.info('-'.repeat(60));
    logger.info('\nRun: danteforge dossier build dantescode  to refresh self-scores');
  });
}

function printLandscapeSummary(matrix: LandscapeMatrix): void {
  logger.info(`\nLandscape generated: ${matrix.generatedAt.slice(0, 16)}`);
  logger.info(`Rubric version: ${matrix.rubricVersion}  |  Competitors: ${matrix.competitors.length}`);
  logger.info('\nTop rankings:');
  matrix.rankings.slice(0, 5).forEach((ranking, index) => {
    logger.info(`  ${index + 1}. ${ranking.displayName.padEnd(22)} ${ranking.composite.toFixed(1)}/10`);
  });
  if (matrix.rankings.length > 5) {
    logger.info(`  ... (${matrix.rankings.length - 5} more)`);
  }
}
