import path from 'node:path';
import { logger } from '../../core/logger.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import { runCouncilUniversePhase } from '../../matrix/engines/council-universe-runner.js';
import { loadUniverseFile } from '../../matrix/engines/council-forge-brief.js';
import { loadVerdictFile } from '../../matrix/engines/council-universe-verifier.js';
import { extractCapabilityProposals, saveProposalFile } from '../../matrix/engines/council-universe-proposals.js';

export async function runCouncilUniverseCommand(opts: {
  cwd?: string;
  dims?: string;
  members?: string;
  skipExisting?: boolean;
  skipVerify?: boolean;
  proposeOutcomes?: boolean;
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
  if (!opts.skipVerify) logger.info('[council-universe] Verification enabled (opposite member verifies each file)');

  const result = await runCouncilUniversePhase({
    projectPath,
    targets,
    researchers,
    skipExisting: opts.skipExisting ?? true,
    skipVerify: opts.skipVerify ?? false,
    concurrencyLimit: opts.concurrency ?? 4,
    onProgress: (dimId, status, researcher) => {
      if (status === 'started') logger.info(`[universe] → ${dimId} (${researcher})`);
      else if (status === 'verifying') logger.info(`[universe] ⟳ verifying ${dimId} (${researcher})`);
      else if (status === 'revision') logger.info(`[universe] ↺ revising ${dimId} (${researcher})`);
      else if (status === 'failed') logger.warn(`[universe] ✗ ${dimId} failed`);
    },
  });

  // Phase 2b: extract outcome proposals for verified dims
  if (opts.proposeOutcomes && result.written.length > 0) {
    logger.info(`[council-universe] Extracting outcome proposals for ${result.written.length} written dim(s)`);
    const dimsToPropose = result.written.filter(dimId => {
      const verdict = result.verified.includes(dimId) ? 'VERIFIED' : 'unverified';
      if (!result.verified.includes(dimId) && !opts.skipVerify) {
        logger.verbose(`[council-universe] Skipping proposals for unverified dim: ${dimId}`);
        return false;
      }
      return true;
    });

    for (const dimId of dimsToPropose) {
      const universeContent = await loadUniverseFile(projectPath, dimId);
      if (!universeContent) continue;

      const dim = matrix.dimensions.find(d => d.id === dimId);
      if (!dim) continue;

      const extractor = researchers[0]!; // use first researcher as extractor
      const existingCapabilityTest = (dim as unknown as Record<string, unknown>)['capability_test'] as { command: string; description: string } | undefined;
      const existingOutcomes = ((dim as unknown as Record<string, unknown>)['outcomes'] as Array<{ id: string }> | undefined) ?? [];

      const proposal = await extractCapabilityProposals({
        projectPath,
        dimId,
        dimName: dim.label,
        universeContent,
        existingCapabilityTest,
        existingOutcomeIds: existingOutcomes.map(o => o.id),
        extractor,
      });

      if (proposal) {
        const verdict = await loadVerdictFile(projectPath, dimId);
        await saveProposalFile(projectPath, dimId, proposal, {
          extractedBy: extractor,
          verified: verdict?.verdict === 'VERIFIED',
        });
        logger.info(`[council-universe] ✓ proposals saved for ${dimId} (${proposal.proposedOutcomes.length} outcomes)`);
      }
    }
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  logger.info('');
  logger.info('── Council Universe Results ──────────────────────────────────────');
  if (result.written.length > 0)       logger.info(`  ✓ Written:        ${result.written.join(', ')}`);
  if (result.verified.length > 0)      logger.info(`  ✓ Verified:       ${result.verified.join(', ')}`);
  if (result.needsRevision.length > 0) logger.warn(`  ⚠ Needs revision: ${result.needsRevision.join(', ')}`);
  if (result.skipped.length > 0)       logger.info(`  ↷ Skipped:        ${result.skipped.join(', ')}`);
  if (result.failed.length > 0)        logger.warn(`  ✗ Failed:         ${result.failed.join(', ')}`);
  logger.info('');
  if (opts.proposeOutcomes) {
    logger.info('Proposals saved. Run: danteforge council-universe-apply --dry-run');
  } else {
    logger.info('Universe files ready. Run with --propose-outcomes to extract capability test proposals.');
  }
  logger.info('Builder and judge prompts will automatically inject universe criteria.');
}
