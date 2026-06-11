// ground-outcomes — make a project's outcome suite HONEST and re-check it with the gate.
// Runs on any project (DanteForge or a fleet repo via --project). Grounds gate-flagged
// TEST-backed outcomes to real wired callsites where the seam-free test exercises one;
// honestly downgrades the rest of the test-backed set to orphan-pending; annotates
// product-run outcomes (which prove by execution and stay bounded by the integrity caps).
// This is the repeatable "properly define" step: it can never invent evidence, and
// `validate` afterward produces an honest score.

import fs from 'node:fs/promises';
import path from 'node:path';
import { groundOutcomes } from '../../core/outcome-grounding.js';
import { checkOutcomeIntegrity } from '../../matrix/engines/outcome-integrity.js';
import { logger } from '../../core/logger.js';

export async function groundOutcomesCommand(options: { project?: string; apply?: boolean; json?: boolean } = {}): Promise<void> {
  const cwd = path.resolve(options.project ?? process.cwd());
  const mpath = path.join(cwd, '.danteforge', 'compete', 'matrix.json');

  let matrix: { dimensions: Array<{ id: string }> };
  try {
    matrix = JSON.parse(await fs.readFile(mpath, 'utf8'));
  } catch {
    logger.error(`No matrix at ${mpath}`);
    process.exitCode = 1;
    return;
  }

  const summary = await groundOutcomes({ matrix: matrix as never, projectPath: cwd });
  const after = await checkOutcomeIntegrity(matrix.dimensions as never, cwd);
  const dirtyAfter = [...new Set([...after.seamedDims, ...after.decoupledDims, ...after.orphanDims])];

  // Post-state policy (fleet run 2: the command exited 1 forever and the engine read
  // itself as failing): grounding only rewrites T5+ TEST-backed outcomes, while the
  // integrity gate flags T4+ — including product runs and T4 earns it deliberately
  // leaves alone. ORPHAN_CALLSITE and UNSCANNABLE are CAP-ENFORCED classes: the bound
  // is applied by integrityCapFor at score time, so their remaining flags are not
  // grounding work and read CLEAN-FOR-GROUNDING (exit 0, with an honest note).
  // Seam / shared-receipt / decoupled dirt is real dishonesty and still exits 1.
  const blockingDirty = [...new Set([...after.seamedDims, ...after.sharedReceiptDims, ...after.decoupledDims])];
  const capEnforcedFlags = after.violations.filter(v => v.kind === 'ORPHAN_CALLSITE' || v.kind === 'UNSCANNABLE').length;
  const capEnforcedDims = [...new Set([...after.orphanDims, ...after.unscannableDims])].filter(d => !blockingDirty.includes(d));

  if (options.apply) {
    await fs.writeFile(mpath, JSON.stringify(matrix, null, 2) + '\n', 'utf8');
  }

  if (options.json) {
    process.stdout.write(JSON.stringify({ project: cwd, counts: summary.counts, dirtyAfter, blockingDirty, capEnforcedFlags, capEnforcedDims, applied: !!options.apply, results: summary.results }, null, 2) + '\n');
    return;
  }

  logger.info(`Outcome grounding — ${cwd}${options.apply ? '  (APPLIED)' : '  (dry-run; use --apply to write)'}`);
  const c = summary.counts;
  logger.info(`  already-honest ${c['already-honest']} | grounded ${c.grounded} | downgraded ${c.downgraded} | partial ${c.partial} | annotated ${c.annotated}`);
  for (const r of summary.results) {
    if (r.status === 'already-honest') continue;
    logger.info(`  [${r.status}] ${r.dimId}`);
    for (const ch of r.changes) logger.info(`      ${ch}`);
    for (const s of r.suggestions) logger.info(`      hint: ${s}`);
  }
  if (blockingDirty.length > 0) {
    logger.warn(`  ⚠ still dirty after grounding (seam/shared-receipt/decoupled — needs manual attention): ${blockingDirty.join(', ')}`);
    process.exitCode = 1;
  } else {
    if (capEnforcedFlags > 0) {
      logger.info(`  ${capEnforcedFlags} cap-enforced orphan/unscannable flag(s) remain — bounded by integrity caps, not grounding work (${capEnforcedDims.join(', ')})`);
    }
    logger.success(`  ✓ all ${matrix.dimensions.length} dimensions are grounding-clean — run \`danteforge validate --all\` for the honest baseline`);
  }
}
