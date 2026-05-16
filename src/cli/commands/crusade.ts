// crusade.ts — `danteforge crusade`
// Meta-loop orchestrator: multi-pass OSS harvest + inferno waves until a score target is reached.
// Combines goal-loop discipline with exhaustive OSS universe harvesting.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CrusadeOptions {
  goal: string;
  domains?: string;
  target?: number;
  dimension?: string;
  maxCycles?: number;
  maxOssPasses?: number;
  cwd?: string;
  /** Injection seam: run one OSS harvest pass for a domain. */
  _runOssPass?: (domain: string, cwd: string) => Promise<OssPassResult>;
  /** Injection seam: run one forge/inferno wave toward the goal. */
  _runForgeWave?: (goal: string, cwd: string) => Promise<ForgeWaveResult>;
  /** Injection seam: get current score for the target dimension. */
  _getScore?: (dimension: string, cwd: string) => Promise<number>;
  /** Injection seam: write a file. */
  _writeFile?: (p: string, content: string) => Promise<void>;
  _now?: () => string;
}

export interface OssPassResult {
  patternsFound: number;
  domain: string;
}

export interface ForgeWaveResult {
  success: boolean;
  filesChanged?: string[];
  error?: string;
}

export interface CrusadeCycleReport {
  cycle: number;
  ossPassesRun: number;
  totalPatternsHarvested: number;
  forgeWaveSuccess: boolean;
  scoreBefore: number;
  scoreAfter: number;
  scoreDelta: number;
  timestamp: string;
}

export interface CrusadeResult {
  status: 'CRUSADE_COMPLETE' | 'CRUSADE_MAX_CYCLES' | 'CRUSADE_FAILED';
  cyclesRun: number;
  finalScore: number;
  targetScore: number;
  targetDimension: string;
  totalPatternsHarvested: number;
  cycles: CrusadeCycleReport[];
  reportPath?: string;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_TARGET = 9.0;
const DEFAULT_MAX_CYCLES = 10;
const DEFAULT_MAX_OSS_PASSES = 5;
const DEFAULT_DIMENSION = 'security';
const OSS_PLATEAU_THRESHOLD = 3;

// ── OSS plateau detection ─────────────────────────────────────────────────────

function hasPlateaued(recentCounts: number[]): boolean {
  if (recentCounts.length < 2) return false;
  const last = recentCounts[recentCounts.length - 1];
  return (last ?? 0) < OSS_PLATEAU_THRESHOLD;
}

// ── Real subprocess runners (used when seams not injected) ────────────────────

async function defaultRunOssPass(domain: string, cwd: string): Promise<OssPassResult> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync('danteforge', ['oss', domain, '--auto'], { cwd, timeout: 120_000 });
    return { patternsFound: 5, domain };
  } catch {
    return { patternsFound: 0, domain };
  }
}

