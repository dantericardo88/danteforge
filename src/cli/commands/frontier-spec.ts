// frontier-spec.ts — author, check, freeze, and track per-dim frontier contracts.
//
//   danteforge frontier-spec init <dim>     scaffold a draft spec from what the dim knows
//   danteforge frontier-spec check <dim>     run the honesty guardrails
//   danteforge frontier-spec freeze <dim>    lock it before implementation (hash + timestamp)
//   danteforge frontier-spec status [--all]  where each dim stands vs its frontier

import fs from 'node:fs/promises';
import path from 'node:path';
import { loadMatrix, invalidateMatrixCache, type CompeteMatrix } from '../../core/compete-matrix.js';
import { logger } from '../../core/logger.js';
import {
  scaffoldFrontierSpec, seedLeaderTargetFromLadder, checkFrontierSpec, computeSpecHash, effectiveStatus,
  type FrontierSpec,
} from '../../core/frontier-spec.js';
import { completeFrontierSpec, type SpecCompletionResult, type SpecProbeRun } from '../../core/frontier-spec-complete.js';
import { loadDimRubric } from '../../core/rubric-ladder.js';
import { seedLeaderTargetFromHarvest } from '../../core/harvested-bar.js';
import { loadHarvestedSignals } from '../../core/harvest-loader.js';

export type FrontierSpecAction = 'init' | 'check' | 'freeze' | 'status';

export interface FrontierSpecOptions {
  action: FrontierSpecAction;
  dimId?: string;
  all?: boolean;
  write?: boolean;
  json?: boolean;
  cwd?: string;
  /**
   * init only: run the deterministic evidence-grounded completer after scaffold + ladder seed
   * (frontier-spec-complete.ts). Defaults ON (`--no-complete` disables) — without it an
   * autonomous init can never produce a court-checkable spec.
   */
  complete?: boolean;
  /** Injected ISO timestamp (avoids Date in tests). */
  _now?: string;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _writeMatrix?: (m: CompeteMatrix, p: string) => Promise<void>;
  /** Seam: completer probe runner (see SpecCompleteOptions._probeRun). */
  _probeRun?: (command: string, cwd: string) => Promise<SpecProbeRun>;
  /** Seam: completer mtime snapshotter (see SpecCompleteOptions._snapshotMtimes). */
  _snapshotMtimes?: (root: string) => Promise<Map<string, number>>;
}

export interface FrontierSpecResult {
  action: FrontierSpecAction;
  dimId?: string;
  ok: boolean;
  errors: string[];
  warnings: string[];
  wrote: boolean;
  status?: string;
  statuses?: Array<{ dimId: string; status: string; hasSpec: boolean }>;
  /** init only: which unauthored fields the completer filled from real evidence. */
  completed?: SpecCompletionResult['completed'];
  /** init only: true iff the completer's single probe run executed. */
  probed?: boolean;
  /** init only: does the written draft already pass checkFrontierSpec (zero human edits)? */
  specReady?: boolean;
}

function competitorsOf(matrix: CompeteMatrix): string[] {
  const m = matrix as unknown as { competitors_closed_source?: string[]; competitors_oss?: string[] };
  return [...(m.competitors_closed_source ?? []), ...(m.competitors_oss ?? [])];
}

function specOf(dim: unknown): FrontierSpec | undefined {
  return (dim as { frontier_spec?: FrontierSpec }).frontier_spec;
}

