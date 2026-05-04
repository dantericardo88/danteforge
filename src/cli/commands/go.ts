// go - Smart daily driver: state-aware entry point for DanteForge.
// First run: lightweight onboarding + init + first score.
// Existing project: state panel + one recommended next step + optional improvement loop.

import fs from 'node:fs/promises';
import path from 'node:path';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { KNOWN_CEILINGS } from '../../core/compete-matrix.js';
import { runGoWizard } from '../../core/go-wizard.js';
import type { GoWizardOptions, WizardAnswers } from '../../core/go-wizard.js';
import type { SelfImproveOptions, SelfImproveResult } from './self-improve.js';
import type { HarshScoreResult } from '../../core/harsh-scorer.js';
import type { ScoreOptions } from './score.js';
import { BUILDER_DIMENSIONS } from './score.js';
import type { Workflow } from './flow.js';

export interface GoOptions {
  goal?: string;
  yes?: boolean;
  simple?: boolean;
  /** Show status panel only — no wizard, no improvement offer */
  status?: boolean;
  /** Force full wizard even when STATE.yaml exists */
  fresh?: boolean;
  /** Show 5 workflow journey templates (from flow.ts) */
  journey?: boolean;
  /** Run init with IDE detection + adversarial scoring setup */
  advanced?: boolean;
  cwd?: string;
  _runSelfImprove?: (opts: SelfImproveOptions) => Promise<SelfImproveResult>;
  _computeScore?: (cwd: string) => Promise<HarshScoreResult>;
  _stateExists?: (cwd: string) => Promise<boolean>;
  _confirm?: (msg: string) => Promise<boolean>;
  _choiceFn?: (prompt: string) => Promise<string>;
  _stdout?: (line: string) => void;
  _runWizard?: (opts: GoWizardOptions) => Promise<WizardAnswers | null>;
  _isLLMAvailable?: () => Promise<boolean>;
  _initFn?: (opts: { cwd: string; guided: boolean; nonInteractive: boolean; provider: string; projectDescription?: string; preferredLevel?: string; preferLive?: boolean; advanced?: boolean }) => Promise<void>;
  _scoreFn?: (opts: ScoreOptions) => Promise<unknown>;
  _qualityFn?: (opts: { cwd: string; _stdout: (l: string) => void; _isTTY: boolean }) => Promise<void>;
  /** Injection seam — override workflows list for testing */
  _journeysFn?: () => Workflow[];
}

function bar(score: number, width = 10): string {
  const filled = Math.round((score / 10) * width);
  return chalk.green('='.repeat(filled)) + chalk.gray('.'.repeat(width - filled));
}

export function verdict(score: number): string {
  if (score >= 9.0) return chalk.green('excellent');
  if (score >= 8.0) return chalk.green('good');
  if (score >= 7.0) return chalk.yellow('solid');
  if (score >= 5.0) return chalk.yellow('developing');
  return chalk.red('needs attention');
}

