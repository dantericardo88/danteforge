// go — Smart daily driver: state-aware entry point for DanteForge.
// First run (no STATE.yaml): welcome banner + redirect to init.
// Existing project: state panel (score + gaps + ceilings) + confirm + self-improve.
// Usage: danteforge go [--yes]

import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { KNOWN_CEILINGS } from '../../core/compete-matrix.js';
import { runGoWizard } from '../../core/go-wizard.js';
import type { GoWizardOptions, WizardAnswers } from '../../core/go-wizard.js';
import type { SelfImproveOptions, SelfImproveResult } from './self-improve.js';
import type { HarshScoreResult } from '../../core/harsh-scorer.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GoOptions {
  goal?: string;
  yes?: boolean;
  cwd?: string;
  // Injection seams
  _runSelfImprove?: (opts: SelfImproveOptions) => Promise<SelfImproveResult>;
  _computeScore?: (cwd: string) => Promise<HarshScoreResult>;
  _stateExists?: (cwd: string) => Promise<boolean>;
  _confirm?: (msg: string) => Promise<boolean>;
  _stdout?: (line: string) => void;
  _runWizard?: (opts: GoWizardOptions) => Promise<WizardAnswers | null>;
  _isLLMAvailable?: () => Promise<boolean>;
  _initFn?: (opts: { cwd: string; guided: boolean; nonInteractive: boolean; provider: string }) => Promise<void>;
  _qualityFn?: (opts: { cwd: string; _stdout: (l: string) => void; _isTTY: boolean }) => Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bar(score: number, width = 10): string {
  const filled = Math.round((score / 10) * width);
  return chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(width - filled));
}

function verdict(score: number): string {
  if (score >= 9.0) return chalk.green('excellent');
  if (score >= 8.0) return chalk.green('good');
  if (score >= 7.0) return chalk.yellow('needs-work');
  if (score >= 5.0) return chalk.yellow('developing');
  return chalk.red('critical');
}

// ── First-run banner ──────────────────────────────────────────────────────────

function showWelcomeBanner(emit: (l: string) => void): void {
  emit('');
  emit(chalk.bold('  Welcome to DanteForge'));
  emit('  ─────────────────────────────────────────────────');
  emit('');
  emit('  No project found in this directory.');
  emit('');
  emit('  To get started:');
  emit('');
  emit(chalk.cyan('    danteforge init') + '    — guided setup (2 min)');
  emit('');
  emit('  Or see a live example:');
  emit('');
  emit(chalk.cyan('    cd examples/todo-app && danteforge dashboard'));
  emit('');
  emit('  ─────────────────────────────────────────────────');
  emit('');
}

// ── State panel ───────────────────────────────────────────────────────────────

function showStatePanel(result: HarshScoreResult, emit: (l: string) => void): void {
  const score = result.displayScore;
  const dims = result.displayDimensions ?? {};

  emit('');
  emit(chalk.bold('  DanteForge  —  Project State'));
  emit('  ─────────────────────────────────────────────────');
  emit('');
  emit(`  Overall  ${chalk.bold(score.toFixed(1) + '/10')}  ${verdict(score)}`);
  emit('');

  // P0 gaps: dimensions below 7.0
  const p0Dims = Object.entries(dims)
    .filter(([, v]) => v < 7.0)
    .sort(([, a], [, b]) => a - b)
    .slice(0, 3);

  if (p0Dims.length > 0) {
    emit('  ' + chalk.yellow('P0 gaps') + ' (below 7.0):');
    for (const [dimId, dimScore] of p0Dims) {
      const label = dimId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      emit(`    ${label.padEnd(26)}${bar(dimScore, 8)}  ${dimScore.toFixed(1)}`);
    }
    emit('');
  }

  // Ceiling dims from KNOWN_CEILINGS
  const ceilingEntries = Object.entries(KNOWN_CEILINGS);
  if (ceilingEntries.length > 0) {
    emit('  ' + chalk.gray('Ceilings') + ' (cannot auto-improve past):');
    for (const [dimId, { ceiling, reason }] of ceilingEntries) {
      const label = dimId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const self = dims[dimId as keyof typeof dims] ?? ceiling;
      emit(`    ${label.padEnd(26)}${self.toFixed(1)}/10  ⚠  ${reason.slice(0, 50)}`);
    }
    emit('');
  }

  // Recommended next action — plain English first, command second
  if (p0Dims.length > 0) {
    const [topDimId, topScore] = p0Dims[0]!;
    const topLabel = topDimId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    emit(`  Recommended next step:`);
    emit(`    Improve ${chalk.bold(topLabel)}  (currently ${topScore.toFixed(1)}/10)`);
    emit(`    Runs an automated cycle targeting this gap — takes 1-3 minutes.`);
    emit(`    ${chalk.dim('→')} ${chalk.cyan(`danteforge magic "improve ${topLabel.toLowerCase()}"`)}`);
  } else {
    emit(`  All tracked dimensions at 7.0+.`);
    emit(`    Push to 9.0+ with ${chalk.cyan('danteforge ascend')} (autonomous loop).`);
  }
  emit('');
  emit('  ─────────────────────────────────────────────────');
  emit('');
}

