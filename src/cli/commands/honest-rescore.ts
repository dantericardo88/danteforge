// honest-rescore.ts — Reality-check the competitive matrix against runtime evidence.
// Reads .danteforge/compete/matrix.json and the most recent .danteforge/runtime-evidence/<sha>-<tier>.json
// files, applies the Capability Ladder tier caps, and writes a *.honest.json file plus a diff report.
//
// CRITICAL: This command NEVER mutates matrix.json. The operator copies the honest version if satisfied.
// That is the Phase A safety contract — we cannot silently overwrite a green matrix just because the
// probe came up red, because the probe might be wrong (e.g., wrong package-to-dimension map).

import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import type { ProbeResult, ProbeTier } from './probe.js';

const EVIDENCE_DIR = path.join('.danteforge', 'runtime-evidence');
const MATRIX_PATH = path.join('.danteforge', 'compete', 'matrix.json');
const HONEST_PATH = path.join('.danteforge', 'compete', 'matrix.honest.json');
const DIFF_PATH = path.join('.danteforge', 'compete', 'matrix.honest.diff.md');
const PKG_MAP_PATH = path.join('.danteforge', 'package-to-dimension.json');

// ── Tier ladder (mirrors plan §"Capability Ladder") ─────────────────────────

export const TIER_SCORE_CAPS: Record<ProbeTier, number> = {
  T0: 1.0, T1: 4.0, T2: 5.0, T3: 6.0, T4: 7.0, T5: 8.0, T6: 8.5,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PackageToDimensionMap {
  [pkgName: string]: string;
  // Reserved keys: _default, _unmapped_cap_tier
}

export interface MatrixDimensionLite {
  id: string;
  scores: { self: number; [k: string]: number };
  capability_test?: unknown;
}

export interface MatrixLite {
  project?: string;
  overallSelfScore?: number;
  dimensions: MatrixDimensionLite[];
}

export interface DimensionRescore {
  id: string;
  reportedScore: number;
  honestScore: number;
  capApplied: number;
  capTier: ProbeTier | null;
  reason: string;
  failedPackages: string[];
}

export interface HonestRescoreResult {
  project: string;
  cwd: string;
  reportedOverall: number;
  honestOverall: number;
  perDimension: DimensionRescore[];
  evidenceUsed: Array<{ tier: ProbeTier; gitSha: string | null; failedPackageCount: number }>;
  honestMatrixPath: string;
  diffReportPath: string;
}

export interface HonestRescoreOptions {
  cwd?: string;
  json?: boolean;
  apply?: boolean;
  // Injection seams
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, data: string) => Promise<void>;
  _exists?: (p: string) => Promise<boolean>;
  _readdir?: (p: string) => Promise<string[]>;
  _stdout?: (line: string) => void;
}

// ── Probe evidence collection ─────────────────────────────────────────────────

async function collectLatestEvidence(
  cwd: string,
  existsFn: (p: string) => Promise<boolean>,
  readdirFn: (p: string) => Promise<string[]>,
  readFn: (p: string) => Promise<string>,
): Promise<Map<ProbeTier, ProbeResult>> {
  const evidence = new Map<ProbeTier, ProbeResult>();
  const dir = path.join(cwd, EVIDENCE_DIR);
  if (!(await existsFn(dir))) return evidence;

  let files: string[];
  try {
    files = await readdirFn(dir);
  } catch {
    return evidence;
  }

  // Newest first by name (sha-tier.json — ties broken by mtime would need stat,
  // we keep this Phase-A simple: take whatever the dir order returns last).
  for (const f of files.filter(n => n.endsWith('.json'))) {
    try {
      const raw = await readFn(path.join(dir, f));
      const parsed = JSON.parse(raw) as ProbeResult;
      if (parsed && parsed.tier && parsed.tier in TIER_SCORE_CAPS) {
        // Keep the latest per tier (last write wins in directory order).
        evidence.set(parsed.tier as ProbeTier, parsed);
      }
    } catch { /* skip unreadable */ }
  }
  return evidence;
}

// ── Package → dimension mapping ───────────────────────────────────────────────

