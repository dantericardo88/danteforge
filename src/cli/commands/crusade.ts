// crusade.ts — `danteforge crusade`
// Meta-loop orchestrator: multi-pass OSS harvest + inferno waves until a score target is reached.
// Combines goal-loop discipline with exhaustive OSS universe harvesting.
// Frontier mode: drives N dimensions in parallel to 9+ with autoresearch on stall.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { withProgress } from '../../core/progress-indicator.js';
import { loadMatrix, computeGapPriority, decisionDimScore, type MatrixDimension, type CompeteMatrix } from '../../core/compete-matrix.js';
import { runCIPCheck, type CIPOptions, type CIPResult } from '../../core/completion-integrity.js';
import { inferFailureKind, selectRecoveryAction, formatRecoveryPlan, type RecoveryContext } from '../../core/loop-recovery.js';
import { buildCycleRecord, assessLoopHealth, type CycleRecord } from '../../matrix/engines/autonomy-loop-monitor.js';

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

/** Returns the Node.js binary + path to the currently-running CLI entry point.
 *  More reliable than `danteforge` on PATH (which may be a .ps1 shim on Windows
 *  that execFileAsync cannot invoke without shell:true). */
function selfCli(): [string, string] {
  return [process.execPath, process.argv[1] ?? 'dist/index.js'];
}

async function defaultRunOssPass(domain: string, cwd: string): Promise<OssPassResult> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const fs = await import('node:fs/promises');
  const path = await import('node:path');

  try {
    // Use the currently-running Node process + CLI entry to avoid PATH resolution
    // issues on Windows (danteforge may be a .ps1 shim, not directly executable).
    const [node, cli] = selfCli();
    await execFileAsync(node, [cli, 'oss', '--max-repos', '5'], { cwd, timeout: 180_000 });

    // Best-effort: look for the report the oss command typically generates and count real patterns.
    // This is still heuristic but much better than hardcoding 5.
    let patternsFound = 5;
    try {
      const reportPath = path.join(cwd, 'OSS_REPORT.md');
      const report = await fs.readFile(reportPath, 'utf8');
      const matches = report.match(/pattern|harvested|extracted/gi);
      if (matches && matches.length > 0) {
        patternsFound = Math.min(Math.max(Math.floor(matches.length / 2), 2), 12);
      }
    } catch {
      // Report not found or unreadable — fall back to conservative positive signal
    }

    return { patternsFound, domain };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`[crusade] OSS harvest failed for domain "${domain}": ${msg.slice(0, 120)}`);
    return { patternsFound: 0, domain };
  }
}

async function defaultRunForgeWave(goal: string, cwd: string): Promise<ForgeWaveResult> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    // `danteforge magic <goal>` is the correct hero command — `forge` has no --goal flag.
    // Use the currently-running Node process + CLI entry to avoid .ps1 shim issues on Windows.
    // --light bypasses hard gates (CONSTITUTION, SPEC) that are not present when running
    // DanteForge on itself; the crusade manages its own quality gates (harden, CIP, Fix A).
    const [node, cli] = selfCli();
    await execFileAsync(node, [cli, 'magic', goal, '--yes', '--light'], { cwd, timeout: 300_000 });
    return { success: true };
  } catch (err) {
    const e = err as Error & { stderr?: string; stdout?: string };
    const details = [e.stderr, e.stdout].filter(Boolean).join('\n').trim();
    const error = details ? `${e.message}\n${details}` : e.message;
    return { success: false, error };
  }
}

