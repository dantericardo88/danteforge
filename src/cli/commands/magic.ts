import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { logger } from "../../core/logger.js";
import { withErrorBoundary } from "../../core/cli-error-boundary.js";
import { emitTaskStart, emitTaskComplete } from "../../core/event-bus.js";
import { withSpinner } from "../../core/progress.js";
import { loadState, saveState, type DanteState } from "../../core/state.js";
import { createTelemetry, recordToolCall, recordBashCommand, type ExecutionTelemetry } from "../../core/execution-telemetry.js";
import { detectLoop } from "../../core/loop-detector.js";
import {
  DEFAULT_MAGIC_LEVEL,
  MAGIC_PRESETS,
  MAGIC_USAGE_RULES,
  buildMagicExecutionPlan,
  formatMagicPlan,
  normalizeMagicLevel,
  type MagicExecutionStep,
  type MagicLevel,
} from "../../core/magic-presets.js";

export type VerifyStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export interface ConvergenceOptions {
  level: MagicLevel;
  goal: string;
  maxCycles: number;
  /** Full wave count from preset for bursty cycles. Defaults to preset's autoforgeWaves if not provided. */
  autoforgeWaves?: number;
  skipInitialVerify?: boolean;
  _getVerifyStatus?: () => Promise<VerifyStatus>;
  _runAutoforge?: (goal: string, waves: number) => Promise<void>;
  _runVerify?: () => Promise<void>;
  _assessMaturity?: (ctx: { cwd: string; state: import('../../core/state.js').DanteState; pdseScores: Record<string, unknown>; targetLevel: number }) => Promise<import('../../core/maturity-engine.js').MaturityAssessment>;
}

export interface ConvergenceResult {
  cyclesRun: number;
  initialStatus: VerifyStatus;
  finalStatus: VerifyStatus;
}

async function runMaturityGuidedAutoforge(
  opts: ConvergenceOptions,
  resolvedAutoforgeWaves: number,
  runAutoforge: (goal: string, waves: number) => Promise<void>,
): Promise<void> {
  try {
    const { assessMaturity: defaultAssessMaturity } = await import("../../core/maturity-engine.js");
    const { scoreAllArtifacts } = await import("../../core/pdse.js");
    const { MAGIC_PRESETS } = await import("../../core/magic-presets.js");
    const assessMaturityFn = opts._assessMaturity ?? defaultAssessMaturity;
    const state = await loadState();
    const cwd = process.cwd();
    const pdseScores = await scoreAllArtifacts(cwd, state);
    const targetLevel = MAGIC_PRESETS[opts.level]?.targetMaturityLevel ?? 4;
    const assessment = await assessMaturityFn({ cwd, state, pdseScores, targetLevel });
    const criticalGaps = assessment.gaps.filter(g => g.severity === 'critical');
    if (criticalGaps.length > 0) {
      logger.warn(`[${opts.level}] ${criticalGaps.length} critical gap${criticalGaps.length === 1 ? '' : 's'} to address:`);
      for (const gap of criticalGaps.slice(0, 5)) {
        logger.warn(`  - ${gap.dimension}: ${gap.currentScore}/100 (need ${gap.targetScore ?? 89}+)`);
      }
      await runAutoforge(`Address critical quality gaps: ${criticalGaps.map(g => g.dimension).join(', ')}`, resolvedAutoforgeWaves);
    } else {
      await runAutoforge(`Fix failing verification - ${opts.goal}`, resolvedAutoforgeWaves);
    }
  } catch (err) {
    logger.warn(`[${opts.level}] Maturity assessment failed: ${err instanceof Error ? err.message : String(err)} - falling back to standard convergence`);
    await runAutoforge(`Fix failing verification - ${opts.goal}`, resolvedAutoforgeWaves);
  }
}

