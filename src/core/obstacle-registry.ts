// obstacle-registry.ts — DanteForge's problem-solving DNA.
//
// The operating philosophy, made structural: every obstacle is a SOLVABLE sub-problem, never a wall. On
// hitting an obstacle the loop must DIAGNOSE it, GENERATE >=3 candidate solutions, RANK them, and EXECUTE
// the best WITH PRE-GRANTED AUTHORITY (no human approval) — then verify and loop. There is no "we can't":
// there is "here is the problem, here are 3 solutions, here is the best, executing," or — only when a
// solution genuinely needs more than this authority — an HONEST, actionable escalation (never a dead stop).
//
// Two structural guarantees keep "never say can't" from degenerating into "lower the bar" / runaway scope:
//   1. BLAST RADIUS — every solution declares local-only | shared-state | destructive. ONLY local-only
//      auto-executes under pre-granted authority; shared-state needs council consensus; destructive needs a
//      human. So unbounded authority is never granted — it is granted exactly for safe, local fixes.
//   2. THE HONESTY STACK IS NON-NEGOTIABLE — a solver NEVER writes a score. Its output still passes the
//      capability_test gate, the sensitivity probe, the outcome-acceptance + frontier courts. A solution
//      that lowers the bar is rejected by those gates before any score moves; the registry cannot bypass them.
// Plus bounded attempts (a solver gets N tries, default 3) so a class that genuinely can't be solved this
// pass yields an honest ceiling WITH the attempted solutions logged — an opportunity recorded, not a wall.

export type BlastRadius = 'local-only' | 'shared-state' | 'destructive';

export interface Obstacle {
  /** The obstacle class (the dispatch key), e.g. 'spawn-failure', 'missing-ladder', 'stub-yardstick'. */
  kind: string;
  /** The raw diagnostic signal (error text / court dissent / audit verdict). */
  signal: string;
  /** Structured context the solver needs (dim id, command, cwd, paths…). */
  context?: Record<string, unknown>;
}

export interface Solution {
  id: string;
  description: string;
  blastRadius: BlastRadius;
  /** 0..1 — the solver's confidence this solution resolves the obstacle (drives ranking). */
  confidence: number;
  /** Do the real work. Returns whether it resolved the obstacle. MUST NOT write a score (honesty stack owns that). */
  apply: () => Promise<{ ok: boolean; detail: string }>;
}

export interface ObstacleSolver {
  kind: string;
  canSolve: (o: Obstacle) => boolean;
  /** The never-say-can't discipline: ALWAYS return >=3 distinct candidate solutions. */
  proposeSolutions: (o: Obstacle) => Promise<Solution[]>;
}

export interface SolveAttempt {
  solution: string;
  blastRadius: BlastRadius;
  outcome: 'applied' | 'failed' | 'deferred-needs-consensus' | 'deferred-needs-human';
  detail: string;
}

export interface SolveResult {
  solved: boolean;
  obstacle: Obstacle;
  attempted: SolveAttempt[];
  /** Set when unsolved THIS pass — an honest, actionable next step (NOT a dead "we can't"). */
  ceiling?: string;
  /** True when no solver is registered for this class — the meta-solver should build one. */
  needsMetaSolver?: boolean;
}

export interface SolveOptions {
  /** Highest blast radius pre-authorized to auto-execute. Default 'local-only' (the safe pre-granted authority). */
  authority?: BlastRadius;
  /** Max solutions to try this pass. Default 3. */
  maxAttempts?: number;
  /** Council-consensus seam: approve a shared-state solution (returns true to proceed). */
  approveSharedState?: (s: Solution) => Promise<boolean>;
}

const RADIUS_ORDER: Record<BlastRadius, number> = { 'local-only': 0, 'shared-state': 1, 'destructive': 2 };
const REGISTRY = new Map<string, ObstacleSolver>();

/** Register (or replace) a solver for an obstacle class. The meta-solver uses this to self-extend. */
export function registerSolver(solver: ObstacleSolver): void { REGISTRY.set(solver.kind, solver); }
export function clearSolvers(): void { REGISTRY.clear(); }
export function registeredKinds(): string[] { return [...REGISTRY.keys()]; }

/** The solver for an obstacle: prefer an exact kind match, else the first whose canSolve() accepts it. */
export function findSolver(o: Obstacle): ObstacleSolver | null {
  const exact = REGISTRY.get(o.kind);
  if (exact && exact.canSolve(o)) return exact;
  for (const s of REGISTRY.values()) if (s.canSolve(o)) return s;
  return null;
}

/**
 * Solve an obstacle under pre-granted authority. Generates >=3 solutions, ranks by confidence, and executes
 * the best ones whose blast radius is within the granted authority (local-only by default). shared-state
 * solutions require council consensus (approveSharedState); destructive ones always defer to a human. A pass
 * that resolves nothing returns an honest ceiling with the attempts logged — never a silent dead stop.
 */
export async function solveObstacle(o: Obstacle, opts: SolveOptions = {}): Promise<SolveResult> {
  const solver = findSolver(o);
  if (!solver) {
    return { solved: false, obstacle: o, attempted: [], needsMetaSolver: true,
      ceiling: `No solver registered for obstacle class "${o.kind}" — META-SOLVE: build, test, and register one (the missing solver IS the next sub-problem to solve).` };
  }

  const solutions = await solver.proposeSolutions(o);
  if (solutions.length < 3) {
    return { solved: false, obstacle: o, attempted: [],
      ceiling: `Solver "${solver.kind}" returned ${solutions.length} solution(s) — the never-say-can't discipline requires >=3. Treat the gap as a sub-problem: broaden the solution search.` };
  }

  const authority = opts.authority ?? 'local-only';
  const ranked = [...solutions].sort((a, b) => b.confidence - a.confidence).slice(0, opts.maxAttempts ?? 3);
  const attempted: SolveAttempt[] = [];

  for (const sol of ranked) {
    if (RADIUS_ORDER[sol.blastRadius] > RADIUS_ORDER[authority]) {
      // Beyond pre-granted authority — escalate honestly (consensus or human), do NOT silently skip.
      if (sol.blastRadius === 'shared-state' && opts.approveSharedState) {
        if (!(await opts.approveSharedState(sol))) {
          attempted.push({ solution: sol.description, blastRadius: sol.blastRadius, outcome: 'deferred-needs-consensus', detail: 'council consensus withheld' });
          continue;
        }
      } else {
        attempted.push({ solution: sol.description, blastRadius: sol.blastRadius,
          outcome: sol.blastRadius === 'destructive' ? 'deferred-needs-human' : 'deferred-needs-consensus',
          detail: `blast radius ${sol.blastRadius} exceeds pre-granted authority ${authority}` });
        continue;
      }
    }
    const r = await sol.apply();
    attempted.push({ solution: sol.description, blastRadius: sol.blastRadius, outcome: r.ok ? 'applied' : 'failed', detail: r.detail });
    if (r.ok) return { solved: true, obstacle: o, attempted };
  }

  return { solved: false, obstacle: o, attempted,
    ceiling: `Exhausted ${attempted.length} solution(s) within ${authority} authority. Next: escalate the highest-confidence deferred solution for consensus/human, or widen authority. Logged, not abandoned.` };
}
