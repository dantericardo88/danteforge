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

    emit(`\n  [${'='.repeat(Math.min(totalCycles, 20))}] Cycle ${totalCycles}/${maxCycles} — ${next.name} (${next.failing} gaps)`);

    try {
      await runAuto(next.path, target, yes);
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