async function checkMaturityAfterCycle(
  opts: ConvergenceOptions,
  cyclesRun: number,
  finalStatus: VerifyStatus,
): Promise<{ achieved: boolean }> {
  try {
    const { assessMaturity: defaultAssessMaturity2 } = await import("../../core/maturity-engine.js");
    const { scoreAllArtifacts } = await import("../../core/pdse.js");
    const { MAGIC_PRESETS } = await import("../../core/magic-presets.js");
    const assessMaturityFn2 = opts._assessMaturity ?? defaultAssessMaturity2;
    const state = await loadState();
    const cwd = process.cwd();
    const pdseScores = await scoreAllArtifacts(cwd, state);
    const targetLevel = MAGIC_PRESETS[opts.level]?.targetMaturityLevel ?? 4;
    const assessment = await assessMaturityFn2({ cwd, state, pdseScores, targetLevel });
    logger.info('');
    logger.info(`[${opts.level}] 🤔 Maturity check after cycle ${cyclesRun}...`);
    logger.info(`[${opts.level}] Current: ${assessment.currentLevel}/6 (score: ${assessment.overallScore}/100)`);
    logger.info(`[${opts.level}] Target:  ${assessment.targetLevel}/6`);
    if (assessment.currentLevel >= assessment.targetLevel && finalStatus === 'pass') {
      logger.success(`[${opts.level}] ✅ MATURITY TARGET ACHIEVED after ${cyclesRun} cycle${cyclesRun === 1 ? '' : 's'}!`);
      return { achieved: true };
    }
    const remaining = assessment.targetLevel - assessment.currentLevel;
    logger.warn(`[${opts.level}] ⚠️  Still ${remaining} level${remaining === 1 ? '' : 's'} below target`);
    if (cyclesRun < opts.maxCycles) logger.info(`[${opts.level}] Continuing to cycle ${cyclesRun + 1}/${opts.maxCycles}...`);
    return { achieved: false };
  } catch (err) {
    if (finalStatus === 'pass') logger.success(`[${opts.level}] Convergence achieved after ${cyclesRun} cycle${cyclesRun === 1 ? '' : 's'}`);
    else logger.warn(`[${opts.level}] Convergence cycle ${cyclesRun} complete - verify still ${finalStatus}`);
    return { achieved: false };
  }
}

export async function runConvergenceCycles(
  opts: ConvergenceOptions,
): Promise<ConvergenceResult> {
  if (opts.maxCycles === 0) {
    return { cyclesRun: 0, initialStatus: 'unknown', finalStatus: 'unknown' };
  }

  // Resolve autoforgeWaves: explicit > 3 (convergence cycles use a lighter wave count by default)
  const resolvedAutoforgeWaves = opts.autoforgeWaves ?? 3;

  const getStatus: () => Promise<VerifyStatus> =
    opts._getVerifyStatus ??
    (async () => {
      const state: DanteState = await loadState();
      return (state.lastVerifyStatus ?? 'unknown') as VerifyStatus;
    });

  const runAutoforge: (goal: string, waves: number) => Promise<void> =
    opts._runAutoforge ??
    (async (goalText: string, waves: number) => {
      const { autoforge } = await import("./autoforge.js");
      await autoforge(goalText, { maxWaves: waves });
    });

  const runVerify: () => Promise<void> =
    opts._runVerify ??
    (async () => {
      const { verify } = await import("./verify.js");
      await verify();
    });

  if (!opts.skipInitialVerify) {
    logger.info(`[${opts.level}] Convergence: running verify...`);
    await runVerify();
  }

  const initialStatus = await getStatus();

  if (initialStatus === 'pass') {
    logger.success(
      `[${opts.level}] Convergence: verify passed - no repair cycles needed`,
    );
    return { cyclesRun: 0, initialStatus, finalStatus: 'pass' };
  }

  let finalStatus: VerifyStatus = initialStatus;
  let cyclesRun = 0;

  while (finalStatus !== 'pass' && cyclesRun < opts.maxCycles) {
    cyclesRun++;

    logger.info(`[${opts.level}] 💥 CONVERGENCE CYCLE ${cyclesRun}/${opts.maxCycles}`);
    logger.info(`[${opts.level}] Launching ${resolvedAutoforgeWaves}-wave improvement burst...`);

    // Run autoforge waves first
    await runMaturityGuidedAutoforge(opts, resolvedAutoforgeWaves, runAutoforge);

    // Run verify after autoforge
    await runVerify();
    finalStatus = await getStatus();

    // NOW check maturity AFTER waves completed and verify ran
    const { achieved } = await checkMaturityAfterCycle(opts, cyclesRun, finalStatus);
    if (achieved) return { cyclesRun, initialStatus, finalStatus: 'pass' };
  }

  if (finalStatus !== 'pass') {
    logger.warn(
      `[${opts.level}] Convergence exhausted (${cyclesRun}/${opts.maxCycles} cycles) - verify: ${finalStatus}`,
    );
  }

  return { cyclesRun, initialStatus, finalStatus };
}

export interface MagicPipelineCheckpoint {
  pipelineId: string;
  level: MagicLevel;
  goal: string;
  steps: MagicExecutionStep[];
  currentStepIndex: number;
  completedResults: {
    step: string;
    status: "ok" | "fail";
    durationMs: number;
    message?: string;
  }[];
  startedAt: string;
  lastCheckpointAt: string;
  currentStepRetries: number;
}