const OUTCOME_LANGUAGE: Record<string, { nextMove: string; outcome: string }> = {
  errorHandling: {
    nextMove: 'add safer error messages and recovery paths',
    outcome: 'fewer crashes and clearer failures for users',
  },
  testing: {
    nextMove: 'add tests for the most critical code paths',
    outcome: 'catch bugs before users see them',
  },
  security: {
    nextMove: 'add input validation and rate limiting',
    outcome: 'protect user data from common attacks',
  },
  performance: {
    nextMove: 'identify and remove the slowest bottlenecks',
    outcome: 'faster response times for users',
  },
  documentation: {
    nextMove: 'document the core APIs and getting-started path',
    outcome: 'new contributors can onboard without asking questions',
  },
  maintainability: {
    nextMove: 'reduce coupling and clarify module boundaries',
    outcome: 'changes are safer and faster to make',
  },
  uxPolish: {
    nextMove: 'standardize layouts and fix inconsistent interactions',
    outcome: 'users find the product easier and more trustworthy',
  },
  functionality: {
    nextMove: 'implement the missing core feature',
    outcome: 'users can complete their primary workflow',
  },
  autonomy: {
    nextMove: 'extend the autonomous loop to handle edge cases',
    outcome: 'less manual intervention needed',
  },
  selfImprovement: {
    nextMove: 'add more lessons and reflection checkpoints',
    outcome: 'the system gets smarter with each run',
  },
  specDrivenPipeline: {
    nextMove: 'write a clearer spec and execution plan',
    outcome: 'the build process is predictable and reviewable',
  },
  developerExperience: {
    nextMove: 'improve CLI output clarity and error messages',
    outcome: 'developers can debug faster',
  },
  tokenEconomy: {
    nextMove: 'reduce redundant LLM calls with smarter caching',
    outcome: 'same quality at lower cost',
  },
  convergenceSelfHealing: {
    nextMove: 'add retry logic and self-correction steps',
    outcome: 'failures recover automatically instead of stopping',
  },
  planningQuality: {
    nextMove: 'improve task decomposition and dependency ordering',
    outcome: 'less rework and fewer blocked steps',
  },
  communityAdoption: {
    nextMove: 'publish to npm, write contributor guides, and share examples publicly',
    outcome: 'more users and contributors discover and trust the project',
  },
  enterpriseReadiness: {
    nextMove: 'document deployment patterns, SLAs, and compliance controls',
    outcome: 'enterprise teams can evaluate and adopt the project confidently',
  },
  mcpIntegration: {
    nextMove: 'wire the MCP server tools and validate with a real MCP client',
    outcome: 'Claude Code and other MCP-compatible tools can invoke your commands directly',
  },
};

function showJourneys(emit: (l: string) => void, workflows: Workflow[]): void {
  emit('');
  emit(chalk.bold('  DanteForge — Workflow Journeys'));
  emit('  -------------------------------------------------');
  emit('');
  for (let i = 0; i < workflows.length; i++) {
    const w = workflows[i]!;
    emit(`  ${i + 1}. ${chalk.bold(w.label)}`);
    emit(`     ${w.useWhen}`);
    emit(`     ${chalk.dim('->')} ${w.steps.join(' → ')}`);
    emit('');
  }
  emit('  -------------------------------------------------');
  emit('');
}

function showWelcomeBanner(emit: (l: string) => void): void {
  emit('');
  emit(chalk.bold('  Welcome to DanteForge'));
  emit('  -------------------------------------------------');
  emit('');
  emit('  No project found in this directory.');
  emit('');
  emit('  We will ask 3 quick questions, save your setup, and show your first score.');
  emit('');
  emit('  Prefer to start manually?');
  emit('');
  emit(chalk.cyan('    danteforge init') + '    - guided setup');
  emit('');
  emit('  Or see what improvement looks like:');
  emit('');
  emit(chalk.cyan('    danteforge demo') + '    - before/after quality demo (no setup needed)');
  emit('');
  emit('  Or see a live example:');
  emit('');
  emit(chalk.cyan('    cd examples/todo-app && danteforge dashboard'));
  emit('');
  emit('  -------------------------------------------------');
  emit('');
}