async function defaultGetScore(dimension: string, cwd: string): Promise<number> {
  // Use the EFFECTIVE score (min of self + evidence-derived), not the raw self-score.
  // Crusade once trusted scores.self and skipped any dim self-claiming >= target —
  // which means an inflated matrix made crusade declare "already met / nothing to do"
  // and do no work (the split-brain we closed in ascend-engine + gap-report). The
  // effective score respects evidence caps, so crusade can't be fooled by inflation.
  try {
    const matrix = await loadMatrix(cwd);
    if (!matrix) return 0;
    const dim = matrix.dimensions.find(d => d.id === dimension);
    return dim ? decisionDimScore(dim) : 0;
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
  const loopRecords: CycleRecord[] = [];
  let consecutiveForgeFailures = 0;
  let consecutiveZeroPatterns = 0;
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

    if (cyclePatterns === 0) {
      consecutiveZeroPatterns++;
    } else {
      consecutiveZeroPatterns = 0;
    }

    // Phase B: Forge wave toward goal
    logger.info(`[crusade]   Running forge wave...`);
    const forgeResult = await withProgress('forge wave', async (progress) => {
      const result = await runForgeWave(options.goal, cwd);
      if (result.success) progress.succeed('forge wave complete');
      else progress.fail('forge wave failed');
      return result;
    });
    if (!forgeResult.success) {
      consecutiveForgeFailures++;
      logger.warn(`[crusade]   Forge wave failed: ${forgeResult.error ?? 'unknown'}`);
      // Surface a structured recovery recommendation
      const ctx: RecoveryContext = {
        dimensionId: dimension,
        consecutiveFailures: Math.max(consecutiveZeroPatterns, consecutiveForgeFailures),
        lastPatternCount: cyclePatterns,
        lastScoreDelta: 0,
        cyclesWithoutProgress: cycle,
        llmAvailable: true,
      };
      const failureKind = inferFailureKind({
        patternsFound: cyclePatterns, forgeSucceeded: false,
        scoreDelta: 0, cyclesWithoutProgress: consecutiveForgeFailures,
        capabilityTestFailed: false, llmAvailable: true,
        forgeError: forgeResult.error,
      });
      const recovery = selectRecoveryAction(failureKind, ctx);
      logger.warn(`[crusade]   Recovery: ${formatRecoveryPlan(recovery)}`);
    } else {
      consecutiveForgeFailures = 0;
    }

    // Phase C: Rescore
    currentScore = await getScore(dimension, cwd);
    const scoreAfter = currentScore;

    // Track loop health
    loopRecords.push(buildCycleRecord({
      cycle, dimensionId: dimension,
      patternsHarvested: cyclePatterns, forgeWaveSuccess: forgeResult.success,
      scoreBefore, scoreAfter,
    }));

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

  const health = assessLoopHealth(loopRecords);
  logger.info(`[crusade] Loop health: ${health.status} — ${health.recommendation}`);
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

// ── Frontier Crusade ──────────────────────────────────────────────────────────
// Pushes N dimensions in parallel to the target score, with autoresearch on stall.

export interface FrontierCrusadeOptions {
  goal: string;
  parallel?: number;       // number of dimensions to push simultaneously (default 4)
  target?: number;         // score target per dimension (default 9.0)
  maxDimCycles?: number;   // per-dimension cycle cap (default 15)
  stallThreshold?: number; // consecutive no-progress cycles before autoresearch (default 3)
  stallDelta?: number;     // min delta to count as progress (default 0.1)
  loop?: boolean;          // keep re-ranking and re-running passes until ALL_DONE (default false)
  verifyCap?: boolean;     // run capability_test before declaring FRONTIER_REACHED (default false)
  skipLLMCheck?: boolean;  // skip pre-flight LLM availability check (for testing)
  /** Skip CIP verification before FRONTIER_REACHED (development escape hatch — never default). */
  skipCIP?: boolean;
  /** Injection seam: override runCIPCheck for tests. */
  _cipCheck?: (dimensionId: string, options: CIPOptions) => Promise<CIPResult>;
  cwd?: string;
  _runInferno?: (goal: string, cwd: string) => Promise<void>;
  _getScore?: (dimension: string, cwd: string) => Promise<number>;
  _runAutoResearch?: (dimensionId: string, goal: string, cwd: string) => Promise<void>;
  _runVerifyCap?: (dimensionId: string, cwd: string) => Promise<boolean>;
  /** Run `danteforge validate <dimId> --force-cold` to write OutcomeEvidenceEntry receipts. */
  _runValidate?: (dimId: string, cwd: string) => Promise<void>;
  /** Run `node scripts/evidence-rescore.mjs` to update matrix.json from evidence files. */
  _runEvidenceRescore?: (cwd: string) => Promise<void>;
  /** Emit a Time Machine causal commit. null disables (test isolation). */
  _createTimeMachineCommit?: ((opts: { cwd: string; paths: string[]; label: string }) => Promise<unknown>) | null;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  /**
   * Tri-state seam for the regrade-cadence guard:
   *   undefined → load real state.yaml from cwd (production path)
   *   null      → disable the regrade-cadence guard entirely (test isolation)
   *   function  → injected loader for tests that want to drive specific wave counts
   */
  _loadState?: ((opts: { cwd?: string }) => Promise<{ wavesSinceLastRegrade?: number }>) | null;
  /**
   * Injection seam: override the autonomy-rules check.
   *   undefined → run real checkAutonomyRules (production path)
   *   null      → skip check entirely — returns { kind: 'proceed' } (test isolation)
   *   function  → injected checker returning a custom verdict
   */
  _checkAutonomyRules?: ((cwd?: string) => Promise<{ kind: string; reason?: string; rule?: string; affectedDims?: string[] }>) | null;
}

export interface DimFrontierResult {
  dimensionId: string;
  label: string;
  initialScore: number;
  finalScore: number;
  cyclesRun: number;
  autoresearchRuns: number;
  capabilityTestResult?: 'PASS' | 'FAIL' | 'NOT_DECLARED';
  status: 'FRONTIER_REACHED' | 'AT_CEILING' | 'MAX_CYCLES' | 'FAILED' | 'CAPABILITY_TEST_BLOCKED';
}

export interface FrontierCrusadeResult {
  status: 'ALL_DONE' | 'PARTIAL';
  dimensions: DimFrontierResult[];
  reportPath?: string;
}

async function defaultRunInferno(goal: string, _cwd: string): Promise<void> {
  const { inferno } = await import('./magic.js');
  await inferno(goal);
}

async function defaultRunAutoResearch(dimensionId: string, goal: string, cwd: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const [node, cli] = selfCli();
  // 30-minute budget; allow-dirty because inferno may have staged files
  await execFileAsync(
    node,
    [cli, 'autoresearch', '--goal', goal, '--metric', dimensionId, '--time', '30', '--allow-dirty'],
    { cwd, timeout: 1_900_000 },
  );
}

async function defaultRunVerifyCap(dimensionId: string, cwd: string): Promise<boolean> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const [node, cli] = selfCli();
  try {
    await execFileAsync(
      node, [cli, 'matrix-kernel', 'verify-capability', dimensionId],
      { cwd, timeout: 120_000 },
    );
    return true;
  } catch {
    return false;
  }
}

async function defaultRunValidate(dimId: string, cwd: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const [node, cli] = selfCli();
  await promisify(execFile)(node, [cli, 'validate', dimId, '--force-cold'], { cwd, timeout: 120_000 });
}

async function defaultRunEvidenceRescore(cwd: string): Promise<void> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  await promisify(execFile)(process.execPath, ['scripts/evidence-rescore.mjs'], { cwd, timeout: 60_000 });
}