async function loadPackageMap(
  cwd: string,
  existsFn: (p: string) => Promise<boolean>,
  readFn: (p: string) => Promise<string>,
): Promise<PackageToDimensionMap> {
  const p = path.join(cwd, PKG_MAP_PATH);
  if (!(await existsFn(p))) return {};
  try {
    const raw = await readFn(p);
    const parsed = JSON.parse(raw) as PackageToDimensionMap;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function mapPackageToDim(pkgName: string, map: PackageToDimensionMap): string {
  if (map[pkgName]) return map[pkgName]!;
  // Prefix match: @org/security-* → security
  const stripped = pkgName.replace(/^@[^/]+\//, '');
  const before = stripped.split(/[-_.]/)[0];
  if (before) return before.toLowerCase();
  return (map['_default'] as string | undefined) ?? '_unmapped';
}

// ── Tier-cap math ─────────────────────────────────────────────────────────────

export function computeHighestPassedTier(
  evidenceByTier: Map<ProbeTier, ProbeResult>,
  failedPackagesForDim: Map<ProbeTier, string[]>,
): ProbeTier | null {
  // Walk the ladder low-to-high. A tier passes for THIS dim iff:
  //  - the dim has no packages attributed to its failure bucket at this tier, AND
  //  - the tier did not exit non-zero with no per-package attribution (unattributed failure).
  // Missing tiers are skipped (don't punish a dim for tiers we never probed) —
  // monotonic capability means a higher passed tier implies lower ones pass too.
  const order: ProbeTier[] = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
  let highest: ProbeTier | null = null;
  for (const tier of order) {
    const result = evidenceByTier.get(tier);
    if (!result) continue;
    const dimFailed = failedPackagesForDim.get(tier) ?? [];
    // Unattributed failure: probe exited non-zero with no per-package errors parsed →
    // conservatively fail every dim (we don't know who to blame).
    const unattributedFailure = !result.passed && result.failedPackages.length === 0;
    const tierPassed = dimFailed.length === 0 && !unattributedFailure;
    if (!tierPassed) break;
    highest = tier;
  }
  return highest;
}

// ── Per-dimension rescore ─────────────────────────────────────────────────────

function rescoreDimension(
  dim: MatrixDimensionLite,
  evidence: Map<ProbeTier, ProbeResult>,
  pkgMap: PackageToDimensionMap,
): DimensionRescore {
  const reportedScore = dim.scores.self;
  const dimFailedByTier = new Map<ProbeTier, string[]>();
  const allFailed = new Set<string>();

  for (const [tier, result] of evidence.entries()) {
    const dimFailures: string[] = [];
    for (const pkg of result.failedPackages) {
      const mappedDim = mapPackageToDim(pkg, pkgMap);
      if (mappedDim === dim.id || mappedDim === '_unmapped') {
        dimFailures.push(pkg);
        allFailed.add(pkg);
      }
    }
    dimFailedByTier.set(tier, dimFailures);
  }

  const highestTier = computeHighestPassedTier(evidence, dimFailedByTier);
  const capApplied = highestTier ? TIER_SCORE_CAPS[highestTier] : 1.0;
  const honestScore = Math.min(reportedScore, capApplied);

  let reason: string;
  if (evidence.size === 0) {
    reason = 'No runtime evidence — score unverifiable, capped at T0';
  } else if (highestTier === null) {
    reason = `T1 failed: ${allFailed.size} package(s) attributed to this dim did not compile`;
  } else if (allFailed.size > 0) {
    reason = `Capped at ${highestTier} (${capApplied}/10) — ${allFailed.size} package(s) failed higher tiers`;
  } else {
    reason = `Highest passed tier: ${highestTier} (cap ${capApplied}/10)`;
  }

  return {
    id: dim.id,
    reportedScore,
    honestScore,
    capApplied,
    capTier: highestTier,
    reason,
    failedPackages: Array.from(allFailed).sort(),
  };
}

// ── Diff renderer ─────────────────────────────────────────────────────────────

function renderDiffMarkdown(result: HonestRescoreResult): string {
  const lines: string[] = [];
  lines.push(`# Honest Rescore Diff Report`);
  lines.push('');
  lines.push(`**Project:** ${result.project}`);
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`| Metric | Reported | Honest | Δ |`);
  lines.push(`|---|---|---|---|`);
  const delta = (result.honestOverall - result.reportedOverall).toFixed(2);
  lines.push(`| Overall | ${result.reportedOverall.toFixed(2)} | ${result.honestOverall.toFixed(2)} | ${delta} |`);
  lines.push('');
  lines.push(`## Evidence used`);
  lines.push('');
  if (result.evidenceUsed.length === 0) {
    lines.push('_No runtime evidence available. Run \`danteforge probe\` first._');
  } else {
    lines.push(`| Tier | git SHA | Failed packages |`);
    lines.push(`|---|---|---|`);
    for (const e of result.evidenceUsed) {
      lines.push(`| ${e.tier} | ${(e.gitSha ?? 'nogit').slice(0, 8)} | ${e.failedPackageCount} |`);
    }
  }
  lines.push('');
  lines.push(`## Per-dimension rescore`);
  lines.push('');
  lines.push(`| Dimension | Reported | Honest | Δ | Cap | Reason |`);
  lines.push(`|---|---|---|---|---|---|`);
  for (const d of result.perDimension) {
    const d_ = (d.honestScore - d.reportedScore).toFixed(2);
    const tier = d.capTier ?? 'T0';
    lines.push(`| ${d.id} | ${d.reportedScore.toFixed(1)} | ${d.honestScore.toFixed(1)} | ${d_} | ${tier}=${d.capApplied} | ${d.reason} |`);
  }
  lines.push('');
  lines.push(`## Failed packages by dimension`);
  lines.push('');
  for (const d of result.perDimension.filter(x => x.failedPackages.length > 0)) {
    lines.push(`### ${d.id}`);
    for (const p of d.failedPackages) lines.push(`- ${p}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ── Overall score recomputation ───────────────────────────────────────────────

interface MatrixForOverall {
  dimensions: Array<{ id: string; weight?: number; scores: { self: number } }>;
}

function recomputeOverall(matrix: MatrixForOverall, rescores: Map<string, number>): number {
  let tw = 0, ts = 0;
  for (const d of matrix.dimensions) {
    const w = d.weight ?? 1;
    const score = rescores.get(d.id) ?? d.scores.self;
    tw += w;
    ts += score * w;
  }
  return tw === 0 ? 0 : parseFloat((ts / tw).toFixed(2));
}

// ── Main ─────────────────────────────────────────────────────────────────────

export async function runHonestRescore(options: HonestRescoreOptions = {}): Promise<HonestRescoreResult> {
  const cwd = options.cwd ?? process.cwd();
  const readFn = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFn = options._writeFile ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, d, 'utf8');
  });
  const existsFn = options._exists ?? (async (p: string) => {
    try { await fs.access(p); return true; } catch { return false; }
  });
  const readdirFn = options._readdir ?? ((p: string) => fs.readdir(p));

  const matrixPath = path.join(cwd, MATRIX_PATH);
  if (!(await existsFn(matrixPath))) {
    throw new Error(`No matrix.json at ${matrixPath} — run 'danteforge init' first.`);
  }
  const matrix = JSON.parse(await readFn(matrixPath)) as MatrixLite;

  const evidence = await collectLatestEvidence(cwd, existsFn, readdirFn, readFn);
  const pkgMap = await loadPackageMap(cwd, existsFn, readFn);

  const perDimension: DimensionRescore[] = [];
  const honestScores = new Map<string, number>();
  for (const dim of matrix.dimensions) {
    const r = rescoreDimension(dim, evidence, pkgMap);
    perDimension.push(r);
    honestScores.set(dim.id, r.honestScore);
  }

  const reportedOverall = matrix.overallSelfScore ?? recomputeOverall(matrix as MatrixForOverall, new Map());
  const honestOverall = recomputeOverall(matrix as MatrixForOverall, honestScores);

  const evidenceUsed = Array.from(evidence.entries()).map(([tier, r]) => ({
    tier, gitSha: r.gitSha, failedPackageCount: r.failedPackages.length,
  }));

  const result: HonestRescoreResult = {
    project: matrix.project ?? path.basename(cwd),
    cwd,
    reportedOverall,
    honestOverall,
    perDimension,
    evidenceUsed,
    honestMatrixPath: path.join(cwd, HONEST_PATH),
    diffReportPath: path.join(cwd, DIFF_PATH),
  };

  // Write the honest matrix (a copy with self scores replaced) — never overwrite matrix.json.
  const honestMatrix = JSON.parse(JSON.stringify(matrix));
  for (const dim of honestMatrix.dimensions) {
    const r = perDimension.find(x => x.id === dim.id);
    if (r) dim.scores.self = r.honestScore;
  }
  honestMatrix.overallSelfScore = honestOverall;
  honestMatrix.honestRescoredAt = new Date().toISOString();

  await writeFn(result.honestMatrixPath, JSON.stringify(honestMatrix, null, 2));
  await writeFn(result.diffReportPath, renderDiffMarkdown(result));

  return result;
}

// ── Regrade mode ──────────────────────────────────────────────────────────────

/**
 * Mandatory skeptic-regrade cadence (Phase D).
 *
 * Runs the harden gate against EVERY dimension (regardless of current score —
 * unlike the production gate which only fires at >= 7.0) and surfaces any
 * dimension where the harden verdict would clamp the current score. Resets
 * state.wavesSinceLastRegrade to 0 on completion.
 *
 * Why not spawn a real LLM subagent? Two reasons:
 *  1. We already have a deterministic skeptic — the hardener. Running it across
 *     all dims with no exemption is the same as a "fresh skeptic re-reads code"
 *     pass, except deterministic and free.
 *  2. Real LLM regrades drift over time (model updates, prompt churn). Our
 *     code-inspection regrade is reproducible.
 *
 * The cadence enforcement happens elsewhere: `runFrontierCrusade` reads
 * state.wavesSinceLastRegrade and refuses to start when >3 unless the operator
 * runs this command.
 */
async function runRegradeMode(opts: { json?: boolean; cwd?: string }): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const { loadMatrix } = await import('../../core/compete-matrix.js');
  const { loadState, saveState } = await import('../../core/state.js');
  const { runHardenGate } = await import('../../matrix/engines/hardener.js');

  const matrix = await loadMatrix(cwd);
  if (!matrix) throw new Error(`No matrix.json at ${cwd}/.danteforge/compete/matrix.json`);

  const state = await loadState({ cwd });
  const reportRows: Array<{ id: string; current: number; allowed: boolean; cappedAt: number; failedChecks: string[] }> = [];

  for (const dim of matrix.dimensions) {
    const verdict = await runHardenGate({ dimensionId: dim.id, dim, cwd, _noWrite: true });
    const failedChecks = verdict.checks.filter(c => !c.passed && !c.skipped).map(c => c.check);
    reportRows.push({
      id: dim.id,
      current: dim.scores.self,
      allowed: verdict.allowed,
      cappedAt: verdict.allowed ? dim.scores.self : Math.min(dim.scores.self, verdict.scoreCap),
      failedChecks,
    });
  }

  const clamped = reportRows.filter(r => r.cappedAt < r.current - 0.01);

  state.wavesSinceLastRegrade = 0;
  state.lastRegradeAt = new Date().toISOString();
  await saveState(state, { cwd });

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      mode: 'regrade',
      cwd, ranAt: state.lastRegradeAt,
      totalDimensions: matrix.dimensions.length,
      wouldClamp: clamped.length,
      perDimension: reportRows,
    }, null, 2) + '\n');
    return;
  }

  logger.info('');
  logger.info(chalk.bold('Honest Rescore — Mandatory Skeptic Regrade'));
  logger.info(chalk.dim('─'.repeat(60)));
  logger.info('');
  logger.info(`  ${chalk.bold('Dimensions scanned:')}  ${matrix.dimensions.length}`);
  logger.info(`  ${chalk.bold('Would clamp:')}         ${clamped.length}`);
  logger.info(`  ${chalk.bold('Counter reset to:')}    0  (${chalk.dim(state.lastRegradeAt)})`);
  logger.info('');

  if (clamped.length === 0) {
    logger.success('  All dimensions hold against the harden gate ✓');
  } else {
    logger.info(chalk.bold('  Dimensions that would clamp:'));
    for (const r of clamped.slice(0, 25)) {
      const delta = (r.cappedAt - r.current).toFixed(2);
      logger.info(`    ${chalk.red('↓')} ${r.id.padEnd(30)} ${r.current.toFixed(1)} → ${chalk.yellow(r.cappedAt.toFixed(1))}  (${chalk.red(delta)})  ${chalk.dim(r.failedChecks.join(', '))}`);
    }
    if (clamped.length > 25) logger.info(chalk.dim(`    … and ${clamped.length - 25} more`));
  }
  logger.info('');
  logger.info(chalk.dim('  matrix.json was NOT modified. Run `danteforge harden migrate --apply` if callsites are needed.'));
  logger.info('');
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

function pct(n: number): string {
  if (n >= 8) return chalk.green(n.toFixed(2));
  if (n >= 6) return chalk.yellow(n.toFixed(2));
  return chalk.red(n.toFixed(2));
}

export async function runHonestRescoreCommand(opts: { json?: boolean; cwd?: string; regrade?: boolean } = {}): Promise<void> {
  if (opts.regrade) {
    await runRegradeMode(opts);
    return;
  }

  const result = await runHonestRescore({ cwd: opts.cwd });

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return;
  }

  logger.info('');
  logger.info(chalk.bold(`Honest Rescore — ${result.project}`));
  logger.info(chalk.dim('─'.repeat(50)));
  logger.info('');
  logger.info(`  ${chalk.bold('Reported overall:')} ${pct(result.reportedOverall)}`);
  logger.info(`  ${chalk.bold('Honest overall:')}   ${pct(result.honestOverall)}`);
  const delta = result.honestOverall - result.reportedOverall;
  if (Math.abs(delta) > 0.01) {
    const deltaStr = (delta > 0 ? '+' : '') + delta.toFixed(2);
    logger.info(`  ${chalk.bold('Δ:')}                ${delta < 0 ? chalk.red(deltaStr) : chalk.green(deltaStr)}`);
  }
  logger.info('');

  if (result.evidenceUsed.length === 0) {
    logger.warn('  ⚠ No runtime evidence found — every dim defaults to T0 (cap 1.0).');
    logger.info(`  ${chalk.dim('Run')} ${chalk.cyan('danteforge probe')} ${chalk.dim('first, then re-run this command.')}`);
  } else {
    logger.info(chalk.bold(`  Evidence (${result.evidenceUsed.length} tier(s)):`));
    for (const e of result.evidenceUsed) {
      const sha = (e.gitSha ?? 'nogit').slice(0, 8);
      logger.info(`    ${chalk.cyan(e.tier)}  sha=${sha}  failed_packages=${e.failedPackageCount}`);
    }
  }
  logger.info('');

  const regressions = result.perDimension.filter(d => d.honestScore < d.reportedScore - 0.05);
  if (regressions.length > 0) {
    logger.info(chalk.bold(`  Dimensions clamped (${regressions.length}):`));
    for (const r of regressions.slice(0, 15)) {
      const d_ = (r.honestScore - r.reportedScore).toFixed(2);
      logger.info(`    ${chalk.red('↓')} ${r.id.padEnd(28)} ${r.reportedScore.toFixed(1)} → ${chalk.yellow(r.honestScore.toFixed(1))}  (${chalk.red(d_)})  ${chalk.dim(r.reason)}`);
    }
    if (regressions.length > 15) logger.info(chalk.dim(`    … and ${regressions.length - 15} more`));
  } else {
    logger.success('  All dimensions hold against runtime evidence.');
  }
  logger.info('');
  logger.info(`  ${chalk.dim('Honest matrix:')} ${path.relative(process.cwd(), result.honestMatrixPath)}`);
  logger.info(`  ${chalk.dim('Diff report:')}  ${path.relative(process.cwd(), result.diffReportPath)}`);
  logger.info('');
  logger.info(chalk.dim('  matrix.json was NOT modified. Review the honest version and copy if satisfied.'));
  logger.info('');
}
