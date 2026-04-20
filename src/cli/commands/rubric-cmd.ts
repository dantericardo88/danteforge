// src/cli/commands/rubric-cmd.ts — CLI handlers for rubric show/init/validate/add-dim

import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import type { Rubric, RubricDimension } from '../../dossier/types.js';

export interface RubricOptions {
  cwd?: string;
  dim?: string;
  // Injection seams
  _getRubric?: typeof import('../../dossier/rubric.js').getRubric;
  _saveRubric?: typeof import('../../dossier/rubric.js').saveRubric;
  _listDossiers?: typeof import('../../dossier/builder.js').listDossiers;
}

export async function rubricShow(options: RubricOptions = {}): Promise<void> {
  return withErrorBoundary('rubric show', async () => {
    const cwd = options.cwd ?? process.cwd();
    const { getRubric: defaultGet } = await import('../../dossier/rubric.js');
    const getRubricFn = options._getRubric ?? defaultGet;

    const rubric = await getRubricFn(cwd);

    if (options.dim) {
      const dimKey = String(parseInt(options.dim, 10));
      const dimDef = rubric.dimensions[dimKey];
      if (!dimDef) {
        logger.error(`[Rubric] Dimension ${options.dim} not found`);
        return;
      }
      printDimCriteria(dimKey, dimDef);
      return;
    }

    logger.info(`\nRubric v${rubric.version} (frozen: ${rubric.frozenAt})`);
    logger.info(`Dimensions: ${Object.keys(rubric.dimensions).length}`);
    logger.info('');
    const keys = Object.keys(rubric.dimensions).sort((a, b) => Number(a) - Number(b));
    for (const key of keys) {
      const dim = rubric.dimensions[key]!;
      logger.info(`  ${key.padEnd(3)}: ${dim.name}`);
    }
  });
}

export async function rubricInit(options: RubricOptions = {}): Promise<void> {
  return withErrorBoundary('rubric init', async () => {
    const cwd = options.cwd ?? process.cwd();
    const { getRubric: defaultGet } = await import('../../dossier/rubric.js');

    try {
      const existing = await (options._getRubric ?? defaultGet)(cwd);
      logger.info(`[Rubric] Rubric already exists (v${existing.version}, frozen: ${existing.frozenAt})`);
      logger.info('[Rubric] Use `danteforge rubric add-dim` to add new dimensions.');
      return;
    } catch { /* not found — create it */ }

    logger.info('[Rubric] Rubric not found. Copying from project seed file...');
    logger.info('[Rubric] The project ships with a 28-dimension rubric at .danteforge/rubric.json.');
    logger.info('[Rubric] If the file is missing, re-run: danteforge dossier build --all');
    logger.info('[Rubric] (rubric.json is committed to source control — check .danteforge/)');
  });
}

export async function rubricValidate(options: RubricOptions = {}): Promise<void> {
  return withErrorBoundary('rubric validate', async () => {
    const cwd = options.cwd ?? process.cwd();
    const { getRubric: defaultGet } = await import('../../dossier/rubric.js');
    const { listDossiers: defaultList } = await import('../../dossier/builder.js');
    const getRubricFn = options._getRubric ?? defaultGet;
    const listDossiersFn = options._listDossiers ?? defaultList;

    const rubric = await getRubricFn(cwd);
    const dossiers = await listDossiersFn(cwd);

    if (dossiers.length === 0) {
      logger.warn('[Rubric] No dossiers found. Build some first: danteforge dossier build --all');
      return;
    }

    logger.info(`[Rubric] Validating ${dossiers.length} dossier(s) against rubric v${rubric.version}...`);

    let issues = 0;
    const dimKeys = Object.keys(rubric.dimensions);

    for (const dossier of dossiers) {
      const missingDims: string[] = [];
      const unverifiedDims: string[] = [];

      for (const dimKey of dimKeys) {
        const dim = dossier.dimensions[dimKey];
        if (!dim) {
          missingDims.push(dimKey);
        } else if (dim.unverified) {
          unverifiedDims.push(dimKey);
        }
      }

      if (missingDims.length > 0 || unverifiedDims.length > 0) {
        logger.warn(`  ${dossier.displayName}:`);
        if (missingDims.length > 0) {
          logger.warn(`    Missing dimensions: ${missingDims.join(', ')}`);
          issues += missingDims.length;
        }
        if (unverifiedDims.length > 0) {
          logger.warn(`    Unverified dimensions (no evidence): ${unverifiedDims.join(', ')}`);
          issues += unverifiedDims.length;
        }
      } else {
        logger.info(`  ✓ ${dossier.displayName} — all dimensions verified`);
      }
    }

    if (issues === 0) {
      logger.success('[Rubric] All dossiers fully verified.');
    } else {
      logger.warn(`[Rubric] ${issues} issue(s) found. Rebuild affected dossiers to fetch missing evidence.`);
    }
  });
}

export async function rubricAddDim(options: RubricOptions & { name?: string } = {}): Promise<void> {
  return withErrorBoundary('rubric add-dim', async () => {
    const cwd = options.cwd ?? process.cwd();
    const { getRubric: defaultGet, saveRubric: defaultSave } = await import('../../dossier/rubric.js');
    const getRubricFn = options._getRubric ?? defaultGet;
    const saveRubricFn = options._saveRubric ?? defaultSave;

    const rubric = await getRubricFn(cwd);
    const existingKeys = Object.keys(rubric.dimensions).map(Number);
    const nextKey = String(Math.max(...existingKeys, 0) + 1);

    const newDim: RubricDimension = {
      name: options.name ?? `Dimension ${nextKey}`,
      scoreCriteria: {
        '9': ['Define 9-level observable behaviors here'],
        '7': ['Define 7-level observable behaviors here'],
        '5': ['Define 5-level observable behaviors here'],
        '3': ['Define 3-level observable behaviors here'],
        '1': ['Define 1-level observable behaviors here'],
      },
    };

    const updated: Rubric = {
      ...rubric,
      dimensions: { ...rubric.dimensions, [nextKey]: newDim },
    };

    await saveRubricFn(cwd, updated);
    logger.success(`[Rubric] Added dimension ${nextKey}: "${newDim.name}"`);
    logger.info('[Rubric] Edit .danteforge/rubric.json to fill in the scoring criteria.');
  });
}

function printDimCriteria(dimKey: string, dim: RubricDimension): void {
  logger.info(`\nDimension ${dimKey}: ${dim.name}`);
  logger.info('');
  for (const [score, criteria] of Object.entries(dim.scoreCriteria).sort(
    ([a], [b]) => Number(b) - Number(a),
  )) {
    logger.info(`  Score ${score}:`);
    for (const c of criteria as string[]) {
      logger.info(`    • ${c}`);
    }
  }
}