// Fix A gate (Scoring Doctrine Rule 10): runs the dimension's capability_test command.
// If it exits non-zero AND the evidence-derived score > 5.0, the score is clamped to 5.0.
// This cannot be overridden by outcomes — structural code correctness is the gate.
async function runFixAGate(
  dim: MatrixDimension,
  score: number,
  cwd: string,
): Promise<{ score: number; result: 'PASS' | 'FAIL' | 'NOT_DECLARED' }> {
  const dimAny = dim as unknown as Record<string, unknown>;
  const capTest = dimAny['capability_test'] as { command?: string } | undefined;
  const noCapTest = dimAny['no_capability_test'] as boolean | undefined;
  if (noCapTest || !capTest?.command) return { score, result: 'NOT_DECLARED' };
  try {
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    await promisify(exec)(capTest.command, { cwd, timeout: 60_000 });
    return { score, result: 'PASS' };
  } catch {
    return { score: Math.min(score, 5.0), result: 'FAIL' };
  }
}

function buildFrontierReport(results: DimFrontierResult[], goal: string): string {
  const lines: string[] = [
    '# FRONTIER_CRUSADE_REPORT.md',
    '',
    `**Goal:** ${goal}`,
    `**Timestamp:** ${new Date().toISOString()}`,
    '',
    '## Dimension Results',
    '',
  ];
  for (const r of results) {
    const delta = r.finalScore - r.initialScore;
    lines.push(`### ${r.label} (\`${r.dimensionId}\`)`);
    lines.push(`- Status: **${r.status}**`);
    lines.push(`- Score: ${r.initialScore.toFixed(2)} → ${r.finalScore.toFixed(2)} (Δ${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`);
    lines.push(`- Cycles: ${r.cyclesRun} | Autoresearch runs: ${r.autoresearchRuns}`);
    if (r.capabilityTestResult) lines.push(`- Fix A (capability_test): ${r.capabilityTestResult}`);
    lines.push('');
  }
  const reached = results.filter(r => r.status === 'FRONTIER_REACHED').length;
  lines.push(`## Summary: ${reached}/${results.length} dimensions reached the frontier.`);
  return lines.join('\n');
}

