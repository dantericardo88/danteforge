import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { logger } from "../../core/logger.js";
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

// ── Convergence Loop ─────────────────────────────────────────────────────────

export type VerifyStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export interface ConvergenceOptions {
  level: MagicLevel;
  goal: string;
  /** Maximum repair cycles to run after verify fails (0 = disabled) */
  maxCycles: number;
  /**
   * Skip running verify before checking status — set true when the main
   * pipeline already ran verify and STATE.yaml has a fresh lastVerifyStatus.
   */
  skipInitialVerify?: boolean;
  /** Injected for testing — avoids real state I/O */
  _getVerifyStatus?: () => Promise<VerifyStatus>;
  /** Injected for testing — avoids real autoforge execution */
  _runAutoforge?: (goal: string, waves: number) => Promise<void>;
  /** Injected for testing — avoids real verify execution */
  _runVerify?: () => Promise<void>;
}

export interface ConvergenceResult {
  cyclesRun: number;
  initialStatus: VerifyStatus;
  finalStatus: VerifyStatus;
}

export async function runConvergenceCycles(
  opts: ConvergenceOptions,
): Promise<ConvergenceResult> {
  if (opts.maxCycles === 0) {
    return { cyclesRun: 0, initialStatus: 'unknown', finalStatus: 'unknown' };
  }

  const getStatus: () => Promise<VerifyStatus> =
    opts._getVerifyStatus ??
    (async () => {
      const state: DanteState = await loadState();
      return (state.lastVerifyStatus ?? 'unknown') as VerifyStatus;
    });

  const runAutoforge: (goal: string, waves: number) => Promise<void> =
    opts._runAutoforge ??
    (async (g: string, waves: number) => {
      const { autoforge } = await import("./autoforge.js");
      await autoforge(g, { maxWaves: waves });
    });

  const runVerify: () => Promise<void> =
    opts._runVerify ??
    (async () => {
      const { verify } = await import("./verify.js");
      await verify();
    });

  // Run initial verify unless the pipeline already did it
  if (!opts.skipInitialVerify) {
    logger.info(`[${opts.level}] Convergence: running verify...`);
    await runVerify();
  }

  const initialStatus = await getStatus();

  if (initialStatus === 'pass') {
    logger.success(
      `[${opts.level}] Convergence: verify passed — no repair cycles needed`,
    );
    return { cyclesRun: 0, initialStatus, finalStatus: 'pass' };
  }

  let finalStatus: VerifyStatus = initialStatus;
  let cyclesRun = 0;

  while (finalStatus !== 'pass' && cyclesRun < opts.maxCycles) {
    cyclesRun++;
    logger.info(
      `[${opts.level}] Convergence cycle ${cyclesRun}/${opts.maxCycles}: re-executing targeted fixes...`,
    );
    const fixGoal = `Fix failing verification — ${opts.goal}`;
    await runAutoforge(fixGoal, 3);
    await runVerify();
    finalStatus = await getStatus();
    if (finalStatus === 'pass') {
      logger.success(
        `[${opts.level}] Convergence achieved after ${cyclesRun} cycle${cyclesRun === 1 ? '' : 's'}`,
      );
    } else {
      logger.warn(
        `[${opts.level}] Convergence cycle ${cyclesRun} complete — verify still ${finalStatus}`,
      );
    }
  }

  if (finalStatus !== 'pass') {
    logger.warn(
      `[${opts.level}] Convergence exhausted (${cyclesRun}/${opts.maxCycles} cycles) — verify: ${finalStatus}`,
    );
  }

  return { cyclesRun, initialStatus, finalStatus };
}

