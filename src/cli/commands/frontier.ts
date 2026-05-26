// frontier.ts — Phase H Slice 4b.
//
// Reports the project's frontier state: a boolean conjunction per dimension,
// rolled up to one of {frontier-reached, stuck-on-dims, blocked-by-dispensations,
// progressing}. This is the substrate's terminal-state report — what crusade
// will return as its win condition after Phase H Slice 5.

import path from 'node:path';
import fs from 'node:fs/promises';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import { loadOutcomeEvidence } from '../../matrix/engines/outcome-runner.js';
import {
  computeProjectFrontierState,
  type DimensionFrontierResult,
} from '../../core/frontier-state.js';
import type { Outcome } from '../../matrix/types/outcome.js';
import type { CapabilityTier } from '../../matrix/types/capability-test.js';

export type FrontierTerminal =
  | 'frontier-reached'
  | 'progressing'
  | 'stuck-on-dims'
  | 'blocked-by-dispensations';

export interface RunFrontierOptions {
  cwd?: string;
  json?: boolean;
  /** Filter to one dim. */
  dim?: string;
  /** Custom waves-threshold for stuck detection (default 3). */
  stuckThreshold?: number;
  /**
   * CI gate: require the project to be in exactly this terminal state. If
   * provided and the actual state does not match, exit with code 1. When
   * absent, the default behavior is preserved (exit 0 only on frontier-reached).
   */
  requireState?: FrontierTerminal;
  _loadMatrix?: typeof loadMatrix;
}

const DISPENSATION_DIR = path.join('.danteforge', 'score-proposals', 'dispensations');

async function recordFrontierTransition(cwd: string, newTerminal: string, summary: string): Promise<void> {
  try {
    const { loadState, saveState } = await import('../../core/state.js');
    const state = await loadState({ cwd });
    const prior = (state as unknown as Record<string, unknown>)['lastFrontierTerminal'] as string | undefined;
    if (prior === newTerminal) return; // No transition.
    (state as unknown as Record<string, unknown>)['lastFrontierTerminal'] = newTerminal;
    await saveState(state, { cwd });
    if (prior) {
      try {
        const { createTimeMachineCommit } = await import('../../core/time-machine.js');
        await createTimeMachineCommit({
          cwd,
          paths: [],
          label: `frontier-transition/${prior}->${newTerminal}`,
          causalLinks: { materials: [], inputDependencies: [] },
        });
      } catch { /* best-effort */ }
    }
    void summary;
  } catch { /* best-effort — state errors don't change the report */ }
}

async function loadDispensations(cwd: string): Promise<Record<string, string[]>> {
  const dir = path.join(cwd, DISPENSATION_DIR);
  let entries: string[];
  try { entries = await fs.readdir(dir); } catch { return {}; }
  const map: Record<string, string[]> = {};
  const now = Date.now();
  for (const f of entries.filter(n => n.endsWith('.json'))) {
    try {
      const raw = await fs.readFile(path.join(dir, f), 'utf8');
      const parsed = JSON.parse(raw) as { dimensionId?: string; receiptId?: string; cleared?: boolean; expiresAt?: string };
      if (parsed.cleared) continue;
      // TTL: treat expired dispensations as cleared (do not block autonomy).
      if (parsed.expiresAt) {
        const expiry = new Date(parsed.expiresAt).getTime();
        if (Number.isFinite(expiry) && now > expiry) continue;
      }
      const dimId = parsed.dimensionId;
      if (!dimId) continue;
      const list = map[dimId] ?? [];
      list.push(parsed.receiptId ?? f.replace(/\.json$/, ''));
      map[dimId] = list;
    } catch { /* skip */ }
  }
  return map;
}

async function loadWavesSinceProgress(cwd: string): Promise<Record<string, number>> {
  // Read STATE.yaml outcomeRefinementCounts if present (written by the crusade loop).
  // Fall back to empty — every dim has 0 waves recorded.
  try {
    const { loadState } = await import('../../core/state.js');
    const state = await loadState({ cwd });
    const counts = (state as unknown as Record<string, unknown>)['outcomeRefinementCounts'];
    if (counts && typeof counts === 'object' && !Array.isArray(counts)) {
      return counts as Record<string, number>;
    }
  } catch { /* best-effort */ }
  return {};
}

