// Autoforge Executor — production command dispatcher for the autonomous loop.
// Spawns the CLI in a child process so each command (forge, verify, etc.) runs
// in full isolation with the correct module graph and env.
import { spawnSync } from 'node:child_process';

/**
 * Execute a single autoforge command by spawning the CLI as a child process.
 * Returns { success: true } only when the exit code is 0.
 *
 * @param command - CLI command string, e.g. "verify" or "forge 1"
 * @param cwd     - Project directory passed to spawnSync
 */
export async function executeAutoforgeCommand(
  command: string,
  cwd: string,
): Promise<{ success: boolean }> {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  const result = spawnSync(process.execPath, [process.argv[1]!, ...parts], {
    cwd,
    stdio: 'inherit',
    env: process.env,
  });
  return { success: result.status === 0 };
}