// ── Magic Pipeline State (checkpoint/resume) ──

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
    // File doesn't exist — that's fine
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
  /** Resume from a previously interrupted pipeline run. */
  resume?: boolean;
  /** Local source paths to harvest before OSS discovery (inferno/nova/blaze) */
  localSources?: string[];
  /** Depth for local source harvesting */
  localDepth?: string;
  /** Path to local-sources YAML config */
  localSourcesConfig?: string;
  /** Skip tech-decide in spark (it's ON by default in spark) */
  skipTechDecide?: boolean;
  /** Add tech-decide to nova pipeline */
  withTechDecide?: boolean;
  /** Add design + ux-refine steps to blaze/nova/inferno pipeline */
  withDesign?: boolean;
  /** Design prompt for the design step */
  designPrompt?: string;
  /** Injection seam for testing — replaces runMagicPlanStep with a custom runner */
  _runStep?: (step: MagicExecutionStep, goal: string) => Promise<void>;
  /** Injection seam for testing — overrides convergence loop I/O (avoids real LLM calls) */
  _convergenceOpts?: {
    getVerifyStatus?: () => Promise<VerifyStatus>;
    runAutoforge?: (goal: string, waves: number) => Promise<void>;
    runVerify?: () => Promise<void>;
  };
  /** Injection seam for testing — overrides checkpoint file I/O */
  _checkpointOps?: {
    load: () => Promise<MagicPipelineCheckpoint | null>;
    save: (cp: MagicPipelineCheckpoint) => Promise<void>;
    clear: () => Promise<void>;
  };
  /** Injection seam for testing — overrides final state persistence */
  _stateOps?: {
    load: () => Promise<import('../../core/state.js').DanteState>;
    save: (state: import('../../core/state.js').DanteState) => Promise<void>;
  };
}

export async function magic(goal?: string, options: MagicCommandOptions = {}) {
  return runMagicPreset(goal, {
    ...options,
    level: options.level ?? DEFAULT_MAGIC_LEVEL,
  });
}

export async function spark(
  goal?: string,
  options: Omit<MagicCommandOptions, "level"> = {},
) {
  return runMagicPreset(goal, { ...options, level: "spark" });
}

export async function ember(
  goal?: string,
  options: Omit<MagicCommandOptions, "level"> = {},
) {
  return runMagicPreset(goal, { ...options, level: "ember" });
}

export async function blaze(
  goal?: string,
  options: Omit<MagicCommandOptions, "level"> = {},
) {
  return runMagicPreset(goal, { ...options, level: "blaze" });
}

export async function nova(
  goal?: string,
  options: Omit<MagicCommandOptions, "level"> = {},
) {
  return runMagicPreset(goal, { ...options, level: "nova" });
}

export async function canvas(
  goal?: string,
  options: Omit<MagicCommandOptions, "level"> = {},
) {
  return runMagicPreset(goal, { ...options, level: "canvas" });
}

export async function inferno(
  goal?: string,
  options: Omit<MagicCommandOptions, "level"> = {},
) {
  return runMagicPreset(goal, { ...options, level: "inferno" });
}

