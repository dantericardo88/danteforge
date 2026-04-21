// src/cli/commands/dossier.ts - CLI handlers for dossier build/diff/show

import path from 'node:path';
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import type { Dossier } from '../../dossier/types.js';

export interface DossierBuildOptions {
  cwd?: string;
  all?: boolean;
  sources?: string;
  since?: string;
  _buildDossier?: typeof import('../../dossier/builder.js').buildDossier;
  _buildAllDossiers?: typeof import('../../dossier/builder.js').buildAllDossiers;
}

export interface DossierDiffOptions {
  cwd?: string;
  _loadDossier?: typeof import('../../dossier/builder.js').loadDossier;
  _loadPreviousDossier?: typeof import('../../dossier/builder.js').loadPreviousDossier;
}

export interface DossierShowOptions {
  cwd?: string;
  dim?: string;
  _loadDossier?: typeof import('../../dossier/builder.js').loadDossier;
}

export async function dossierBuild(
  competitorArg: string | undefined,
  options: DossierBuildOptions = {},
): Promise<void> {
  return withErrorBoundary('dossier build', async () => {
    const cwd = options.cwd ?? process.cwd();
    const { buildDossier: defaultBuild, buildAllDossiers: defaultBuildAll } = await import('../../dossier/builder.js');
    const buildDossierFn = options._buildDossier ?? defaultBuild;
    const buildAllFn = options._buildAllDossiers ?? defaultBuildAll;

    const sourceUrls = options.sources
      ? options.sources.split(',').map((source) => source.trim()).filter(Boolean)
      : undefined;

    if (options.all) {
      logger.info('[Dossier] Building all competitors...');
      const dossiers = await buildAllFn({ cwd, since: options.since });
      logger.success(`[Dossier] Built ${dossiers.length} dossiers.`);
      for (const dossier of dossiers) {
        logger.info(`  ${dossier.displayName}: ${dossier.composite.toFixed(1)}/10 composite`);
      }
      return;
    }

    if (!competitorArg) {
      logger.error('[Dossier] Specify a competitor id or use --all.\n  Example: danteforge dossier build cursor');
      return;
    }

    logger.info(`[Dossier] Building dossier for: ${competitorArg}`);
    const dossier = await buildDossierFn({
      cwd,
      competitor: competitorArg,
      sources: sourceUrls,
      since: options.since,
    });

    printDossierSummary(dossier);

    // Auto-classify COFL role and persist to registry (best-effort)
    try {
      const { classifyCompetitorRoles, loadCoflRegistry, saveCoflRegistry } = await import('../../core/cofl-engine.js');
      const { loadMatrix } = await import('../../core/compete-matrix.js');
      const matrix = await loadMatrix(cwd).catch(() => null);
      if (matrix) {
        const partition = classifyCompetitorRoles(
          matrix.competitors_closed_source ?? [],
          matrix.competitors_oss ?? [],
        );
        const needle = competitorArg.toLowerCase();
        const displayNeedle = dossier.displayName.toLowerCase();
        const isMatch = (list: string[]) =>
          list.some(c => c.toLowerCase() === needle || c.toLowerCase() === displayNeedle);
        const role = isMatch(partition.directPeers) ? 'direct_peer'
          : isMatch(partition.specialistTeachers) ? 'specialist_teacher'
          : isMatch(partition.referenceTeachers) ? 'reference_teacher'
          : 'unclassified';

        logger.info(`[Dossier] COFL role: ${role}`);
        if (role === 'direct_peer') logger.info('  → Scoreboard: track this gap, do not cargo-cult patterns');
        else if (role === 'specialist_teacher') logger.info('  → Specialist teacher: harvest domain-specific patterns via /inferno');
        else if (role === 'reference_teacher') logger.info('  → Reference teacher: harvest broad operator patterns via /inferno');
        else logger.info('  → Run `danteforge cofl --universe` to classify this competitor');

        // Persist updated partition to COFL registry if it has changed
        const registry = await loadCoflRegistry(cwd);
        const changed = registry.partition.directPeers.length !== partition.directPeers.length
          || registry.partition.referenceTeachers.length !== partition.referenceTeachers.length
          || registry.partition.specialistTeachers.length !== partition.specialistTeachers.length;
        if (changed) {
          await saveCoflRegistry({ ...registry, partition, updatedAt: new Date().toISOString() }, cwd);
          logger.info('[Dossier] COFL registry partition updated.');
        }
      }
    } catch { /* best-effort — never block dossier output */ }
  });
}

