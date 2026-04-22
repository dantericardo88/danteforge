// self-improve — Fully autonomous quality improvement loop
// Runs assess → forge focused gaps → verify → assess until all dimensions
// score >= minScore. Replaces the 3 manual prompts users previously had to type.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { loadState, saveState, type DanteState } from '../../core/state.js';
import { assess, type AssessOptions, type AssessResult } from './assess.js';
import type { ScoringDimension } from '../../core/harsh-scorer.js';
import type { MasterplanItem } from '../../core/gap-masterplan.js';
import { formatCompletionTarget, type CompletionTarget } from '../../core/completion-target.js';
import { buildFeatureForgePrompt, type FeatureScore, type FeatureItem } from '../../core/feature-universe.js';
import { generatedByLine } from '../../core/version.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SelfImproveOptions {
  goal?: string;
  minScore?: number;              // default: 9.0 (0-10 scale)
  maxCycles?: number;             // default: 20 (safety limit)
  focusDimensions?: ScoringDimension[];
  preset?: string;
  cwd?: string;
  // Injection seams for testing
  _runAssess?: (opts: AssessOptions) => Promise<AssessResult>;
  _runAutoforge?: (goal: string, waves: number, cwd: string) => Promise<void>;
  _runVerify?: (cwd: string) => Promise<void>;
  _runParty?: (goal: string, cwd: string) => Promise<void>;
  /** Self-harvest: run local-harvest on the codebase itself to discover internal patterns.
   *  Called as a second-order plateau escalation when party mode fails to break through. */
  _runLocalHarvest?: (cwd: string) => Promise<void>;
  _loadState?: (opts?: { cwd?: string }) => Promise<DanteState>;
  _saveState?: (state: DanteState, opts?: { cwd?: string }) => Promise<void>;
  _appendLesson?: (entry: string) => Promise<void>;
  _now?: () => string;
  /** Injection seam for writing the improvement report (default: fs.writeFile). */
  _writeReport?: (filePath: string, content: string) => Promise<void>;
}

export interface SelfImproveResult {
  cyclesRun: number;
  initialScore: number;
  finalScore: number;
  achieved: boolean;
  plateauDetected: boolean;
  stopReason: 'target-achieved' | 'max-cycles' | 'plateau-unresolved' | 'error';
}

