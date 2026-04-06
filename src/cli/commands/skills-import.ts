import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { harvestAntigravityBundle } from '../../core/skills-import.js';
import { loadState, saveState } from '../../core/state.js';

// ---------------------------------------------------------------------------
// copyDir helper — recursive directory copy
// ---------------------------------------------------------------------------
export async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, dstPath);
    } else {
      await fs.copyFile(srcPath, dstPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Target path map (resolved at call time via _homedir injection)
// ---------------------------------------------------------------------------
function buildTargetPaths(homedir: string): Record<string, string> {
  return {
    'claude-code': path.join(homedir, '.claude', 'skills', 'danteforge'),
    'codex': path.join(homedir, '.codex', 'skills', 'danteforge'),
    'cursor': path.join(homedir, '.cursor', 'skills', 'danteforge'),
    'windsurf': path.join(homedir, '.windsurf', 'skills', 'danteforge'),
  };
}

// ---------------------------------------------------------------------------
// exportSkills — copy all skills to one or more target directories
// ---------------------------------------------------------------------------
export async function exportSkills(
  target: string,
  opts: {
    _copyDir?: (src: string, dst: string) => Promise<void>;
    _homedir?: () => string;
    _skillsDir?: string;
  } = {},
): Promise<void> {
  const copyFn = opts._copyDir ?? copyDir;
  const homedir = (opts._homedir ?? os.homedir)();
  const skillsDir =
    opts._skillsDir ??
    path.join(
      path.dirname(new URL(import.meta.url).pathname),
      '..',
      '..',
      'harvested',
      'dante-agents',
      'skills',
    );

  const TARGET_PATHS = buildTargetPaths(homedir);

  const targets: string[] =
    target === 'all' ? Object.values(TARGET_PATHS) : [TARGET_PATHS[target]];

  if (targets.some((t) => t === undefined)) {
    const known = Object.keys(TARGET_PATHS).join(', ');
    throw new Error(`Unknown export target "${target}". Known targets: ${known}, all`);
  }

  // Count skills (top-level subdirectories)
  let skillCount = 0;
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    skillCount = entries.filter((e) => e.isDirectory()).length;
  } catch {
    // best-effort — proceed even if we can't count
  }

  for (const targetPath of targets) {
    logger.info(`Exporting ${skillCount} skills to ${targetPath}...`);
    await copyFn(skillsDir, targetPath);
    logger.success(`Skills exported to ${targetPath}`);
  }
}

// ---------------------------------------------------------------------------
// skillsImport — main command handler
// ---------------------------------------------------------------------------
export async function skillsImport(options: {
  from: string;
  bundle?: string;
  enhance?: boolean;
  allowOverwrite?: boolean;
  export?: boolean;
  target?: string;
}) {
  // --export mode: copy packaged skills to target agent tool directory
  if (options.export) {
    const target = options.target ?? 'claude-code';
    try {
      await exportSkills(target);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
    return;
  }

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