function showStatePanel(result: HarshScoreResult, emit: (l: string) => void, simple = false): void {
  const score = result.displayScore;
  const dims = result.displayDimensions ?? {};

  // In simple mode, only surface builder dimensions so meta/ecosystem gaps don't dominate
  const allGaps = Object.entries(dims)
    .filter(([, v]) => v < 7.0)
    .sort(([, a], [, b]) => a - b);
  const builderGaps = allGaps.filter(([d]) => BUILDER_DIMENSIONS.has(d as never));
  const p0Dims = simple
    ? builderGaps.slice(0, 3)
    : [...builderGaps, ...allGaps.filter(([d]) => !BUILDER_DIMENSIONS.has(d as never))].slice(0, 3);

  emit('');
  emit(chalk.bold('  DanteForge - Project State'));
  emit('  -------------------------------------------------');
  emit('');

  // Lead with the outcome-first recommendation so the most actionable info appears first
  if (p0Dims.length > 0) {
    const [topDimId, topScore] = p0Dims[0]!;
    const topLabel = topDimId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const lang = OUTCOME_LANGUAGE[topDimId];
    emit('  Recommended next step:');
    emit(`    Your project is weakest at ${chalk.bold(topLabel)}.`);
    if (lang) {
      emit(`    Best next move:   ${lang.nextMove}.`);
      emit(`    Expected outcome: ${lang.outcome}.`);
    } else {
      emit(`    Current score: ${topScore.toFixed(1)}/10 — one improvement cycle will target this gap.`);
    }
    emit(`    ${chalk.dim('->')} ${chalk.cyan(`danteforge improve "${topLabel.toLowerCase()}"`)}`);
  } else {
    emit('  All tracked dimensions at 7.0+.');
    emit(`    Push to 9.0+ with ${chalk.cyan('danteforge auto-improve')} (autonomous loop).`);
  }
  emit('');

  // Score and gaps as secondary metadata
  emit(`  Overall  ${chalk.bold(score.toFixed(1) + '/10')}  ${verdict(score)}`);
  emit('');

  if (p0Dims.length > 0) {
    emit('  ' + chalk.yellow('P0 gaps') + ' (below 7.0):');
    for (const [dimId, dimScore] of p0Dims) {
      const label = dimId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      emit(`    ${label.padEnd(26)}${bar(dimScore, 8)}  ${dimScore.toFixed(1)}`);
    }
    emit('');
  }

  if (!simple) {
    const ceilingEntries = Object.entries(KNOWN_CEILINGS);
    if (ceilingEntries.length > 0) {
      emit('  ' + chalk.gray('Ceilings') + ' (cannot auto-improve past):');
      for (const [dimId, { ceiling, reason }] of ceilingEntries) {
        const label = dimId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        const self = dims[dimId as keyof typeof dims] ?? ceiling;
        emit(`    ${label.padEnd(26)}${self.toFixed(1)}/10  !  ${reason.slice(0, 50)}`);
      }
      emit('');
    }
  }

  emit(`  ${chalk.dim('Unfamiliar with a term?')}  ${chalk.cyan('danteforge explain <term>')}`);
  emit('  -------------------------------------------------');
  emit('');
}

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

async function defaultChoiceFn(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) return '2';
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
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

async function handleNewProject(options: GoOptions, cwd: string, emit: (line: string) => void): Promise<void> {
  showWelcomeBanner(emit);
  const runWizardFn = options._runWizard ?? runGoWizard;
  const answers = await runWizardFn({ _isTTY: process.stdout.isTTY, _stdout: emit });
  if (!answers) return;
  try {
    const initFn = options._initFn ?? (async (opts) => {
      const { init } = await import('./init.js');
      await init(opts as import('./init.js').InitOptions);
    });
    await initFn({ cwd, guided: false, nonInteractive: true, provider: answers.provider, projectDescription: answers.description, preferredLevel: answers.preferredLevel, preferLive: answers.startMode === 'live', ...(options.advanced ? { advanced: true } : {}) });
  } catch (err) { logger.warn(`[Go] Init failed: ${String(err)}`); }
  try {
    if (options._scoreFn) { await options._scoreFn({ cwd, _stdout: emit }); }
    else if (options._qualityFn) { await options._qualityFn({ cwd, _stdout: emit, _isTTY: false }); }
    else { const { score } = await import('./score.js'); await score({ cwd, _stdout: emit }); }
  } catch (err) { logger.warn(`[Go] First score failed: ${String(err)}`); }
  emit('');
  emit('  Setup complete. Run ' + chalk.cyan('danteforge go') + ' anytime to see your state again.');
  emit('  If you want hands-off improvement, run ' + chalk.cyan('danteforge auto-improve') + '.');
  emit('');
}