const MAX_RETRIES_PER_STEP = 2;

function getMagicCheckpointPath(cwd?: string): string {
  const root = cwd ?? process.cwd();
  return join(root, ".danteforge", "magic-session.json");
}

async function saveMagicCheckpoint(
  checkpoint: MagicPipelineCheckpoint,
): Promise<void> {
  const filePath = getMagicCheckpointPath();
  await mkdir(dirname(filePath), { recursive: true });
  checkpoint.lastCheckpointAt = new Date().toISOString();
  await writeFile(filePath, JSON.stringify(checkpoint, null, 2), "utf-8");
}

async function loadMagicCheckpoint(): Promise<MagicPipelineCheckpoint | null> {
  try {
    const raw = await readFile(getMagicCheckpointPath(), "utf-8");
    return JSON.parse(raw) as MagicPipelineCheckpoint;
  } catch {
    return null;
  }
}

async function clearMagicCheckpoint(): Promise<void> {
  try {
    await unlink(getMagicCheckpointPath());
  } catch {
    // File does not exist.
  }
}

export interface MagicCommandOptions {
  level?: string;
  profile?: string;
  skipUx?: boolean;
  host?: string;
  prompt?: boolean;
  worktree?: boolean;
  isolation?: boolean;
  maxRepos?: number;
  resume?: boolean;
  localSources?: string[];
  localDepth?: string;
  localSourcesConfig?: string;
  skipTechDecide?: boolean;
  withTechDecide?: boolean;
  withDesign?: boolean;
  designPrompt?: string;
  /** Skip the confirmation gate (equivalent to --yes on ascend/compete) */
  yes?: boolean;
  _runStep?: (step: MagicExecutionStep, goal: string) => Promise<void>;
  _runPrime?: () => Promise<void>;
  /** Injection seam for confirmMatrix gate — avoids real TTY/filesystem in tests */
  _confirmMatrix?: (cwd: string) => Promise<boolean>;
  /** Injection seam for computeStrictDimensions — used for post-pipeline score update */
  _computeStrictDims?: (cwd: string) => Promise<{ autonomy: number; selfImprovement: number; tokenEconomy: number }>;
  _convergenceOpts?: {
    getVerifyStatus?: () => Promise<VerifyStatus>;
    runAutoforge?: (goal: string, waves: number) => Promise<void>;
    runVerify?: () => Promise<void>;
  };
  _checkpointOps?: {
    load: () => Promise<MagicPipelineCheckpoint | null>;
    save: (cp: MagicPipelineCheckpoint) => Promise<void>;
    clear: () => Promise<void>;
  };
  _stateOps?: {
    load: () => Promise<DanteState>;
    save: (state: DanteState) => Promise<void>;
  };
}

export async function magic(goal?: string, options: MagicCommandOptions = {}) {
  return withErrorBoundary('magic', async () => {
    await runMagicPreset(goal, {
      ...options,
      level: options.level ?? DEFAULT_MAGIC_LEVEL,
    });
  });
}

export async function spark(
  goal?: string,
  options: Omit<MagicCommandOptions, "level"> = {},
) {
  return withErrorBoundary('spark', async () => {
    await runMagicPreset(goal, { ...options, level: "spark" });
  });
}

export async function ember(
  goal?: string,
  options: Omit<MagicCommandOptions, "level"> = {},
) {
  return withErrorBoundary('ember', async () => {
    await runMagicPreset(goal, { ...options, level: "ember" });
  });
}

export async function blaze(
  goal?: string,
  options: Omit<MagicCommandOptions, "level"> = {},
) {
  return withErrorBoundary('blaze', async () => {
    await runMagicPreset(goal, { ...options, level: "blaze" });
  });
}

export async function nova(
  goal?: string,
  options: Omit<MagicCommandOptions, "level"> = {},
) {
  return withErrorBoundary('nova', async () => {
    await runMagicPreset(goal, { ...options, level: "nova" });
  });
}

export async function canvas(
  goal?: string,
  options: Omit<MagicCommandOptions, "level"> = {},
) {
  return withErrorBoundary('canvas', async () => {
    await runMagicPreset(goal, { ...options, level: "canvas" });
  });
}

export async function inferno(
  goal?: string,
  options: Omit<MagicCommandOptions, "level"> = {},
) {
  return withErrorBoundary('inferno', async () => {
    await runMagicPreset(goal, { ...options, level: "inferno" });
  });
}

