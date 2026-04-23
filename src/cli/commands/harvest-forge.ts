// Harvest Forge — compounding OSS intelligence loop.
// oss-intel → adopt top patterns → verify → rescore → convergence check → repeat.
// Stores state in .danteforge/convergence.json — survives process restarts.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import {
  loadConvergence,
  saveConvergence,
  initConvergence,
  updateDimension,
  isFullyConverged,
  detectPlateau,
  renderConvergenceChart,
  recordAdoption,
  type ConvergenceState,
  type CycleRecord,
} from '../../core/convergence.js';
import { ossIntel, type OssIntelOptions, type AdoptionCandidate } from './oss-intel.js';
import { type UniverseScanOptions, type UniverseScan } from './universe-scan.js';
import { type GoalConfig } from './set-goal.js';
import { buildLeapfrogPlan, buildCompetitorProfiles, findLeapfrogOpportunities, type LeapfrogPlan } from '../../core/competitive-planner.js';
import { recordAdoptionResult, loadAttributionLog, saveAttributionLog, type AttributionRecord } from '../../core/causal-attribution.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type StopReason =
  | 'convergence-achieved'
  | 'plateau-detected'
  | 'max-cycles'
  | 'budget-exhausted'
  | 'queue-exhausted'
  | 'error';

export interface HarvestForgeResult {
  cyclesRun: number;
  stopReason: StopReason;
  finalScores: Record<string, number>;
  totalPatternsAdopted: number;
}

