/**
 * `danteforge truth-loop run` command — wires the spine runner into the CLI.
 * PRD-26 §5.3 contract.
 */

import { resolve } from 'node:path';
import { logger } from '../../core/logger.js';
import { runTruthLoop, type RunnerOptions } from '../../spine/truth_loop/runner.js';
import type { Strictness } from '../../spine/truth_loop/types.js';

export interface TruthLoopFlags {
  repo?: string;
  objective?: string;
  critics?: string;
  critiqueFile?: string[];
  budgetUsd?: string;
  budgetMinutes?: string;
  mode?: 'sequential' | 'parallel';
  strictness?: Strictness;
  out?: string;
  initiator?: 'founder' | 'agent' | 'ci';
  hardware?: 'rtx_4060_laptop' | 'rtx_3090_workstation' | 'cloud_runner' | 'ci_only';
  skipTests?: boolean;
  testCommand?: string;
}

const VALID_SOURCES = new Set(['codex', 'claude', 'grok', 'gemini', 'human']);

export async function truthLoopRun(flags: TruthLoopFlags): Promise<{ exitCode: number; runDir: string | null }> {
  const repo = resolve(flags.repo ?? process.cwd());
  const objective = (flags.objective ?? '').trim();
  if (!objective) {
    logger.error('truth-loop: --objective is required');
    return { exitCode: 2, runDir: null };
  }

  const critics = (flags.critics ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  if (critics.length === 0) {
    logger.error('truth-loop: at least one --critics value is required');
    return { exitCode: 2, runDir: null };
  }

  const critiqueFiles = parseCritiqueFiles(flags.critiqueFile ?? [], critics);
  if ('error' in critiqueFiles) {
    logger.error(`truth-loop: ${critiqueFiles.error}`);
    return { exitCode: 2, runDir: null };
  }

  const budgetUsd = Number.parseFloat(flags.budgetUsd ?? '5');
  if (!Number.isFinite(budgetUsd) || budgetUsd < 0) {
    logger.error('truth-loop: --budget-usd must be a non-negative number');
    return { exitCode: 2, runDir: null };
  }

  const opts: RunnerOptions = {
    repo,
    objective,
    critics,
    critiqueFiles: critiqueFiles.value,
    budgetUsd,
    budgetMinutes: flags.budgetMinutes ? Number.parseFloat(flags.budgetMinutes) : undefined,
    mode: flags.mode ?? 'sequential',
    strictness: flags.strictness ?? 'standard',
    outDir: flags.out ? resolve(flags.out) : undefined,
    initiator: flags.initiator ?? 'founder',
    hardwareProfile: flags.hardware ?? 'rtx_4060_laptop',
    skipTests: flags.skipTests === true,
    testCommand: flags.testCommand ? splitTestCommand(flags.testCommand) : undefined
  };

  let result;
  try {
    result = await runTruthLoop(opts);
  } catch (err) {
    logger.error(`truth-loop failed: ${(err as Error).message}`);
    return { exitCode: 1, runDir: null };
  }

  logger.info(`truth-loop ${result.run.runId} → ${result.verdict.finalStatus} (score ${result.verdict.score.toFixed(2)})`);
  logger.info(`  artifacts: ${result.runDir}`);
  logger.info(`  next action: ${result.nextAction.priority} — ${result.nextAction.title}`);

  const exitCode = result.verdict.finalStatus === 'complete' ? 0 :
    result.verdict.finalStatus === 'progress_real_but_not_done' ? 0 : 1;
  return { exitCode, runDir: result.runDir };
}

interface ParsedCritiqueFile {
  source: 'codex' | 'claude' | 'grok' | 'gemini' | 'human';
  path: string;
}

function parseCritiqueFiles(raw: string[], critics: string[]): { value: ParsedCritiqueFile[] } | { error: string } {
  const out: ParsedCritiqueFile[] = [];
  raw.forEach((entry, idx) => {
    const explicitMatch = /^([a-z]+)=(.+)$/.exec(entry);
    if (explicitMatch) {
      const source = explicitMatch[1] as ParsedCritiqueFile['source'];
      if (!VALID_SOURCES.has(source)) {
        out.push({ source: 'human', path: entry });
        return;
      }
      out.push({ source, path: resolve(explicitMatch[2] ?? '') });
      return;
    }
    const critic = critics[idx];
    const source = (critic && VALID_SOURCES.has(critic) ? critic : 'human') as ParsedCritiqueFile['source'];
    out.push({ source, path: resolve(entry) });
  });
  return { value: out };
}

function splitTestCommand(raw: string): { cmd: string; args: string[] } {
  const parts = raw.trim().split(/\s+/);
  const [cmd, ...args] = parts;
  return { cmd: cmd ?? 'npm', args };
}