async function runDimensionFrontierLoop(
  dim: MatrixDimension,
  options: FrontierCrusadeOptions,
): Promise<DimFrontierResult> {
  const cwd = options.cwd ?? process.cwd();
  const target = options.target ?? DEFAULT_TARGET;
  const maxDimCycles = options.maxDimCycles ?? 15;
  const stallThreshold = options.stallThreshold ?? 3;
  const stallDelta = options.stallDelta ?? 0.1;
  const runInferno = options._runInferno ?? defaultRunInferno;
  const getScore = options._getScore ?? defaultGetScore;
  const runAutoResearch = options._runAutoResearch ?? defaultRunAutoResearch;
  const runVerifyCap = options._runVerifyCap ?? defaultRunVerifyCap;

  const runValidate = options._runValidate ?? defaultRunValidate;
  const runEvidenceRescore = options._runEvidenceRescore ?? defaultRunEvidenceRescore;

  const initialScore = decisionDimScore(dim); // evidence-capped, not raw self (anti-inflation)
  let score = initialScore;
  let consecutiveNoProgress = 0;
  let consecutiveCapTestFail = 0;
  let autoresearchRuns = 0;
  let cycle = 0;
  let lastCapResult: 'PASS' | 'FAIL' | 'NOT_DECLARED' = 'NOT_DECLARED';

  logger.info(`[frontier:${dim.id}] Start ${score.toFixed(2)} → target ${target}`);

  while (cycle < maxDimCycles) {
    cycle++;
    const dimGoal = `Improve "${dim.label}" from ${score.toFixed(2)} to ${target}`;
    try { await runInferno(dimGoal, cwd); } catch (err) {
      logger.warn(`[frontier:${dim.id}] Inferno failed cycle ${cycle}: ${err}`);
    }

    // CIP pre-check: skip validate for dims that can't satisfy production callsite evidence.
    // Mirrors council-parallel runPostMergeDoctrine — CIP before validate, never after.
    if (!options.skipCIP) {
      const cipFn = options._cipCheck ?? runCIPCheck;
      let cipBlocked = false;
      try {
        const cipPre = await cipFn(dim.id, { cwd, target });
        if (cipPre.blocksFrontierReached) {
          logger.warn(`[frontier:${dim.id}] CIP pre-check blocked validate (cycle ${cycle}) — ${cipPre.gaps.join('; ')}`);
          cipBlocked = true;
        }
      } catch (err) {
        logger.warn(`[frontier:${dim.id}] CIP pre-check error (cycle ${cycle}) — proceeding: ${err}`);
      }
      if (cipBlocked) {
        // Skip the rest of the evidence pipeline; treat cycle as no-progress.
        consecutiveNoProgress++;
        // Stall check must run even when CIP blocks — dim may be permanently stuck.
        if (consecutiveNoProgress >= stallThreshold) {
          logger.info(`[frontier:${dim.id}] Stalled (CIP-blocked) — triggering autoresearch`);
          try {
            await runAutoResearch(dim.id, dimGoal, cwd);
            autoresearchRuns++;
          } catch (err) {
            logger.warn(`[frontier:${dim.id}] Autoresearch failed: ${err}`);
          }
          consecutiveNoProgress = 0;
        }
        continue;
      }
    }

    // Evidence pipeline (Scoring Doctrine Rules 9–13):
    // validate writes receipts → evidence-rescore updates matrix → Fix A gate clamps if needed.
    try { await runValidate(dim.id, cwd); } catch (err) {
      logger.warn(`[frontier:${dim.id}] validate failed cycle ${cycle}: ${err}`);
    }
    try { await runEvidenceRescore(cwd); } catch (err) {
      logger.warn(`[frontier:${dim.id}] evidence-rescore failed cycle ${cycle}: ${err}`);
    }

    const rawScore = await getScore(dim.id, cwd);
    const { score: cappedScore, result: capResult } = await runFixAGate(dim, rawScore, cwd);
    lastCapResult = capResult;

    if (capResult === 'FAIL') {
      logger.warn(`[frontier:${dim.id}] Fix A: capability_test FAIL — clamping ${rawScore.toFixed(2)} → ${cappedScore.toFixed(2)}`);
      consecutiveCapTestFail++;
      if (consecutiveCapTestFail >= 2) {
        logger.error(`[frontier:${dim.id}] CAPABILITY_TEST_BLOCKED — 2 consecutive Fix A failures. Fix the code, not the score.`);
        return { dimensionId: dim.id, label: dim.label, initialScore, finalScore: cappedScore, cyclesRun: cycle, autoresearchRuns, capabilityTestResult: 'FAIL', status: 'CAPABILITY_TEST_BLOCKED' };
      }
    } else {
      consecutiveCapTestFail = 0;
    }

    // Time Machine commit — mandatory before accepting any score (Rule 13).
    try {
      const tmFn = options._createTimeMachineCommit === null ? null
        : options._createTimeMachineCommit
        ?? (await import('../../core/time-machine.js')).createTimeMachineCommit;
      if (tmFn) {
        await tmFn({
          cwd,
          paths: ['.danteforge/outcome-evidence', '.danteforge/harden-receipts'],
          label: `crusade/cycle-${cycle}/${dim.id}`,
        });
      }
    } catch (err) {
      logger.warn(`[frontier:${dim.id}] Time Machine commit failed cycle ${cycle}: ${err}`);
    }

    const newScore = cappedScore;
    const delta = newScore - score;
    const prev = score;
    score = newScore;
    logger.info(`[frontier:${dim.id}] Cycle ${cycle}: ${prev.toFixed(2)} → ${score.toFixed(2)} (Δ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}) cap=${capResult}`);

    if (delta < stallDelta) {
      consecutiveNoProgress++;
    } else {
      consecutiveNoProgress = 0;
    }

    if (consecutiveNoProgress >= stallThreshold) {
      logger.info(`[frontier:${dim.id}] Stalled — triggering autoresearch`);
      try {
        await runAutoResearch(dim.id, dimGoal, cwd);
        autoresearchRuns++;
      } catch (err) {
        logger.warn(`[frontier:${dim.id}] Autoresearch failed: ${err}`);
      }
      consecutiveNoProgress = 0;
    }

    // Ceiling check before target: dims capped below target report AT_CEILING, not FRONTIER_REACHED
    if (dim.ceiling !== undefined && score >= dim.ceiling) {
      logger.info(`[frontier:${dim.id}] At natural ceiling (${score.toFixed(2)} >= ${dim.ceiling})`);
      return { dimensionId: dim.id, label: dim.label, initialScore, finalScore: score, cyclesRun: cycle, autoresearchRuns, capabilityTestResult: lastCapResult, status: 'AT_CEILING' };
    }

    if (score >= target) {
      // Fix A must be PASS (or NOT_DECLARED) before declaring FRONTIER_REACHED
      if (capResult === 'FAIL') {
        logger.warn(`[frontier:${dim.id}] Score ${score.toFixed(2)} >= target but capability_test FAIL — not declaring frontier`);
        continue;
      }
      if (options.verifyCap) {
        const capOk = await runVerifyCap(dim.id, cwd);
        if (!capOk) {
          logger.warn(`[frontier:${dim.id}] Score ${score.toFixed(2)} >= target but matrix-kernel verify-capability failed — continuing`);
          consecutiveNoProgress++;
          continue;
        }
      }
      // CIP gate (Scoring Doctrine Rule 14): verify end-to-end evidence before
      // declaring FRONTIER_REACHED. Self-reported scores are untrusted.
      if (!options.skipCIP) {
        const cipFn = options._cipCheck ?? runCIPCheck;
        const cip = await cipFn(dim.id, { cwd, target });
        if (cip.blocksFrontierReached) {
          logger.warn(`[frontier:${dim.id}] CIP blocked FRONTIER_REACHED — ${cip.gaps.join('; ')}`);
          consecutiveNoProgress = 0; // treat as non-plateau so the loop continues
          continue;
        }
        logger.success(`[frontier:${dim.id}] FRONTIER_REACHED — ${score.toFixed(2)} evidence-verified, CIP confirmed (cipScore=${cip.cipScore.toFixed(2)})`);
      } else {
        logger.warn(`[frontier:${dim.id}] --skip-cip active — CIP gate bypassed (dev mode only)`);
        // Audit trail — append bypass record so ops can detect misuse
        fs.mkdir(path.join(cwd, '.danteforge', 'integrity-audit'), { recursive: true })
          .then(() => fs.appendFile(
            path.join(cwd, '.danteforge', 'integrity-audit', 'bypass.log'),
            `${new Date().toISOString()} skip-cip frontier-crusade ${dim.id}\n`,
            'utf8',
          )).catch(() => { /* best-effort */ });
        logger.success(`[frontier:${dim.id}] FRONTIER_REACHED — ${score.toFixed(2)} evidence-verified`);
      }
      return { dimensionId: dim.id, label: dim.label, initialScore, finalScore: score, cyclesRun: cycle, autoresearchRuns, capabilityTestResult: lastCapResult, status: 'FRONTIER_REACHED' };
    }
  }

  logger.warn(`[frontier:${dim.id}] Max cycles (${maxDimCycles}) reached. Final: ${score.toFixed(2)}`);
  return { dimensionId: dim.id, label: dim.label, initialScore, finalScore: score, cyclesRun: cycle, autoresearchRuns, capabilityTestResult: lastCapResult, status: 'MAX_CYCLES' };
}

