// goal-loop-engine.ts — Cross-project autonomous scoring loop engine.
// Rotates across registered projects, running compete --auto until all
// dimensions reach target. Writes per-project GOAL_STATUS.json so
// Claude Code's /goal reads an exit code, not an LLM opinion.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';
import { loadMatrix, getMatrixPath } from './compete-matrix.js';
import { loadProjectsManifest, type ProjectRegistryEntry } from './project-registry.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GoalLoopProject {
  name: string;
  path: string;
}

export interface GoalLoopProjectStatus {
  name: string;
  path: string;
  passing: number;
  failing: number;
  blocked: number;
  total: number;
  overallScore: number;
  allGreen: boolean;
  lastChecked: string;
}

export interface GoalLoopResult {
  cyclesRun: number;
  projectCycles: Record<string, number>;
  projectStatuses: GoalLoopProjectStatus[];
  allProjectsGreen: boolean;
  success: boolean;
}

export interface GoalLoopEngineOptions {
  projects: GoalLoopProject[];
  target?: number;
  maxCycles?: number;
  maxCyclesPerProject?: number;
  rotationMode?: 'round-robin' | 'greedy';
  yes?: boolean;
  // Injection seams for testing
  _runCompeteAuto?: (projectPath: string, target: number, yes: boolean) => Promise<{ overallScore?: number }>;
  _checkAllNine?: (projectPath: string, target: number) => Promise<GoalLoopProjectStatus>;
  _stdout?: (line: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export async function resolveProjects(
  explicit: GoalLoopProject[],
  _loadManifest?: () => Promise<{ projects: ProjectRegistryEntry[] }>,
): Promise<GoalLoopProject[]> {
  if (explicit.length > 0) return explicit;
  const loadFn = _loadManifest ?? loadProjectsManifest;
  try {
    const manifest = await loadFn();
    return manifest.projects.map(p => ({ name: p.name, path: p.path }));
  } catch {
    return [];
  }
}

export async function readProjectStatus(
  projectPath: string,
  target: number,
): Promise<GoalLoopProjectStatus> {
  const name = path.basename(projectPath);
  const statusFile = path.join(projectPath, '.danteforge', 'GOAL_STATUS.json');
  try {
    const raw = await fs.readFile(statusFile, 'utf8');
    const data = JSON.parse(raw) as {
      allGreen: boolean;
      target: number;
      passing: number;
      failing: number;
      blocked: number;
      total: number;
      failingDimensions: string[];
      checkedAt: string;
    };
    const matrix = await loadMatrix(projectPath).catch(() => null);
    return {
      name,
      path: projectPath,
      passing: data.passing,
      failing: data.failing,
      blocked: data.blocked,
      total: data.total,
      overallScore: matrix?.overallSelfScore ?? 0,
      allGreen: data.allGreen && data.target >= target,
      lastChecked: data.checkedAt,
    };
  } catch {
    // No status file yet — read matrix directly
    const matrix = await loadMatrix(projectPath).catch(() => null);
    if (!matrix) {
      return { name, path: projectPath, passing: 0, failing: 0, blocked: 0, total: 0, overallScore: 0, allGreen: false, lastChecked: new Date().toISOString() };
    }
    const failing = matrix.dimensions.filter(d => {
      if (d.ceiling !== undefined && d.ceiling < target) return false;
      return (d.scores['self'] ?? 0) < target;
    }).length;
    const blocked = matrix.dimensions.filter(d => d.ceiling !== undefined && d.ceiling < target).length;
    const passing = matrix.dimensions.length - failing - blocked;
    return {
      name,
      path: projectPath,
      passing,
      failing,
      blocked,
      total: matrix.dimensions.length,
      overallScore: matrix.overallSelfScore ?? 0,
      allGreen: failing === 0,
      lastChecked: new Date().toISOString(),
    };
  }
}

export function pickNextProject(
  statuses: GoalLoopProjectStatus[],
  cycleCount: Record<string, number>,
  mode: 'round-robin' | 'greedy',
  maxCyclesPerProject: number,
): GoalLoopProjectStatus | null {
  const eligible = statuses.filter(s => !s.allGreen && (cycleCount[s.name] ?? 0) < maxCyclesPerProject);
  if (eligible.length === 0) return null;
  if (mode === 'round-robin') {
    return eligible.reduce((min, s) => (cycleCount[s.name] ?? 0) < (cycleCount[min.name] ?? 0) ? s : min, eligible[0]);
  }
  // greedy: most failing dimensions first
  return eligible.reduce((best, s) => s.failing > best.failing ? s : best, eligible[0]);
}

export function renderProgressTable(statuses: GoalLoopProjectStatus[], target: number): string {
  const lines: string[] = [
    '',
    `  ┌─ Goal Loop Progress (target: ${target}+) ${'─'.repeat(30)}`,
    `  │ ${'Project'.padEnd(20)} ${'Score'.padEnd(8)} ${'Pass'.padEnd(6)} ${'Fail'.padEnd(6)} Status`,
    `  ├${'─'.repeat(56)}`,
  ];
  for (const s of statuses) {
    const status = s.allGreen ? '✓ DONE' : `${s.failing} gaps`;
    lines.push(`  │ ${s.name.padEnd(20)} ${s.overallScore.toFixed(1).padEnd(8)} ${String(s.passing).padEnd(6)} ${String(s.failing).padEnd(6)} ${status}`);
  }
  lines.push(`  └${'─'.repeat(56)}`);
  return lines.join('\n');
}

// ── Engine ────────────────────────────────────────────────────────────────────

export async function runGoalLoopEngine(opts: GoalLoopEngineOptions): Promise<GoalLoopResult> {
  const target = opts.target ?? 9.0;
  const maxCycles = opts.maxCycles ?? 120;
  const maxCyclesPerProject = opts.maxCyclesPerProject ?? 15;
  const rotationMode = opts.rotationMode ?? 'greedy';
  const yes = opts.yes ?? false;
  const emit = opts._stdout ?? ((l: string) => logger.info(l));

  const runAuto = opts._runCompeteAuto ?? defaultRunCompeteAuto;
  const checkFn = opts._checkAllNine ?? ((p: string, t: number) => defaultCheckAllNine(p, t));

  const cycleCount: Record<string, number> = {};
  let totalCycles = 0;

  // Initial status read
  let statuses = await Promise.all(opts.projects.map(p => readProjectStatus(p.path, target)));

  emit(renderProgressTable(statuses, target));

  while (totalCycles < maxCycles) {
    const next = pickNextProject(statuses, cycleCount, rotationMode, maxCyclesPerProject);
    if (!next) {
      emit('\n  All projects have reached target or exhausted cycles.');
      break;
    }

    cycleCount[next.name] = (cycleCount[next.name] ?? 0) + 1;
    totalCycles++;

    // Depth Doctrine: alternate breadth/depth per project cycle.
    const { getWaveGuard } = await import('./wave-alternation.js');
    const waveGuard = getWaveGuard(cycleCount[next.name]! - 1);

    emit(`\n  [${'='.repeat(Math.min(totalCycles, 20))}] Cycle ${totalCycles}/${maxCycles} — ${next.name} (${next.failing} gaps) [${waveGuard.type}]`);

    try {
      if (waveGuard.type === 'depth') {
        emit(`  DEPTH WAVE: running validate --all for ${next.name}`);
        const { runValidateCli } = await import('../cli/commands/validate.js');
        await runValidateCli({ all: true, forceCold: true, cwd: next.path }).catch(() => {});
      } else {
        await runAuto(next.path, target, yes);
      }
      const updated = await checkFn(next.path, target);
      statuses = statuses.map(s => s.name === next.name ? updated : s);
      emit(renderProgressTable(statuses, target));
    } catch (err) {
      emit(`  Error on ${next.name}: ${err instanceof Error ? err.message : String(err)} — continuing`);
    }

    if (statuses.every(s => s.allGreen)) {
      emit('\n  ✓ All projects green — goal achieved!');
      break;
    }
  }

  const allProjectsGreen = statuses.every(s => s.allGreen);
  return {
    cyclesRun: totalCycles,
    projectCycles: cycleCount,
    projectStatuses: statuses,
    allProjectsGreen,
    success: allProjectsGreen,
  };
}

// ── Defaults ──────────────────────────────────────────────────────────────────

async function defaultRunCompeteAuto(projectPath: string, target: number, yes: boolean): Promise<{ overallScore?: number }> {
  const { compete } = await import('../cli/commands/compete.js');
  const result = await compete({
    auto: true,
    target,
    yes,
    maxCycles: 5,
    cwd: projectPath,
  });
  return { overallScore: result.overallScore };
}

async function defaultCheckAllNine(projectPath: string, target: number): Promise<GoalLoopProjectStatus> {
  const { actionCheckAllNine } = await import('../cli/commands/compete.js');
  await actionCheckAllNine({ target, cwd: projectPath }, projectPath);
  return readProjectStatus(projectPath, target);
}

export { getMatrixPath };

// ── Unattended goal loop ──────────────────────────────────────────────────────

export interface GoalLoopUnattendedOptions {
  /** Plain-text description of the goal (used for logging). */
  goal: string;
  /** Maximum number of autoforge cycles to run. Default: 20 */
  maxCycles?: number;
  /** Stop when overall score >= this value. Default: 9.0 */
  targetScore?: number;
  /** Project working directory. Default: process.cwd() */
  cwd?: string;
  /** Path to the log file (appended). Default: .danteforge/goal-loop.log */
  logFile?: string;
  /**
   * Injectable stage runner for testing.
   * Receives the cwd and returns whether the run succeeded and the current overall score.
   */
  _runStage?: (cwd: string) => Promise<{ success: boolean; overallScore: number }>;
  /** Injectable file appender for testing. */
  _appendLog?: (logFile: string, line: string) => Promise<void>;
}

export interface GoalLoopUnattendedResult {
  cyclesRun: number;
  goalMet: boolean;
  finalScore: number;
  stopReason: 'goal-met' | 'max-cycles' | 'consecutive-failures';
}

const MAX_CONSECUTIVE_FAILURES = 3;

async function appendGoalLog(
  logFile: string,
  line: string,
  _appendLog?: (logFile: string, line: string) => Promise<void>,
): Promise<void> {
  if (_appendLog) {
    await _appendLog(logFile, line);
    return;
  }
  try {
    const { default: fs } = await import('node:fs/promises');
    const { default: path } = await import('node:path');
    await fs.mkdir(path.dirname(logFile), { recursive: true });
    await fs.appendFile(logFile, line + '\n', 'utf8');
  } catch {
    // best-effort — log write never stops the loop
  }
}

async function defaultStageRunner(cwd: string): Promise<{ success: boolean; overallScore: number }> {
  try {
    const { compete } = await import('../cli/commands/compete.js');
    const result = await compete({ auto: true, target: 9.0, yes: true, maxCycles: 3, cwd });
    return { success: true, overallScore: result.overallScore ?? 0 };
  } catch {
    return { success: false, overallScore: 0 };
  }
}

/**
 * Run the goal loop in fully unattended mode.
 *
 * - Reads the goal from the `goal` parameter (never prompts for input).
 * - Runs autoforge cycles and checks progress after each one.
 * - Stops when the goal score is met, max cycles are reached, or 3 consecutive failures occur.
 * - Appends structured log entries to `logFile`.
 * - Never throws: errors are logged and counted.
 *
 * @param options - Configuration for the unattended run.
 */
export async function runGoalLoopUnattended(
  options: GoalLoopUnattendedOptions,
): Promise<GoalLoopUnattendedResult> {
  const cwd = options.cwd ?? process.cwd();
  const maxCycles = options.maxCycles ?? 20;
  const targetScore = options.targetScore ?? 9.0;
  const logFile = options.logFile ??
    (await import('node:path')).default.join(cwd, '.danteforge', 'goal-loop.log');
  const runStage = options._runStage ?? defaultStageRunner;

  let cyclesRun = 0;
  let consecutiveFailures = 0;
  let finalScore = 0;
  let goalMet = false;
  let stopReason: GoalLoopUnattendedResult['stopReason'] = 'max-cycles';

  const startMsg =
    `[goal-loop-unattended] START goal="${options.goal}" target=${targetScore} maxCycles=${maxCycles} at=${new Date().toISOString()}`;
  await appendGoalLog(logFile, startMsg, options._appendLog);

  while (cyclesRun < maxCycles) {
    cyclesRun++;
    const cycleStart = new Date().toISOString();

    let success = false;
    let overallScore = 0;

    try {
      const result = await runStage(cwd);
      success = result.success;
      overallScore = result.overallScore;
    } catch (err) {
      success = false;
      overallScore = 0;
      const msg = err instanceof Error ? err.message : String(err);
      await appendGoalLog(
        logFile,
        `[goal-loop-unattended] cycle=${cyclesRun} ERROR: ${msg} at=${cycleStart}`,
        options._appendLog,
      );
    }

    finalScore = overallScore;

    await appendGoalLog(
      logFile,
      `[goal-loop-unattended] cycle=${cyclesRun}/${maxCycles} success=${success} score=${overallScore.toFixed(2)} target=${targetScore} at=${cycleStart}`,
      options._appendLog,
    );

    if (success) {
      consecutiveFailures = 0;
    } else {
      consecutiveFailures++;
    }

    if (overallScore >= targetScore) {
      goalMet = true;
      stopReason = 'goal-met';
      break;
    }

    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      stopReason = 'consecutive-failures';
      await appendGoalLog(
        logFile,
        `[goal-loop-unattended] STOP: ${MAX_CONSECUTIVE_FAILURES} consecutive failures — aborting at=${new Date().toISOString()}`,
        options._appendLog,
      );
      break;
    }
  }

  const endMsg =
    `[goal-loop-unattended] END goalMet=${goalMet} finalScore=${finalScore.toFixed(2)} cycles=${cyclesRun} reason=${stopReason} at=${new Date().toISOString()}`;
  await appendGoalLog(logFile, endMsg, options._appendLog);

  return { cyclesRun, goalMet, finalScore, stopReason };
}