interface MagicPresetShape {
  level?: string;
  intensity?: string;
  tokenLevel?: string;
  combines?: string;
  defaultProfile?: string;
  targetMaturityLevel?: number;
  convergenceCycles: number;
  autoforgeWaves: number;
}

interface MagicPlanShape {
  level: MagicLevel;
  goal: string;
  preset: MagicPresetShape;
  steps: MagicExecutionStep[];
}

type PipelineResult = { step: string; status: 'ok' | 'fail'; durationMs: number; message?: string };

async function checkConfirmationGate(plan: { level: string }, options: Pick<MagicCommandOptions, 'yes' | 'resume' | '_confirmMatrix'>): Promise<boolean> {
  if (options.yes || options.resume) return false;
  try {
    const cwd = process.cwd();
    if (options._confirmMatrix) {
      const ok = await options._confirmMatrix(cwd);
      if (!ok) { logger.warn(`[${plan.level}] Aborted by user at confirmation gate.`); return true; }
    } else {
      const { confirmMatrix } = await import('../../core/matrix-confirm.js');
      const { loadMatrix } = await import('../../core/compete-matrix.js');
      const matrix = await loadMatrix(cwd).catch(() => null);
      if (matrix) {
        const ok = await confirmMatrix(matrix);
        if (!ok) { logger.warn(`[${plan.level}] Aborted by user at confirmation gate.`); return true; }
      }
    }
  } catch { /* No matrix or confirmMatrix unavailable — proceed without gate */ }
  return false;
}

async function runPipelineSteps(
  plan: MagicPlanShape, checkpoint: MagicPipelineCheckpoint,
  cpOps: { save: (cp: MagicPipelineCheckpoint) => Promise<void> },
  runStep: (step: MagicExecutionStep, goal: string) => Promise<void>,
  pipelineTelemetry: ExecutionTelemetry, effectiveLevel: MagicLevel,
  startIndex: number, initialResults: PipelineResult[],
): Promise<PipelineResult[]> {
  const results = [...initialResults];
  for (let i = startIndex; i < plan.steps.length; i++) {
    const step = plan.steps[i]!;
    const stepStart = Date.now();
    const label = describeStep(step);
    emitTaskStart(label);
    logger.info(`[${effectiveLevel}] Running: ${label} (${i + 1}/${plan.steps.length})`);
    checkpoint.currentStepIndex = i;
    await cpOps.save(checkpoint);
    let stepOk = false;
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_STEP; attempt++) {
      try {
        const previousExitCode = process.exitCode;
        process.exitCode = 0;
        await runStep(step, plan.goal);
        const stepExitCode = process.exitCode ?? 0;
        process.exitCode = previousExitCode;
        if (stepExitCode !== 0) throw new Error(`${label} exited with code ${stepExitCode}`);
        stepOk = true;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_RETRIES_PER_STEP) {
          logger.warn(`[${effectiveLevel}] ${label} failed (attempt ${attempt + 1}/${MAX_RETRIES_PER_STEP + 1}): ${message} - retrying...`);
          checkpoint.currentStepRetries = attempt + 1;
          await cpOps.save(checkpoint);
        } else {
          const durationMs = Date.now() - stepStart;
          results.push({ step: label, status: 'fail', durationMs, message });
          logger.error(`[${effectiveLevel}] ${label} failed after ${MAX_RETRIES_PER_STEP + 1} attempts: ${message}`);
          logger.warn(`[${effectiveLevel}] Skipping failed step and continuing pipeline...`);
        }
      }
    }
    if (stepOk) {
      const durationMs = Date.now() - stepStart;
      results.push({ step: label, status: 'ok', durationMs });
      const isCriticalStep = ['autoforge', 'verify', 'party'].includes(step.kind);
      emitTaskComplete(label);
      if (!isCriticalStep || !plan.preset.targetMaturityLevel) {
        logger.success(`[${effectiveLevel}] ${label} complete (${(durationMs / 1000).toFixed(1)}s)`);
      } else {
        logger.info(`[${effectiveLevel}] ${label} finished (${(durationMs / 1000).toFixed(1)}s) - will check maturity...`);
      }
      recordToolCall(pipelineTelemetry, step.kind, true);
    } else {
      recordBashCommand(pipelineTelemetry, `${step.kind} (failed)`);
      recordToolCall(pipelineTelemetry, step.kind, false);
    }
    checkpoint.completedResults = [...results];
    checkpoint.currentStepIndex = i + 1;
    checkpoint.currentStepRetries = 0;
    await cpOps.save(checkpoint);
  }
  return results;
}