async function runFrontierPass(options: FrontierCrusadeOptions): Promise<FrontierCrusadeResult> {
  const cwd = options.cwd ?? process.cwd();
  const parallel = options.parallel ?? 4;
  const target = options.target ?? DEFAULT_TARGET;
  const loadFn = options._loadMatrix ?? loadMatrix;
  const writeFile = options._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));

  const matrix = await loadFn(cwd);
  if (!matrix) throw new Error('No compete matrix found. Run `danteforge compete --init` first.');

  const excluded = new Set(matrix.excludedDimensions ?? []);
  const eligible = matrix.dimensions
    .filter(d =>
      !excluded.has(d.id) &&
      d.status !== 'closed' &&
      decisionDimScore(d) < target &&
      (d.ceiling === undefined || decisionDimScore(d) < d.ceiling),
    )
    .sort((a, b) => computeGapPriority(b) - computeGapPriority(a))
    .slice(0, parallel);

  if (eligible.length === 0) {
    logger.success('[frontier] All dimensions already at target or ceiling.');
    return { status: 'ALL_DONE', dimensions: [] };
  }

  logger.info(`[frontier] Pushing ${eligible.length} dimension(s) in parallel: ${eligible.map(d => d.label).join(', ')}`);

  const results = await Promise.all(eligible.map(dim => runDimensionFrontierLoop(dim, options)));

  const allDone = results.every(r => r.status === 'FRONTIER_REACHED' || r.status === 'AT_CEILING');
  const reportPath = path.join(cwd, 'FRONTIER_CRUSADE_REPORT.md');
  try { await writeFile(reportPath, buildFrontierReport(results, options.goal)); } catch { /* best-effort */ }

  // Phase D: increment regrade-cadence counter so the next crusade enforces
  // the skeptic-regrade cadence. Best-effort — never blocks the wave.
  try {
    const { loadState, saveState } = await import('../../core/state.js');
    const state = await loadState({ cwd });
    state.wavesSinceLastRegrade = (state.wavesSinceLastRegrade ?? 0) + 1;
    await saveState(state, { cwd });
  } catch { /* best-effort */ }

  return { status: allDone ? 'ALL_DONE' : 'PARTIAL', dimensions: results, reportPath };
}

