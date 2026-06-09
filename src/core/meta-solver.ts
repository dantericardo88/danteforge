// meta-solver.ts — self-extension: the loop writes its OWN new solvers.
//
// When the obstacle registry has no solver for a class, the missing solver IS the next sub-problem (the
// never-say-can't discipline applied to the registry itself). The meta-solver dispatches a coding agent to
// author a new ObstacleSolver + a REPLAY TEST (the triggering obstacle becomes the test fixture), then only
// registers it if it passes two hard gates — so the loop grows new capabilities without ever registering a
// solver that cheats:
//
//   GATE 1 — NO-STUB: the authored solver must not swallow errors / stub / TODO / always-return-ok. A solver
//            that "solves" by lying is rejected before it can ever run.
//   GATE 2 — REPLAY: the authored solver must actually resolve the exact obstacle that triggered it (the
//            replay test). A solver that doesn't solve its own reason for existing is rejected.
//
// Bounded to ONE new solver per class per pass (no meta-regress); a failed attempt is an honest ceiling,
// not recursion. Writing+registering executable code is high blast-radius, so this runs ONLY behind these
// gates (and the caller decides whether to invoke it — it is not a local-only auto-fix).

import path from 'node:path';
import fs from 'node:fs/promises';
import type { Obstacle } from './obstacle-registry.js';

export interface MetaSolveResult {
  registered: boolean;
  kind: string;
  solverPath?: string;
  reason: string;
  /** Which gate rejected it, if any. */
  rejectedBy?: 'already-attempted' | 'dispatch' | 'no-stub' | 'replay' | 'register';
}

export interface MetaSolveOptions {
  cwd: string;
  /** Dispatch the agent to author the solver + replay test at the given paths (write-scoped). */
  dispatchSolverAuthor: (obstacle: Obstacle, solverPath: string, replayTestPath: string) => Promise<{ ranOk: boolean; reason?: string }>;
  /** Scan a file for stub/lie patterns → list of violations (empty = clean). Defaults to a static scan. */
  scanForStubs?: (absPath: string) => Promise<string[]>;
  /** Run the replay test → did the new solver resolve the triggering obstacle? */
  runReplayTest: (replayTestPath: string) => Promise<{ passed: boolean; detail: string }>;
  /** Load + register the new solver into the live registry. */
  registerNewSolver: (solverPath: string) => Promise<{ ok: boolean; reason?: string }>;
  /** One new solver per class per pass — returns true if this class was already attempted (no meta-regress). */
  alreadyAttempted: (kind: string) => boolean;
  /** fs seams (tests). */
  _exists?: (p: string) => Promise<boolean>;
  _removeFile?: (p: string) => Promise<void>;
}

/** Stub / error-swallowing / self-passing patterns a real solver must never contain. */
const STUB_PATTERNS: Array<[RegExp, string]> = [
  [/not\s+implemented/i, 'throws/returns "not implemented"'],
  [/\/\/\s*TODO|\/\/\s*FIXME/i, 'TODO/FIXME placeholder'],
  [/catch\s*\([^)]*\)\s*\{\s*\}/, 'empty catch (swallows errors)'],
  [/return\s*\{\s*ok:\s*true[^}]*\}\s*;?\s*\/\/\s*(stub|fake|always)/i, 'hardcoded ok:true stub'],
  [/proposeSolutions[\s\S]{0,200}return\s*\[\s*\]/, 'proposes zero solutions (violates >=3)'],
];

async function defaultScanForStubs(absPath: string): Promise<string[]> {
  let src: string;
  try { src = await fs.readFile(absPath, 'utf8'); } catch { return [`solver file not found: ${absPath}`]; }
  return STUB_PATTERNS.filter(([re]) => re.test(src)).map(([, label]) => label);
}

function slug(kind: string): string { return kind.replace(/[^a-z0-9_-]/gi, '-').toLowerCase(); }

/**
 * Auto-extend the registry with a new solver for an unsolved obstacle class. Returns registered=false with a
 * specific rejectedBy when any gate fails — an honest ceiling, never a silent dead stop.
 */
export async function metaSolve(obstacle: Obstacle, opts: MetaSolveOptions): Promise<MetaSolveResult> {
  const kind = obstacle.kind;
  if (opts.alreadyAttempted(kind)) {
    return { registered: false, kind, rejectedBy: 'already-attempted', reason: `class "${kind}" already had a solver authored this pass — no meta-regress; honest ceiling until next pass.` };
  }
  const solverPath = `src/core/solvers/${slug(kind)}-solver.ts`;
  const replayTestPath = `tests/solvers/${slug(kind)}-solver.replay.test.ts`;
  const absSolver = path.join(opts.cwd, solverPath);
  const exists = opts._exists ?? (async (p: string) => { try { await fs.access(p); return true; } catch { return false; } });
  const removeFile = opts._removeFile ?? ((p: string) => fs.rm(p, { force: true }));
  const scan = opts.scanForStubs ?? defaultScanForStubs;
  const revert = async (): Promise<void> => {
    await removeFile(absSolver).catch(() => { /* best-effort */ });
    await removeFile(path.join(opts.cwd, replayTestPath)).catch(() => { /* best-effort */ });
  };

  const d = await opts.dispatchSolverAuthor(obstacle, solverPath, replayTestPath);
  if (!d.ranOk) return { registered: false, kind, rejectedBy: 'dispatch', reason: `solver-author agent did not run: ${d.reason ?? 'unknown'}` };
  if (!(await exists(absSolver))) {
    await revert();
    return { registered: false, kind, rejectedBy: 'dispatch', reason: 'agent produced no solver file.' };
  }

  // GATE 1 — NO-STUB: a solver that lies/swallows is rejected before it can ever run.
  const stubs = await scan(absSolver);
  if (stubs.length > 0) {
    await revert();
    return { registered: false, kind, rejectedBy: 'no-stub', reason: `authored solver failed the no-stub scan (${stubs.join('; ')}) — reverted.` };
  }

  // GATE 2 — REPLAY: the solver must resolve the exact obstacle that triggered it.
  const replay = await opts.runReplayTest(replayTestPath);
  if (!replay.passed) {
    await revert();
    return { registered: false, kind, rejectedBy: 'replay', reason: `authored solver failed the replay test (${replay.detail}) — reverted.` };
  }

  const reg = await opts.registerNewSolver(solverPath);
  if (!reg.ok) {
    await revert();
    return { registered: false, kind, rejectedBy: 'register', reason: reg.reason ?? 'registration failed.' };
  }
  return { registered: true, kind, solverPath, reason: 'self-extended: solver authored, no-stub-clean, replay-verified, registered. The loop grew a new capability.' };
}
