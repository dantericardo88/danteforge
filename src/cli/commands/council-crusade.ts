// council-crusade.ts — Autonomous multi-agent frontier push via council.
//
// Outer loop: selects weakest dimensions, dispatches council --parallel for each
// pass, rescores, and repeats until every target dimension reaches the score
// goal or the pass cap is hit.
//
// Injection seams on CouncilCrusadeOptions allow full unit-test coverage without
// real subprocesses or file I/O (same pattern as crusade.ts / council-ask.ts).

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import {
  loadMatrix,
  type CompeteMatrix,
  type MatrixDimension,
} from '../../core/compete-matrix.js';
import type { ParallelCouncilOptions } from './council-parallel.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CouncilCrusadeOptions {
  cwd?: string;
  goal?: string;
  /** Score target per dimension (default: 9). */
  target?: number;
  /** Maximum outer-loop passes (default: 5). */
  maxPasses?: number;
  /** Council rounds per pass (default: 2). */
  maxRoundsPerPass?: number;
  /** Max dimensions scheduled per pass (default: 4). */
  maxDimsPerPass?: number;
  /** Sub-agents per council member (default: 2). */
  slotsPerMember?: number;
  /** Min cross-member judges required per candidate (default: 2). */
  minJudges?: number;
  /** Restrict to these dimension IDs only. */
  focusDims?: string[];
  /** Skip post-merge validate (faster for testing). */
  skipValidate?: boolean;
  /** Print plan without running. */
  dryRun?: boolean;
  /** Emit JSON summary. */
  json?: boolean;

  // ── Injection seams ────────────────────────────────────────────────────────
  /** Override matrix loader for tests. */
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  /** Override parallel council runner for tests. */
  _runParallelCouncil?: (opts: ParallelCouncilOptions) => Promise<void>;
  /** Override report writer for tests. */
  _writeReport?: (cwd: string, content: string) => Promise<void>;
}

export interface PassResult {
  pass: number;
  dimsAttempted: string[];
  scoresBefore: Record<string, number>;
  scoresAfter: Record<string, number>;
  delta: number;
}