export interface HarvestForgeOptions {
  cwd?: string;
  /** Max iteration cycles (default 10) */
  maxCycles?: number;
  /** Target convergence score 0-10 (default 9.0) */
  targetScore?: number;
  /** Adoptions to attempt per cycle (default 3) */
  topAdoptionsPerCycle?: number;
  /** Skip human approval checkpoint (default false) */
  autoApprove?: boolean;
  /** Show the loop plan without executing */
  promptMode?: boolean;
  /**
   * Max wall-clock hours before stopping with 'budget-exhausted'.
   * Set alongside maxCycles for time-bounded runs.
   */
  maxHours?: number;
  /**
   * Run forge adoptions in parallel (default false — sequential for safety).
   * Set true for speed when adoptions are known to be independent.
   */
  parallelForge?: boolean;
  _llmCaller?: (prompt: string) => Promise<string>;
  _isLLMAvailable?: () => Promise<boolean>;
  _runOssIntel?: (opts?: OssIntelOptions) => Promise<void>;
  _runForge?: (goal: string, opts?: { cwd?: string }) => Promise<{ success: boolean }>;
  _runVerify?: (opts?: { cwd?: string }) => Promise<void>;
  _getScores?: (cwd?: string) => Promise<Record<string, number>>;
  _loadConvergence?: (cwd?: string) => Promise<ConvergenceState>;
  _saveConvergence?: (state: ConvergenceState, cwd?: string) => Promise<void>;
  _readAdoptionQueue?: (cwd?: string) => Promise<AdoptionCandidate[]>;
  /** Called every 3 cycles to refresh universe scan and SCORES.json */
  _runUniverseScan?: (opts?: UniverseScanOptions) => Promise<UniverseScan>;
  /**
   * Returns the LLM cost in USD for the current cycle.
   * Defaults to 0 until real token tracking is wired.
   */
  _getCycleCost?: () => number;
  /**
   * Load GOAL.json — used for oversight level and daily budget enforcement.
   * Injected for testing; defaults to loadGoal().
   */
  _loadGoal?: (cwd?: string) => Promise<GoalConfig | null>;
  /**
   * Record a pattern as adopted into convergence state.
   * Injected for testing; defaults to recordAdoption().
   */
  _recordAdoption?: (state: ConvergenceState, patternName: string) => ConvergenceState;
  /** Returns current timestamp ms — injected for testing maxHours logic. */
  _now?: () => number;
  /**
   * Print adoption reasoning for each pattern before adopting it.
   * Helps understand why each pattern was selected and what it does.
   */
  explain?: boolean;
  /**
   * Enable rollback: capture git SHA before each adoption, auto-rollback on verify failure.
   * Patterns that fail verify get marked 'rejected' in attribution-log.json.
   */
  enableRollback?: boolean;
  /**
   * Override git rev-parse HEAD — used in tests to capture rollback SHA.
   */
  _getGitSha?: (cwd?: string) => Promise<string | undefined>;
  /**
   * Override git reset for rollback — used in tests.
   */
  _gitReset?: (cwd: string, sha: string) => Promise<void>;
  /**
   * Enable sequential micro-adoption with per-pattern verify for causal attribution.
   * Each pattern is adopted individually, verified, and score delta recorded.
   * Slower but provides clean causal signal for pattern ROI tracking.
   * CLI: --attribution
   */
  attributionMode?: boolean;
  /**
   * Enable competitive leapfrog planning — prints opportunities in cycle header.
   * Requires universe-scan data to be present.
   */
  enableLeapfrog?: boolean;
  /** Override leapfrog plan builder — used in tests */
  _buildLeapfrogPlan?: typeof buildLeapfrogPlan;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function getDanteforgeDir(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge');
}

// ── Default implementations ───────────────────────────────────────────────────

async function defaultGetScores(cwd?: string): Promise<Record<string, number>> {
  const danteforgeDir = getDanteforgeDir(cwd);
  // Prefer SCORES.json (written by universe-scan) — it has evidence-based scores
  for (const filename of ['SCORES.json', 'feature-scores.json']) {
    try {
      const raw = await fs.readFile(path.join(danteforgeDir, filename), 'utf8');
      return JSON.parse(raw) as Record<string, number>;
    } catch {
      // try next
    }
  }
  return {};
}

async function defaultRunUniverseScan(opts?: UniverseScanOptions): Promise<UniverseScan> {
  const { universeScan } = await import('./universe-scan.js');
  return universeScan(opts);
}

async function defaultReadAdoptionQueue(cwd?: string): Promise<AdoptionCandidate[]> {
  try {
    const queuePath = path.join(getDanteforgeDir(cwd), 'ADOPTION_QUEUE.md');
    const content = await fs.readFile(queuePath, 'utf8');

    // Parse adoption candidates from markdown (simple extraction)
    const sections = content.split(/^## \d+\. /m).filter(s => s.trim());
    return sections.map(section => {
      const lines = section.split('\n');
      const patternName = lines[0]?.split(' (score:')[0]?.trim() ?? 'unknown';
      const whatToBuild = lines.find(l => l.startsWith('**What to build**:'))
        ?.replace('**What to build**:', '').trim() ?? '';
      const effortMatch = section.match(/Effort\*\*: (1h|4h|1d|3d)/);
      return {
        patternName,
        category: '',
        sourceRepo: '',
        referenceImplementation: '',
        whatToBuild,
        filesToModify: [],
        estimatedEffort: (effortMatch?.[1] ?? '4h') as AdoptionCandidate['estimatedEffort'],
        unlocksGapClosure: [],
        adoptionScore: 0,
      };
    }).filter(c => c.patternName !== 'unknown');
  } catch {
    return [];
  }
}

async function defaultRunForge(
  goal: string,
  opts?: { cwd?: string },
): Promise<{ success: boolean }> {
  try {
    const { autoforge } = await import('./autoforge.js');
    await autoforge(goal, { maxWaves: 6, cwd: opts?.cwd });
    return { success: true };
  } catch (err) {
    logger.warn(`[harvest-forge] Forge failed: ${err instanceof Error ? err.message : String(err)}`);
    return { success: false };
  }
}

async function defaultRunVerify(opts?: { cwd?: string }): Promise<void> {
  try {
    const { verify } = await import('./verify.js');
    await verify({ cwd: opts?.cwd });
  } catch (err) {
    logger.warn(`[harvest-forge] Verify failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Convergence chart printing ────────────────────────────────────────────────

function printCycleHeader(cycle: number, maxCycles: number): void {
  const bar = '═'.repeat(60);
  logger.info(`\n${bar}`);
  logger.info(`  HARVEST-FORGE CYCLE ${cycle} / ${maxCycles}`);
  logger.info(`${bar}`);
}

function printConvergenceChart(state: ConvergenceState, cycle: number): void {
  logger.info('\n  CONVERGENCE STATUS:');
  logger.info(renderConvergenceChart(state));
  logger.info(`\n  Cycle ${cycle} complete. ${state.dimensions.filter(d => d.converged).length}/${state.dimensions.length} dimensions converged.\n`);
}

// ── Checkpoint input parsing ──────────────────────────────────────────────────

/**
 * Parse human checkpoint input.
 *
 * Returns:
 *   []       — APPROVE (run all adoptions)
 *   [-1]     — STOP (sentinel: pause the loop)
 *   [0, 2]   — SKIP 1 3 (0-based indices of adoptions to skip)
 */
export function parseCheckpointInput(input: string, count: number): number[] {
  const upper = input.trim().toUpperCase();
  if (upper === 'STOP') return [-1];
  if (upper === '' || upper === 'APPROVE') return [];

  // "SKIP 1" or "SKIP 1 3" — 1-based user input → 0-based indices
  const skipMatch = upper.match(/^SKIP\s+([\d\s]+)$/);
  if (skipMatch) {
    return skipMatch[1]!
      .trim()
      .split(/\s+/)
      .map(n => parseInt(n, 10) - 1)
      .filter(idx => idx >= 0 && idx < count);
  }

  return [];  // unrecognised input → treat as approve
}

// ── Human checkpoint ──────────────────────────────────────────────────────────

/**
 * Returns indices (0-based) of adoptions to skip.
 * Empty array = approve all. [-1] = stop entirely.
 */
async function humanCheckpoint(
  cycle: number,
  adoptions: AdoptionCandidate[],
  scores: Record<string, number>,
  autoApprove: boolean,
): Promise<number[]> {
  const plan = [
    `\n  CYCLE ${cycle} PLAN:`,
    `  Current scores: ${Object.entries(scores).map(([k, v]) => `${k}: ${v}`).join(', ')}`,
    `  Proposing to implement:`,
    ...adoptions.map((a, i) => `    ${i + 1}. ${a.patternName} — ${a.whatToBuild} (${a.estimatedEffort})`),
    '',
  ].join('\n');

  logger.info(plan);

  if (autoApprove) {
    logger.info('  [auto-approve] Proceeding automatically.');
    return [];
  }

  // In non-interactive environments (CI, tests), auto-approve
  if (!process.stdin.isTTY) {
    logger.info('  [non-interactive] Auto-approving.');
    return [];
  }

  logger.info('  Type APPROVE to continue, SKIP 1 to skip item 1, STOP to pause (30-min timeout): ');
  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      logger.info('  [timeout 30min] Auto-approving.');
      resolve([]);
    }, 1_800_000);

    process.stdin.once('data', (data: Buffer) => {
      clearTimeout(timeout);
      const input = data.toString().trim();
      resolve(parseCheckpointInput(input, adoptions.length));
    });
  });
}

// ── Oversight level resolution ────────────────────────────────────────────────

async function resolveEffectiveAutoApprove(
  adoptions: AdoptionCandidate[],
  baseAutoApprove: boolean,
  loadGoal: (cwd?: string) => Promise<GoalConfig | null>,
  cwd: string,
): Promise<boolean> {
  if (baseAutoApprove) return true;
  try {
    const goal = await loadGoal(cwd);
    if (!goal) return baseAutoApprove;
    if (goal.oversightLevel === 3) return true;
    if (goal.oversightLevel === 2) {
      // Auto-approve unless architectural (> 3 file touches or architecture category)
      const isArchitectural = adoptions.some(
        a => a.filesToModify.length > 3 || a.category === 'architecture',
      );
      return !isArchitectural;
    }
    // oversightLevel === 1: always checkpoint
    return false;
  } catch {
    return baseAutoApprove;
  }
}

// ── Rollback helpers ───────────────────────────────────────────────────────────

async function captureGitSha(cwd?: string, _getGitSha?: (cwd?: string) => Promise<string | undefined>): Promise<string | undefined> {
  if (_getGitSha) return _getGitSha(cwd);
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const result = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: cwd ?? process.cwd() });
    return result.stdout.trim();
  } catch {
    return undefined;
  }
}

async function rollbackToSha(cwd: string, sha: string, _gitReset?: (cwd: string, sha: string) => Promise<void>): Promise<void> {
  if (_gitReset) {
    await _gitReset(cwd, sha);
    return;
  }
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('git', ['reset', '--hard', sha], { cwd });
    logger.warn(`[harvest-forge] Rolled back to ${sha.slice(0, 8)}`);
  } catch (err) {
    logger.error(`[harvest-forge] Rollback failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Main entry ─────────────────────────────────────────────────────────────────

function buildHarvestForgePlan(opts: HarvestForgeOptions, maxCycles: number, targetScore: number, topAdoptionsPerCycle: number): string {
  const autoApprove = opts.autoApprove ?? false;
  return `# Harvest-Forge Compounding Loop Plan

## Configuration
- Max cycles: ${maxCycles}
- Target score: ${targetScore}
- Adoptions per cycle: ${topAdoptionsPerCycle}
- Auto-approve: ${autoApprove}
- Max hours: ${opts.maxHours ?? 'unlimited'}

## Loop Structure (per cycle)
  Step 0: Universe sync every 3 cycles (refreshes SCORES.json)
  Step 1: Run oss-intel → updates ADOPTION_QUEUE.md
          (passes already-adopted patterns so LLM avoids re-suggestion)
  Step 2: Take top ${topAdoptionsPerCycle} items from ADOPTION_QUEUE
  Step 3: Human checkpoint (${autoApprove ? 'auto-approve enabled' : '30s timeout then auto-approve'})
          Supports: APPROVE, STOP, SKIP 1, SKIP 1 3
          Oversight level from GOAL.json: 1=always ask, 2=architectural only, 3=autonomous
  Step 4: Run forge for each adoption (${opts.parallelForge ? 'parallel' : 'sequential'})
  Step 5: Run verify
  Step 6: Rescore dimensions + record adopted pattern names in convergence state
  Step 7: Print convergence chart + plateau check
  Step 8: Save convergence.json + check stop conditions

## Stop Conditions
  - All dimensions >= ${targetScore} AND stable → CONVERGENCE ACHIEVED
  - 3 cycles < 0.5 total improvement → PLATEAU DETECTED
  - Budget exhausted → BUDGET PAUSE
  - ${maxCycles} cycles reached → MAX CYCLES
  - Max hours (${opts.maxHours ?? '∞'}) elapsed → BUDGET PAUSE

## State File
  .danteforge/convergence.json (survives process restarts)
`;
}

async function printLeapfrogIfEnabled(opts: HarvestForgeOptions, cwd: string, getScores: (cwd: string) => Promise<Record<string, number>>, readAdoptionQueue: (cwd?: string) => Promise<AdoptionCandidate[]>, cycle: number): Promise<void> {
  if (!opts.enableLeapfrog || cycle % 3 !== 1) return;
  try {
    const scores = await getScores(cwd);
    if (Object.keys(scores).length > 0) {
      const planBuilder = opts._buildLeapfrogPlan ?? buildLeapfrogPlan;
      const plan = await planBuilder(scores, [], await readAdoptionQueue(cwd), opts._llmCaller);
      if (plan.opportunities.length > 0) {
        logger.info('[harvest-forge] ── Competitive Leapfrog Opportunities ──');
        for (const opp of plan.opportunities.slice(0, 3)) {
          logger.info(`[harvest-forge]   ${opp.urgency.toUpperCase()} ${opp.dimension}: adopt "${opp.adoptionPattern}" to reach score ${opp.leapfrogScore.toFixed(1)}`);
        }
        logger.info(`[harvest-forge]   Recommendation: ${plan.topRecommendation}`);
      }
    }
  } catch { /* best-effort — never block the main loop */ }
}

async function runUniverseSyncIfNeeded(cycle: number, opts: HarvestForgeOptions, cwd: string, runUniverseScan: (opts?: UniverseScanOptions) => Promise<UniverseScan>, lastUniverseScanAt: Date): Promise<Date> {
  if (cycle % 3 !== 0) return lastUniverseScanAt;
  const emergentDimsPath = path.join(getDanteforgeDir(cwd), 'emergent-dimensions.json');
  try {
    const emergentData = JSON.parse(await fs.readFile(emergentDimsPath, 'utf8')) as { detectedAt?: string; dimensions?: unknown[] };
    if (emergentData.detectedAt && new Date(emergentData.detectedAt) > lastUniverseScanAt && Array.isArray(emergentData.dimensions) && emergentData.dimensions.length > 0) {
      logger.info('[harvest-forge] New emergent dimensions detected — triggering universe-scan refresh');
    }
  } catch { /* no emergent dims file yet — that's fine */ }
  logger.info('[harvest-forge] Step 0: Running universe-scan (every 3 cycles)...');
  try { await runUniverseScan({ cwd, _llmCaller: opts._llmCaller, _isLLMAvailable: opts._isLLMAvailable } as UniverseScanOptions); return new Date(); } catch (err) {
    logger.warn(`[harvest-forge] universe-scan failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    return lastUniverseScanAt;
  }
}

async function readAndFilterCandidates(cycle: number, cwd: string, readAdoptionQueue: (cwd?: string) => Promise<AdoptionCandidate[]>, getScores: (cwd: string) => Promise<Record<string, number>>, autoApprove: boolean, loadGoalFn: (cwd?: string) => Promise<GoalConfig | null>, topAdoptionsPerCycle: number): Promise<{ adoptions: AdoptionCandidate[]; scoresBefore: Record<string, number>; queueExhausted: boolean; humanStopped: boolean }> {
  const allAdoptions = await readAdoptionQueue(cwd);
  const allCandidates = allAdoptions.slice(0, topAdoptionsPerCycle);
  if (allCandidates.length === 0) return { adoptions: [], scoresBefore: {}, queueExhausted: true, humanStopped: false };
  const scoresBefore = await getScores(cwd);
  const effectiveAutoApprove = await resolveEffectiveAutoApprove(allCandidates, autoApprove, loadGoalFn, cwd);
  const skipIndices = await humanCheckpoint(cycle, allCandidates, scoresBefore, effectiveAutoApprove);
  if (skipIndices.length === 1 && skipIndices[0] === -1) return { adoptions: [], scoresBefore, queueExhausted: false, humanStopped: true };
  return { adoptions: allCandidates.filter((_, i) => !skipIndices.includes(i)), scoresBefore, queueExhausted: false, humanStopped: false };
}

async function forgeAdoptionsSequential(adoptions: AdoptionCandidate[], opts: HarvestForgeOptions, cwd: string, runForge: (goal: string, o: { cwd: string }) => Promise<{ success: boolean }>, runVerify: (o: { cwd: string }) => Promise<void>, getScores: (cwd: string) => Promise<Record<string, number>>): Promise<{ adoptionsSucceeded: number; succeededPatterns: string[] }> {
  let adoptionsSucceeded = 0;
  const succeededPatterns: string[] = [];
  for (const adoption of adoptions) {
    if (opts.explain) {
      logger.info(`[harvest-forge] ── Pattern: ${adoption.patternName} ──`);
      logger.info(`[harvest-forge]   Category: ${adoption.category}`);
      logger.info(`[harvest-forge]   Why: ${adoption.whatToBuild}`);
      logger.info(`[harvest-forge]   Effort: ${adoption.estimatedEffort} | Unlocks: ${adoption.unlocksGapClosure.join(', ') || 'general improvement'}`);
      logger.info(`[harvest-forge]   Score: ${adoption.adoptionScore.toFixed(2)}`);
    }
    const rollbackSha = opts.enableRollback ? await captureGitSha(cwd, opts._getGitSha) : undefined;
    const adoptionScoresBefore = opts.attributionMode ? await getScores(cwd) : undefined;
    logger.info(`  → Forging: ${adoption.patternName}`);
    const result = await runForge(`Implement the ${adoption.patternName} pattern. ${adoption.whatToBuild}`, { cwd });
    if (result.success) { adoptionsSucceeded++; succeededPatterns.push(adoption.patternName); }
    let verifyPassed = true;
    if (opts.enableRollback && rollbackSha) {
      logger.info(`[harvest-forge] Step 5: Running verify for ${adoption.patternName}...`);
      try { await runVerify({ cwd }); } catch {
        verifyPassed = false;
        logger.warn(`[harvest-forge] Verify failed for ${adoption.patternName}, rolling back to ${rollbackSha.slice(0, 8)}`);
        await rollbackToSha(cwd, rollbackSha, opts._gitReset);
        if (result.success) { adoptionsSucceeded--; const idx = succeededPatterns.indexOf(adoption.patternName); if (idx !== -1) succeededPatterns.splice(idx, 1); }
      }
    }
    if (opts.attributionMode && adoptionScoresBefore) {
      try {
        const adoptionScoresAfter = await getScores(cwd);
        const avg = (s: Record<string, number>) => Object.values(s).reduce((a, b) => a + b, 0) / Math.max(1, Object.keys(s).length);
        await recordAdoptionResult({ patternName: adoption.patternName, sourceRepo: adoption.sourceRepo, adoptedAt: new Date().toISOString(), preAdoptionScore: avg(adoptionScoresBefore), postAdoptionScore: avg(adoptionScoresAfter), scoreDelta: avg(adoptionScoresAfter) - avg(adoptionScoresBefore), verifyStatus: verifyPassed ? 'pass' : 'fail', filesModified: adoption.filesToModify }, cwd);
      } catch { /* best-effort attribution */ }
    }
  }
  return { adoptionsSucceeded, succeededPatterns };
}

async function checkCycleTermination(state: ConvergenceState, cycle: number, opts: HarvestForgeOptions, cwd: string, startedAt: number, nowFn: () => number, saveConv: (s: ConvergenceState, cwd?: string) => Promise<void>, loadGoalFn: (cwd?: string) => Promise<GoalConfig | null>): Promise<{ shouldBreak: boolean; stopReason: StopReason | null }> {
  printConvergenceChart(state, cycle);
  if (isFullyConverged(state)) {
    logger.info('  ✓ ALL DIMENSIONS CONVERGED — GOAL ACHIEVED');
    await saveConv(state, cwd);
    return { shouldBreak: true, stopReason: 'convergence-achieved' };
  }
  if (detectPlateau(state, undefined, { attributionMode: opts.attributionMode })) {
    logger.info('  ⚠  PLATEAU DETECTED — 3 consecutive cycles < 0.5 improvement');
    logger.info('     Recommendation: run /inferno for fresh OSS discovery or /nova for deeper implementation.');
    await saveConv(state, cwd);
    return { shouldBreak: true, stopReason: 'plateau-detected' };
  }
  const dailyBudgetUsd = await getDailyBudget(loadGoalFn, cwd);
  if (dailyBudgetUsd > 0 && state.totalCostUsd > 0 && state.totalCostUsd >= dailyBudgetUsd) {
    logger.info(`  ⚠  BUDGET EXHAUSTED — $${state.totalCostUsd.toFixed(2)} >= $${dailyBudgetUsd.toFixed(2)} daily limit`);
    await saveConv(state, cwd);
    return { shouldBreak: true, stopReason: 'budget-exhausted' };
  }
  if (opts.maxHours && (nowFn() - startedAt) / 3_600_000 >= opts.maxHours) {
    logger.info(`  ⚠  TIME BUDGET EXHAUSTED — ${opts.maxHours}h elapsed`);
    await saveConv(state, cwd);
    return { shouldBreak: true, stopReason: 'budget-exhausted' };
  }
  return { shouldBreak: false, stopReason: null };
}

async function runHarvestForgeLoop(
  initState: ConvergenceState, opts: HarvestForgeOptions, maxCycles: number, topAdoptionsPerCycle: number, autoApprove: boolean, cwd: string,
  loadConv: (cwd?: string) => Promise<ConvergenceState>, saveConv: (s: ConvergenceState, cwd?: string) => Promise<void>,
  runOssIntel: (o?: OssIntelOptions) => Promise<void>, runForge: (goal: string, o: { cwd: string }) => Promise<{ success: boolean }>,
  runVerify: (o: { cwd: string }) => Promise<void>, getScores: (cwd: string) => Promise<Record<string, number>>,
  readAdoptionQueue: (cwd?: string) => Promise<AdoptionCandidate[]>, runUniverseScan: (opts?: UniverseScanOptions) => Promise<UniverseScan>,
  getCycleCost: () => number, loadGoalFn: (cwd?: string) => Promise<GoalConfig | null>, doRecordAdoption: (s: ConvergenceState, n: string) => ConvergenceState,
  nowFn: () => number,
): Promise<{ state: ConvergenceState; cyclesRun: number; stopReason: StopReason; totalPatternsAdopted: number }> {
  let state = initState;
  let cyclesRun = 0;
  let stopReason: StopReason = 'max-cycles';
  let totalPatternsAdopted = 0;
  const startedAt = nowFn();
  let lastUniverseScanAt = new Date(0);
  const parallelForge = opts.parallelForge ?? false;

  while (state.lastCycle < maxCycles) {
    const cycle = state.lastCycle + 1;
    printCycleHeader(cycle, maxCycles);
    await printLeapfrogIfEnabled(opts, cwd, getScores, readAdoptionQueue, cycle);
    lastUniverseScanAt = await runUniverseSyncIfNeeded(cycle, opts, cwd, runUniverseScan, lastUniverseScanAt);

    logger.info('[harvest-forge] Step 1: Running oss-intel...');
    try { await runOssIntel({ cwd, _llmCaller: opts._llmCaller, _isLLMAvailable: opts._isLLMAvailable, _adoptedPatterns: state.adoptedPatternsSummary } as OssIntelOptions); } catch (err) {
      logger.warn(`[harvest-forge] oss-intel failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    const { adoptions, scoresBefore, queueExhausted, humanStopped } = await readAndFilterCandidates(cycle, cwd, readAdoptionQueue, getScores, autoApprove, loadGoalFn, topAdoptionsPerCycle);
    if (queueExhausted) { stopReason = 'queue-exhausted'; break; }
    if (humanStopped) { logger.info('[harvest-forge] Paused by human. Run harvest-forge again to resume.'); stopReason = 'plateau-detected'; break; }
    if (adoptions.length === 0) { logger.info('[harvest-forge] All adoptions skipped — moving to next cycle.'); state = { ...state, lastCycle: cycle }; await saveConv(state, cwd); cyclesRun = cycle; continue; }

    logger.info(`[harvest-forge] Step 4: Implementing ${adoptions.length} adoption(s)${parallelForge ? ' (parallel)' : ''}...`);
    let adoptionsSucceeded = 0;
    const succeededPatterns: string[] = [];
    if (parallelForge) {
      const forgeResults = await Promise.all(adoptions.map(a => { logger.info(`  → Forging (parallel): ${a.patternName}`); return runForge(`Implement the ${a.patternName} pattern. ${a.whatToBuild}`, { cwd }).then(r => ({ result: r, adoption: a })); }));
      for (const { result, adoption } of forgeResults) { if (result.success) { adoptionsSucceeded++; succeededPatterns.push(adoption.patternName); } }
    } else {
      const seqResult = await forgeAdoptionsSequential(adoptions, opts, cwd, runForge, runVerify, getScores);
      adoptionsSucceeded = seqResult.adoptionsSucceeded;
      succeededPatterns.push(...seqResult.succeededPatterns);
    }
    totalPatternsAdopted += adoptionsSucceeded;

    if (!opts.enableRollback) { logger.info('[harvest-forge] Step 5: Running verify...'); await runVerify({ cwd }); }

    logger.info('[harvest-forge] Step 6: Rescoring dimensions...');
    const scoresAfter = await getScores(cwd);
    for (const [dimension, score] of Object.entries(scoresAfter)) state = updateDimension(state, dimension, score);
    for (const patternName of succeededPatterns) state = doRecordAdoption(state, patternName);

    const cycleCostUsd = getCycleCost();
    state = { ...state, lastCycle: cycle, totalCostUsd: state.totalCostUsd + cycleCostUsd, cycleHistory: [...state.cycleHistory, { cycle, timestamp: new Date().toISOString(), adoptionsAttempted: adoptions.length, adoptionsSucceeded, scoresBefore, scoresAfter, costUsd: cycleCostUsd } as CycleRecord] };

    const termination = await checkCycleTermination(state, cycle, opts, cwd, startedAt, nowFn, saveConv, loadGoalFn);
    if (termination.shouldBreak) { cyclesRun = cycle; stopReason = termination.stopReason!; break; }
    await saveConv(state, cwd);
    cyclesRun = cycle;
  }
  return { state, cyclesRun, stopReason, totalPatternsAdopted };
}

export async function harvestForge(opts: HarvestForgeOptions = {}): Promise<HarvestForgeResult> {
  try {
    const cwd = opts.cwd ?? process.cwd();
    const maxCycles = opts.maxCycles ?? 10;
    const targetScore = opts.targetScore ?? 9.0;
    const topAdoptionsPerCycle = opts.topAdoptionsPerCycle ?? 3;
    const autoApprove = opts.autoApprove ?? false;

    if (opts.promptMode) {
      logger.info(buildHarvestForgePlan(opts, maxCycles, targetScore, topAdoptionsPerCycle));
      return { cyclesRun: 0, stopReason: 'max-cycles' as StopReason, finalScores: {}, totalPatternsAdopted: 0 };
    }

    const loadConv = opts._loadConvergence ?? loadConvergence;
    const saveConv = opts._saveConvergence ?? saveConvergence;
    const runOssIntel = opts._runOssIntel ?? ((o?: OssIntelOptions) => ossIntel({ ...o, cwd }));
    const runForge = opts._runForge ?? defaultRunForge;
    const runVerify = opts._runVerify ?? defaultRunVerify;
    const getScores = opts._getScores ?? defaultGetScores;
    const readAdoptionQueue = opts._readAdoptionQueue ?? defaultReadAdoptionQueue;
    const runUniverseScan = opts._runUniverseScan ?? defaultRunUniverseScan;
    const getCycleCost = opts._getCycleCost ?? (() => 0);
    const loadGoalFn = opts._loadGoal ?? defaultLoadGoal;
    const doRecordAdoption = opts._recordAdoption ?? recordAdoption;
    const nowFn = opts._now ?? (() => Date.now());

    let state = await loadConv(cwd);
    if (state.lastCycle === 0 && state.dimensions.length === 0) {
      state = initConvergence(targetScore);
      logger.info('[harvest-forge] Starting fresh convergence session.');
    } else {
      logger.info(`[harvest-forge] Resuming from cycle ${state.lastCycle}.`);
    }

    const loopResult = await runHarvestForgeLoop(state, opts, maxCycles, topAdoptionsPerCycle, autoApprove, cwd, loadConv, saveConv, runOssIntel, runForge, runVerify, getScores, readAdoptionQueue, runUniverseScan, getCycleCost, loadGoalFn, doRecordAdoption, nowFn);

    let { cyclesRun, stopReason, totalPatternsAdopted } = loopResult;
    state = loopResult.state;
    if (cyclesRun === 0) cyclesRun = state.lastCycle;
    if (stopReason === 'max-cycles') logger.info(`[harvest-forge] Max cycles (${maxCycles}) reached.`);

    const finalScores = Object.fromEntries(state.dimensions.map(d => [d.dimension, d.score]));
    logger.info('\n  HARVEST-FORGE COMPLETE');
    logger.info(`  Stop reason: ${stopReason}`);
    logger.info(`  Cycles run: ${cyclesRun}`);
    logger.info(`  Patterns adopted: ${totalPatternsAdopted}`);
    return { cyclesRun, stopReason, finalScores, totalPatternsAdopted };
  } catch (err) {
    logger.error(`[harvest-forge] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function defaultLoadGoal(cwd?: string): Promise<GoalConfig | null> {
  try {
    const { loadGoal } = await import('./set-goal.js');
    return loadGoal(cwd);
  } catch {
    return null;
  }
}

async function getDailyBudget(
  loadGoal: (cwd?: string) => Promise<GoalConfig | null>,
  cwd: string,
): Promise<number> {
  try {
    const goal = await loadGoal(cwd);
    return goal?.dailyBudgetUsd ?? 0;
  } catch {
    return 0;
  }
}
