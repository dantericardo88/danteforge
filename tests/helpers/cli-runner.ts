import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve('tsx/cli');
const CLI_ENTRY = path.resolve('src/cli/index.ts');

export interface CliRunResult {
  stdout: string;
  stderr: string;
  status: number | null;
  error: Error | null;
}

export function runTsxCli(args: string[], options?: {
  cwd?: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}): CliRunResult {
  const result = spawnSync(process.execPath, [TSX_CLI, CLI_ENTRY, ...args], {
    encoding: 'utf8',
    timeout: options?.timeout ?? 60000,
    cwd: options?.cwd ?? process.cwd(),
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
      ...options?.env,
    },
  });

  return {
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    status: result.status,
    error: result.error ?? null,
  };
}