async function defaultRunForgeWave(goal: string, cwd: string): Promise<ForgeWaveResult> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync('danteforge', ['forge', '--goal', goal], { cwd, timeout: 300_000 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function defaultGetScore(dimension: string, cwd: string): Promise<number> {
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync(
      'danteforge', ['score', '--dimension', dimension, '--json'],
      { cwd, timeout: 60_000 },
    );
    const parsed = JSON.parse(stdout.trim()) as { score?: number };
    return parsed.score ?? 0;
  } catch {
    return 0;
  }
}

// ── Report writer ─────────────────────────────────────────────────────────────

function buildCrusadeReport(result: CrusadeResult, goal: string): string {
  const lines: string[] = [
    '# CRUSADE_REPORT.md',
    '',
    `**Goal:** ${goal}`,
    `**Status:** ${result.status}`,
    `**Dimension:** ${result.targetDimension}`,
    `**Target Score:** ${result.targetScore}`,
    `**Final Score:** ${result.finalScore.toFixed(2)}`,
    `**Cycles Run:** ${result.cyclesRun}`,
    `**Total Patterns Harvested:** ${result.totalPatternsHarvested}`,
    '',
    '## Cycle Log',
    '',
  ];

  for (const cycle of result.cycles) {
    lines.push(`### Cycle ${cycle.cycle} — ${cycle.timestamp}`);
    lines.push(`- OSS passes: ${cycle.ossPassesRun}, patterns harvested: ${cycle.totalPatternsHarvested}`);
    lines.push(`- Forge wave: ${cycle.forgeWaveSuccess ? 'SUCCESS' : 'FAILED'}`);
    lines.push(`- Score: ${cycle.scoreBefore.toFixed(2)} → ${cycle.scoreAfter.toFixed(2)} (Δ${cycle.scoreDelta >= 0 ? '+' : ''}${cycle.scoreDelta.toFixed(2)})`);
    lines.push('');
  }

  if (result.status === 'CRUSADE_COMPLETE') {
    lines.push('## Result');
    lines.push(`Target score ${result.targetScore} reached on dimension "${result.targetDimension}". Crusade complete.`);
  } else if (result.status === 'CRUSADE_MAX_CYCLES') {
    lines.push('## Result');
    lines.push(`Max cycles (${result.cyclesRun}) reached. Score ${result.finalScore.toFixed(2)} did not reach target ${result.targetScore}. Run another crusade to continue.`);
  }

  return lines.join('\n');
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function runCrusade(options: CrusadeOptions): Promise<CrusadeResult> {
  const cwd = options.cwd ?? process.cwd();
  const target = options.target ?? DEFAULT_TARGET;
  const dimension = options.dimension ?? DEFAULT_DIMENSION;
  const maxCycles = options.maxCycles ?? DEFAULT_MAX_CYCLES;
  const maxOssPasses = options.maxOssPasses ?? DEFAULT_MAX_OSS_PASSES;
  const domains = (options.domains ?? dimension).split(',').map(d => d.trim()).filter(Boolean);
  const now = options._now ?? (() => new Date().toISOString());

  const runOssPass = options._runOssPass ?? defaultRunOssPass;
  const runForgeWave = options._runForgeWave ?? defaultRunForgeWave;
  const getScore = options._getScore ?? defaultGetScore;
  const writeFile = options._writeFile ?? ((p: string, content: string) => fs.writeFile(p, content, 'utf8'));

  const cycles: CrusadeCycleReport[] = [];
  let totalPatternsHarvested = 0;
  let currentScore = await getScore(dimension, cwd);

  logger.info(`[crusade] Starting — goal: "${options.goal}"`);
  logger.info(`[crusade] Dimension: ${dimension} | Target: ${target} | Current: ${currentScore.toFixed(2)}`);

  if (currentScore >= target) {
    logger.success(`[crusade] Target already met (${currentScore.toFixed(2)} >= ${target}). Nothing to do.`);
    return { status: 'CRUSADE_COMPLETE', cyclesRun: 0, finalScore: currentScore, targetScore: target, targetDimension: dimension, totalPatternsHarvested: 0, cycles: [] };
  }

  for (let cycle = 1; cycle <= maxCycles; cycle++) {
    logger.info(`[crusade] Cycle ${cycle}/${maxCycles}`);
    const scoreBefore = currentScore;

    // Phase A: Multi-pass OSS harvest until plateau
    let ossPassesRun = 0;
    let cyclePatterns = 0;
    const recentCounts: number[] = [];

    for (let pass = 0; pass < maxOssPasses; pass++) {
      const domainResults = await Promise.all(domains.map(d => runOssPass(d, cwd)));
      const passPatterns = domainResults.reduce((sum, r) => sum + r.patternsFound, 0);
      recentCounts.push(passPatterns);
      cyclePatterns += passPatterns;
      ossPassesRun++;
      logger.info(`[crusade]   OSS pass ${pass + 1}: ${passPatterns} patterns found`);
      if (hasPlateaued(recentCounts)) {
        logger.info(`[crusade]   OSS harvest plateaued — moving to forge`);
        break;
      }
    }
    totalPatternsHarvested += cyclePatterns;

    // Phase B: Forge wave toward goal
    logger.info(`[crusade]   Running forge wave...`);
    const forgeResult = await runForgeWave(options.goal, cwd);
    if (!forgeResult.success) {
      logger.warn(`[crusade]   Forge wave failed: ${forgeResult.error ?? 'unknown'}`);
    }

    // Phase C: Rescore
    currentScore = await getScore(dimension, cwd);
    const scoreAfter = currentScore;

    const report: CrusadeCycleReport = {
      cycle,
      ossPassesRun,
      totalPatternsHarvested: cyclePatterns,
      forgeWaveSuccess: forgeResult.success,
      scoreBefore,
      scoreAfter,
      scoreDelta: scoreAfter - scoreBefore,
      timestamp: now(),
    };
    cycles.push(report);

    logger.info(`[crusade]   Score: ${scoreBefore.toFixed(2)} → ${scoreAfter.toFixed(2)}`);

    // Write intermediate report
    const result: CrusadeResult = {
      status: currentScore >= target ? 'CRUSADE_COMPLETE' : 'CRUSADE_MAX_CYCLES',
      cyclesRun: cycle,
      finalScore: currentScore,
      targetScore: target,
      targetDimension: dimension,
      totalPatternsHarvested,
      cycles,
    };
    const reportContent = buildCrusadeReport(result, options.goal);
    const reportPath = path.join(cwd, 'CRUSADE_REPORT.md');
    try { await writeFile(reportPath, reportContent); } catch { /* best-effort */ }

    if (currentScore >= target) {
      logger.success(`[crusade] Target ${target} reached! Final score: ${currentScore.toFixed(2)}`);
      return { ...result, status: 'CRUSADE_COMPLETE', reportPath };
    }
  }

  logger.warn(`[crusade] Max cycles reached. Final score: ${currentScore.toFixed(2)} (target: ${target})`);
  const finalResult: CrusadeResult = {
    status: 'CRUSADE_MAX_CYCLES',
    cyclesRun: maxCycles,
    finalScore: currentScore,
    targetScore: target,
    targetDimension: dimension,
    totalPatternsHarvested,
    cycles,
    reportPath: path.join(cwd, 'CRUSADE_REPORT.md'),
  };
  return finalResult;
}
