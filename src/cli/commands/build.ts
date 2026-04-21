// build — Guided spec-to-ship wizard.
// Usage: danteforge build "create a REST API with auth"
// Runs the full pipeline: constitution → specify → clarify → plan → tasks → forge → verify → score.
// Completed stages are detected from filesystem and skipped automatically.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import type { ScoreOptions, ScoreResult } from './score.js';
import type { DanteState } from '../../core/state.js';
import { loadState } from '../../core/state.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type BuildStage =
  | 'constitution' | 'specify' | 'clarify' | 'plan' | 'tasks'
  | 'forge' | 'verify' | 'score';

export interface BuildOptions {
  spec: string;
  cwd?: string;
  interactive?: boolean;
  // Injection seams
  _detectStages?: (cwd: string) => Promise<Set<BuildStage>>;
  _runStage?: (stage: BuildStage, spec: string, cwd: string) => Promise<boolean>;
  _confirm?: (message: string) => Promise<boolean>;
  _runScore?: (opts: ScoreOptions) => Promise<ScoreResult>;
  _loadState?: typeof loadState;
  _stdout?: (line: string) => void;
}

export interface BuildResult {
  stagesRun: BuildStage[];
  stagesSkipped: BuildStage[];
  entryScore: number;
  exitScore: number;
}

// ── Stage order ───────────────────────────────────────────────────────────────

const STAGE_ORDER: BuildStage[] = [
  'constitution', 'specify', 'clarify', 'plan', 'tasks',
  'forge', 'verify', 'score',
];

const STAGE_LABELS: Record<BuildStage, string> = {
  constitution: 'Constitution  — define project values and constraints',
  specify:      'Specify       — write structured requirements',
  clarify:      'Clarify       — resolve ambiguities',
  plan:         'Plan          — create execution waves',
  tasks:        'Tasks         — break plan into tasks',
  forge:        'Forge         — implement the code',
  verify:       'Verify        — run tests and quality gates',
  score:        'Score         — measure final quality',
};

// ── Detect completed stages from filesystem ───────────────────────────────────

