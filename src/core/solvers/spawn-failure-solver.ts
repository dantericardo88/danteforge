// spawn-failure-solver.ts — the first registered obstacle solver: a command that won't launch.
//
// This is the EXACT class the operator hit this session (`npx tsx --test …` ENOENT on Windows, because
// npx is a .cmd wrapper execFile can't launch). It should never need a human again. All three candidate
// solutions are local-only (re-running / installing a tool is safe + local), so they auto-execute under
// pre-granted authority — diagnose -> 3 solutions -> best -> execute, with no approval.

import { execFile } from 'node:child_process';
import type { ObstacleSolver, Solution, Obstacle } from '../obstacle-registry.js';

/** Run a command, optionally through the platform shell (so .cmd wrappers like npx/npm resolve). exit code. */
export type CommandRunner = (command: string, cwd: string, viaShell: boolean) => Promise<number>;

const defaultRunner: CommandRunner = (command, cwd, viaShell) =>
  new Promise(resolve => {
    const [file, args] = viaShell
      ? (process.platform === 'win32' ? [process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command]] : ['/bin/sh', ['-c', command]])
      : (() => { const p = command.split(/\s+/); return [p[0]!, p.slice(1)]; })();
    const child = execFile(file as string, args as string[], { cwd, timeout: 180_000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err) => {
      const code = (err as (NodeJS.ErrnoException & { code?: number | string }) | null)?.code;
      resolve(typeof code === 'number' ? code : (err ? 1 : 0));
    });
    child.on('error', () => resolve(127));
  });

const SPAWN_FAILURE_RE = /ENOENT|command not found|is not recognized|spawn\s+\S+\s+ENOENT|exit(?:\s*code)?\s*127/i;

/** A command whose first token is a Windows .cmd wrapper that execFile can't launch directly. */
function startsWithCmdWrapper(command: string): boolean {
  return /^(?:npx|pnpx|npm|yarn|pnpm|tsx)\b/i.test(command.trim());
}

export function makeSpawnFailureSolver(run: CommandRunner = defaultRunner): ObstacleSolver {
  return {
    kind: 'spawn-failure',
    canSolve: (o: Obstacle) => SPAWN_FAILURE_RE.test(o.signal),
    proposeSolutions: async (o: Obstacle): Promise<Solution[]> => {
      const command = String(o.context?.command ?? '');
      const cwd = String(o.context?.cwd ?? process.cwd());
      const verify = async (cmd: string, viaShell: boolean): Promise<{ ok: boolean; detail: string }> => {
        const code = await run(cmd, cwd, viaShell);
        return { ok: code !== 127, detail: code === 127 ? `still won't launch (exit 127): ${cmd}` : `launches now (exit ${code}) via ${viaShell ? 'shell' : 'direct'}: ${cmd}` };
      };
      return [
        {
          id: 'shell-route', blastRadius: 'local-only', confidence: startsWithCmdWrapper(command) ? 0.95 : 0.7,
          description: 'Route the command through the platform shell (cmd /c | sh -c) so .cmd/.bat wrappers (npx, npm, yarn) resolve — the launch fix, no command change.',
          apply: () => verify(command, true),
        },
        {
          id: 'npx-yes', blastRadius: 'local-only', confidence: /^npx\b/i.test(command.trim()) ? 0.6 : 0.2,
          description: 'Retry with `npx --yes` to auto-provision a missing local binary instead of prompting.',
          apply: () => verify(command.replace(/^npx\b/i, 'npx --yes'), true),
        },
        {
          id: 'install-then-retry', blastRadius: 'local-only', confidence: 0.4,
          description: 'Provision dependencies (npm ci || npm install), then re-run the command — for a genuinely missing tool, not just a launch-shape issue.',
          apply: async () => {
            await run('npm ci || npm install', cwd, true);
            return verify(command, true);
          },
        },
      ];
    },
  };
}
