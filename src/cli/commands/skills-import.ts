import path from 'node:path';
import { logger } from '../../core/logger.js';
import { harvestAntigravityBundle } from '../../core/skills-import.js';
import { loadState, saveState } from '../../core/state.js';

export async function skillsImport(options: { from: string; bundle?: string; enhance?: boolean; allowOverwrite?: boolean }) {
  if (options.from !== 'antigravity') {
    logger.error(`Unsupported skills source: ${options.from}. Supported sources: antigravity`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await harvestAntigravityBundle({
      allowOverwrite: options.allowOverwrite,
      bundle: options.bundle,
      enhance: options.enhance !== false,
      outputDir: path.join(process.cwd(), 'src', 'harvested', 'dante-agents', 'skills'),
    });

    const state = await loadState();
    state.auditLog.push(
      `${new Date().toISOString()} | skills import: antigravity bundle "${result.bundle}" -> ${result.importedSkills.length} skills via ${result.sourceMethod}${options.allowOverwrite ? ' (overwrite allowed)' : ''}`,
    );
    await saveState(state);

    logger.success(`Imported ${result.importedSkills.length} skills from the "${result.bundle}" bundle via ${result.sourceMethod}`);
    for (const skillName of result.importedSkills) {
      logger.info(`Imported skill: ${skillName}`);
    }
    logger.info(`Import manifest: ${result.manifestPath}`);
    logger.info('Next commands: npm run verify');
    logger.info('Next commands: npm run build');
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