async function runMagicPreset(
  goal?: string,
  options: MagicCommandOptions = {},
) {
  const magicStart = Date.now();
  const level = normalizeMagicLevel(options.level);

  // ── Resolve I/O operations (injected or real) ──
  const cpOps = {
    load: options._checkpointOps?.load ?? loadMagicCheckpoint,
    save: options._checkpointOps?.save ?? saveMagicCheckpoint,
    clear: options._checkpointOps?.clear ?? clearMagicCheckpoint,
  };
  const stOps = {
    load: options._stateOps?.load ?? loadState,
    save: options._stateOps?.save ?? saveState,
  };

  // ── Resume from checkpoint? ──
  let checkpoint: MagicPipelineCheckpoint | null = null;
  if (options.resume) {
    checkpoint = await cpOps.load();
    if (checkpoint) {
      logger.success(
        `Resuming ${capitalize(checkpoint.level)} pipeline (${checkpoint.completedResults.length}/${checkpoint.steps.length} steps done)`,
      );
      for (const r of checkpoint.completedResults) {
        logger.info(`  [SKIP] ${r.step} (already ${r.status})`);
      }
    } else {
      logger.warn("No magic pipeline checkpoint found — starting fresh.");
    }
  }

  const plan = checkpoint
    ? {
        level: checkpoint.level,
        goal: checkpoint.goal,
        preset: MAGIC_PRESETS[checkpoint.level],
        steps: checkpoint.steps,
      }
    : buildMagicExecutionPlan(level, goal, {
        profile: options.profile ?? MAGIC_PRESETS[level].defaultProfile,
        maxRepos: options.maxRepos,
        worktree: options.worktree,
        isolation: options.isolation,
        localSources: options.localSources,
        localDepth: options.localDepth as import("../../core/magic-presets.js").HarvestDepth | undefined,
        localSourcesConfig: options.localSourcesConfig,
        skipTechDecide: options.skipTechDecide,
        withTechDecide: options.withTechDecide,
        withDesign: options.withDesign,
        designPrompt: options.designPrompt,
      });

  if (options.prompt) {
    logger.success(`DanteForge ${plan.preset.level} preset - prompt mode`);
    logger.info("");
    process.stdout.write(formatMagicPlan(plan) + "\n");
    logger.info("");
    logger.info(MAGIC_USAGE_RULES);
    return;
  }

  const effectiveLevel = plan.level as MagicLevel;

  if (!checkpoint) {
    logger.success(`DanteForge ${capitalize(effectiveLevel)} preset`);
    logger.info(`Goal: ${plan.goal}`);
    logger.info(`Intensity: ${plan.preset.intensity}`);
    logger.info(`Token level: ${plan.preset.tokenLevel}`);
    logger.info(`Combines: ${plan.preset.combines}`);
    logger.info("");
  }

  // Initialize or restore checkpoint state
  if (!checkpoint) {
    checkpoint = {
      pipelineId: randomUUID(),
      level: effectiveLevel,
      goal: plan.goal,
      steps: plan.steps,
      currentStepIndex: 0,
      completedResults: [],
      startedAt: new Date().toISOString(),
      lastCheckpointAt: new Date().toISOString(),
      currentStepRetries: 0,
    };
  }

  const results = [...checkpoint.completedResults];
  const startIndex = checkpoint.currentStepIndex;
  const pipelineTelemetry = createTelemetry();

  for (let i = startIndex; i < plan.steps.length; i++) {
    const step = plan.steps[i]!;
    const stepStart = Date.now();
    const label = describeStep(step);
    logger.info(
      `[${effectiveLevel}] Running: ${label} (${i + 1}/${plan.steps.length})`,
    );

    // Save checkpoint before starting each step
    checkpoint.currentStepIndex = i;
    await cpOps.save(checkpoint);

    let stepOk = false;
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_STEP; attempt++) {
      try {
        const previousExitCode = process.exitCode;
        process.exitCode = 0;
        await (options._runStep ?? runMagicPlanStep)(step, plan.goal);
        const stepExitCode = process.exitCode ?? 0;
        process.exitCode = previousExitCode;
        if (stepExitCode !== 0) {
          throw new Error(`${label} exited with code ${stepExitCode}`);
        }
        stepOk = true;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (attempt < MAX_RETRIES_PER_STEP) {
          logger.warn(
            `[${effectiveLevel}] ${label} failed (attempt ${attempt + 1}/${MAX_RETRIES_PER_STEP + 1}): ${message} — retrying...`,
          );
          checkpoint.currentStepRetries = attempt + 1;
          await cpOps.save(checkpoint);
        } else {
          const durationMs = Date.now() - stepStart;
          results.push({ step: label, status: "fail", durationMs, message });
          logger.error(
            `[${effectiveLevel}] ${label} failed after ${MAX_RETRIES_PER_STEP + 1} attempts: ${message}`,
          );
          // Don't break — continue to next step instead of halting the pipeline
          logger.warn(
            `[${effectiveLevel}] Skipping failed step and continuing pipeline...`,
          );
        }
      }
    }

    if (stepOk) {
      const durationMs = Date.now() - stepStart;
      results.push({ step: label, status: "ok", durationMs });
      logger.success(
        `[${effectiveLevel}] ${label} complete (${(durationMs / 1000).toFixed(1)}s)`,
      );
      // Track successful step as a write operation
      recordToolCall(pipelineTelemetry, step.kind, true);
    } else {
      // Track failed step — record retry bash commands for loop detection
      recordBashCommand(pipelineTelemetry, `${step.kind} (failed)`);
      recordToolCall(pipelineTelemetry, step.kind, false);
    }

    // Update checkpoint after step completion (success or skip)
    checkpoint.completedResults = [...results];
    checkpoint.currentStepIndex = i + 1;
    checkpoint.currentStepRetries = 0;
    await cpOps.save(checkpoint);
  }

  // ── Convergence loop: validate and repair until verify passes ───────────────
  const convergenceCycles = plan.preset.convergenceCycles;
  if (convergenceCycles > 0) {
    const convergeStart = Date.now();
    const skipInitialVerify = plan.steps.some((s) => s.kind === 'verify');
    logger.info('');
    logger.info(
      `[${effectiveLevel}] Starting convergence loop (up to ${convergenceCycles} cycle${convergenceCycles === 1 ? '' : 's'})...`,
    );
    try {
      const convergeResult = await runConvergenceCycles({
        level: effectiveLevel,
        goal: plan.goal,
        maxCycles: convergenceCycles,
        skipInitialVerify,
        _getVerifyStatus: options._convergenceOpts?.getVerifyStatus,
        _runAutoforge: options._convergenceOpts?.runAutoforge,
        _runVerify: options._convergenceOpts?.runVerify,
      });
      const convergeDur = Date.now() - convergeStart;
      if (convergeResult.cyclesRun === 0) {
        results.push({
          step: `convergence verify (passed, 0 cycles)`,
          status: 'ok',
          durationMs: convergeDur,
        });
      } else {
        results.push({
          step: `convergence (${convergeResult.cyclesRun}/${convergenceCycles} cycles → ${convergeResult.finalStatus})`,
          status: convergeResult.finalStatus === 'pass' ? 'ok' : 'fail',
          durationMs: convergeDur,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[${effectiveLevel}] Convergence loop error: ${message}`);
    }
  }

  const failed = results.some((result) => result.status === "fail");
  const totalDur = Date.now() - magicStart;

  // Pipeline-level loop detection
  const loopResult = detectLoop(pipelineTelemetry);
  if (loopResult.detected) {
    logger.warn("");
    logger.warn(`Loop detected: ${loopResult.type} loop (${loopResult.severity})`);
    logger.warn(`Evidence: ${loopResult.evidence}`);
    if (loopResult.type === "planning") {
      logger.warn("Pipeline is reading without making progress. Consider running `danteforge forge` directly.");
    } else {
      logger.warn("Pipeline is repeating failed steps. Check errors above and fix the root cause.");
    }
  }

  logger.info("");
  logger.info("=".repeat(60));
  if (failed) {
    logger.error(
      `  ${effectiveLevel.toUpperCase()} PRESET COMPLETED WITH FAILURES`,
    );
  } else {
    logger.success(`  ${effectiveLevel.toUpperCase()} PRESET COMPLETE`);
  }
  logger.info("=".repeat(60));
  logger.info("");

  for (const result of results) {
    const prefix = result.status === "ok" ? "[OK]  " : "[FAIL]";
    const duration = ` (${(result.durationMs / 1000).toFixed(1)}s)`;
    const message = result.message ? ` - ${result.message}` : "";
    if (result.status === "ok") {
      logger.success(`${prefix} ${result.step}${duration}`);
    } else {
      logger.warn(`${prefix} ${result.step}${duration}${message}`);
    }
  }

  logger.info("");
  logger.info(MAGIC_USAGE_RULES);
  logger.info(`Total time: ${(totalDur / 1000).toFixed(1)}s`);

  const appState = await stOps.load();
  appState.auditLog.push(
    `${new Date().toISOString()} | magic-preset:${effectiveLevel} ${failed ? "completed-with-failures" : "complete"} (${results.length} step${results.length === 1 ? "" : "s"}, ${(totalDur / 1000).toFixed(1)}s)`,
  );
  await stOps.save(appState);

  // Clear checkpoint on pipeline completion (success or completed-with-failures)
  await cpOps.clear();

  if (failed) {
    process.exitCode = 1;
  }
}

/** Per-step command function overrides for testing — covers all step kinds with testable arg contracts */
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

export async function runMagicPlanStep(
  step: MagicExecutionStep,
  goal: string,
  _fns?: MagicStepCommandFns,
): Promise<void> {
  switch (step.kind) {
    case "review": {
      const fn = _fns?.review ?? (async (opts: { prompt: boolean }) => { const { review } = await import("./review.js"); await review(opts); });
      await fn({ prompt: false });
      return;
    }
    case "constitution": {
      const fn = _fns?.constitution ?? (async () => { const { constitution } = await import("./constitution.js"); await constitution(); });
      await fn();
      return;
    }
    case "specify": {
      const fn = _fns?.specify ?? (async (g: string) => { const { specify } = await import("./specify.js"); await specify(g); });
      await fn(goal);
      return;
    }
    case "clarify": {
      const fn = _fns?.clarify ?? (async () => { const { clarify } = await import("./clarify.js"); await clarify(); });
      await fn();
      return;
    }
    case "plan": {
      const fn = _fns?.plan ?? (async () => { const { plan } = await import("./plan.js"); await plan(); });
      await fn();
      return;
    }
    case "tasks": {
      const fn = _fns?.tasks ?? (async () => { const { tasks } = await import("./tasks.js"); await tasks(); });
      await fn();
      return;
    }
    case "autoforge": {
      const fn = _fns?.autoforge ?? (async (g: string, opts: { maxWaves: number; profile: string; parallel: boolean; worktree: boolean }) => {
        const { autoforge } = await import("./autoforge.js");
        await autoforge(g, opts);
      });
      await fn(goal, {
        maxWaves: step.maxWaves,
        profile: step.profile,
        parallel: step.parallel,
        worktree: step.worktree,
      });
      return;
    }
    case "party": {
      const fn = _fns?.party ?? (async (opts: { worktree: boolean; isolation: boolean }) => { const { party } = await import("./party.js"); await party(opts); });
      await fn({ worktree: step.worktree, isolation: step.isolation });
      return;
    }
    case "verify": {
      const fn = _fns?.verify ?? (async () => { const { verify } = await import("./verify.js"); await verify(); });
      await fn();
      return;
    }
    case "synthesize": {
      const fn = _fns?.synthesize ?? (async () => { const { synthesize } = await import("./synthesize.js"); await synthesize(); });
      await fn();
      return;
    }
    case "retro": {
      const fn = _fns?.retro ?? (async () => { const { retro } = await import("./retro.js"); await retro(); });
      await fn();
      return;
    }
    case "lessons-compact": {
      const fn = _fns?.lessonsCompact ?? (async () => { const { lessons } = await import("./lessons.js"); await lessons(undefined, { compact: true }); });
      await fn();
      return;
    }
    case "oss": {
      const fn = _fns?.oss ?? (async (opts: { maxRepos: string }) => { const { ossResearcher } = await import("./oss.js"); await ossResearcher(opts); });
      await fn({ maxRepos: String(step.maxRepos) });
      return;
    }
    case "tech-decide": {
      const fn = _fns?.techDecide ?? (async (opts: { auto: boolean }) => { const { techDecide } = await import("./tech-decide.js"); await techDecide(opts); });
      await fn({ auto: true });
      return;
    }
    case "design": {
      const fn = _fns?.design ?? (async (prompt: string, opts: { light: boolean }) => { const { design } = await import("./design.js"); await design(prompt, opts); });
      await fn(step.designPrompt ?? goal, { light: false });
      return;
    }
    case "ux-refine": {
      const fn = _fns?.uxRefine ?? (async (opts: { openpencil: boolean; light: boolean }) => { const { uxRefine } = await import("./ux-refine.js"); await uxRefine(opts); });
      await fn({ openpencil: step.openpencil, light: true });
      return;
    }
    case "local-harvest": {
      const fn = _fns?.localHarvest ?? (async (sources: string[], opts: { depth: string; config?: string }) => { const { localHarvest } = await import("./local-harvest.js"); await localHarvest(sources, opts); });
      await fn(step.sources, { depth: step.depth, config: step.configPath });
      return;
    }
  }
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
      return `local-harvest (${step.sources.length > 0 ? step.sources.length + ' sources' : 'config'}, depth: ${step.depth})`;
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
