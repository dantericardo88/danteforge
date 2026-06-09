// obstacle-registry.ts — DanteForge's problem-solving DNA.
//
// The operating philosophy, made structural: every obstacle is a SOLVABLE sub-problem, never a wall. On
// hitting an obstacle the loop DIAGNOSEs it, GENERATEs >=3 candidate solutions, RANKs them, and EXECUTEs
// the best WITH PRE-GRANTED AUTHORITY — then verifies and loops. There is no "we can't": there is "here is
// the problem, here are 3 solutions, here is the best, executing," or an HONEST, actionable escalation.
//
// SECURITY MODEL (hardened after an adversarial red-team that broke v1). The original design trusted a
// self-declared `blastRadius` string and ran a freeform `apply()` closure with full privileges — so the
// label was the security boundary and the solver wrote the label. Now:
//   - A solution declares a TYPED EFFECT (noop | shell | write-file), NOT a closure. The KERNEL executes it.
//   - The KERNEL DERIVES the blast radius from the effect and IGNORES any claim. Destructive shell ops
//     (rm -rf, git reset --hard, git push, --force…) and writes to the score/yardstick surface can NEVER be
//     mislabeled local-only — the kernel sees the real effect.
//   - PRE-GRANTED AUTHORITY auto-executes ONLY local-only effects. shared-state needs council consensus;
//     destructive needs a human, always. Plus a deny-guard refuses destructive ops even at execution time.
//   - A module-owned RE-ENTRANCY + DEPTH guard makes apply()-recursion / runaway self-modification finite.
// The honesty stack (capability_test, sensitivity probe, courts) still owns all SCORE writes — a solver
// never writes a score; the registry only fixes obstacles, and a fix that touches the score/yardstick
// surface is derived shared-state and cannot auto-run.

export type BlastRadius = 'local-only' | 'shared-state' | 'destructive';

/** WHAT a solution does — a typed effect the kernel executes. The kernel derives the radius from this. */
export type SolverEffect =
  | { kind: 'noop'; detail: string }
  | { kind: 'shell'; command: string; cwd?: string; /** ok when: exit 0 (default) or merely 'launches' (exit != 127). */ successWhen?: 'exit-zero' | 'launches' }
  | { kind: 'write-file'; path: string; content: string };

export interface Solution {
  id: string;
  description: string;
  /** 0..1 — confidence this resolves the obstacle (drives ranking). */
  confidence: number;
  effect: SolverEffect;
}

export interface ObstacleSolver {
  kind: string;
  canSolve: (o: Obstacle) => boolean;
  /** The never-say-can't discipline: ALWAYS return >=3 distinct candidate solutions. */
  proposeSolutions: (o: Obstacle) => Promise<Solution[]>;
}

export interface Obstacle {
  kind: string;
  signal: string;
  context?: Record<string, unknown>;
}

export interface SolveAttempt {
  solution: string;
  /** The KERNEL-DERIVED radius (not anything the solver claimed). */
  blastRadius: BlastRadius;
  outcome: 'applied' | 'failed' | 'deferred-needs-consensus' | 'deferred-needs-human' | 'blocked-destructive';
  detail: string;
}

export interface SolveResult {
  solved: boolean;
  obstacle: Obstacle;
  attempted: SolveAttempt[];
  ceiling?: string;
  needsMetaSolver?: boolean;
}

export interface SolveOptions {
  /** Highest radius pre-authorized to auto-execute. Default 'local-only' (the safe pre-granted authority). */
  authority?: BlastRadius;
  maxAttempts?: number;
  /** Council-consensus seam for a shared-state effect (returns true to proceed). */
  approveSharedState?: (s: Solution, derived: BlastRadius) => Promise<boolean>;
  /** Run a shell command → exit code. Injectable for tests. */
  runShell?: (command: string, cwd: string) => Promise<number>;
  /** Write a file (already path-checked by the kernel). Injectable for tests. */
  writeFile?: (path: string, content: string) => Promise<void>;
  cwd?: string;
}

const RADIUS_ORDER: Record<BlastRadius, number> = { 'local-only': 0, 'shared-state': 1, 'destructive': 2 };
const REGISTRY = new Map<string, ObstacleSolver>();

// Destructive shell operations — derived 'destructive' AND refused by the deny-guard regardless of authority.
const DESTRUCTIVE_RE = /\brm\s+-rf|\brmdir\s+\/s|\bgit\s+reset\s+--hard|\bgit\s+clean\b|\bgit\s+checkout\s+--|\bgit\s+push\b|--force\b|\bdel\s+\/[a-z]|\bformat\b|\bmkfs\b|>\s*\/dev\/sd|:\(\)\s*\{.*\};:/i;
// Score / yardstick / shared-state surface — any write here is derived 'shared-state' (needs consensus).
const SCORE_SURFACE_RE = /matrix\.json|score-proposals|STATE\.yaml|[/\\]universe[/\\]|frontier_spec|category_delta|observed_capability|\.danteforge[/\\]compete/i;

/** Derive the blast radius from the EFFECT — the kernel's verdict, never the solver's claim. */
export function deriveRadius(effect: SolverEffect): BlastRadius {
  if (effect.kind === 'noop') return 'local-only';
  if (effect.kind === 'shell') {
    if (DESTRUCTIVE_RE.test(effect.command)) return 'destructive';
    if (SCORE_SURFACE_RE.test(effect.command)) return 'shared-state';
    return 'local-only';
  }
  // write-file
  if (SCORE_SURFACE_RE.test(effect.path)) return 'shared-state';
  if (effect.path.includes('..') || /^(?:[a-z]:[/\\]|\/|\\\\)/i.test(effect.path)) return 'destructive'; // escapes the project
  return 'local-only';
}

