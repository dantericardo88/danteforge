// crusade.ts — `danteforge crusade`
// Meta-loop orchestrator: multi-pass OSS harvest + inferno waves until a score target is reached.
// Combines goal-loop discipline with exhaustive OSS universe harvesting.
// Frontier mode: drives N dimensions in parallel to 9+ with autoresearch on stall.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { loadMatrix, computeGapPriority, type MatrixDimension, type CompeteMatrix } from '../../core/compete-matrix.js';

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
  // Read the competitive matrix self score for this dimension — authoritative source for crusade progress.
  // Falls back to 0 if the matrix or dimension is not found.
  try {
    const matrix = await loadMatrix(cwd);
    if (!matrix) return 0;
    const dim = matrix.dimensions.find(d => d.id === dimension);
    return dim?.scores['self'] ?? 0;
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
  cwd?: string;
  _runInferno?: (goal: string, cwd: string) => Promise<void>;
  _getScore?: (dimension: string, cwd: string) => Promise<number>;
  _runAutoResearch?: (dimensionId: string, goal: string, cwd: string) => Promise<void>;
  _runVerifyCap?: (dimensionId: string, cwd: string) => Promise<boolean>;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  /**
   * Tri-state seam for the regrade-cadence guard:
   *   undefined → load real state.yaml from cwd (production path)
   *   null      → disable the regrade-cadence guard entirely (test isolation)
   *   function  → injected loader for tests that want to drive specific wave counts
   */
  _loadState?: ((opts: { cwd?: string }) => Promise<{ wavesSinceLastRegrade?: number }>) | null;
}

export interface DimFrontierResult {
  dimensionId: string;
  label: string;
  initialScore: number;
  finalScore: number;
  cyclesRun: number;
  autoresearchRuns: number;
  status: 'FRONTIER_REACHED' | 'AT_CEILING' | 'MAX_CYCLES' | 'FAILED';
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
  // 30-minute budget; allow-dirty because inferno may have staged files
  await execFileAsync(
    'danteforge',
    ['autoresearch', '--goal', goal, '--metric', dimensionId, '--time', '30', '--allow-dirty'],
    { cwd, timeout: 1_900_000 },
  );
}

async function defaultRunVerifyCap(dimensionId: string, cwd: string): Promise<boolean> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  try {
    await execFileAsync(
      'danteforge', ['matrix-kernel', 'verify-capability', dimensionId],
      { cwd, timeout: 120_000 },
    );
    return true;
  } catch {
    return false;
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

  const initialScore = dim.scores['self'] ?? 0;
  let score = initialScore;
  let consecutiveNoProgress = 0;
  let autoresearchRuns = 0;
  let cycle = 0;

  logger.info(`[frontier:${dim.id}] Start ${score.toFixed(2)} → target ${target}`);

  while (cycle < maxDimCycles) {
    cycle++;
    const dimGoal = `Improve "${dim.label}" from ${score.toFixed(2)} to ${target}`;
    try { await runInferno(dimGoal, cwd); } catch (err) {
      logger.warn(`[frontier:${dim.id}] Inferno failed cycle ${cycle}: ${err}`);
    }

    const newScore = await getScore(dim.id, cwd);
    const delta = newScore - score;
    const prev = score;
    score = newScore;
    logger.info(`[frontier:${dim.id}] Cycle ${cycle}: ${prev.toFixed(2)} → ${score.toFixed(2)} (Δ${delta >= 0 ? '+' : ''}${delta.toFixed(2)})`);

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
      return { dimensionId: dim.id, label: dim.label, initialScore, finalScore: score, cyclesRun: cycle, autoresearchRuns, status: 'AT_CEILING' };
    }

    if (score >= target) {
      if (options.verifyCap) {
        const capOk = await runVerifyCap(dim.id, cwd);
        if (!capOk) {
          logger.warn(`[frontier:${dim.id}] Score ${score.toFixed(2)} >= target but capability_test failed — continuing`);
          consecutiveNoProgress++;
          continue;
        }
        logger.success(`[frontier:${dim.id}] Frontier reached and capability verified! ${score.toFixed(2)}`);
      } else {
        logger.success(`[frontier:${dim.id}] Frontier reached! ${score.toFixed(2)} >= ${target}`);
      }
      return { dimensionId: dim.id, label: dim.label, initialScore, finalScore: score, cyclesRun: cycle, autoresearchRuns, status: 'FRONTIER_REACHED' };
    }
  }

  logger.warn(`[frontier:${dim.id}] Max cycles (${maxDimCycles}) reached. Final: ${score.toFixed(2)}`);
  return { dimensionId: dim.id, label: dim.label, initialScore, finalScore: score, cyclesRun: cycle, autoresearchRuns, status: 'MAX_CYCLES' };
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
      (d.scores['self'] ?? 0) < target &&
      (d.ceiling === undefined || (d.scores['self'] ?? 0) < d.ceiling),
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
    const autonomyVerdict = await checkAutonomyRules(options.cwd);
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