function statusColor(status: DimensionFrontierResult['status']): (s: string) => string {
  switch (status) {
    case 'at-frontier': return chalk.green;
    case 'progressing': return chalk.cyan;
    case 'stuck': return chalk.red;
    case 'blocked-by-dispensation': return chalk.yellow;
    case 'no-outcomes-declared': return chalk.dim;
  }
}

export interface FrontierState {
  terminal: FrontierTerminal;
  summary: string;
  perDimension: DimensionFrontierResult[];
  stuckDims: string[];
  frontierCount: number;
  totalEligible: number;
}

export async function getFrontierState(cwd: string, options: { dim?: string; stuckThreshold?: number; _loadMatrix?: typeof loadMatrix } = {}): Promise<FrontierState> {
  const loadMatrixFn = options._loadMatrix ?? loadMatrix;
  const matrix = await loadMatrixFn(cwd);
  if (!matrix) throw new Error(`No matrix.json at ${cwd}/.danteforge/compete/matrix.json`);

  const evidence = await loadOutcomeEvidence(cwd);
  const dispensations = await loadDispensations(cwd);
  const wavesSinceProgress = await loadWavesSinceProgress(cwd);

  const dims = matrix.dimensions
    .filter(d => !options.dim || d.id === options.dim)
    .map(d => ({
      id: d.id,
      outcomes: (d as unknown as Record<string, unknown>)['outcomes'] as Outcome[] | undefined,
      declared_ceiling: (d as unknown as Record<string, unknown>)['declared_ceiling'] as CapabilityTier | undefined,
      scores: d.scores,
      legacy_score: (d as unknown as Record<string, unknown>)['legacy_score'] as number | undefined,
    }));

  const rawState = computeProjectFrontierState({
    dimensions: dims,
    evidence,
    wavesSinceProgress,
    dispensations,
    stuckThreshold: options.stuckThreshold,
  });

  const frontierCount = rawState.perDimension.filter((d: any) => d.status === 'at-frontier').length;

  return {
    terminal: rawState.terminal,
    summary: rawState.summary,
    perDimension: rawState.perDimension,
    stuckDims: rawState.stuckDims ?? [],
    frontierCount,
    totalEligible: rawState.perDimension.length,
  };
}

export async function runFrontierCommand(options: RunFrontierOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();

  const state = await getFrontierState(cwd, {
    dim: options.dim,
    stuckThreshold: options.stuckThreshold,
  });

  // Phase H Time Machine integration: record terminal-state transitions as
  // causal commits. Reads the prior terminal from DanteState; updates it
  // after recording. Best-effort — TM failures don't change the report.
  await recordFrontierTransition(cwd, state.terminal, state.summary);

  // Exit-code policy:
  // - `requireState` (CI gate): exit 0 iff actual terminal matches the required state.
  // - default: exit 0 iff terminal is 'frontier-reached', else 1.
  const matchesRequired = options.requireState
    ? state.terminal === options.requireState
    : state.terminal === 'frontier-reached';

  if (options.json) {
    process.stdout.write(JSON.stringify(state, null, 2) + '\n');
    process.exitCode = matchesRequired ? 0 : 1;
    return;
  }

  // Human display
  logger.info('');
  logger.info(chalk.bold('Project Frontier State'));
  logger.info(chalk.dim('─'.repeat(60)));
  logger.info('');

  const terminalColor =
    state.terminal === 'frontier-reached' ? chalk.green :
    state.terminal === 'stuck-on-dims' ? chalk.red :
    state.terminal === 'blocked-by-dispensations' ? chalk.yellow :
    chalk.cyan;
  logger.info(`  ${chalk.bold('Terminal state:')} ${terminalColor(state.terminal)}`);
  logger.info(`  ${chalk.dim(state.summary)}`);
  logger.info('');

  // Per-dim table
  for (const r of state.perDimension) {
    const colorFn = statusColor(r.status);
    const tier = r.highestPassedTier ?? '—';
    const ceiling = r.declaredCeiling ?? '(none)';
    logger.info(`  ${colorFn('●')} ${r.dimensionId.padEnd(28)} ${colorFn(r.status.padEnd(24))} score=${chalk.dim(r.derivedScore.toFixed(1))} tier=${chalk.dim(tier)}/${chalk.dim(ceiling)}`);
    if (r.status !== 'at-frontier' && r.status !== 'no-outcomes-declared') {
      logger.info(`      ${chalk.dim(r.reason)}`);
    }
  }
  logger.info('');

  // Help footer
  if (state.terminal === 'blocked-by-dispensations') {
    logger.info(chalk.yellow(`  Action: clear dispensations with \`danteforge dispensation clear\` (Phase H Slice 6 — pending CLI; for now remove files from ${DISPENSATION_DIR}).`));
  } else if (state.terminal === 'stuck-on-dims') {
    logger.info(chalk.red(`  Action: review stuck dims (${state.stuckDims.join(', ')}). Either the outcome design is wrong or the capability is genuinely hard.`));
  } else if (state.terminal === 'progressing') {
    logger.info(chalk.cyan(`  Next: run \`danteforge outcomes\` to refresh evidence, or \`danteforge crusade\` to push toward frontier.`));
  } else if (state.terminal === 'frontier-reached') {
    logger.info(chalk.green(`  Done. Every eligible dim is at frontier. Time to use the system on real work for a while.`));
  }
  logger.info('');

  process.exitCode = matchesRequired ? 0 : 1;
  if (options.requireState && !matchesRequired) {
    logger.warn(`  CI gate: required state "${options.requireState}", got "${state.terminal}". Exit 1.`);
  }
}

