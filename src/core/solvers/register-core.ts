// register-core.ts — register the built-in obstacle solvers into the live registry (idempotent).
// The loop calls this before routing an obstacle through solveObstacle, so the DNA is actually USED
// (the red-team's "zero production callers" gap) rather than a tested-but-dormant mechanism.

import { registerSolver, registeredKinds } from '../obstacle-registry.js';
import { spawnFailureSolver } from './spawn-failure-solver.js';

let registered = false;

export function registerCoreSolvers(): void {
  if (registered) return;
  registerSolver(spawnFailureSolver);
  // Future built-in solvers register here; the meta-solver adds the rest at runtime.
  registered = true;
}

/** For tests: re-arm registration (clearSolvers() in the registry doesn't reset this module's latch). */
export function _resetCoreSolvers(): void { registered = false; }

export { registeredKinds };
