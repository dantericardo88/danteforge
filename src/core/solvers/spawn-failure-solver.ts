// spawn-failure-solver.ts — the first registered obstacle solver: a command that won't launch.
//
// The exact class the operator hit this session (`npx tsx --test …` ENOENT on Windows, because npx is a
// .cmd wrapper execFile can't launch). Should never need a human again. Each solution declares a TYPED
// shell EFFECT (the kernel runs it + derives the radius) — none of these touch the destructive or
// score-surface patterns, so the kernel derives them local-only and auto-executes them. The solver does
// NOT self-label its radius (the v1 hole the red-team broke); it only says WHAT to run.

import type { ObstacleSolver, Solution, Obstacle } from '../obstacle-registry.js';

const SPAWN_FAILURE_RE = /ENOENT|command not found|is not recognized|spawn\s+\S+\s+ENOENT|exit(?:\s*code)?\s*127/i;

function startsWithCmdWrapper(command: string): boolean {
  return /^(?:npx|pnpx|npm|yarn|pnpm|tsx)\b/i.test(command.trim());
}

export const spawnFailureSolver: ObstacleSolver = {
  kind: 'spawn-failure',
  canSolve: (o: Obstacle) => SPAWN_FAILURE_RE.test(o.signal),
  proposeSolutions: async (o: Obstacle): Promise<Solution[]> => {
    const command = String(o.context?.command ?? '');
    const cwd = String(o.context?.cwd ?? '');
    return [
      {
        id: 'shell-route', confidence: startsWithCmdWrapper(command) ? 0.95 : 0.7,
        description: 'Route the command through the platform shell (cmd /c | sh -c) so .cmd/.bat wrappers (npx, npm, yarn) resolve — the launch fix.',
        effect: { kind: 'shell', command, cwd, successWhen: 'launches' },
      },
      {
        id: 'npx-yes', confidence: /^npx\b/i.test(command.trim()) ? 0.6 : 0.2,
        description: 'Retry with `npx --yes` to auto-provision a missing local binary instead of prompting.',
        effect: { kind: 'shell', command: command.replace(/^npx\b/i, 'npx --yes'), cwd, successWhen: 'launches' },
      },
      {
        id: 'install-then-retry', confidence: 0.4,
        description: 'Provision dependencies (npm ci || npm install) then re-run the command — for a genuinely missing tool.',
        effect: { kind: 'shell', command: `(npm ci || npm install) && ${command}`, cwd, successWhen: 'launches' },
      },
    ];
  },
};

/** Back-compat factory (the runner is now the kernel's, not the solver's — kept for callers/tests). */
export function makeSpawnFailureSolver(): ObstacleSolver { return spawnFailureSolver; }
