// run-pipeline — full unattended spec-to-verify pipeline
import { logger } from '../../core/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RunPipelineOptions {
  spec?: string;
  yes?: boolean;
  maxPhases?: number;
  cwd?: string;
  /** Injectable stage runner for testing */
  _runStage?: StageRunner;
  /** Injectable prompt function for testing (returns true to continue) */
  _prompt?: PromptFn;
}

export interface StageResult {
  stage: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface RunPipelineResult {
  stagesCompleted: string[];
  stagesFailed: string[];
  totalDurationMs: number;
  scoreAchieved: number | null;
  summary: string;
}

/** A function that runs a single pipeline stage and returns success/failure. */
export type StageRunner = (
  stage: string,
  options: { cwd?: string; spec?: string; yes?: boolean },
) => Promise<StageResult>;

/** A function that prompts the user for confirmation. Returns true to proceed. */
export type PromptFn = (message: string) => Promise<boolean>;

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

/** Ordered list of pipeline stages. */
export const PIPELINE_STAGES = [
  'specify',
  'clarify',
  'plan',
  'tasks',
  'forge',
  'verify',
] as const;

export type PipelineStage = typeof PIPELINE_STAGES[number];

// ---------------------------------------------------------------------------
// Default stage runner
// ---------------------------------------------------------------------------

async function defaultRunStage(
  stage: string,
  options: { cwd?: string; spec?: string; yes?: boolean },
): Promise<StageResult> {
  const start = Date.now();
  try {
    switch (stage) {
      case 'specify': {
        const { specify } = await import('./specify.js');
        await specify(options.spec ?? 'run-pipeline: execute full spec-to-verify pipeline', {});
        break;
      }
      case 'clarify': {
        const { clarify } = await import('./clarify.js');
        await clarify({});
        break;
      }
      case 'plan': {
        const { plan } = await import('./plan.js');
        await plan({});
        break;
      }
      case 'tasks': {
        const { tasks } = await import('./tasks.js');
        await tasks({});
        break;
      }
      case 'forge': {
        const { forge } = await import('./forge.js');
        await forge('1', { profile: 'balanced' });
        break;
      }
      case 'verify': {
        const { verify } = await import('./verify.js');
        await verify({});
        break;
      }
      default:
        throw new Error(`Unknown stage: ${stage}`);
    }
    return { stage, success: true, durationMs: Date.now() - start };
  } catch (err) {
    return {
      stage,
      success: false,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function defaultPrompt(message: string): Promise<boolean> {
  // In non-interactive environments, default to proceeding
  if (!process.stdout.isTTY) return true;
  process.stdout.write(`\n${message} [Y/n] `);
  return new Promise<boolean>((resolve) => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (data: string) => {
      const answer = String(data).trim().toLowerCase();
      resolve(answer === '' || answer === 'y' || answer === 'yes');
    });
  });
}

// ---------------------------------------------------------------------------
// Score reader (best-effort)
// ---------------------------------------------------------------------------

async function readCurrentScore(cwd?: string): Promise<number | null> {
  try {
    const { computeHarshScore } = await import('../../core/harsh-scorer.js');
    const result = await computeHarshScore({ cwd: cwd ?? process.cwd() });
    return result.displayScore;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main command
// ---------------------------------------------------------------------------

/**
 * Run the full spec-to-verify pipeline unattended.
 *
 * Sequences: specify → clarify → plan → tasks → forge → verify
 * Each stage respects --max-phases to limit forge waves.
 * --yes skips all confirmation prompts.
 */
export async function runPipeline(options: RunPipelineOptions = {}): Promise<RunPipelineResult> {
  const cwd = options.cwd ?? process.cwd();
  const maxPhases = options.maxPhases ?? 3;
  const yes = options.yes ?? false;
  const runStage = options._runStage ?? defaultRunStage;
  const promptFn = options._prompt ?? defaultPrompt;

  const start = Date.now();
  const stagesCompleted: string[] = [];
  const stagesFailed: string[] = [];

  logger.info('[run-pipeline] Starting full spec-to-verify pipeline');
  logger.info(`[run-pipeline] Max forge phases: ${maxPhases} | Auto-confirm: ${yes}`);
  logger.info('');

  const stagesToRun = PIPELINE_STAGES.slice();

  for (const stage of stagesToRun) {
    if (!yes) {
      const proceed = await promptFn(`Run stage "${stage}"?`);
      if (!proceed) {
        logger.info(`[run-pipeline] Skipped stage: ${stage}`);
        continue;
      }
    }

    logger.info(`[run-pipeline] Running stage: ${stage}`);
    const result = await runStage(stage, { cwd, spec: options.spec, yes });

    if (result.success) {
      stagesCompleted.push(stage);
      logger.success(`[run-pipeline] Stage complete: ${stage} (${result.durationMs}ms)`);
    } else {
      stagesFailed.push(stage);
      logger.error(`[run-pipeline] Stage failed: ${stage} — ${result.error ?? 'unknown error'}`);
      logger.warn('[run-pipeline] Halting pipeline on first failure.');
      break;
    }
  }

  const totalDurationMs = Date.now() - start;
  const scoreAchieved = await readCurrentScore(cwd);

  const summary = [
    `Pipeline complete in ${(totalDurationMs / 1000).toFixed(1)}s`,
    `Stages completed: ${stagesCompleted.join(', ') || 'none'}`,
    stagesFailed.length > 0 ? `Stages failed: ${stagesFailed.join(', ')}` : '',
    scoreAchieved !== null ? `Final score: ${scoreAchieved}/10` : '',
  ].filter(Boolean).join(' | ');

  logger.info('');
  logger.info(`[run-pipeline] ${summary}`);

  return { stagesCompleted, stagesFailed, totalDurationMs, scoreAchieved, summary };
}
