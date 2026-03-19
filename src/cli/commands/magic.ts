import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { logger } from "../../core/logger.js";
import { loadState, saveState } from "../../core/state.js";
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

// ── Magic Pipeline State (checkpoint/resume) ──

interface MagicPipelineCheckpoint {
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

  // ── Resume from checkpoint? ──
  let checkpoint: MagicPipelineCheckpoint | null = null;
  if (options.resume) {
    checkpoint = await loadMagicCheckpoint();
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
    await saveMagicCheckpoint(checkpoint);

    let stepOk = false;
    for (let attempt = 0; attempt <= MAX_RETRIES_PER_STEP; attempt++) {
      try {
        const previousExitCode = process.exitCode;
        process.exitCode = 0;
        await runMagicPlanStep(step, plan.goal);
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
          await saveMagicCheckpoint(checkpoint);
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
    await saveMagicCheckpoint(checkpoint);
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

  const appState = await loadState();
  appState.auditLog.push(
    `${new Date().toISOString()} | magic-preset:${effectiveLevel} ${failed ? "completed-with-failures" : "complete"} (${results.length} step${results.length === 1 ? "" : "s"}, ${(totalDur / 1000).toFixed(1)}s)`,
  );
  await saveState(appState);

  // Clear checkpoint on pipeline completion (success or completed-with-failures)
  await clearMagicCheckpoint();

  if (failed) {
    process.exitCode = 1;
  }
}

async function runMagicPlanStep(
  step: MagicExecutionStep,
  goal: string,
): Promise<void> {
  switch (step.kind) {
    case "review": {
      const { review } = await import("./review.js");
      await review({ prompt: false });
      return;
    }
    case "constitution": {
      const { constitution } = await import("./constitution.js");
      await constitution();
      return;
    }
    case "specify": {
      const { specify } = await import("./specify.js");
      await specify(goal);
      return;
    }
    case "clarify": {
      const { clarify } = await import("./clarify.js");
      await clarify();
      return;
    }
    case "plan": {
      const { plan } = await import("./plan.js");
      await plan();
      return;
    }
    case "tasks": {
      const { tasks } = await import("./tasks.js");
      await tasks();
      return;
    }
    case "autoforge": {
      const { autoforge } = await import("./autoforge.js");
      await autoforge(goal, {
        maxWaves: step.maxWaves,
        profile: step.profile,
        parallel: step.parallel,
        worktree: step.worktree,
      });
      return;
    }
    case "party": {
      const { party } = await import("./party.js");
      await party({
        worktree: step.worktree,
        isolation: step.isolation,
      });
      return;
    }
    case "verify": {
      const { verify } = await import("./verify.js");
      await verify();
      return;
    }
    case "synthesize": {
      const { synthesize } = await import("./synthesize.js");
      await synthesize();
      return;
    }
    case "retro": {
      const { retro } = await import("./retro.js");
      await retro();
      return;
    }
    case "lessons-compact": {
      const { lessons } = await import("./lessons.js");
      await lessons(undefined, { compact: true });
      return;
    }
    case "oss": {
      const { ossResearcher } = await import("./oss.js");
      await ossResearcher({ maxRepos: String(step.maxRepos) });
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
    default:
      return step.kind;
  }
}

function capitalize(value: MagicLevel): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
