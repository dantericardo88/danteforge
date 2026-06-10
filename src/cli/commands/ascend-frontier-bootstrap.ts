// ascend-frontier-bootstrap.ts — Phase A define for a COLD repo (no compete matrix yet).
//
// The production state builder (defaultBuildState in ascend-frontier.ts) reads
// .danteforge/compete/matrix.json; a repo that has never run define has none, so the
// orchestrator used to burn its whole retry budget on "No compete matrix found" and abort —
// `danteforge ascend-frontier` could not start on a cold repo. The proven cold-matrix creator
// already exists: core/universe-definer.ts:defineUniverse (ascend-engine calls it exactly this
// way, non-interactively). This module wires it in as the loop's real Phase A entry and seeds
// it (best-effort) from the matrix-orchestrate detect/discover artifacts when they exist.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { defineUniverse, type UniverseDefinerOptions } from '../../core/universe-definer.js';
import { loadMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';

/** The injectable define seam (options._defineUniverse) — same shape ascend-engine uses. */
export type DefineUniverseFn = (opts: UniverseDefinerOptions) => Promise<CompeteMatrix>;

export interface BootstrapSeeds {
  seedProjectDescription?: string;
  seedCompetitors?: string[];
}

/** What the orchestrator should do about a missing matrix — one decision, decided up front. */
export type BootstrapDecision =
  | { kind: 'matrix-exists' }
  | { kind: 'no-bootstrap'; remedy: string }
  | { kind: 'would-define' }
  | { kind: 'defined'; detail: { dimensions: number; seededDescription: boolean; seededCompetitors: number } }
  | { kind: 'define-failed'; reason: string };

/**
 * Best-effort read of the matrix-orchestrate cold-start artifacts:
 *   .danteforge/matrix-orchestration/project-intent.json       (detect — ProjectIntent)
 *   .danteforge/matrix-orchestration/competitive-universe.json (discover — CompetitiveUniverse)
 * When present they carry a REAL project description + gh-discovered competitor names, which
 * make the bootstrapped matrix grounded in this project's actual category instead of generic
 * dev-tool defaults. Absent or malformed artifacts yield empty seeds — they must never block
 * the define phase itself.
 */
export async function readOrchestrationSeeds(cwd: string): Promise<BootstrapSeeds> {
  const orchDir = path.join(cwd, '.danteforge', 'matrix-orchestration');
  const seeds: BootstrapSeeds = {};
  try {
    const intent = JSON.parse(await fs.readFile(path.join(orchDir, 'project-intent.json'), 'utf8')) as { goal?: unknown };
    if (typeof intent.goal === 'string' && intent.goal.trim() !== '') seeds.seedProjectDescription = intent.goal.trim();
  } catch { /* no detect artifact — define falls back to state/projectName */ }
  try {
    const universe = JSON.parse(await fs.readFile(path.join(orchDir, 'competitive-universe.json'), 'utf8')) as { entries?: unknown };
    if (Array.isArray(universe.entries)) {
      const names = [...new Set(
        (universe.entries as { name?: unknown; recommendedAction?: unknown }[])
          .filter(e => e.recommendedAction !== 'skip' && typeof e.name === 'string' && e.name.trim() !== '')
          .map(e => (e.name as string).trim()),
      )];
      if (names.length > 0) seeds.seedCompetitors = names;
    }
  } catch { /* no discover artifact — the competitor scanner derives its own list */ }
  return seeds;
}

/**
 * Decide (and, outside dry-run, execute) the cold-repo define phase. NEVER prompts — the
 * orchestrator's contract — so defineUniverse always runs with interactive:false. A define
 * failure is returned as data (not thrown) so the orchestrator can finish with a 'failed'
 * terminal that carries the real underlying reason.
 */
export async function bootstrapColdRepo(
  cwd: string,
  opts: { bootstrap?: boolean; dryRun?: boolean; _defineUniverse?: DefineUniverseFn },
): Promise<BootstrapDecision> {
  const existing = await loadMatrix(cwd);
  if (existing) return { kind: 'matrix-exists' };

  if (opts.bootstrap === false) {
    return {
      kind: 'no-bootstrap',
      remedy: 'no compete matrix found (.danteforge/compete/matrix.json) and --no-bootstrap is set — '
        + 'rerun without --no-bootstrap to let Phase A define create one, or create it first via '
        + '`danteforge ascend` / `danteforge matrix-orchestrate discover`',
    };
  }
  if (opts.dryRun) return { kind: 'would-define' };

  logger.info('[ascend-frontier] Phase A define: no compete matrix found — bootstrapping one via defineUniverse (non-interactive)...');
  try {
    const seeds = await readOrchestrationSeeds(cwd);
    if (seeds.seedProjectDescription) logger.info('[ascend-frontier] define seeded from matrix-orchestration/project-intent.json');
    if (seeds.seedCompetitors) logger.info(`[ascend-frontier] define seeded with ${seeds.seedCompetitors.length} discovered competitor(s) from matrix-orchestration/competitive-universe.json`);
    const defineFn = opts._defineUniverse ?? defineUniverse;
    const matrix = await defineFn({ cwd, interactive: false, ...seeds });
    const dims = (matrix as Partial<CompeteMatrix> | null)?.dimensions;
    const detail = {
      dimensions: Array.isArray(dims) ? dims.length : 0,
      seededDescription: seeds.seedProjectDescription !== undefined,
      seededCompetitors: seeds.seedCompetitors?.length ?? 0,
    };
    logger.info(`[ascend-frontier] Phase A define complete — compete matrix created (${detail.dimensions} dimensions)`);
    return { kind: 'defined', detail };
  } catch (err) {
    return { kind: 'define-failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

// ── Pre-flight (fleet rank 10) ────────────────────────────────────────────────

export interface PreflightResult { ok: boolean; remedy?: string; notes: string[] }

const exists = async (p: string): Promise<boolean> => { try { await fs.access(p); return true; } catch { return false; } };

/**
 * Probe the environment ONCE before the loop spends anything. Two checks the fleet paid for in
 * burned cycles: (1) a Node repo without node_modules cannot run its own capability_tests/outcomes
 * — every dim derives 0 and the chain churns on phantoms (hard fail, named remedy; sweep refuses
 * for the same reason); (2) the count of live agent CLIs decides what the run can honestly achieve
 * (0 → build cycles fail fast; 1 → no court/ladder-research quorum; ≥2 → full chain) — surfaced as
 * notes + ledgered, never invented. Non-Node repos skip (1): their toolchains are resolved by
 * toolchainEnv on the gate runners.
 */
export async function defaultPreflight(
  cwd: string,
  parallel: boolean,
  discoverMembers: () => Promise<unknown[]>,
): Promise<PreflightResult> {
  const notes: string[] = [];
  const pkgRaw = await fs.readFile(path.join(cwd, 'package.json'), 'utf8').catch(() => null);
  if (pkgRaw !== null) {
    // node_modules is required only when the manifest actually DECLARES dependencies — a
    // zero-dep package never has one (npm creates nothing to install), and failing it here
    // made such repos permanently un-runnable (caught live on the cold-repo define E2E).
    let declaresDeps = false;
    try {
      // BOM-tolerant: Windows editors/shells routinely write package.json with a UTF-8 BOM,
      // and JSON.parse throws on it — which silently flipped zero-dep repos into "assume deps".
      const pkg = JSON.parse(pkgRaw.replace(/^\uFEFF/, '')) as { dependencies?: object; devDependencies?: object };
      declaresDeps = Object.keys(pkg.dependencies ?? {}).length > 0 || Object.keys(pkg.devDependencies ?? {}).length > 0;
    } catch { declaresDeps = true; /* unreadable manifest — assume deps, the safer direction */ }
    if (declaresDeps) {
      const hasDeps = await exists(path.join(cwd, 'node_modules'));
      notes.push(`node repo — node_modules ${hasDeps ? 'present' : 'MISSING'}`);
      if (!hasDeps) {
        return {
          ok: false, notes,
          remedy: 'node_modules is missing — this checkout cannot run its own capability_tests/outcomes (every dim derives 0). Run the repo install (npm ci) + build, then re-run. (--dry-run still works.)',
        };
      }
    } else {
      notes.push('node repo with zero declared dependencies — node_modules not required');
    }
  } else {
    notes.push('non-Node repo (no package.json) — gate runners resolve cargo/go via toolchainEnv');
  }
  try {
    const members = await discoverMembers();
    notes.push(`agent CLIs: ${members.length}${members.length > 0 ? ` (${members.join(', ')})` : ''}`);
    if (members.length === 0) notes.push('WARNING: no claude/codex CLI available — every build cycle will fail fast (exit 2) until one is installed + authenticated');
    else if (parallel && members.length < 2) notes.push('WARNING: --parallel needs ≥2 live members for cross-judging — this round will degrade');
    else if (members.length < 2) notes.push('NOTE: 1 agent CLI — build-to-7 works; 9.0 court verdicts and ladder research need ≥2 independent members and will honestly block');
  } catch (err) {
    notes.push(`agent discovery failed (${err instanceof Error ? err.message : String(err)}) — continuing; build cycles will surface it honestly`);
  }
  return { ok: true, notes };
}