async function askImprovementChoice(
  options: GoOptions,
  emit: (line: string) => void,
  choiceFn: (prompt: string) => Promise<string>,
): Promise<number | null> {
  emit('  What would you like to do?');
  emit('    1. Review only           — see full score details, no changes made');
  emit('    2. Apply one improvement — targeted cycle, ~2-3 min  (recommended)');
  emit('    3. Run auto-improve      — autonomous loop, 5-20 min');
  emit('    Enter to skip');
  const choice = await choiceFn('  Your choice [2]: ');
  if (choice === '1' || choice === '') {
    if (choice === '1') { emit(''); emit('  Full score breakdown: ' + chalk.cyan('danteforge score --full')); }
    emit('');
    emit('  When you\'re ready: ' + chalk.cyan('danteforge improve "<goal>"') + ' or ' + chalk.cyan('danteforge auto-improve'));
    emit('');
    return null;
  }
  if (choice === '3') {
    emit(''); emit('  Starting autonomous improvement loop — target: 9.0/10, max 3 cycles');
    return 3;
  }
  emit(''); emit('  Applying one targeted improvement cycle...');
  return 1;
}

export async function go(options: GoOptions = {}): Promise<void> {
  const emit = options._stdout ?? ((line: string) => process.stdout.write(line + '\n'));
  const cwd = options.cwd ?? process.cwd();

  const stateExistsFn = options._stateExists ?? defaultStateExists;
  const computeScoreFn = options._computeScore ?? defaultComputeScore;
  const confirmFn = options._confirm ?? defaultConfirm;
  const choiceFn = options._choiceFn ?? defaultChoiceFn;
  const runSelfImproveFn = options._runSelfImprove ?? defaultRunSelfImprove;

  // --journey: show workflow journey templates, then exit
  if (options.journey) {
    let workflows: Workflow[];
    if (options._journeysFn) {
      workflows = options._journeysFn();
    } else {
      const { WORKFLOWS } = await import('./flow.js');
      workflows = WORKFLOWS;
    }
    showJourneys(emit, workflows);
    return;
  }

  // --fresh: force new-project wizard regardless of existing state
  if (options.fresh) {
    await handleNewProject(options, cwd, emit);
    return;
  }

  const hasState = await stateExistsFn(cwd);
  if (!hasState) { await handleNewProject(options, cwd, emit); return; }

  let scoreResult: HarshScoreResult;
  try {
    scoreResult = await computeScoreFn(cwd);
  } catch {
    emit('');
    emit('  Project found. Run ' + chalk.cyan('danteforge score') + ' to see your score.');
    emit('');
    return;
  }

  showStatePanel(scoreResult, emit, options.simple ?? false);

  // --status: show panel only, no improvement offer
  if (options.status) return;

  try {
    const isLLMAvailableFn = options._isLLMAvailable ?? (async () => {
      const { isLLMAvailable } = await import('../../core/llm.js');
      return isLLMAvailable();
    });
    const llmOk = await isLLMAvailableFn().catch(() => false);
    if (!llmOk) {
      emit('');
      emit('  ' + chalk.yellow('No LLM detected.') + ' Improvement loops need one.');
      emit('  Run ' + chalk.cyan('danteforge doctor') + ' to diagnose, or ' +
           chalk.cyan('danteforge config') + ' to set a provider.');
      emit('');
    }
  } catch {
    // best effort
  }

  let maxCycles = 3;

  if (!options.yes) {
    const cycles = await askImprovementChoice(options, emit, choiceFn);
    if (cycles === null) return;
    maxCycles = cycles;
    emit('');
  }

  const result = await runSelfImproveFn({
    goal: options.goal,
    maxCycles,
    minScore: 9.0,
    cwd,
  });

  emit('');
  emit(`  Before: ${result.initialScore.toFixed(1)}/10`);
  emit(`  After:  ${result.finalScore.toFixed(1)}/10  (${result.cyclesRun} cycle${result.cyclesRun !== 1 ? 's' : ''})`);

  if (result.achieved) {
    emit('  ' + chalk.green('Target reached - 9.0+ achieved.'));
  } else {
    const reason = result.stopReason === 'plateau-unresolved'
      ? 'Plateau detected - try ' + chalk.cyan('danteforge inferno') + ' for deeper work.'
      : `Stopped after ${result.cyclesRun} cycles. Run again to continue.`;
    emit(`  ${reason}`);
  }
  emit('');
}