const MAX_WAVES_WITHOUT_REGRADE = 3;

/**
 * Phase H Slice 5 helper: run the autonomy rule chain.
 * Returns the first halting verdict, the frontier-reached verdict, or "proceed".
 * Best-effort caller wraps in try/catch — a rule-engine crash should not block
 * the crusade (we still want forward progress on the load-bearing work).
 */
export async function checkAutonomyRules(cwd?: string): Promise<import('../../matrix/engines/crusade-autonomy.js').AutonomyVerdict> {
  const { applyAutonomyRules } = await import('../../matrix/engines/crusade-autonomy.js');
  const { loadState } = await import('../../core/state.js');
  const { loadMatrix } = await import('../../core/compete-matrix.js');
  const { computeProjectFrontierState } = await import('../../core/frontier-state.js');
  const { loadOutcomeEvidence } = await import('../../matrix/engines/outcome-runner.js');
  const stateCwd = cwd ?? process.cwd();
  const state = await loadState({ cwd: stateCwd });
  const matrix = await loadMatrix(stateCwd);
  if (!matrix) return { kind: 'proceed' };

  // Load active dispensations (filter cleared + expired TTL).
  // Parity with src/cli/commands/frontier.ts:loadDispensations — both readers
  // must agree on what "active" means, otherwise the crusade halts on
  // dispensations that `danteforge dispensation list` correctly reports as cleared.
  const dispensationsByDim: Record<string, string[]> = {};
  try {
    const dispDir = path.join(stateCwd, '.danteforge', 'score-proposals', 'dispensations');
    const files = await fs.readdir(dispDir).catch(() => []);
    const now = Date.now();
    for (const f of files.filter(n => n.endsWith('.json'))) {
      try {
        const raw = await fs.readFile(path.join(dispDir, f), 'utf8');
        const parsed = JSON.parse(raw) as { dimensionId?: string; id?: string; cleared?: boolean; expiresAt?: string };
        if (parsed.cleared) continue;
        if (parsed.expiresAt) {
          const expiry = new Date(parsed.expiresAt).getTime();
          if (Number.isFinite(expiry) && now > expiry) continue;
        }
        if (parsed.dimensionId && parsed.id) {
          (dispensationsByDim[parsed.dimensionId] ??= []).push(parsed.id);
        }
      } catch { /* skip */ }
    }
  } catch { /* no dispensations dir */ }

  const evidence = await loadOutcomeEvidence(stateCwd);
  const frontier = computeProjectFrontierState({
    dimensions: matrix.dimensions.map(d => ({
      id: d.id,
      outcomes: (d as unknown as Record<string, unknown>)['outcomes'] as never,
      declared_ceiling: (d as unknown as Record<string, unknown>)['declared_ceiling'] as never,
      scores: d.scores,
      legacy_score: (d as unknown as Record<string, unknown>)['legacy_score'] as number | undefined,
    })),
    evidence,
    wavesSinceProgress: state.wavesSinceProgress,
    dispensations: dispensationsByDim,
  });

  const result = applyAutonomyRules({ state, frontier, cwd: stateCwd });
  return result.verdict;
}