// ── Default I/O ───────────────────────────────────────────────────────────────

async function defaultConfirm(msg: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true;
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    rl.question(`${msg} `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== 'n');
    });
  });
}

async function defaultComputeScore(cwd: string): Promise<HarshScoreResult> {
  const { computeHarshScore } = await import('../../core/harsh-scorer.js');
  return computeHarshScore({ cwd });
}

async function defaultStateExists(cwd: string): Promise<boolean> {
  try {
    await fs.access(path.join(cwd, '.danteforge', 'STATE.yaml'));
    return true;
  } catch {
    return false;
  }
}

async function defaultRunSelfImprove(opts: SelfImproveOptions): Promise<SelfImproveResult> {
  const { selfImprove } = await import('./self-improve.js');
  return selfImprove(opts);
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function go(options: GoOptions = {}): Promise<void> {
  const emit = options._stdout ?? ((line: string) => process.stdout.write(line + '\n'));
  const cwd = options.cwd ?? process.cwd();

  const stateExistsFn = options._stateExists ?? defaultStateExists;
  const computeScoreFn = options._computeScore ?? defaultComputeScore;
  const confirmFn = options._confirm ?? defaultConfirm;
  const runSelfImproveFn = options._runSelfImprove ?? defaultRunSelfImprove;

  const hasState = await stateExistsFn(cwd);

  if (!hasState) {
    showWelcomeBanner(emit);
    const runWizardFn = options._runWizard ?? runGoWizard;
    const answers = await runWizardFn({ _isTTY: process.stdout.isTTY, _stdout: emit });
    if (answers) {
      try {
        const initFn = options._initFn ?? (async (opts) => {
          const { init } = await import('./init.js');
          await init(opts as import('./init.js').InitOptions);
        });
        await initFn({
          cwd,
          guided: false,
          nonInteractive: true,
          provider: answers.provider as import('../../core/config.js').LLMProvider,
        });
      } catch (err) {
        logger.warn(`[Go] Init failed: ${String(err)}`);
      }
      try {
        const qualityFn = options._qualityFn ?? (async (opts) => {
          const { quality } = await import('./quality.js');
          await quality(opts as import('./quality.js').QualityOptions);
        });
        await qualityFn({ cwd, _stdout: emit, _isTTY: false });
      } catch (err) {
        logger.warn(`[Go] Quality score failed: ${String(err)}`);
      }
      emit('');
      emit('  Setup complete. Run ' + chalk.cyan('danteforge ascend') + ' to begin improving.');
      emit('');
    }
    return;
  }

  // Existing project — show state panel
  let scoreResult: HarshScoreResult;
  try {
    scoreResult = await computeScoreFn(cwd);
  } catch {
    // If scoring fails, fall back to simple message
    emit('');
    emit('  Project found. Run ' + chalk.cyan('danteforge score') + ' to see your quality score.');
    emit('');
    return;
  }

  showStatePanel(scoreResult, emit);

  // Quick LLM health check — warn if ascend will fail
  try {
    const isLLMAvailableFn = options._isLLMAvailable ?? (async () => {
      const { isLLMAvailable } = await import('../../core/llm.js');
      return isLLMAvailable();
    });
    const llmOk = await isLLMAvailableFn().catch(() => false);
    if (!llmOk) {
      emit('');
      emit('  ' + chalk.yellow('⚠ No LLM detected.') + ' The improvement loop needs one.');
      emit('  Run ' + chalk.cyan('danteforge doctor') + ' to diagnose, or ' +
           chalk.cyan('danteforge config') + ' to set a provider.');
      emit('');
    }
  } catch { /* best-effort — never block the confirm prompt */ }

  // Confirm before running self-improve
  if (!options.yes) {
    emit('  This will run up to 3 improvement cycles, each targeting your lowest-scoring gap.');
    const ok = await confirmFn('  Start? [Y/n]');
    if (!ok) {
      emit('');
      emit('  Skipped. Run ' + chalk.cyan('danteforge ascend') + ' for the full autonomous loop,');
      emit('  or ' + chalk.cyan('danteforge magic "<goal>"') + ' to target a specific area.');
      emit('');
      return;
    }
  }

  emit('');
  emit('  Starting improvement loop — target: 9.0/10, max 3 cycles');
  emit('');

  const result = await runSelfImproveFn({
    goal: options.goal,
    maxCycles: 3,
    minScore: 9.0,
    cwd,
  });

  emit('');
  emit(`  Before: ${result.initialScore.toFixed(1)}/10`);
  emit(`  After:  ${result.finalScore.toFixed(1)}/10  (${result.cyclesRun} cycle${result.cyclesRun !== 1 ? 's' : ''})`);

  if (result.achieved) {
    emit('  ' + chalk.green('Target reached — 9.0+ achieved.'));
  } else {
    const reason = result.stopReason === 'plateau-unresolved'
      ? 'Plateau detected — try ' + chalk.cyan('danteforge inferno') + ' for deeper work.'
      : `Stopped after ${result.cyclesRun} cycles. Run again to continue.`;
    emit(`  ${reason}`);
  }
  emit('');
}