interface CycleRecord {
  cycle: number;
  score: number;
  timestamp: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MIN_SCORE = 9.0;
const DEFAULT_MAX_CYCLES = 20;
const PLATEAU_THRESHOLD = 0.1;     // Min score improvement per cycle to not be "plateau"
const PLATEAU_CYCLE_COUNT = 3;     // After N cycles with < threshold gain, escalate
const FOCUSED_AUTOFORGE_WAVES = 6;
const PLATEAU_PARTY_WAVES = 10;    // More aggressive when plateaued

// ── Cycle action dispatch ──────────────────────────────────────────────────────

interface CycleActionResult {
  newPlateauDetected?: boolean;
  resetConsecutivePlateau?: boolean;
  shouldStop?: boolean;
  stopReason?: SelfImproveResult['stopReason'];
}

async function executeCycleActions(
  cycle: number,
  cycleAssessResult: AssessResult,
  consecutivePlateauCycles: number,
  plateauDetected: boolean,
  goal: string,
  cwd: string,
  runAutoforgeF: (goal: string, waves: number, cwd: string) => Promise<void>,
  runPartyFn: (goal: string, cwd: string) => Promise<void>,
  runLocalHarvestFn: (cwd: string) => Promise<void>,
  appendLessonFn: (entry: string) => Promise<void>,
  focusDimensions?: ScoringDimension[],
): Promise<CycleActionResult> {
  const isFeatureUniverseMode = cycleAssessResult.completionTarget.mode === 'feature-universe';
  const isPlateauCycle = consecutivePlateauCycles >= PLATEAU_CYCLE_COUNT;

  if (isPlateauCycle) {
    if (!plateauDetected) {
      logger.warn(`[self-improve] Plateau detected after ${consecutivePlateauCycles} cycles — escalating to party mode`);
      const focusItems = selectFocusItems(cycleAssessResult, focusDimensions);
      const partyGoal = buildPlateauEscalationPrompt(focusItems, cycleAssessResult);
      await runPartyFn(partyGoal, cwd);
      return { newPlateauDetected: true, resetConsecutivePlateau: true };
    } else {
      logger.warn(`[self-improve] Party mode did not break plateau — running self-harvest...`);
      try {
        await runLocalHarvestFn(cwd);
        await appendLessonFn(
          `[self-improve] Self-harvest triggered at cycle ${cycle} — party escalation failed to break plateau`,
        );
      } catch (err) {
        logger.warn(`[self-improve] Self-harvest failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      return { resetConsecutivePlateau: true };
    }
  } else if (isFeatureUniverseMode && cycleAssessResult.featureAssessment) {
    const featureItems = selectFeatureFocusItems(cycleAssessResult);
    if (featureItems.length === 0) {
      logger.warn('[self-improve] No feature gaps found — stopping');
      return { shouldStop: true, stopReason: 'error' };
    }
    const projectName = 'the project';
    for (const { score, feature } of featureItems) {
      const featureGoal = buildFeatureFocusedGoal(score, feature, projectName);
      logger.info(`[self-improve] Forging feature: ${feature.name} (score: ${score.score})`);
      await runAutoforgeF(featureGoal, FOCUSED_AUTOFORGE_WAVES, cwd);
    }
    return {};
  } else {
    const focusItems = selectFocusItems(cycleAssessResult, focusDimensions);
    if (focusItems.length === 0) {
      logger.warn('[self-improve] No actionable gaps found — stopping');
      return { shouldStop: true, stopReason: 'error' };
    }
    for (const item of focusItems) {
      const itemGoal = buildFocusedForgeGoal(item, goal);
      logger.info(`[self-improve] Forging: [${item.dimension}] ${item.description}`);
      await runAutoforgeF(itemGoal, FOCUSED_AUTOFORGE_WAVES, cwd);
    }
    return {};
  }
}

// ── Main improvement loop ──────────────────────────────────────────────────────

interface SelfImproveLoopCtx {
  maxCycles: number;
  minScore: number;
  cwd: string;
  goal: string;
  preset?: string;
  focusDimensions?: ScoringDimension[];
  initialResult: AssessResult;
  cycleHistory: CycleRecord[];
  runAssessFn: (opts: AssessOptions) => Promise<AssessResult>;
  runAutoforgeF: (goal: string, waves: number, cwd: string) => Promise<void>;
  runVerifyFn: (cwd: string) => Promise<void>;
  runPartyFn: (goal: string, cwd: string) => Promise<void>;
  runLocalHarvestFn: (cwd: string) => Promise<void>;
  appendLessonFn: (entry: string) => Promise<void>;
  now: () => string;
}

interface LoopOutcome {
  cyclesRun: number;
  currentScore: number;
  plateauDetected: boolean;
  stopReason: SelfImproveResult['stopReason'];
}

async function runSelfImproveLoop(ctx: SelfImproveLoopCtx): Promise<LoopOutcome> {
  let currentScore = ctx.initialResult.overallScore;
  let cyclesRun = 0;
  let consecutivePlateauCycles = 0;
  let plateauDetected = false;
  let stopReason: SelfImproveResult['stopReason'] = 'max-cycles';

  try {
    for (let cycle = 1; cycle <= ctx.maxCycles; cycle++) {
      cyclesRun = cycle;
      logger.info('');
      logger.info(`━━━ Cycle ${cycle}/${ctx.maxCycles}  |  Score: ${currentScore.toFixed(1)}/10  |  Gap: ${(ctx.minScore - currentScore).toFixed(1)} ━━━`);

      const cycleAssessResult = cycle === 1
        ? ctx.initialResult
        : await ctx.runAssessFn({
            cwd: ctx.cwd, preset: ctx.preset, minScore: ctx.minScore, cycleNumber: cycle,
            competitors: cycle % 3 === 0,
            harsh: true,
          });

      if (cycleAssessResult.passesThreshold) {
        currentScore = cycleAssessResult.overallScore;
        stopReason = 'target-achieved';
        logger.success(`✓ Target ${ctx.minScore.toFixed(1)}/10 achieved in cycle ${cycle}!`);
        break;
      }

      const cycleAction = await executeCycleActions(
        cycle, cycleAssessResult, consecutivePlateauCycles, plateauDetected,
        ctx.goal, ctx.cwd, ctx.runAutoforgeF, ctx.runPartyFn, ctx.runLocalHarvestFn,
        ctx.appendLessonFn, ctx.focusDimensions,
      );
      if (cycleAction.newPlateauDetected !== undefined) plateauDetected = cycleAction.newPlateauDetected;
      if (cycleAction.resetConsecutivePlateau) consecutivePlateauCycles = 0;
      if (cycleAction.shouldStop) { stopReason = cycleAction.stopReason ?? 'error'; break; }

      logger.info('[self-improve] Running verify...');
      try { await ctx.runVerifyFn(ctx.cwd); } catch { logger.warn('[self-improve] Verify encountered issues — continuing loop'); }

      const postCycleResult = await ctx.runAssessFn({
        cwd: ctx.cwd, preset: ctx.preset, minScore: ctx.minScore, cycleNumber: cycle,
        competitors: false, harsh: true,
      });

      const prevScore = currentScore;
      currentScore = postCycleResult.overallScore;
      const cycleDelta = currentScore - prevScore;
      ctx.cycleHistory.push({ cycle, score: currentScore, timestamp: ctx.now() });

      logger.info(`[self-improve] Cycle ${cycle} complete: ${prevScore.toFixed(1)} → ${currentScore.toFixed(1)} (${cycleDelta >= 0 ? '+' : ''}${cycleDelta.toFixed(1)})`);

      if (cycleDelta < PLATEAU_THRESHOLD) {
        consecutivePlateauCycles++;
        if (consecutivePlateauCycles >= PLATEAU_CYCLE_COUNT) {
          logger.warn(`[self-improve] Score has not improved by ${PLATEAU_THRESHOLD} in ${consecutivePlateauCycles} cycles`);
        }
      } else {
        consecutivePlateauCycles = 0;
      }

      if (cycleDelta > 0.5) {
        try {
          await ctx.appendLessonFn(
            `[self-improvement] Score improved ${cycleDelta.toFixed(1)} points in cycle ${cycle}. Mode: ${cycleAssessResult.completionTarget.mode}`,
          );
        } catch { /* best-effort */ }
      }

      if (postCycleResult.passesThreshold) {
        stopReason = 'target-achieved';
        logger.success(`✓ Target ${ctx.minScore.toFixed(1)}/10 achieved in cycle ${cycle}!`);
        break;
      }
    }
  } catch (err) {
    logger.error(`[self-improve] Loop error: ${err instanceof Error ? err.message : String(err)}`);
    stopReason = 'error';
  }

  if (plateauDetected && stopReason !== 'target-achieved') {
    stopReason = 'plateau-unresolved';
  }

  return { cyclesRun, currentScore, plateauDetected, stopReason };
}

// ── Main entry ─────────────────────────────────────────────────────────────────

export async function selfImprove(options: SelfImproveOptions = {}): Promise<SelfImproveResult> {
  const cwd = options.cwd ?? process.cwd();
  const goal = options.goal ?? 'Improve overall quality across all dimensions to 9/10';
  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const maxCycles = options.maxCycles ?? DEFAULT_MAX_CYCLES;

  const runAssessFn = options._runAssess ?? assess;
  const runAutoforgeF = options._runAutoforge ?? defaultRunAutoforge;
  const runVerifyFn = options._runVerify ?? defaultRunVerify;
  const runPartyFn = options._runParty ?? defaultRunParty;
  const runLocalHarvestFn = options._runLocalHarvest ?? defaultRunLocalHarvest;
  const loadStateFn = options._loadState ?? loadState;
  const saveStateFn = options._saveState ?? saveState;
  const appendLessonFn = options._appendLesson ?? defaultAppendLesson;
  const now = options._now ?? (() => new Date().toISOString());

  logger.info('');
  logger.info('╔══════════════════════════════════════════════════════╗');
  logger.info('║    DanteForge Autonomous Self-Improvement Loop        ║');
  logger.info(`║    Target: ${minScore.toFixed(1)}/10  Max cycles: ${maxCycles}${' '.repeat(19 - String(maxCycles).length)}║`);
  logger.info('╚══════════════════════════════════════════════════════╝');
  logger.info('');

  // ── Initial assessment ────────────────────────────────────────────────────
  const initialResult = await runAssessFn({
    cwd, preset: options.preset, minScore, cycleNumber: 0,
    competitors: true, harsh: true,
  });

  // Show the completion target definition
  logger.info(`Completion target: ${formatCompletionTarget(initialResult.completionTarget)}`);
  logger.info('');

  const initialScore = initialResult.overallScore;
  logger.info(`Starting score: ${initialScore.toFixed(1)}/10  |  Target: ${minScore.toFixed(1)}/10`);

  if (initialResult.passesThreshold) {
    logger.success(`✓ Already at target ${minScore.toFixed(1)}/10 — nothing to improve!`);
    return {
      cyclesRun: 0, initialScore, finalScore: initialScore,
      achieved: true, plateauDetected: false, stopReason: 'target-achieved',
    };
  }

  const cycleHistory: CycleRecord[] = [{ cycle: 0, score: initialScore, timestamp: now() }];
  const { cyclesRun, currentScore, plateauDetected, stopReason } = await runSelfImproveLoop({
    maxCycles, minScore, cwd, goal,
    preset: options.preset, focusDimensions: options.focusDimensions,
    initialResult, cycleHistory,
    runAssessFn, runAutoforgeF, runVerifyFn, runPartyFn, runLocalHarvestFn, appendLessonFn, now,
  });

  const achieved = stopReason === 'target-achieved';
  printFinalReport({ cyclesRun, initialScore, finalScore: currentScore, achieved, stopReason, minScore });

  // Auto-export improvement report (best-effort)
  if (cycleHistory.length > 1) {
    try {
      const writeFn = options._writeReport
        ?? (async (filePath: string, content: string) => {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, content, 'utf8');
        });
      const reportPath = path.join(cwd, 'docs', 'IMPROVEMENT_REPORT.md');
      const report = buildImprovementReport(cycleHistory, initialScore, currentScore, stopReason, goal, minScore);
      await writeFn(reportPath, report);
      logger.success('Improvement report written to docs/IMPROVEMENT_REPORT.md');
    } catch { /* best-effort */ }
  }

  // Persist final score to state (best-effort)
  try {
    const state = await loadStateFn({ cwd });
    state.auditLog = [
      ...(state.auditLog ?? []),
      `self-improve: ${cyclesRun} cycles, ${initialScore.toFixed(1)} → ${currentScore.toFixed(1)}/10`,
    ];
    await saveStateFn(state, { cwd });
  } catch { /* best-effort */ }

  return {
    cyclesRun,
    initialScore,
    finalScore: currentScore,
    achieved,
    plateauDetected,
    stopReason,
  };
}

// ── Focus item selection ──────────────────────────────────────────────────────

function selectFocusItems(
  assessResult: AssessResult,
  focusDimensions?: ScoringDimension[],
): MasterplanItem[] {
  let items = assessResult.masterplan.items.filter((i) => i.priority === 'P0' || i.priority === 'P1');

  if (focusDimensions && focusDimensions.length > 0) {
    items = items.filter((i) => focusDimensions.includes(i.dimension));
  }

  return items.slice(0, 3);
}

// ── Feature-level gap selection ───────────────────────────────────────────────

function selectFeatureFocusItems(
  assessResult: AssessResult,
): Array<{ score: FeatureScore; feature: FeatureItem }> {
  const fa = assessResult.featureAssessment;
  if (!fa) return [];

  // Sort by score ascending (worst features first)
  const sorted = [...fa.scores]
    .filter((s) => s.score < assessResult.minScore * 10)
    .sort((a, b) => a.score - b.score);

  return sorted.slice(0, 3).map((score) => ({
    score,
    feature: fa.universe.features.find((f) => f.id === score.featureId) ?? {
      id: score.featureId,
      name: score.featureName,
      description: '',
      category: 'other' as const,
      competitorsThatHaveIt: [],
    },
  }));
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildFocusedForgeGoal(item: MasterplanItem, baseGoal: string): string {
  return [
    `${baseGoal}.`,
    `FOCUS: Improve the "${item.dimension}" dimension from ${item.currentScore}/10 to ${item.targetScore}/10.`,
    `Specific task: ${item.description}`,
    `Verify by: ${item.verifyCondition}`,
  ].join(' ');
}

function buildFeatureFocusedGoal(
  score: FeatureScore,
  feature: FeatureItem,
  projectName: string,
): string {
  return buildFeatureForgePrompt(score, feature, projectName);
}

function buildPlateauEscalationPrompt(items: MasterplanItem[], result: AssessResult): string {
  const topItem = items[0];
  const competitorHint = topItem?.competitorContext
    ? ` Competitor context: ${topItem.competitorContext}.`
    : '';

  const dimList = items.map((i) => `${i.dimension} (${i.currentScore}/10)`).join(', ');

  return [
    `PLATEAU ESCALATION: Score is stuck at ${result.overallScore.toFixed(1)}/10.`,
    `Focus dimensions: ${dimList}.${competitorHint}`,
    `Bring a fresh perspective. Try new approaches that previous autoforge passes missed.`,
    `Target: ${result.minScore.toFixed(1)}/10 across all dimensions.`,
  ].join(' ');
}

// ── Improvement report builder (pure — no I/O) ───────────────────────────────

export function buildImprovementReport(
  cycleHistory: CycleRecord[],
  initialScore: number,
  finalScore: number,
  stopReason: SelfImproveResult['stopReason'],
  goal: string,
  minScore: number,
): string {
  const gain = finalScore - initialScore;
  const gainLabel = gain >= 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1);
  const verdictLabel =
    stopReason === 'target-achieved' ? '✓ TARGET ACHIEVED'
    : stopReason === 'plateau-unresolved' ? '△ PLATEAU — manual intervention suggested'
    : stopReason === 'max-cycles' ? '✗ Max cycles reached without hitting target'
    : '⚠ Stopped due to error';

  const date = new Date().toISOString().slice(0, 10);

  const lines: string[] = [
    '# DanteForge Improvement Report',
    '',
    `> Generated: ${date}`,
    `> Goal: ${goal}`,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Before | ${initialScore.toFixed(1)} / 10 |`,
    `| After  | ${finalScore.toFixed(1)} / 10 |`,
    `| Gain   | **${gainLabel}** |`,
    `| Cycles | ${cycleHistory.length - 1} |`,
    `| Target | ${minScore.toFixed(1)} / 10 |`,
    `| Result | ${verdictLabel} |`,
    '',
    '## Cycle-by-Cycle Progress',
    '',
    '| Cycle | Score | Delta |',
    '|-------|-------|-------|',
  ];

  for (let i = 0; i < cycleHistory.length; i++) {
    const entry = cycleHistory[i];
    if (!entry) continue;
    const prev = i > 0 ? (cycleHistory[i - 1]?.score ?? entry.score) : entry.score;
    const delta = entry.score - prev;
    const deltaLabel = i === 0 ? '—' : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`;
    const label = i === 0 ? 'Start' : `Cycle ${i}`;
    lines.push(`| ${label} | ${entry.score.toFixed(1)} / 10 | ${deltaLabel} |`);
  }

  lines.push(
    '',
    '## What to Do Next',
    '',
  );

  if (stopReason === 'target-achieved') {
    lines.push(
      '- Run `danteforge assess` to confirm the current score.',
      '- Run `danteforge synthesize` to generate your project summary.',
      '- Run `danteforge showcase` to generate a shareable case study.',
    );
  } else {
    lines.push(
      '- Review `MASTERPLAN.md` for the highest-priority gaps.',
      '- Run `danteforge inferno` for a deeper autonomous push.',
      '- Run `danteforge cross-synthesize` to discover cross-project patterns.',
    );
  }

  lines.push(
    '',
    '---',
    generatedByLine(),
  );

  return lines.join('\n');
}

// ── Final report ──────────────────────────────────────────────────────────────

function printFinalReport(params: {
  cyclesRun: number;
  initialScore: number;
  finalScore: number;
  achieved: boolean;
  stopReason: SelfImproveResult['stopReason'];
  minScore: number;
}): void {
  const { cyclesRun, initialScore, finalScore, achieved, stopReason, minScore } = params;
  const totalGain = finalScore - initialScore;

  logger.info('');
  logger.info('═══════════════════════════════════════════════════════');
  logger.info('  Self-Improvement Loop — Final Report');
  logger.info('═══════════════════════════════════════════════════════');
  logger.info(`  Cycles run:    ${cyclesRun}`);
  logger.info(`  Start score:   ${initialScore.toFixed(1)}/10`);
  logger.info(`  Final score:   ${finalScore.toFixed(1)}/10  (${totalGain >= 0 ? '+' : ''}${totalGain.toFixed(1)} gain)`);
  logger.info(`  Target:        ${minScore.toFixed(1)}/10`);
  logger.info(`  Stop reason:   ${stopReason}`);

  if (achieved) {
    logger.success(`  Result:        ✓ TARGET ACHIEVED`);
  } else if (stopReason === 'max-cycles') {
    logger.warn(`  Result:        ✗ Max cycles (${cyclesRun}) reached without hitting target`);
    logger.warn('  Recommendation: Run /nova or /inferno to make a deeper push');
  } else if (stopReason === 'plateau-unresolved') {
    logger.warn('  Result:        △ Plateau — party escalation did not break through');
    logger.warn('  Recommendation: Manual review of MASTERPLAN.md, then /inferno with --oss');
  }
  logger.info('═══════════════════════════════════════════════════════');
}

// ── Production runners ────────────────────────────────────────────────────────

async function defaultRunAutoforge(goal: string, waves: number, _cwd: string): Promise<void> {
  const { autoforge } = await import('./autoforge.js');
  await autoforge(goal, { maxWaves: waves });
}

async function defaultRunVerify(_cwd: string): Promise<void> {
  const { verify } = await import('./verify.js');
  await verify();
}

async function defaultRunParty(_goal: string, _cwd: string): Promise<void> {
  const { party } = await import('./party.js');
  await party({ isolation: true, worktree: false });
}

async function defaultRunLocalHarvest(cwd: string): Promise<void> {
  const { localHarvest } = await import('./local-harvest.js');
  // Harvest from src/ — discover internal patterns in the codebase itself
  await localHarvest(['src/'], { cwd, depth: 'medium', dryRun: false });
}

async function defaultAppendLesson(entry: string): Promise<void> {
  const { lessons } = await import('./lessons.js');
  await lessons(entry);
}