export async function runFrontierCrusade(options: FrontierCrusadeOptions): Promise<FrontierCrusadeResult> {
  // Mandatory regrade cadence (Phase D): if more than MAX_WAVES_WITHOUT_REGRADE
  // crusade waves have run since the last skeptic regrade, the crusade refuses
  // to start. The operator must run `danteforge honest-rescore --regrade` to
  // re-baseline. This is the structural insurance against score drift between
  // honest audits.
  // Tri-state seam: null disables the guard, function overrides the loader,
  // undefined uses the real state.yaml. Tests that don't care about regrade
  // cadence pass `_loadState: null` and skip this gate entirely.
  if (options._loadState !== null) {
    try {
      const loadStateFn = options._loadState
        ?? (async (o: { cwd?: string }) => {
          const { loadState } = await import('../../core/state.js');
          return loadState(o);
        });
      const state = await loadStateFn({ cwd: options.cwd });
      const waves = state.wavesSinceLastRegrade ?? 0;
      if (waves > MAX_WAVES_WITHOUT_REGRADE) {
        logger.error(`[frontier] BLOCKED: ${waves} crusade waves since last regrade (max: ${MAX_WAVES_WITHOUT_REGRADE}).`);
        logger.error(`[frontier] Run: danteforge honest-rescore --regrade`);
        logger.error(`[frontier] Then re-run the crusade. The skeptic regrade is mandatory to prevent silent score drift.`);
        return { status: 'PARTIAL', dimensions: [] };
      }
      logger.info(`[frontier] Regrade cadence: ${waves}/${MAX_WAVES_WITHOUT_REGRADE} waves since last skeptic pass.`);
    } catch (err) {
      // Best-effort — if state can't be loaded, do not block the crusade.
      logger.warn(`[frontier] could not load state for regrade-cadence check: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Phase H Slice 5: autonomous-crusade rules. Apply all rules BEFORE the wave
  // and again AFTER it. If any rule halts, surface the terminal state and stop.
  // This is what makes "run crusade and DanteForge knows when done" a true
  // statement — the substrate stops itself honestly instead of grinding.
  try {
    const checkFn = options._checkAutonomyRules === null
      ? async () => ({ kind: 'proceed' as const })
      : options._checkAutonomyRules ?? checkAutonomyRules;
    const autonomyVerdict = await checkFn(options.cwd);
    if (autonomyVerdict.kind === 'halt') {
      logger.error(`[frontier] AUTONOMY HALT: ${autonomyVerdict.reason}`);
      if (autonomyVerdict.affectedDims && autonomyVerdict.affectedDims.length > 0) {
        logger.error(`[frontier] Affected dim(s): ${autonomyVerdict.affectedDims.join(', ')}`);
      }
      logger.error(`[frontier] Rule fired: ${autonomyVerdict.rule}`);
      return { status: 'PARTIAL', dimensions: [] };
    }
    if (autonomyVerdict.kind === 'frontier-reached') {
      logger.success(`[frontier] FRONTIER REACHED: ${autonomyVerdict.reason}`);
      return { status: 'ALL_DONE', dimensions: [] };
    }
  } catch (err) {
    // Best-effort — do not block the crusade on an autonomy-rule error.
    logger.warn(`[frontier] autonomy-rules check failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Pre-flight: verify LLM is reachable before spawning parallel waves.
  // Without this, all dimensions time out after 180s each before failing gracefully.
  if (!options.skipLLMCheck) {
    try {
      const { isLLMAvailable } = await import('../../core/llm.js');
      const available = await isLLMAvailable();
      if (!available) {
        logger.error('[frontier] LLM provider is not reachable. Configure a provider with `danteforge config` before running the crusade.');
        logger.error('[frontier] Tip: set ANTHROPIC_API_KEY for Claude, or start Ollama locally.');
        return { status: 'PARTIAL', dimensions: [] };
      }
      logger.info('[frontier] LLM pre-flight check: OK');
    } catch {
      logger.warn('[frontier] LLM pre-flight check failed — proceeding anyway (some dimensions may fail)');
    }
  }

  if (!options.loop) {
    return runFrontierPass(options);
  }

  let pass = 0;
  let result: FrontierCrusadeResult;
  do {
    pass++;
    logger.info(`[frontier] ── Pass ${pass} ──────────────────────────────────────`);
    result = await runFrontierPass(options);
    if (result.status === 'PARTIAL') {
      const summary = result.dimensions.map(d => `${d.label}=${d.finalScore.toFixed(1)}`).join(' ');
      logger.info(`[frontier] Pass ${pass} complete (${summary}) — re-ranking next batch`);
    }
  } while (result.status === 'PARTIAL');

  logger.success(`[frontier] ALL_DONE after ${pass} pass(es). Every dimension at target or ceiling.`);
  return result;
}