export interface CouncilCrusadeResult {
  status: 'COMPLETE' | 'MAX_PASSES' | 'DRY_RUN' | 'ALREADY_AT_TARGET';
  passesRun: number;
  passes: PassResult[];
  reportPath?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Score self or 0 if missing. */
function selfScore(dim: MatrixDimension): number {
  return dim.scores['self'] ?? 0;
}

/** Gap x weight priority — higher is more urgent. */
function gapPriority(dim: MatrixDimension, target: number): number {
  return (target - selfScore(dim)) * (dim.weight ?? 1.0);
}

/**
 * Select up to maxDimsPerPass dimensions with the highest gap*weight.
 * If focusDims is set, only those IDs are considered.
 */
function selectDims(
  matrix: CompeteMatrix,
  target: number,
  maxDimsPerPass: number,
  focusDims?: string[],
): MatrixDimension[] {
  const excluded = new Set(matrix.excludedDimensions ?? []);
  let eligible = matrix.dimensions.filter(d => {
    if (excluded.has(d.id)) return false;
    if (d.status === 'closed') return false;
    if (selfScore(d) >= target) return false;
    if (focusDims && !focusDims.includes(d.id)) return false;
    return true;
  });
  eligible = eligible.sort((a, b) => gapPriority(b, target) - gapPriority(a, target));
  return eligible.slice(0, maxDimsPerPass);
}

// ── Report builder ────────────────────────────────────────────────────────────

function buildReport(
  result: CouncilCrusadeResult,
  goal: string | undefined,
  target: number,
): string {
  const lines: string[] = [
    '# COUNCIL_CRUSADE_REPORT.md',
    '',
    `**Goal:** ${goal ?? '(not specified)'}`,
    `**Target score per dimension:** ${target}`,
    `**Status:** ${result.status}`,
    `**Passes run:** ${result.passesRun}`,
    '',
    '## Pass Log',
    '',
  ];

  for (const p of result.passes) {
    lines.push(`### Pass ${p.pass}`);
    lines.push(`- Dimensions attempted: ${p.dimsAttempted.join(', ') || 'none'}`);
    lines.push(`- Score delta (avg): ${p.delta >= 0 ? '+' : ''}${p.delta.toFixed(2)}`);
    for (const id of p.dimsAttempted) {
      const before = p.scoresBefore[id] ?? 0;
      const after = p.scoresAfter[id] ?? before;
      lines.push(`  - ${id}: ${before.toFixed(2)} -> ${after.toFixed(2)}`);
    }
    lines.push('');
  }

  lines.push('## Summary');
  if (result.status === 'COMPLETE') {
    lines.push(`All targeted dimensions reached score ${target}.`);
  } else if (result.status === 'ALREADY_AT_TARGET') {
    lines.push('All dimensions were already at or above the target score. No passes were needed.');
  } else if (result.status === 'MAX_PASSES') {
    lines.push(`Max passes (${result.passesRun}) reached without all dimensions reaching ${target}.`);
  }

  return lines.join('\n');
}

// ── Real subprocess defaults ──────────────────────────────────────────────────

async function defaultRunParallelCouncil(opts: ParallelCouncilOptions): Promise<void> {
  const { runParallelCouncil } = await import('./council-parallel.js');
  await runParallelCouncil(opts);
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function runCouncilCrusade(options: CouncilCrusadeOptions): Promise<CouncilCrusadeResult> {
  const cwd = options.cwd ?? process.cwd();
  const target = options.target ?? 9;
  const maxPasses = options.maxPasses ?? 5;
  const maxRoundsPerPass = options.maxRoundsPerPass ?? 2;
  const maxDimsPerPass = options.maxDimsPerPass ?? 4;
  const slotsPerMember = options.slotsPerMember ?? 2;
  const minJudges = options.minJudges ?? 2;
  const goal = options.goal;

  const loadFn = options._loadMatrix ?? loadMatrix;
  const runParallelFn = options._runParallelCouncil ?? defaultRunParallelCouncil;
  const writeReport = options._writeReport ?? (async (dir: string, content: string) => {
    const p = path.join(dir, 'COUNCIL_CRUSADE_REPORT.md');
    await fs.mkdir(dir, { recursive: true }).catch(() => { /* best-effort */ });
    await fs.writeFile(p, content, 'utf8');
  });

  logger.info('\n=== DanteForge Council Crusade ===');
  logger.info(`Target: ${target} | Max passes: ${maxPasses} | Dims/pass: ${maxDimsPerPass}`);
  if (goal) logger.info(`Goal: ${goal}`);

  // Project identity guard — show target before any agents start so wrong-cwd is immediately visible.
  logger.info(`[council-crusade] Target directory: ${cwd}`);

  // ── Dry-run: print plan and exit ────────────────────────────────────────────
  if (options.dryRun) {
    const matrix = await loadFn(cwd).catch(() => null);
    const dims = matrix ? selectDims(matrix, target, maxDimsPerPass, options.focusDims) : [];
    logger.info('[council-crusade] Would run:');
    logger.info(`  Max passes: ${maxPasses}`);
    logger.info(`  Rounds/pass: ${maxRoundsPerPass}`);
    logger.info(`  Dims/pass: ${maxDimsPerPass}`);
    logger.info(`  Slots/member: ${slotsPerMember}`);
    logger.info(`  First-pass dim candidates (${dims.length}): ${dims.map(d => d.id).join(', ') || 'none'}`);
    return { status: 'DRY_RUN', passesRun: 0, passes: [] };
  }

  // ── Load matrix and check pre-condition ────────────────────────────────────
  const initialMatrix = await loadFn(cwd);
  if (!initialMatrix) {
    throw new Error('No compete matrix found. Run `danteforge compete --init` first.');
  }
  logger.info(`[council-crusade] Project: ${initialMatrix.project ?? 'unknown'} | Overall self-score: ${(initialMatrix.overallSelfScore ?? 0).toFixed(2)}`);

  const initialDims = selectDims(initialMatrix, target, maxDimsPerPass, options.focusDims);
  if (initialDims.length === 0) {
    logger.info('[council-crusade] All dimensions at target. Nothing to do.');
    return {
      status: 'ALREADY_AT_TARGET',
      passesRun: 0,
      passes: [],
    };
  }

  // ── Outer pass loop ─────────────────────────────────────────────────────────
  const passResults: PassResult[] = [];
  let prevOverallScore = initialMatrix.overallSelfScore ?? 0;
  let stallCount = 0;
  const STALL_DELTA = 0.02;
  const STALL_MAX = 2;

  for (let pass = 1; pass <= maxPasses; pass++) {
    logger.info(`\n-- Council Crusade Pass ${pass}/${maxPasses} ---`);

    // Reload matrix to get fresh scores
    const matrix = (await loadFn(cwd).catch(() => null)) ?? initialMatrix;
    const dims = selectDims(matrix, target, maxDimsPerPass, options.focusDims);

    if (dims.length === 0) {
      logger.info('[council-crusade] All dimensions at target. Crusade complete.');
      break;
    }

    const scoresBefore: Record<string, number> = {};
    for (const d of dims) {
      scoresBefore[d.id] = selfScore(d);
    }

    logger.info(`[council-crusade] Pass ${pass}: attacking ${dims.length} dim(s): ${dims.map(d => d.id).join(', ')}`);

    // Build the goal for this pass
    const passGoal = goal
      ? `${goal} — focus on: ${dims.map(d => d.label).join(', ')}`
      : `Improve the following dimensions: ${dims.map(d => `${d.label} (score ${(scoresBefore[d.id] ?? 0).toFixed(2)})`).join(', ')}`;

    // Run parallel council
    await runParallelFn({
      cwd,
      goal: passGoal,
      maxRounds: maxRoundsPerPass,
      maxDimsPerRound: maxDimsPerPass,
      slotsPerMember,
      minJudges,
      skipValidate: options.skipValidate,
      focusDims: dims.map(d => d.id),
    });

    // Reload to capture scores after
    const matrixAfter = await loadFn(cwd).catch(() => null);
    const scoresAfter: Record<string, number> = {};
    for (const d of dims) {
      const dimAfter = matrixAfter?.dimensions.find(x => x.id === d.id);
      scoresAfter[d.id] = dimAfter ? selfScore(dimAfter) : (scoresBefore[d.id] ?? 0);
    }

    // Compute average delta for this pass
    const deltas = dims.map(d => (scoresAfter[d.id] ?? 0) - (scoresBefore[d.id] ?? 0));
    const avgDelta = deltas.length > 0 ? deltas.reduce((s, v) => s + v, 0) / deltas.length : 0;

    passResults.push({
      pass,
      dimsAttempted: dims.map(d => d.id),
      scoresBefore,
      scoresAfter,
      delta: avgDelta,
    });

    // Stall detection based on overall score
    const overallAfter = matrixAfter?.overallSelfScore ?? prevOverallScore;
    const overallDelta = overallAfter - prevOverallScore;
    prevOverallScore = overallAfter;

    logger.info(`[council-crusade] Pass ${pass} done. Avg dim delta: ${avgDelta >= 0 ? '+' : ''}${avgDelta.toFixed(2)}, Overall: ${overallAfter.toFixed(2)}`);

    if (pass > 1 && Math.abs(overallDelta) < STALL_DELTA) {
      stallCount++;
      logger.warn(`[council-crusade] Stall detected (delta=${overallDelta.toFixed(3)}, count=${stallCount}/${STALL_MAX})`);
      if (stallCount >= STALL_MAX) {
        logger.warn('[council-crusade] Consecutive stalls — stopping to avoid spinning.');
        break;
      }
    } else {
      stallCount = 0;
    }

    // Write intermediate report (best-effort)
    const intermediate: CouncilCrusadeResult = {
      status: 'MAX_PASSES',
      passesRun: pass,
      passes: passResults,
    };
    const content = buildReport(intermediate, goal, target);
    await writeReport(cwd, content).catch(() => { /* best-effort */ });
  }

  // Final status
  const finalMatrix = await loadFn(cwd).catch(() => null);
  const remaining = finalMatrix
    ? selectDims(finalMatrix, target, maxDimsPerPass, options.focusDims).length
    : 0;

  const status: CouncilCrusadeResult['status'] = remaining === 0 ? 'COMPLETE' : 'MAX_PASSES';
  const result: CouncilCrusadeResult = {
    status,
    passesRun: passResults.length,
    passes: passResults,
    reportPath: path.join(cwd, 'COUNCIL_CRUSADE_REPORT.md'),
  };

  // Write final report
  const finalContent = buildReport(result, goal, target);
  await writeReport(cwd, finalContent).catch(() => { /* best-effort */ });

  logger.info(`\n-- Council Crusade Complete (${result.status}) ---`);
  logger.info(`Passes run: ${result.passesRun}`);
  if (status === 'COMPLETE') {
    logger.info('All targeted dimensions reached the score target.');
  } else {
    logger.info(`${remaining} dimension(s) still below target. Run another crusade to continue.`);
  }

  if (options.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }

  return result;
}