async function runConvergencePhase(
  plan: MagicPlanShape, effectiveLevel: MagicLevel, results: PipelineResult[],
  options: Pick<MagicCommandOptions, '_convergenceOpts'>,
  stOps: { load: () => Promise<DanteState> },
): Promise<void> {
  const convergenceCycles = plan.preset.convergenceCycles;
  if (convergenceCycles <= 0) return;
  const convergeStart = Date.now();
  const skipInitialVerify = plan.steps.some((s) => s.kind === 'verify');
  logger.info('');
  logger.info(`[${effectiveLevel}] Starting convergence loop (up to ${convergenceCycles} cycle${convergenceCycles === 1 ? '' : 's'})...`);
  try {
    const convergeResult = await runConvergenceCycles({
      level: effectiveLevel, goal: plan.goal, maxCycles: convergenceCycles,
      autoforgeWaves: plan.preset.autoforgeWaves, skipInitialVerify,
      _getVerifyStatus: options._convergenceOpts?.getVerifyStatus,
      _runAutoforge: options._convergenceOpts?.runAutoforge,
      _runVerify: options._convergenceOpts?.runVerify,
    });
    const convergeDur = Date.now() - convergeStart;
    if (convergeResult.cyclesRun === 0) {
      results.push({ step: 'convergence verify (passed, 0 cycles)', status: 'ok', durationMs: convergeDur });
    } else {
      results.push({ step: `convergence (${convergeResult.cyclesRun}/${convergenceCycles} cycles -> ${convergeResult.finalStatus})`, status: convergeResult.finalStatus === 'pass' ? 'ok' : 'fail', durationMs: convergeDur });
    }
  } catch (err) {
    logger.warn(`[${effectiveLevel}] Convergence loop error: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!plan.preset.targetMaturityLevel) return;
  logger.info('');
  logger.info(`[${effectiveLevel}] 🤔 Final maturity check...`);
  try {
    const { assessMaturity } = await import('../../core/maturity-engine.js');
    const { scoreAllArtifacts } = await import('../../core/pdse.js');
    const state = await stOps.load();
    const cwd = process.cwd();
    const pdseScores = await scoreAllArtifacts(cwd, state);
    const assessment = await assessMaturity({ cwd, state, pdseScores, targetLevel: plan.preset.targetMaturityLevel as Parameters<typeof assessMaturity>[0]['targetLevel'] });
    const levelNames = ['', 'Sketch', 'Prototype', 'Alpha', 'Beta', 'Customer-Ready', 'Enterprise-Grade'];
    const currentLevelName = levelNames[assessment.currentLevel] ?? `Level ${assessment.currentLevel}`;
    const targetLevelName = levelNames[assessment.targetLevel] ?? `Level ${assessment.targetLevel}`;
    logger.info(`[${effectiveLevel}] Current Level: ${currentLevelName} (${assessment.currentLevel}/6)`);
    logger.info(`[${effectiveLevel}] Target Level: ${targetLevelName} (${assessment.targetLevel}/6)`);
    logger.info(`[${effectiveLevel}] Overall Score: ${assessment.overallScore}/100`);
    if (assessment.currentLevel >= assessment.targetLevel) {
      logger.success(`[${effectiveLevel}] ✅ MATURITY TARGET ACHIEVED - ${currentLevelName}!`);
      logger.info('');
    } else {
      logger.warn(`[${effectiveLevel}] ❌ Maturity target NOT met (${assessment.currentLevel}/${assessment.targetLevel})`);
      const criticalGaps = assessment.gaps.filter(g => g.severity === 'critical');
      if (criticalGaps.length > 0) {
        logger.warn(`[${effectiveLevel}] Critical gaps remaining:`);
        for (const gap of criticalGaps.slice(0, 3)) logger.warn(`  - ${gap.dimension}: ${gap.currentScore}/100 (${gap.recommendation})`);
      }
      logger.warn(`[${effectiveLevel}] Consider running more convergence cycles or focused remediation.`);
      logger.info('');
    }
  } catch (err) {
    logger.warn(`[${effectiveLevel}] Maturity assessment failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function applyStrictDimsUpdate(
  options: Pick<MagicCommandOptions, '_computeStrictDims'>,
  stOps: { load: () => Promise<DanteState>; save: (s: DanteState) => Promise<void> },
): Promise<void> {
  try {
    const cwd = process.cwd();
    const computeStrictFn = options._computeStrictDims
      ?? (await import('../../core/harsh-scorer.js').catch(() => null))?.computeStrictDimensions;
    if (computeStrictFn) {
      const strict = await computeStrictFn(cwd);
      const state = await stOps.load().catch(() => null);
      if (state) {
        const s = state as unknown as Record<string, unknown>;
        s['autonomyScore'] = strict.autonomy;
        s['selfImprovementScore'] = strict.selfImprovement;
        s['tokenEconomyScore'] = strict.tokenEconomy;
        await stOps.save(state as DanteState).catch(() => { /* non-fatal */ });
      }
    }
  } catch { /* non-fatal — strict score update never blocks pipeline result */ }
}

async function printAndFinalizePreset(
  results: PipelineResult[], pipelineTelemetry: ExecutionTelemetry, magicStart: number,
  effectiveLevel: MagicLevel,
  stOps: { load: () => Promise<DanteState>; save: (s: DanteState) => Promise<void> },
  cpOps: { clear: () => Promise<void> },
  options: Pick<MagicCommandOptions, '_runPrime'>,
): Promise<void> {
  const failed = results.some((r) => r.status === 'fail');
  const totalDur = Date.now() - magicStart;
  const loopResult = detectLoop(pipelineTelemetry);
  if (loopResult.detected) {
    logger.warn('');
    logger.warn(`Loop detected: ${loopResult.type} loop (${loopResult.severity})`);
    logger.warn(`Evidence: ${loopResult.evidence}`);
    if (loopResult.type === 'planning') {
      logger.warn('Pipeline is reading without making progress. Consider running `danteforge forge` directly.');
    } else {
      logger.warn('Pipeline is repeating failed steps. Check errors above and fix the root cause.');
    }
  }
  logger.info('');
  logger.info('='.repeat(60));
  if (failed) { logger.error(`  ${effectiveLevel.toUpperCase()} PRESET COMPLETED WITH FAILURES`); }
  else { logger.success(`  ${effectiveLevel.toUpperCase()} PRESET COMPLETE`); }
  logger.info('='.repeat(60));
  logger.info('');
  for (const result of results) {
    const prefix = result.status === 'ok' ? '[OK]  ' : '[FAIL]';
    const duration = ` (${(result.durationMs / 1000).toFixed(1)}s)`;
    const message = result.message ? ` - ${result.message}` : '';
    if (result.status === 'ok') { logger.success(`${prefix} ${result.step}${duration}`); }
    else { logger.warn(`${prefix} ${result.step}${duration}${message}`); }
  }
  logger.info('');
  logger.info(MAGIC_USAGE_RULES);
  logger.info(`Total time: ${(totalDur / 1000).toFixed(1)}s`);
  const appState = await stOps.load();
  appState.auditLog.push(`${new Date().toISOString()} | magic-preset:${effectiveLevel} ${failed ? 'completed-with-failures' : 'complete'} (${results.length} step${results.length === 1 ? '' : 's'}, ${(totalDur / 1000).toFixed(1)}s)`);
  await stOps.save(appState);
  await cpOps.clear();
  if (effectiveLevel === 'inferno') {
    try {
      if (options._runPrime) { await options._runPrime(); }
      else { const { prime } = await import('./prime.js'); await prime({}); }
    } catch { /* best-effort — never block on prime failure */ }
  }
  if (failed) process.exitCode = 1;
}

async function runMagicPreset(goal?: string, options: MagicCommandOptions = {}) {
  const magicStart = Date.now();
  const level = normalizeMagicLevel(options.level);
  const cpOps = {
    load: options._checkpointOps?.load ?? loadMagicCheckpoint,
    save: options._checkpointOps?.save ?? saveMagicCheckpoint,
    clear: options._checkpointOps?.clear ?? clearMagicCheckpoint,
  };
  const stOps = { load: options._stateOps?.load ?? loadState, save: options._stateOps?.save ?? saveState };

  let checkpoint: MagicPipelineCheckpoint | null = null;
  if (options.resume) {
    checkpoint = await cpOps.load();
    if (checkpoint) {
      logger.success(`Resuming ${capitalize(checkpoint.level)} pipeline (${checkpoint.completedResults.length}/${checkpoint.steps.length} steps done)`);
      for (const result of checkpoint.completedResults) { logger.info(`  [SKIP] ${result.step} (already ${result.status})`); }
    } else {
      logger.warn('No magic pipeline checkpoint found - starting fresh.');
    }
  }

  const plan: MagicPlanShape = checkpoint
    ? { level: checkpoint.level, goal: checkpoint.goal, preset: MAGIC_PRESETS[checkpoint.level] as MagicPresetShape, steps: checkpoint.steps }
    : buildMagicExecutionPlan(level, goal, {
        profile: options.profile ?? MAGIC_PRESETS[level].defaultProfile,
        maxRepos: options.maxRepos, worktree: options.worktree, isolation: options.isolation,
        localSources: options.localSources,
        localDepth: options.localDepth as import('../../core/magic-presets.js').HarvestDepth | undefined,
        localSourcesConfig: options.localSourcesConfig, skipTechDecide: options.skipTechDecide,
        withTechDecide: options.withTechDecide, withDesign: options.withDesign, designPrompt: options.designPrompt,
      }) as MagicPlanShape;

  if (options.prompt) {
    logger.success(`DanteForge ${plan.preset.level ?? plan.level} preset - prompt mode`);
    logger.info('');
    process.stdout.write(formatMagicPlan(plan as Parameters<typeof formatMagicPlan>[0]) + '\n');
    logger.info('');
    logger.info(MAGIC_USAGE_RULES);
    return;
  }

  if (await checkConfirmationGate(plan, options)) return;

  const effectiveLevel = plan.level;
  if (!checkpoint) {
    logger.success(`DanteForge ${capitalize(effectiveLevel)} preset`);
    logger.info(`Goal: ${plan.goal}`);
    logger.info(`Intensity: ${plan.preset.intensity ?? ''}`);
    logger.info(`Token level: ${plan.preset.tokenLevel ?? ''}`);
    logger.info(`Combines: ${plan.preset.combines ?? ''}`);
    logger.info('');
  }

  if (!checkpoint) {
    checkpoint = {
      pipelineId: randomUUID(), level: effectiveLevel, goal: plan.goal, steps: plan.steps,
      currentStepIndex: 0, completedResults: [], startedAt: new Date().toISOString(),
      lastCheckpointAt: new Date().toISOString(), currentStepRetries: 0,
    };
  }

  const pipelineTelemetry = createTelemetry();
  const runStep = options._runStep ?? runMagicPlanStep;
  const results = await runPipelineSteps(plan, checkpoint, cpOps, runStep, pipelineTelemetry, effectiveLevel, checkpoint.currentStepIndex, [...checkpoint.completedResults]);
  await runConvergencePhase(plan, effectiveLevel, results, options, stOps);
  await applyStrictDimsUpdate(options, stOps);
  await printAndFinalizePreset(results, pipelineTelemetry, magicStart, effectiveLevel, stOps, cpOps, options);
}

export interface MagicStepCommandFns {
  review?: (opts: { prompt: boolean }) => Promise<void>;
  autoforge?: (goal: string, opts: { maxWaves: number; profile: string; parallel: boolean; worktree: boolean }) => Promise<void>;
  verify?: () => Promise<void>;
  techDecide?: (opts: { auto: boolean }) => Promise<void>;
  design?: (prompt: string, opts: { light: boolean }) => Promise<void>;
  uxRefine?: (opts: { openpencil: boolean; light: boolean }) => Promise<void>;
  constitution?: () => Promise<void>;
  specify?: (goal: string) => Promise<void>;
  clarify?: () => Promise<void>;
  plan?: () => Promise<void>;
  tasks?: () => Promise<void>;
  party?: (opts: { worktree: boolean; isolation: boolean }) => Promise<void>;
  synthesize?: () => Promise<void>;
  retro?: () => Promise<void>;
  lessonsCompact?: () => Promise<void>;
  oss?: (opts: { maxRepos: string }) => Promise<void>;
  localHarvest?: (sources: string[], opts: { depth: string; config?: string }) => Promise<void>;
}

async function runMagicPlanStepPipeline(step: MagicExecutionStep, goal: string, _fns?: MagicStepCommandFns): Promise<boolean> {
  switch (step.kind) {
    case "review":
      await (_fns?.review ?? (async (opts: { prompt: boolean }) => { const { review } = await import("./review.js"); await review(opts); }))({ prompt: false }); return true;
    case "constitution":
      await (_fns?.constitution ?? (async () => { const { constitution } = await import("./constitution.js"); await constitution(); }))(); return true;
    case "specify":
      await (_fns?.specify ?? (async (goalText: string) => { const { specify } = await import("./specify.js"); await specify(goalText); }))(goal); return true;
    case "clarify":
      await (_fns?.clarify ?? (async () => { const { clarify } = await import("./clarify.js"); await clarify(); }))(); return true;
    case "plan":
      await (_fns?.plan ?? (async () => { const { plan } = await import("./plan.js"); await plan(); }))(); return true;
    case "tasks":
      await (_fns?.tasks ?? (async () => { const { tasks } = await import("./tasks.js"); await tasks(); }))(); return true;
    case "autoforge":
      await withSpinner(`Running autoforge (${step.maxWaves} waves)...`,
        () => (_fns?.autoforge ?? (async (goalText: string, opts: { maxWaves: number; profile: string; parallel: boolean; worktree: boolean }) => { const { autoforge } = await import("./autoforge.js"); await autoforge(goalText, opts); }))(goal, { maxWaves: step.maxWaves, profile: step.profile, parallel: step.parallel, worktree: step.worktree }),
        'Autoforge waves complete'); return true;
    case "party":
      await (_fns?.party ?? (async (opts: { worktree: boolean; isolation: boolean }) => { const { party } = await import("./party.js"); await party(opts); }))({ worktree: step.worktree, isolation: step.isolation }); return true;
    default: return false;
  }
}

async function runMagicPlanStepSupport(step: MagicExecutionStep, goal: string, _fns?: MagicStepCommandFns): Promise<void> {
  switch (step.kind) {
    case "verify":
      await (_fns?.verify ?? (async () => { const { verify } = await import("./verify.js"); await verify(); }))(); return;
    case "synthesize":
      await (_fns?.synthesize ?? (async () => { const { synthesize } = await import("./synthesize.js"); await synthesize(); }))(); return;
    case "retro":
      await (_fns?.retro ?? (async () => { const { retro } = await import("./retro.js"); await retro(); }))(); return;
    case "lessons-compact":
      await (_fns?.lessonsCompact ?? (async () => { const { lessons } = await import("./lessons.js"); await lessons(undefined, { compact: true }); }))(); return;
    case "oss":
      await withSpinner(`Discovering OSS patterns (max ${step.maxRepos} repos)...`,
        () => (_fns?.oss ?? (async (opts: { maxRepos: string }) => { const { ossResearcher } = await import("./oss.js"); await ossResearcher(opts); }))({ maxRepos: String(step.maxRepos) }),
        'OSS discovery complete'); return;
    case "tech-decide":
      await (_fns?.techDecide ?? (async (opts: { auto: boolean }) => { const { techDecide } = await import("./tech-decide.js"); await techDecide(opts); }))({ auto: true }); return;
    case "design":
      await (_fns?.design ?? (async (prompt: string, opts: { light: boolean }) => { const { design } = await import("./design.js"); await design(prompt, opts); }))(step.designPrompt ?? goal, { light: false }); return;
    case "ux-refine":
      await (_fns?.uxRefine ?? (async (opts: { openpencil: boolean; light: boolean }) => { const { uxRefine } = await import("./ux-refine.js"); await uxRefine(opts); }))({ openpencil: step.openpencil, light: true }); return;
    case "local-harvest":
      await (_fns?.localHarvest ?? (async (sources: string[], opts: { depth: string; config?: string }) => { const { localHarvest } = await import("./local-harvest.js"); await localHarvest(sources, opts); }))(step.sources, { depth: step.depth, config: step.configPath }); return;
  }
}

export async function runMagicPlanStep(
  step: MagicExecutionStep,
  goal: string,
  _fns?: MagicStepCommandFns,
): Promise<void> {
  if (await runMagicPlanStepPipeline(step, goal, _fns)) return;
  await runMagicPlanStepSupport(step, goal, _fns);
}

function describeStep(step: MagicExecutionStep): string {
  switch (step.kind) {
    case "autoforge":
      return `autoforge (${step.maxWaves} waves, ${step.profile},${step.parallel ? " parallel" : " serial"})`;
    case "party":
      return `party${step.isolation ? " --isolation" : ""}${step.worktree ? " --worktree" : ""}`;
    case "lessons-compact":
      return "lessons --compact";
    case "oss":
      return `oss --max-repos ${step.maxRepos}`;
    case "local-harvest":
      return `local-harvest (${step.sources.length > 0 ? `${step.sources.length} sources` : 'config'}, depth: ${step.depth})`;
    case "design":
      return step.designPrompt ? `design "${step.designPrompt}"` : "design";
    case "ux-refine":
      return step.openpencil ? "ux-refine --openpencil" : "ux-refine";
    case "tech-decide":
      return "tech-decide --auto";
    default:
      return step.kind;
  }
}

function capitalize(value: MagicLevel): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
