import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import {
  DEFAULT_MAGIC_LEVEL,
  MAGIC_PRESETS,
  MAGIC_USAGE_RULES,
  buildMagicExecutionPlan,
  formatMagicPlan,
  normalizeMagicLevel,
  type MagicExecutionStep,
  type MagicLevel,
} from '../../core/magic-presets.js';

export interface MagicCommandOptions {
  level?: string;
  profile?: string;
  skipUx?: boolean;
  host?: string;
  prompt?: boolean;
  worktree?: boolean;
  isolation?: boolean;
  maxRepos?: number;
}

export async function magic(goal?: string, options: MagicCommandOptions = {}) {
  return runMagicPreset(goal, {
    ...options,
    level: options.level ?? DEFAULT_MAGIC_LEVEL,
  });
}

export async function spark(goal?: string, options: Omit<MagicCommandOptions, 'level'> = {}) {
  return runMagicPreset(goal, { ...options, level: 'spark' });
}

export async function ember(goal?: string, options: Omit<MagicCommandOptions, 'level'> = {}) {
  return runMagicPreset(goal, { ...options, level: 'ember' });
}

export async function blaze(goal?: string, options: Omit<MagicCommandOptions, 'level'> = {}) {
  return runMagicPreset(goal, { ...options, level: 'blaze' });
}

export async function inferno(goal?: string, options: Omit<MagicCommandOptions, 'level'> = {}) {
  return runMagicPreset(goal, { ...options, level: 'inferno' });
}

async function runMagicPreset(goal?: string, options: MagicCommandOptions = {}) {
  const magicStart = Date.now();
  const level = normalizeMagicLevel(options.level);
  const plan = buildMagicExecutionPlan(level, goal, {
    profile: options.profile ?? MAGIC_PRESETS[level].defaultProfile,
    maxRepos: options.maxRepos,
    worktree: options.worktree,
    isolation: options.isolation,
  });

  if (options.prompt) {
    logger.success(`DanteForge ${plan.preset.level} preset - prompt mode`);
    logger.info('');
    process.stdout.write(formatMagicPlan(plan) + '\n');
    logger.info('');
    logger.info(MAGIC_USAGE_RULES);
    return;
  }

  logger.success(`DanteForge ${capitalize(level)} preset`);
  logger.info(`Goal: ${plan.goal}`);
  logger.info(`Intensity: ${plan.preset.intensity}`);
  logger.info(`Token level: ${plan.preset.tokenLevel}`);
  logger.info(`Combines: ${plan.preset.combines}`);
  logger.info('');

  const results: { step: string; status: 'ok' | 'fail'; durationMs: number; message?: string }[] = [];

  for (const step of plan.steps) {
    const stepStart = Date.now();
    const label = describeStep(step);
    logger.info(`[${level}] Running: ${label}`);

    try {
      const previousExitCode = process.exitCode;
      process.exitCode = 0;
      await runMagicPlanStep(step, plan.goal);
      const stepExitCode = process.exitCode ?? 0;
      process.exitCode = previousExitCode;
      if (stepExitCode !== 0) {
        throw new Error(`${label} exited with code ${stepExitCode}`);
      }
      const durationMs = Date.now() - stepStart;
      results.push({ step: label, status: 'ok', durationMs });
      logger.success(`[${level}] ${label} complete (${(durationMs / 1000).toFixed(1)}s)`);
    } catch (err) {
      const durationMs = Date.now() - stepStart;
      const message = err instanceof Error ? err.message : String(err);
      results.push({ step: label, status: 'fail', durationMs, message });
      logger.error(`[${level}] ${label} failed: ${message}`);
      break;
    }
  }

  const failed = results.some(result => result.status === 'fail');
  const totalDur = Date.now() - magicStart;

  logger.info('');
  logger.info('='.repeat(60));
  if (failed) {
    logger.error(`  ${level.toUpperCase()} PRESET FAILED`);
  } else {
    logger.success(`  ${level.toUpperCase()} PRESET COMPLETE`);
  }
  logger.info('='.repeat(60));
  logger.info('');

  for (const result of results) {
    const prefix = result.status === 'ok' ? '[OK]  ' : '[FAIL]';
    const duration = ` (${(result.durationMs / 1000).toFixed(1)}s)`;
    const message = result.message ? ` - ${result.message}` : '';
    if (result.status === 'ok') {
      logger.success(`${prefix} ${result.step}${duration}`);
    } else {
      logger.warn(`${prefix} ${result.step}${duration}${message}`);
    }
  }

  logger.info('');
  logger.info(MAGIC_USAGE_RULES);
  logger.info(`Total time: ${(totalDur / 1000).toFixed(1)}s`);

  const state = await loadState();
  state.auditLog.push(
    `${new Date().toISOString()} | magic-preset:${level} ${failed ? 'failed' : 'complete'} (${results.length} step${results.length === 1 ? '' : 's'}, ${(totalDur / 1000).toFixed(1)}s)`,
  );
  await saveState(state);

  if (failed) {
    process.exitCode = 1;
  }
}

async function runMagicPlanStep(
  step: MagicExecutionStep,
  goal: string,
): Promise<void> {
  switch (step.kind) {
    case 'review': {
      const { review } = await import('./review.js');
      await review({ prompt: false });
      return;
    }
    case 'constitution': {
      const { constitution } = await import('./constitution.js');
      await constitution();
      return;
    }
    case 'specify': {
      const { specify } = await import('./specify.js');
      await specify(goal);
      return;
    }
    case 'clarify': {
      const { clarify } = await import('./clarify.js');
      await clarify();
      return;
    }
    case 'plan': {
      const { plan } = await import('./plan.js');
      await plan();
      return;
    }
    case 'tasks': {
      const { tasks } = await import('./tasks.js');
      await tasks();
      return;
    }
    case 'autoforge': {
      const { autoforge } = await import('./autoforge.js');
      await autoforge(goal, {
        maxWaves: step.maxWaves,
        profile: step.profile,
        parallel: step.parallel,
        worktree: step.worktree,
      });
      return;
    }
    case 'party': {
      const { party } = await import('./party.js');
      await party({
        worktree: step.worktree,
        isolation: step.isolation,
      });
      return;
    }
    case 'verify': {
      const { verify } = await import('./verify.js');
      await verify();
      return;
    }
    case 'synthesize': {
      const { synthesize } = await import('./synthesize.js');
      await synthesize();
      return;
    }
    case 'retro': {
      const { retro } = await import('./retro.js');
      await retro();
      return;
    }
    case 'lessons-compact': {
      const { lessons } = await import('./lessons.js');
      await lessons(undefined, { compact: true });
      return;
    }
    case 'oss': {
      const { ossResearcher } = await import('./oss.js');
      await ossResearcher({ maxRepos: String(step.maxRepos) });
      return;
    }
  }
}

function describeStep(step: MagicExecutionStep): string {
  switch (step.kind) {
    case 'autoforge':
      return `autoforge (${step.maxWaves} waves, ${step.profile},${step.parallel ? ' parallel' : ' serial'})`;
    case 'party':
      return `party${step.isolation ? ' --isolation' : ''}${step.worktree ? ' --worktree' : ''}`;
    case 'lessons-compact':
      return 'lessons --compact';
    case 'oss':
      return `oss --max-repos ${step.maxRepos}`;
    default:
      return step.kind;
  }
}

function capitalize(value: MagicLevel): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
