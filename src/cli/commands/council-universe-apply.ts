import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { logger } from '../../core/logger.js';
import { loadMatrix, saveMatrix } from '../../core/compete-matrix.js';
import { loadProposalFile } from '../../matrix/engines/council-universe-proposals.js';
import { loadVerdictFile } from '../../matrix/engines/council-universe-verifier.js';
import { loadUniverseFile } from '../../matrix/engines/council-forge-brief.js';
import { isValidOutcome, validateOutcomeForTier } from '../../matrix/types/outcome.js';
import type { ProposedOutcome } from '../../matrix/engines/council-universe-proposals.js';

function proposalsDir(projectPath: string): string {
  return path.join(projectPath, '.danteforge', 'compete', 'universe-proposals');
}

export async function runCouncilUniverseApply(opts: {
  cwd?: string;
  dims?: string;
  dryRun?: boolean;
  skipUnverified?: boolean;
  json?: boolean;
}): Promise<void> {
  const projectPath = opts.cwd ?? process.cwd();
  const skipUnverified = opts.skipUnverified ?? true;

  const matrix = await loadMatrix(projectPath);
  if (!matrix) {
    throw new Error(`No competitive matrix found. Run danteforge compete first.`);
  }

  // Gather proposal files
  let proposalFiles: string[];
  try {
    const entries = await fs.readdir(proposalsDir(projectPath));
    proposalFiles = entries.filter(f => f.endsWith('.json'));
  } catch {
    logger.warn('[universe-apply] No universe-proposals directory found. Run: danteforge council-universe --propose-outcomes');
    return;
  }

  const filterIds = opts.dims
    ? new Set(opts.dims.split(',').map(s => s.trim()).filter(Boolean))
    : null;

  const dimsAdded: string[] = [];
  const dimsSkipped: string[] = [];
  let totalOutcomesAdded = 0;
  let totalCapTestsAdded = 0;

  for (const file of proposalFiles) {
    const dimId = file.replace('.json', '');
    if (filterIds && !filterIds.has(dimId)) continue;

    const proposal = await loadProposalFile(projectPath, dimId);
    if (!proposal) continue;

    // Check verdict if skipUnverified
    const verdict = await loadVerdictFile(projectPath, dimId);
    if (skipUnverified) {
      if (!verdict || verdict.verdict !== 'VERIFIED') {
        logger.verbose(`[universe-apply] Skipping ${dimId}: not verified (verdict: ${verdict?.verdict ?? 'none'})`);
        dimsSkipped.push(dimId);
        continue;
      }
    }

    // Hash guard: reject if universe file changed since verification
    if (verdict?.universeSha256) {
      const currentContent = await loadUniverseFile(projectPath, dimId);
      const currentHash = currentContent
        ? createHash('sha256').update(currentContent).digest('hex')
        : '';
      if (currentHash !== verdict.universeSha256) {
        logger.warn(`[universe-apply] ${dimId}: universe file changed since verification — skipping (stale verdict)`);
        dimsSkipped.push(dimId);
        continue;
      }
    }

    // Proposal hash guard: reject if universe file changed since extraction
    if (proposal.universeSha256) {
      const currentContent = await loadUniverseFile(projectPath, dimId);
      const currentHash = currentContent
        ? createHash('sha256').update(currentContent).digest('hex')
        : '';
      if (currentHash !== proposal.universeSha256) {
        logger.warn(`[universe-apply] ${dimId}: universe file changed since proposal extraction — skipping (stale proposal)`);
        dimsSkipped.push(dimId);
        continue;
      }
    }

    const dim = matrix.dimensions.find(d => d.id === dimId);
    if (!dim) {
      logger.warn(`[universe-apply] Dim ${dimId} not found in matrix — skipping`);
      continue;
    }

    const dimAny = dim as unknown as Record<string, unknown>;
    let changed = false;

    // Apply capability_test if missing
    if (proposal.proposedCapabilityTest && !dimAny['capability_test']) {
      if (opts.dryRun) {
        logger.info(`[universe-apply] DRY-RUN: would add capability_test to ${dimId}: ${proposal.proposedCapabilityTest.command}`);
      } else {
        dimAny['capability_test'] = proposal.proposedCapabilityTest;
        totalCapTestsAdded++;
        changed = true;
        logger.info(`[universe-apply] + capability_test for ${dimId}`);
      }
    }

    // Apply proposed outcomes (skip IDs already present; validate schema)
    const existingOutcomes = (dimAny['outcomes'] as Array<{ id: string }> | undefined) ?? [];
    const existingIds = new Set(existingOutcomes.map(o => o.id));
    const candidateOutcomes = proposal.proposedOutcomes.filter(o => !existingIds.has(o.id));

    const validatedOutcomes: ProposedOutcome[] = [];
    for (const o of candidateOutcomes) {
      // Capture id before the type guard — isValidOutcome narrows the negative
      // branch to `never`, so o.id is unreadable after the guard fails.
      const oid = o.id;
      if (!isValidOutcome(o)) {
        logger.warn(`[universe-apply] ${dimId}: outcome ${oid} failed isValidOutcome — skipping`);
        continue;
      }
      const tierErrors = validateOutcomeForTier(o as Parameters<typeof validateOutcomeForTier>[0]);
      if (tierErrors.length > 0) {
        logger.warn(`[universe-apply] ${dimId}: outcome ${o.id} tier validation failed — ${tierErrors.map(e => e.reason).join('; ')} — skipping`);
        continue;
      }
      validatedOutcomes.push(o);
    }

    if (validatedOutcomes.length > 0) {
      if (opts.dryRun) {
        for (const o of validatedOutcomes) {
          logger.info(`[universe-apply] DRY-RUN: would add outcome ${o.id} to ${dimId}: ${o.command}`);
        }
      } else {
        dimAny['outcomes'] = [...existingOutcomes, ...validatedOutcomes];
        totalOutcomesAdded += validatedOutcomes.length;
        changed = true;
        logger.info(`[universe-apply] + ${validatedOutcomes.length} outcome(s) for ${dimId}`);
      }
    }

    if (changed) dimsAdded.push(dimId);
    else if (!opts.dryRun) logger.verbose(`[universe-apply] ${dimId}: nothing new to apply`);
  }

  if (!opts.dryRun && dimsAdded.length > 0) {
    // Kernel-controlled write: set receipt env var so pre-commit hook allows matrix.json changes
    process.env['DANTEFORGE_MATRIX_MERGE_RECEIPT'] = '1';
    await saveMatrix(matrix, projectPath);
    logger.info(`[universe-apply] matrix.json updated — run: danteforge validate --all to generate receipts`);

    // Write apply receipt for auditability
    const receiptPath = path.join(projectPath, '.danteforge', 'compete', 'universe-proposals', 'apply-receipt.json');
    const receipt = {
      appliedAt: new Date().toISOString(),
      dimsApplied: dimsAdded,
      dimsSkipped,
      outcomesAdded: totalOutcomesAdded,
      capTestsAdded: totalCapTestsAdded,
    };
    await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2), 'utf8');
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      dimsApplied: dimsAdded,
      dimsSkipped,
      outcomesAdded: totalOutcomesAdded,
      capTestsAdded: totalCapTestsAdded,
      dryRun: opts.dryRun ?? false,
    }, null, 2) + '\n');
    return;
  }

  logger.info('');
  logger.info('── Council Universe Apply Results ────────────────────────────────');
  if (opts.dryRun) logger.info('  DRY-RUN — no changes written');
  if (dimsAdded.length > 0) logger.info(`  ✓ Dims updated:   ${dimsAdded.join(', ')}`);
  if (dimsSkipped.length > 0) logger.warn(`  ↷ Dims skipped (unverified): ${dimsSkipped.join(', ')}`);
  logger.info(`  + Outcomes added: ${totalOutcomesAdded}`);
  logger.info(`  + Cap tests added: ${totalCapTestsAdded}`);
  if (!opts.dryRun && dimsAdded.length > 0) {
    logger.info('');
    logger.info('  Next: danteforge validate --all   (generate receipts + lift score ceilings)');
  }
}
