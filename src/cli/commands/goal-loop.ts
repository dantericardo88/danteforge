// goal-loop — Cross-project autonomous goal loop.
//
// Rotates across multiple DanteForge-managed projects, running
// `compete --auto` on each until all reachable dimensions reach target (9.0).
//
// Pairs with Claude Code's /goal command:
//   /goal danteforge compete --check-all-nine exits 0
//
// For multi-project autopilot:
//   danteforge goal-loop --projects /path/to/DanteForge,/path/to/DanteCode
//
// The loop stops on the exit code of `compete --check-all-nine`, not on an
// LLM opinion — so it cannot be fooled by score inflation.

import path from 'node:path';
import { logger } from '../../core/logger.js';
import { SCORING_DOCTRINE_SHORT } from '../../core/scoring-doctrine.js';
import {
  runGoalLoopEngine,
  resolveProjects,
  readProjectStatus,
  renderProgressTable,
  type GoalLoopEngineOptions,
  type GoalLoopProject,
  type GoalLoopProjectStatus,
} from '../../core/goal-loop-engine.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GoalLoopOptions {
  /** Comma-separated project paths or names. Defaults to registered projects. */
  projects?: string[];
  target?: number;
  maxCycles?: number;
  maxCyclesPerProject?: number;
  rotationMode?: 'round-robin' | 'greedy';
  yes?: boolean;
  promptMode?: boolean;
  cwd?: string;
  // Injection seams for testing
  _runCompeteAuto?: (projectPath: string, target: number, yes: boolean) => Promise<{ overallScore?: number }>;
  _checkAllNine?: (projectPath: string, target: number) => Promise<GoalLoopProjectStatus>;
  _resolveProjects?: (explicit: GoalLoopProject[]) => Promise<GoalLoopProject[]>;
  _stdout?: (line: string) => void;
}

export interface GoalLoopResult {
  cyclesRun: number;
  allProjectsGreen: boolean;
  projectStatuses: GoalLoopProjectStatus[];
  success: boolean;
}

// ── Main Entry ────────────────────────────────────────────────────────────────

export async function goalLoop(opts: GoalLoopOptions = {}): Promise<GoalLoopResult> {
  const cwd = opts.cwd ?? process.cwd();
  const emit = opts._stdout ?? ((l: string) => logger.info(l));
  emit(`[scoring-doctrine] ${SCORING_DOCTRINE_SHORT}`);

  if (opts.promptMode) {
    emit(`
  GOAL LOOP — Autonomous Cross-Project Builder
  ════════════════════════════════════════════

  Usage:
    danteforge goal-loop
      # Uses ~/.danteforge/projects.json (registered projects)

    danteforge goal-loop --projects /path/to/DanteForge,/path/to/DanteCode
      # Explicit project list

    danteforge goal-loop --target 9.0 --max-cycles 120 --yes
      # Fully autonomous (no confirmation gates)

  /goal integration (single project):
    /goal danteforge compete --check-all-nine exits 0

  /goal integration (multi-project):
    /goal danteforge goal-loop --yes exits 0
`);
    return { cyclesRun: 0, allProjectsGreen: false, projectStatuses: [], success: false };
  }

  // Resolve projects
  const explicitProjects: GoalLoopProject[] = (opts.projects ?? []).map(p => {
    const resolved = path.isAbsolute(p) ? p : path.resolve(cwd, p);
    return { name: path.basename(resolved), path: resolved };
  });

  const resolveFn = opts._resolveProjects ?? ((e: GoalLoopProject[]) => resolveProjects(e));
  const projects = await resolveFn(explicitProjects);

  if (projects.length === 0) {
    logger.error('No projects found. Pass --projects or register projects with `danteforge register`.');
    logger.info('  Example: danteforge goal-loop --projects /path/to/DanteForge,/path/to/DanteCode');
    process.exitCode = 1;
    return { cyclesRun: 0, allProjectsGreen: false, projectStatuses: [], success: false };
  }

  const target = opts.target ?? 9.0;

  logger.info(`\n  Goal Loop — ${projects.length} project(s) | target: ${target}+ | mode: ${opts.rotationMode ?? 'greedy'}`);
  for (const p of projects) logger.info(`    • ${p.name}  (${p.path})`);

  // Initial status snapshot
  const initialStatuses = await Promise.all(projects.map(p => readProjectStatus(p.path, target)));
  emit(renderProgressTable(initialStatuses, target));

  const engineOpts: GoalLoopEngineOptions = {
    projects,
    target,
    maxCycles: opts.maxCycles ?? 120,
    maxCyclesPerProject: opts.maxCyclesPerProject ?? 15,
    rotationMode: opts.rotationMode ?? 'greedy',
    yes: opts.yes ?? false,
    _runCompeteAuto: opts._runCompeteAuto,
    _checkAllNine: opts._checkAllNine,
    _stdout: emit,
  };

  const result = await runGoalLoopEngine(engineOpts);

  // Final summary
  emit('\n  ── Final Status ─────────────────────────────────────');
  emit(renderProgressTable(result.projectStatuses, target));

  const greenCount = result.projectStatuses.filter(s => s.allGreen).length;
  emit(`\n  ${greenCount}/${projects.length} projects at ${target}+  |  ${result.cyclesRun} total cycles`);

  if (result.allProjectsGreen) {
    logger.success('  ✓ All projects have reached the goal. Run /ship to cut releases.');
    process.exitCode = 0;
  } else {
    const remaining = result.projectStatuses.filter(s => !s.allGreen);
    logger.warn(`  ${remaining.length} project(s) still have gaps: ${remaining.map(s => s.name).join(', ')}`);
    logger.info('  Re-run `danteforge goal-loop` to continue from where it left off.');
    process.exitCode = 1;
  }

  return {
    cyclesRun: result.cyclesRun,
    allProjectsGreen: result.allProjectsGreen,
    projectStatuses: result.projectStatuses,
    success: result.allProjectsGreen,
  };
}
