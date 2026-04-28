/**
 * `danteforge magic-orchestrate <level>` — runs the magic-level skill chain
 * end-to-end via the orchestration runtime. Closes Phase 3 of PRD-MASTER §8.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { logger } from '../../core/logger.js';
import { runMagicLevelOrchestration } from '../../spine/magic_skill_orchestration/runtime.js';
import { MAGIC_LEVEL_MAP, type MagicLevel } from '../../spine/magic_skill_orchestration/index.js';

export interface MagicOrchestrateFlags {
  inputFile?: string;
  inputsJson?: string;
  budgetUsd?: string;
  budgetMinutes?: string;
  maxRetries?: string;
  scoreOverride?: string;
}

export async function magicOrchestrate(level: string, flags: MagicOrchestrateFlags): Promise<{ exitCode: number; runDir: string | null }> {
  if (!(level in MAGIC_LEVEL_MAP)) {
    logger.error(`Unknown magic level: ${level}. Allowed: ${Object.keys(MAGIC_LEVEL_MAP).join(', ')}`);
    return { exitCode: 2, runDir: null };
  }
  const inputs = readInputs(flags);
  if ('error' in inputs) {
    logger.error(`magic-orchestrate input parse failed: ${inputs.error}`);
    return { exitCode: 2, runDir: null };
  }

  const repo = resolve(process.cwd());

  const result = await runMagicLevelOrchestration({
    level: level as MagicLevel,
    inputs: inputs.value,
    repo,
    budgetUsd: flags.budgetUsd ? Number.parseFloat(flags.budgetUsd) : undefined,
    budgetMinutes: flags.budgetMinutes ? Number.parseFloat(flags.budgetMinutes) : undefined,
    maxConvergenceRetries: flags.maxRetries ? Number.parseInt(flags.maxRetries, 10) : undefined,
    scorer: flags.scoreOverride ? parseScoreOverride(flags.scoreOverride) : undefined
  });

  logger.info(`magic-orchestrate ${level} → ${result.overallStatus} (steps=${result.steps.length})`);
  logger.info(`  output: ${result.outputDir}`);
  for (const step of result.steps) {
    logger.info(`    [${step.attempts}x] ${step.skill}: ${step.status} (gate=${step.gate})`);
  }

  const exitCode = result.overallStatus === 'green' ? 0 : 1;
  return { exitCode, runDir: result.outputDir };
}

function readInputs(flags: MagicOrchestrateFlags): { value: Record<string, unknown> } | { error: string } {
  if (flags.inputsJson) {
    try {
      return { value: JSON.parse(flags.inputsJson) as Record<string, unknown> };
    } catch (err) {
      return { error: `--inputs-json could not be parsed: ${(err as Error).message}` };
    }
  }
  if (flags.inputFile) {
    if (!existsSync(flags.inputFile)) return { error: `input file not found: ${flags.inputFile}` };
    try {
      return { value: JSON.parse(readFileSync(flags.inputFile, 'utf-8')) as Record<string, unknown> };
    } catch (err) {
      return { error: `input file parse failed: ${(err as Error).message}` };
    }
  }
  return { value: {} };
}

function parseScoreOverride(raw: string): (dims: string[]) => Record<string, number> {
  const parsed: Record<string, number> = {};
  for (const part of raw.split(',')) {
    const [k, v] = part.split('=');
    const score = Number.parseFloat(v ?? '0');
    if (k && Number.isFinite(score)) parsed[k.trim()] = score;
  }
  return (dims: string[]) => {
    const out: Record<string, number> = {};
    for (const d of dims) out[d] = parsed[d] ?? 9.0;
    return out;
  };
}