export async function detectCompletedStages(cwd: string): Promise<Set<BuildStage>> {
  const completed = new Set<BuildStage>();
  const danteDir = path.join(cwd, '.danteforge');

  async function exists(file: string): Promise<boolean> {
    try { await fs.access(file); return true; } catch { return false; }
  }

  if (await exists(path.join(cwd, 'CONSTITUTION.md'))) completed.add('constitution');
  if (await exists(path.join(cwd, 'SPEC.md'))) completed.add('specify');
  if (await exists(path.join(cwd, 'CLARIFY.md'))) completed.add('clarify');
  if (await exists(path.join(cwd, 'PLAN.md'))) completed.add('plan');
  if (await exists(path.join(cwd, 'TASKS.md'))) completed.add('tasks');

  // forge: check for any source files beyond the danteforge dir
  try {
    const entries = await fs.readdir(cwd);
    const hasSrc = entries.some(e => ['src', 'lib', 'app', 'index.ts', 'index.js', 'main.ts'].includes(e));
    if (hasSrc) completed.add('forge');
  } catch { /* ignore */ }

  // verify: require fresh verify evidence when it exists
  try {
    const state = await loadState({ cwd });
    const verifyPassed = state.verifyEvidence
      ? state.verifyEvidence.status === 'pass' && state.verifyEvidence.fresh
      : state.lastVerifyStatus === 'pass';
    if (verifyPassed) completed.add('verify');
  } catch { /* ignore */ }

  return completed;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function build(options: BuildOptions): Promise<BuildResult> {
  const emit = options._stdout ?? ((line: string) => logger.info(line));
  const cwd = options.cwd ?? process.cwd();
  const interactive = options.interactive ?? false;

  const detectStagesFn = options._detectStages ?? detectCompletedStages;
  const runStageFn = options._runStage ?? defaultRunStage;
  const confirmFn = options._confirm ?? defaultConfirm;
  const runScoreFn = options._runScore ?? defaultRunScore;

  emit('');
  emit(`  Build: "${options.spec}"`);
  emit('');

  // Entry score
  let entryScore = 0;
  try {
    const scoreResult = await runScoreFn({ cwd, _stdout: () => {} });
    entryScore = scoreResult.displayScore;
    emit(`  Entry score: ${entryScore.toFixed(1)}/10`);
  } catch { /* best-effort */ }

  const completed = await detectStagesFn(cwd);
  const stagesRun: BuildStage[] = [];
  const stagesSkipped: BuildStage[] = [];

  emit('');
  emit('  Pipeline:');
  for (const stage of STAGE_ORDER) {
    if (stage === 'score') continue; // score runs at the end always
    const label = STAGE_LABELS[stage];
    if (completed.has(stage)) {
      emit(`    [SKIP] ${label}`);
      stagesSkipped.push(stage);
      continue;
    }
    emit(`    [RUN]  ${label}`);
  }
  emit('');

  // Execute pending stages
  for (const stage of STAGE_ORDER) {
    if (stage === 'score') continue;
    if (completed.has(stage)) continue;

    if (interactive) {
      const yes = await confirmFn(`  Run stage: ${stage}? (Y/n)`);
      if (!yes) {
        emit(`  Stopped at: ${stage}`);
        break;
      }
    }

    emit(`  Running: ${stage}...`);
    let ok = false;
    try {
      ok = await runStageFn(stage, options.spec, cwd);
    } catch {
      ok = false;
    }
    if (ok) {
      stagesRun.push(stage);
      emit(`  Done: ${stage}`);
    } else {
      emit(`  Failed: ${stage} — stopping pipeline.`);
      break;
    }
    emit('');
  }

  // Exit score
  let exitScore = entryScore;
  try {
    const scoreResult = await runScoreFn({ cwd, _stdout: () => {} });
    exitScore = scoreResult.displayScore;
    emit(`  Exit score: ${exitScore.toFixed(1)}/10  (${exitScore >= entryScore ? '+' : ''}${(exitScore - entryScore).toFixed(1)} from baseline)`);
  } catch { /* best-effort */ }

  stagesSkipped.push(...STAGE_ORDER.filter(s => !stagesRun.includes(s) && !stagesSkipped.includes(s) && s !== 'score'));

  emit('');
  return { stagesRun, stagesSkipped, entryScore, exitScore };
}

// ── Defaults ──────────────────────────────────────────────────────────────────

/**
 * Production stage runner — dynamically imports each CLI command and calls it directly.
 * Uses `light: true` on all stages so gates don't block the pipeline mid-wizard.
 */
async function defaultRunStage(stage: BuildStage, spec: string, _cwd: string): Promise<boolean> {
  try {
    switch (stage) {
      case 'constitution': {
        const { constitution } = await import('./constitution.js');
        await constitution();
        return true;
      }
      case 'specify': {
        const { specify } = await import('./specify.js');
        await specify(spec);
        return true;
      }
      case 'clarify': {
        const { clarify } = await import('./clarify.js');
        await clarify({ light: true });
        return true;
      }
      case 'plan': {
        const { plan } = await import('./plan.js');
        await plan({ light: true });
        return true;
      }
      case 'tasks': {
        const { tasks } = await import('./tasks.js');
        await tasks({ light: true });
        return true;
      }
      case 'forge': {
        const { forge } = await import('./forge.js');
        await forge('1', { profile: 'balanced', light: true });
        return true;
      }
      case 'verify': {
        const { verify } = await import('./verify.js');
        await verify();
        return true;
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

async function defaultConfirm(_message: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<boolean>((resolve) => {
    rl.question('Run this stage? [Y/n] ', (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() !== 'n');
    });
  });
}

async function defaultRunScore(opts: ScoreOptions): Promise<ScoreResult> {
  const { score } = await import('./score.js');
  return score(opts);
}
