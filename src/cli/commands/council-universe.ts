import path from 'node:path';
import { logger } from '../../core/logger.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import { runCouncilUniversePhase } from '../../matrix/engines/council-universe-runner.js';

export async function runCouncilUniverseCommand(opts: {
  cwd?: string;
  dims?: string;
  members?: string;
  skipExisting?: boolean;
  concurrency?: number;
  json?: boolean;
}): Promise<void> {
  const projectPath = opts.cwd ?? process.cwd();
  const matrix = await loadMatrix(projectPath);

  if (!matrix) {
    throw new Error(`No competitive matrix found at ${path.join(projectPath, '.danteforge', 'compete', 'matrix.json')}. Run danteforge compete first.`);
  }

  const filterIds = opts.dims
    ? new Set(opts.dims.split(',').map(s => s.trim()).filter(Boolean))
    : null;

  const targets = matrix.dimensions
    .filter(d => !filterIds || filterIds.has(d.id))
    .map(d => ({
      dimId: d.id,
      dimName: d.label,
      currentScore: d.scores['self'] ?? 0,
      targetScore: d.next_sprint_target ?? 9,
      ossLeader: d.oss_leader || undefined,
    }));

  if (targets.length === 0) {
    logger.warn('[council-universe] No matching dimensions found — check --dims filter');
    return;
  }

  const researchers = (opts.members ?? 'claude-code,codex')
    .split(',')
    .map(s => s.trim())
    .filter((s): s is 'claude-code' | 'codex' => s === 'claude-code' || s === 'codex');

  if (researchers.length === 0) {
    throw new Error('No valid researchers specified. Valid values: claude-code, codex');
  }

  logger.info(`[council-universe] Researching ${targets.length} dim(s) with ${researchers.join(', ')}`);
  logger.info(`[council-universe] Output: .danteforge/compete/universe/<dim_id>.md`);

  const result = await runCouncilUniversePhase({
    projectPath,
    targets,
    researchers,
    skipExisting: opts.skipExisting ?? true,
    concurrencyLimit: opts.concurrency ?? 4,
    onProgress: (dimId, status, researcher) => {
      if (status === 'started') logger.info(`[universe] → ${dimId} (${researcher})`);
      else if (status === 'failed') logger.warn(`[universe] ✗ ${dimId} failed`);
    },
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  logger.info('');
  logger.info('── Council Universe Results ──────────────────────────────────────');
  if (result.written.length > 0) logger.info(`  ✓ Written:  ${result.written.join(', ')}`);
  if (result.skipped.length > 0) logger.info(`  ↷ Skipped:  ${result.skipped.join(', ')}`);
  if (result.failed.length > 0)  logger.warn(`  ✗ Failed:   ${result.failed.join(', ')}`);
  logger.info('');
  logger.info('Universe files written. Now run: danteforge council-frontier-loop');
  logger.info('  Builder and judge prompts will automatically inject universe criteria.');
}