export function registerSolver(solver: ObstacleSolver): void { REGISTRY.set(solver.kind, solver); }
export function clearSolvers(): void { REGISTRY.clear(); }
export function registeredKinds(): string[] { return [...REGISTRY.keys()]; }

/** The solver for an obstacle: exact kind match, else the first whose canSolve() accepts it. A greedy
 *  always-true canSolve is rejected (it would capture the whole obstacle stream — a red-team runaway vector). */
export function findSolver(o: Obstacle): ObstacleSolver | null {
  const exact = REGISTRY.get(o.kind);
  if (exact && exact.canSolve(o)) return exact;
  const probe: Obstacle = { kind: '__greedy_probe__', signal: '__greedy_probe__' };
  for (const s of REGISTRY.values()) {
    if (s.kind === o.kind) continue;
    if (s.canSolve(probe)) continue; // greedy/unconditional solver — refuse fall-through capture
    if (s.canSolve(o)) return s;
  }
  return null;
}

// Re-entrancy + depth guard — module-owned, so a solver's effect can never recurse the registry unbounded.
const ACTIVE = new Set<string>();
const MAX_DEPTH = 8;

async function executeEffect(effect: SolverEffect, derived: BlastRadius, opts: SolveOptions): Promise<{ ok: boolean; detail: string; blocked?: boolean }> {
  if (derived === 'destructive') return { ok: false, blocked: true, detail: 'deny-guard: destructive effect refused at execution (defense in depth)' };
  if (effect.kind === 'noop') return { ok: true, detail: effect.detail };
  if (effect.kind === 'shell') {
    const run = opts.runShell ?? defaultRunShell;
    const code = await run(effect.command, effect.cwd ?? opts.cwd ?? process.cwd());
    const ok = (effect.successWhen === 'launches') ? code !== 127 : code === 0;
    return { ok, detail: `shell exited ${code} (${ok ? 'ok' : 'fail'})` };
  }
  const write = opts.writeFile ?? (async (p: string, c: string) => { const fs = await import('node:fs/promises'); await fs.writeFile(p, c, 'utf8'); });
  await write(effect.path, effect.content);
  return { ok: true, detail: `wrote ${effect.path}` };
}

const defaultRunShell = (command: string, cwd: string): Promise<number> =>
  import('node:child_process').then(({ execFile }) => new Promise<number>(resolve => {
    const [file, args] = process.platform === 'win32' ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command]] : ['/bin/sh', ['-c', command]];
    const child = execFile(file, args, { cwd, timeout: 180_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err) => {
      const code = (err as (NodeJS.ErrnoException & { code?: number | string }) | null)?.code;
      resolve(typeof code === 'number' ? code : (err ? 1 : 0));
    });
    child.on('error', () => resolve(127));
  }));

/**
 * Solve an obstacle under pre-granted authority. >=3 solutions; ranked by confidence; the kernel DERIVES
 * each effect's radius and auto-executes only those within the granted authority (local-only by default).
 * shared-state needs consensus; destructive always defers to a human and is deny-guarded at execution.
 * Re-entrant / over-depth solves yield an honest ceiling — never unbounded recursion, never a silent stop.
 */
export async function solveObstacle(o: Obstacle, opts: SolveOptions = {}): Promise<SolveResult> {
  if (ACTIVE.has(o.kind) || ACTIVE.size >= MAX_DEPTH) {
    return { solved: false, obstacle: o, attempted: [], ceiling: `re-entrant or over-depth solve for "${o.kind}" (depth ${ACTIVE.size}/${MAX_DEPTH}) — honest ceiling to prevent runaway self-modification.` };
  }
  ACTIVE.add(o.kind);
  try {
    const solver = findSolver(o);
    if (!solver) {
      return { solved: false, obstacle: o, attempted: [], needsMetaSolver: true,
        ceiling: `No solver registered for "${o.kind}" — META-SOLVE: build, test, and register one (the missing solver IS the next sub-problem).` };
    }
    const solutions = await solver.proposeSolutions(o);
    if (solutions.length < 3) {
      return { solved: false, obstacle: o, attempted: [],
        ceiling: `Solver "${solver.kind}" returned ${solutions.length} solution(s) — the never-say-can't discipline requires >=3. Broaden the search.` };
    }

    const authority = opts.authority ?? 'local-only';
    const ranked = [...solutions].sort((a, b) => b.confidence - a.confidence).slice(0, opts.maxAttempts ?? 3);
    const attempted: SolveAttempt[] = [];

    for (const sol of ranked) {
      const derived = deriveRadius(sol.effect); // the kernel's verdict — the solver's claim is irrelevant
      if (RADIUS_ORDER[derived] > RADIUS_ORDER[authority]) {
        if (derived === 'shared-state' && opts.approveSharedState && (await opts.approveSharedState(sol, derived))) {
          // approved — fall through to execute
        } else {
          attempted.push({ solution: sol.description, blastRadius: derived,
            outcome: derived === 'destructive' ? 'deferred-needs-human' : 'deferred-needs-consensus',
            detail: `kernel-derived radius ${derived} exceeds pre-granted authority ${authority}` });
          continue;
        }
      }
      const r = await executeEffect(sol.effect, derived, opts);
      attempted.push({ solution: sol.description, blastRadius: derived,
        outcome: r.blocked ? 'blocked-destructive' : (r.ok ? 'applied' : 'failed'), detail: r.detail });
      if (r.ok) return { solved: true, obstacle: o, attempted };
    }

    return { solved: false, obstacle: o, attempted,
      ceiling: `Exhausted ${attempted.length} solution(s) within ${authority} authority. Escalate a deferred solution for consensus/human, or widen authority. Logged, not abandoned.` };
  } finally {
    ACTIVE.delete(o.kind);
  }
}
