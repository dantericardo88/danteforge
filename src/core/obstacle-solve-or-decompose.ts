// obstacle-solve-or-decompose.ts — the ONE-CALL no-walls primitive every DanteForge loop uses at a hard
// point. The operator's standing instruction: when inferno / ascend / forge / any function hits something
// hard, PROBLEM-SOLVE — never hit a wall. Drop this where a loop would otherwise `break`, log a "ceiling",
// or give up:
//
//   const receipt = await solveOrDecompose(obstacle, { cwd, proposeChildren, escalate });
//
// It (1) runs obstacle-registry's solveObstacle (>=3 ranked solutions, kernel-executed safely), and if that
// does not solve, (2) enforces the no-walls contract — decompose into >=2 named child sub-problems or
// escalate — and (3) RECORDS each child to the challenge ledger as DEFINED next-work. A wall becomes a
// worklist of smaller problems, tracked and owned, never a silent stop.

import { solveObstacle, type Obstacle, type SolveOptions } from './obstacle-registry.js';
import { decomposeOrEscalate, type DecomposeOptions, type DecompositionReceipt } from './obstacle-decomposition.js';
import { addChallenge } from './self-challenge.js';

export interface SolveOrDecomposeOptions extends DecomposeOptions {
  /** Options forwarded to solveObstacle (authority, runShell seam, …). */
  solveOptions?: SolveOptions;
  /** Project dir for the ledger write. Omit (or set record:false) to skip recording (e.g. dry runs/tests). */
  cwd?: string;
  /** Default true: record decomposed children to the ledger. */
  record?: boolean;
  /** Seam: override solveObstacle (tests). */
  _solve?: (o: Obstacle, opts?: SolveOptions) => Promise<import('./obstacle-registry.js').SolveResult>;
  /** Seam: override the ledger writer (tests). */
  _record?: (receipt: DecompositionReceipt, cwd: string) => Promise<string[]>;
}

/**
 * Solve an obstacle or break it into smaller ones — never a wall. Returns the decomposition receipt
 * (solved / decomposed-with-recorded-children / escalated). Throws WallError only if a caller supplies
 * neither children nor escalation for an unsolved obstacle (a programming error: the loop tried to give up).
 */
export async function solveOrDecompose(o: Obstacle, opts: SolveOrDecomposeOptions = {}): Promise<DecompositionReceipt> {
  const solve = opts._solve ?? solveObstacle;
  const result = await solve(o, opts.solveOptions);
  const receipt = await decomposeOrEscalate(result, opts);
  if (receipt.resolution.kind === 'decomposed' && opts.record !== false && opts.cwd) {
    const record = opts._record ?? recordDecomposition;
    await record(receipt, opts.cwd);
  }
  return receipt;
}

/**
 * Bridge: write a decomposition's child sub-problems to the challenge ledger as DEFINED, open challenges —
 * so the recursion's output becomes real, trackable next-work. Returns the new challenge ids. A child too
 * vague for the ledger's "defined problem" gate is skipped (not fatal) — decomposition must produce real
 * problems, not noise.
 */
export async function recordDecomposition(receipt: DecompositionReceipt, cwd: string): Promise<string[]> {
  if (receipt.resolution.kind !== 'decomposed') return [];
  const attempted = receipt.attempted.map(a => a.solution).join('; ') || 'none';
  // Dedup by title against OPEN challenges so a per-instance loop calling this repeatedly records each child
  // ONCE — decomposition must produce a worklist, never spam (the council's anti-runaway caveat).
  const { loadChallenges } = await import('./self-challenge.js');
  const open = new Set((await loadChallenges(cwd)).filter(c => c.status === 'open').map(c => c.title));
  const ids: string[] = [];
  for (const child of receipt.resolution.children) {
    const title = `[${receipt.parent.kind} → ${child.kind}] ${child.signal}`.slice(0, 120);
    if (open.has(title)) continue; // already tracked — no duplicate
    try {
      const c = await addChallenge(cwd, {
        title,
        problem: child.signal,
        evidence: `Decomposed from "${receipt.parent.kind}" (${receipt.signal}). Solutions already attempted: ${attempted}.`.slice(0, 600),
        opportunity: child.rationale,
      });
      ids.push(c.id);
      open.add(title);
    } catch { /* child below the ledger's defined-problem bar — skip, don't abort the decomposition */ }
  }
  return ids;
}