export async function dossierDiff(
  competitor: string,
  options: DossierDiffOptions = {},
): Promise<void> {
  return withErrorBoundary('dossier diff', async () => {
    const cwd = options.cwd ?? process.cwd();
    const { loadDossier: defaultLoad, loadPreviousDossier: defaultLoadPrevious } = await import('../../dossier/builder.js');
    const { diffDossiers, formatDeltaReport } = await import('../../dossier/diff.js');
    const loadDossierFn = options._loadDossier ?? defaultLoad;
    const loadPreviousDossierFn = options._loadPreviousDossier ?? defaultLoadPrevious;

    const current = await loadDossierFn(cwd, competitor);
    if (!current) {
      logger.error(`[Dossier] No dossier found for "${competitor}". Run: danteforge dossier build ${competitor}`);
      return;
    }

    const previous = await loadPreviousDossierFn(cwd, competitor);
    if (!previous) {
      logger.info(`[Dossier] Diff for: ${current.displayName}`);
      logger.info(`  Last built: ${current.lastBuilt.slice(0, 16)}`);
      logger.info(`  Composite: ${current.composite.toFixed(1)}/10`);
      logger.info('  No previous snapshot found yet. Build this dossier again to start diff tracking.');
      return;
    }

    logger.info(formatDeltaReport(diffDossiers(previous, current)));
  });
}

export async function dossierShow(
  competitor: string,
  options: DossierShowOptions = {},
): Promise<void> {
  return withErrorBoundary('dossier show', async () => {
    const cwd = options.cwd ?? process.cwd();
    const { loadDossier: defaultLoad } = await import('../../dossier/builder.js');
    const loadDossierFn = options._loadDossier ?? defaultLoad;

    const dossier = await loadDossierFn(cwd, competitor);
    if (!dossier) {
      logger.error(`[Dossier] No dossier found for "${competitor}". Run: danteforge dossier build ${competitor}`);
      return;
    }

    if (options.dim) {
      const dimKey = String(parseInt(options.dim, 10));
      const dim = dossier.dimensions[dimKey];
      if (!dim) {
        logger.error(`[Dossier] No data for dimension ${options.dim}`);
        return;
      }

      logger.info(`\n${competitor} - Dimension ${options.dim}`);
      logger.info(`Score: ${dim.score}/10${dim.humanOverride !== null ? ` (override: ${dim.humanOverride})` : ''}`);
      if (dim.unverified) logger.warn('  [!] Unverified (no evidence with non-empty quote)');
      logger.info(`Justification: ${dim.scoreJustification}`);
      logger.info(`\nEvidence (${dim.evidence.length} items):`);
      for (const evidence of dim.evidence) {
        logger.info(`  - ${evidence.claim}`);
        if (evidence.quote) {
          const suffix = evidence.quote.length > 120 ? '...' : '';
          logger.info(`    "${evidence.quote.slice(0, 120)}${suffix}"`);
        }
        logger.info(`    Source: ${evidence.source}`);
      }
      return;
    }

    printDossierSummary(dossier);
  });
}

function printDossierSummary(dossier: Dossier): void {
  logger.info(`\n${dossier.displayName} (${dossier.type})`);
  logger.info(`Composite: ${dossier.composite.toFixed(1)}/10  |  Built: ${dossier.lastBuilt.slice(0, 10)}`);
  logger.info(`Rubric version: ${dossier.rubricVersion}  |  Sources: ${dossier.sources.length}`);
  logger.info('\nPer-dimension scores:');

  const dimKeys = Object.keys(dossier.dimensions).sort((a, b) => Number(a) - Number(b));
  for (const dimKey of dimKeys) {
    const dim = dossier.dimensions[dimKey]!;
    const effectiveScore = dim.humanOverride ?? dim.score;
    const overrideNote = dim.humanOverride !== null ? ' [override]' : '';
    const unverifiedNote = dim.unverified ? ' [!]' : '';
    logger.info(
      `  Dim ${dimKey.padEnd(3)}: ${String(effectiveScore.toFixed(1)).padStart(4)}/10${overrideNote}${unverifiedNote}  ${dim.scoreJustification.slice(0, 60)}`,
    );
  }

  const unverifiedCount = Object.values(dossier.dimensions).filter((dim) => dim.unverified).length;
  if (unverifiedCount > 0) {
    logger.warn(`\n  [!] ${unverifiedCount} dimension(s) unverified (no evidence with non-empty quote)`);
  }

  logger.success(`\nDossier saved to .danteforge/dossiers/${dossier.competitor}.json`);
}

export async function dossierList(options: { cwd?: string } = {}): Promise<void> {
  return withErrorBoundary('dossier list', async () => {
    const cwd = options.cwd ?? process.cwd();
    const { listDossiers } = await import('../../dossier/builder.js');
    const dossiers = await listDossiers(cwd);

    if (dossiers.length === 0) {
      logger.info('[Dossier] No dossiers built yet. Run: danteforge dossier build --all');
      return;
    }

    logger.info(`\nBuilt dossiers (${dossiers.length}):`);
    const sorted = [...dossiers].sort((a, b) => b.composite - a.composite);
    sorted.forEach((dossier, index) => {
      logger.info(
        `  ${index + 1}. ${dossier.displayName.padEnd(20)} ${dossier.composite.toFixed(1)}/10  (${dossier.lastBuilt.slice(0, 10)})`,
      );
    });
  });
}

export type DossierBuildFn = typeof dossierBuild;
export type DossierDiffFn = typeof dossierDiff;
export type DossierShowFn = typeof dossierShow;

export const dossierListFn = dossierList;

export function getDossierPath(cwd: string, competitor: string): string {
  return path.join(cwd, '.danteforge', 'dossiers', `${competitor}.json`);
}