// ---------------------------------------------------------------------------
// Autonomous Drive Mode — the "1 command until 50-100 dimension frontier"
// ---------------------------------------------------------------------------

export interface FrontierDriveOptions {
  cwd?: string;
  targetDims?: number;        // Goal number of dims at strict frontier (default 50)
  targetScore?: number;       // Per-dim target passed to inner crusade (default 9.0)
  parallel?: number;
  maxOuterCycles?: number;    // Safety cap on the outer attainment loop
  timeMinutes?: number;
  json?: boolean;
}

export async function runFrontierDrive(options: FrontierDriveOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const targetDims = options.targetDims ?? 50;
  const targetScore = options.targetScore ?? 9.0;
  const parallel = options.parallel ?? 4;
  const maxOuterCycles = options.maxOuterCycles ?? 20;
  const timeMinutes = options.timeMinutes ?? 45;

  logger.info(chalk.bold('\n=== DanteForge Frontier Drive ==='));
  logger.info(`Target: ${targetDims} dimensions at genuine frontier (score ≥ ${targetScore})`);
  logger.info('Protocol: review → matrix health → harden-crusade loops → strict frontier gate enforcement\n');

  // === Automatic Review Phase (vision alignment) ===
  logger.info(chalk.cyan('[Phase 0] Running project review...'));
  try {
    const { spawnSync } = await import('node:child_process');
    const result = spawnSync('node', [process.argv[1] || 'dist/index.js', 'review', '--light'], {
      cwd,
      stdio: 'inherit',
      encoding: 'utf8',
    });
    if (result.status === 0) {
      logger.info(chalk.dim('Review complete.\n'));
    }
  } catch (err) {
    logger.warn(`Automatic review step had an issue. You can run it manually: danteforge review`);
  }

  // Pre-flight matrix health check
  try {
    const matrix = await loadMatrix(cwd);
    const currentDimCount = matrix?.dimensions?.length ?? 0;

    if (!matrix || currentDimCount === 0) {
      logger.warn('No competitive matrix found. The frontier drive works best when dimensions are defined.');
      logger.info('Recommended: danteforge compete --init   (or danteforge universe to explore)');
      logger.info('You can re-run `danteforge frontier --drive` after expansion.');
    } else if (currentDimCount < Math.floor(targetDims * 0.65)) {
      logger.warn(`Matrix has only ${currentDimCount} dimensions. Target of ${targetDims} will be difficult without expansion.`);
      logger.info('Strongly recommended before continuing: danteforge compete --init');
      logger.info('This synthesizes additional dimensions by studying OSS leaders + closed-source references.');
    } else {
      logger.info(chalk.dim(`Matrix health OK: ${currentDimCount} dimensions present.`));
    }
  } catch { /* non-fatal */ }

  let outerCycle = 0;
  let achieved = 0;
  let previousAchieved = 0;
  let stagnantCycles = 0;

  for (outerCycle = 1; outerCycle <= maxOuterCycles; outerCycle++) {
    logger.info(chalk.cyan(`\n[Cycle ${outerCycle}/${maxOuterCycles}] Launching hardened crusade...`));

    try {
      const { runHardenCrusade } = await import('./harden-crusade.js');
      await runHardenCrusade({
        goal: `Autonomous drive toward ${targetDims} dimensions at frontier (score ${targetScore}+)`,
        parallel,
        target: targetScore,
        maxDimCycles: 8,
        timeMinutes,
        loop: true,
        cwd,
        skipCIP: false,
      });
    } catch (err) {
      logger.warn(`Inner crusade cycle failed: ${err instanceof Error ? err.message : err}`);
    }

    logger.info(chalk.dim('Evaluating strict frontier state...'));

    const state = await getFrontierState(cwd);
    achieved = state.frontierCount;

    // Simple stagnation detection for escalation guidance
    if (achieved <= previousAchieved) {
      stagnantCycles++;
    } else {
      stagnantCycles = 0;
    }
    previousAchieved = achieved;

    if (stagnantCycles >= 3) {
      logger.warn(`No frontier progress for ${stagnantCycles} cycles.`);
      logger.info('Consider escalation: run `danteforge cross-synthesize` or `danteforge ascend` on the weakest dimensions.');
    }

    // Periodic proof for visible progress tracking
    if (outerCycle % 2 === 0) {
      try {
        logger.info(chalk.dim('Capturing proof delta...'));
        const { spawnSync } = await import('node:child_process');
        spawnSync('node', [process.argv[1] || 'dist/index.js', 'proof', '--since', 'last'], {
          cwd,
          stdio: 'inherit',
        });
      } catch { /* best effort */ }
    }

    // Write rich progress artifact
    try {
      const progress = {
        timestamp: new Date().toISOString(),
        outerCycle,
        targetDims,
        currentFrontierCount: achieved,
        terminal: state.terminal,
        summary: state.summary,
        stuckDims: state.stuckDims,
        recommendation: state.terminal === 'stuck-on-dims'
          ? 'Review stuck dimensions and either refine outcomes or accept natural ceiling.'
          : state.terminal === 'progressing'
            ? 'Continue drive or run targeted work on weakest dimensions.'
            : 'System is healthy — consider raising target or expanding the competitive universe.',
      };
      await fs.writeFile(
        path.join(cwd, '.danteforge', 'FRONTIER_PROGRESS.json'),
        JSON.stringify(progress, null, 2),
        'utf8'
      );

      // Also write a human-readable summary
      const md = [
        `# Frontier Drive Progress — Cycle ${outerCycle}`,
        '',
        `**Timestamp:** ${progress.timestamp}`,
        `**Frontier Count:** ${achieved} / ${targetDims}`,
        `**Terminal State:** ${state.terminal}`,
        '',
        `**Summary:** ${state.summary}`,
        '',
        state.stuckDims.length > 0 ? `**Stuck Dimensions:** ${state.stuckDims.join(', ')}` : '',
        '',
        `**Recommendation:** ${progress.recommendation}`,
        '',
        'Run `danteforge frontier` for the latest detailed view.',
      ].filter(Boolean).join('\n');

      await fs.writeFile(path.join(cwd, '.danteforge', 'FRONTIER_PROGRESS.md'), md, 'utf8');
      logger.info(chalk.dim(`Progress written to .danteforge/FRONTIER_PROGRESS.json + .md (${achieved}/${targetDims})`));
    } catch { /* best effort */ }

    logger.info(`Current strict frontier count: ${chalk.bold(achieved)} / ${targetDims}`);

    if (achieved >= targetDims) {
      logger.info(chalk.green.bold('\n✓ FRONTIER ATTAINED'));
      logger.info(`${achieved} dimensions meet the full doctrine criteria.`);
      process.exitCode = 0;
      return;
    }

    logger.info(chalk.dim('Not yet at target scale. Beginning next cycle...\n'));
  }

  logger.warn(`\nMax outer cycles reached (${maxOuterCycles}) with ${achieved}/${targetDims} at frontier.`);
  logger.info('Inspect with `danteforge frontier`, address blockers, then re-run `--drive`.');
  process.exitCode = 1;
}