export async function runFrontierSpec(options: FrontierSpecOptions): Promise<FrontierSpecResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const loadFn = options._loadMatrix ?? loadMatrix;
  const writeMatrix = options._writeMatrix ?? ((m, p) => fs.writeFile(p, JSON.stringify(m, null, 2) + '\n', 'utf8'));
  const matrixPath = path.join(cwd, '.danteforge', 'compete', 'matrix.json');

  const matrix = await loadFn(cwd);
  if (!matrix) throw new Error('No compete matrix found. Run `danteforge compete --init` first.');

  const res: FrontierSpecResult = { action: options.action, dimId: options.dimId, ok: true, errors: [], warnings: [], wrote: false };

  // ── status ──────────────────────────────────────────────────────────────────
  if (options.action === 'status') {
    const dims = options.all || !options.dimId ? matrix.dimensions : matrix.dimensions.filter(d => d.id === options.dimId);
    res.statuses = dims.map(d => {
      const spec = specOf(d);
      return { dimId: d.id, hasSpec: !!spec, status: spec ? effectiveStatus(spec) : 'none' };
    });
    logger.info('');
    logger.success('Frontier-spec status:');
    for (const s of res.statuses) {
      const icon = s.status === 'frozen' || s.status === 'validated' ? '🔒' : s.status === 'stale' ? '⚠ ' : s.status === 'draft' ? '✎ ' : '· ';
      logger.info(`  ${icon} ${s.dimId.padEnd(28)} ${s.status}`);
    }
    const without = res.statuses.filter(s => !s.hasSpec).length;
    if (without > 0) logger.info(`\n  ${without} dim(s) have no frontier_spec. Author one: danteforge frontier-spec init <dim>`);
    if (options.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return res;
  }

  // ── per-dim actions ───────────────────────────────────────────────────────────
  const dim = matrix.dimensions.find(d => d.id === options.dimId);
  if (!dim) throw new Error(`Dimension "${options.dimId}" not found.`);
  const d = dim as unknown as Record<string, unknown>;
  // The dim's competitor-grounded Score Ladder — seeds the frontier bar (init) and anchors the
  // anti-laundering check (check/freeze). [] when the dim has no universe ladder (no fabrication).
  const rubric = await loadDimRubric(cwd, options.dimId!);

  if (options.action === 'init') {
    if (specOf(dim)) {
      res.warnings.push(`"${options.dimId}" already has a frontier_spec (status ${effectiveStatus(specOf(dim)!)}). Not overwriting.`);
    } else if (options.write) {
      const tracked = competitorsOf(matrix);
      const draft = scaffoldFrontierSpec(d, tracked);
      // KEYSTONE (harvested-bar): seed the bar from HARVESTED external feedback FIRST — harvested
      // facts (real competitor demand/capability) outrank LLM-authored Score Ladder prose. The
      // ladder seed then fills only what harvest left unauthored. [] when no harvest artifacts exist
      // (no fabrication). signals also feed checkFrontierSpec's provenance gate (no-op when gate off).
      const signals = await loadHarvestedSignals(cwd, options.dimId!);
      const harvest = seedLeaderTargetFromHarvest(draft, signals);
      const seed = seedLeaderTargetFromLadder(draft, rubric);
      // Deterministic completion (default ON): promote evidence the dim has ALREADY recorded
      // (product-run outcomes, declared artifacts, an observed probe run) into the unauthored
      // real-user-path fields. Pure derivation — a field with no real evidence stays unauthored
      // and the honest spec-incomplete ceiling stands. checkFrontierSpec is unchanged.
      let matrixToWrite = matrix;
      let dimToWrite: Record<string, unknown> = d;
      if (options.complete !== false) {
        const completion = await completeFrontierSpec(draft, d, {
          cwd, _probeRun: options._probeRun, _snapshotMtimes: options._snapshotMtimes,
        });
        res.completed = completion.completed;
        res.probed = completion.probed;
        for (const n of completion.notes) res.warnings.push(n);
        if (completion.probed) {
          // The probe just EXECUTED a real product command (up to 10 min) — danteforge-style
          // probes write matrix.json themselves (validate persists derived up/down, compete
          // rescores report). Writing our pre-probe in-memory matrix back would clobber all of
          // it (lost-update; adversarial-review finding). Re-read disk and graft ONLY the spec.
          invalidateMatrixCache();
          const fresh = await loadFn(cwd);
          const freshDim = fresh?.dimensions.find(x => x.id === options.dimId);
          if (fresh && freshDim) {
            matrixToWrite = fresh;
            dimToWrite = freshDim as unknown as Record<string, unknown>;
          }
        }
      }
      dimToWrite.frontier_spec = draft;
      await writeMatrix(matrixToWrite, matrixPath);
      res.wrote = true;
      if (harvest.tags.length > 0) {
        res.warnings.push(`Seeded the frontier bar from HARVESTED external feedback (${harvest.tags.join(', ')}): ${[harvest.seeded.score && 'score', harvest.seeded.observed_capability && 'observed_capability', harvest.seeded.category_delta && 'category_delta'].filter(Boolean).join(' + ')}. Subjective (capability/demand) rows need ratification before they unlock >7 (hybrid posture).`);
      }
      if (seed.ladder_rows_used.length > 0) {
        res.warnings.push(`Seeded the frontier bar from the competitor-grounded Score Ladder (row(s) ${seed.ladder_rows_used.join(', ')}): ${[seed.seeded.observed_capability && 'observed_capability', seed.seeded.category_delta && 'category_delta'].filter(Boolean).join(' + ')}. Review it — you may sharpen but not soften it.`);
      }
      res.specReady = checkFrontierSpec(draft, tracked, rubric, signals).ok;
      if (res.specReady) {
        res.warnings.push('Draft passes the honesty guardrails with ZERO human edits — ready to freeze.');
      }
    } else {
      res.warnings.push('Dry-run — re-run with --write to add the draft spec.');
    }
    logger.info('');
    logger.success(`frontier-spec init "${options.dimId}": ${res.wrote ? 'draft written' : 'dry-run'}`);
    for (const w of res.warnings) logger.warn(`  ⚠ ${w}`);
    if (res.specReady) {
      logger.info(`  Next: danteforge frontier-spec freeze ${options.dimId} --write  (before building).`);
    } else {
      logger.info('  Fill in any remaining TODOs (run_command, required_callsite, observable_artifacts),');
      logger.info(`  then: danteforge frontier-spec check ${options.dimId}  →  freeze ${options.dimId}  (before building).`);
    }
    if (options.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return res;
  }

  const spec = specOf(dim);
  if (!spec) throw new Error(`"${options.dimId}" has no frontier_spec. Run: danteforge frontier-spec init ${options.dimId} --write`);
  // Phase 0.3: freeze (and check) must run the harvest-provenance gate — a >7 bar can't FREEZE on
  // self-authored prose; it must trace to harvested external signals. No-op when the gate is off / no
  // signals exist (so today's flow is unaffected until DANTEFORGE_GROUNDING_GATE flips on).
  const signals = await loadHarvestedSignals(cwd, options.dimId!);
  const check = checkFrontierSpec(spec, competitorsOf(matrix), rubric, signals);
  res.ok = check.ok; res.errors = check.errors; res.warnings = check.warnings;

  if (options.action === 'check') {
    printCheck(options.dimId!, check);
    if (options.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return res;
  }

  // freeze
  if (!check.ok) {
    logger.error(`Cannot freeze "${options.dimId}" — the spec fails the honesty guardrails:`);
    printCheck(options.dimId!, check);
    if (options.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return res;
  }
  if (options.write) {
    spec.status = 'frozen';
    spec.frozen_at = options._now ?? new Date().toISOString();
    spec.frozen_hash = computeSpecHash(spec);
    await writeMatrix(matrix, matrixPath);
    res.wrote = true;
    res.status = 'frozen';
  }
  logger.success(`frontier-spec freeze "${options.dimId}": ${res.wrote ? 'FROZEN 🔒' : 'dry-run (would freeze)'}`);
  logger.info('  Now build to the spec, then capture evidence:');
  logger.info(`    danteforge session-record ${options.dimId} --run "${spec.real_user_path.run_command}" --callsite ${spec.real_user_path.required_callsite} --artifact ${spec.real_user_path.observable_artifacts[0]?.path} --write`);
  logger.info(`    danteforge validate ${options.dimId}   (twice, across sessions)`);
  if (options.json) process.stdout.write(JSON.stringify(res, null, 2) + '\n');
  return res;
}

function printCheck(dimId: string, check: { ok: boolean; errors: string[]; warnings: string[] }): void {
  logger.info('');
  if (check.ok) logger.success(`frontier-spec "${dimId}": PASSES honesty guardrails ✓`);
  else logger.error(`frontier-spec "${dimId}": ${check.errors.length} guardrail violation(s):`);
  for (const e of check.errors) logger.error(`  ✗ ${e}`);
  for (const w of check.warnings) logger.warn(`  ⚠ ${w}`);
}
