import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const TSX_IMPORT = pathToFileURL(require.resolve('tsx')).href;
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
  const result = spawnSync(process.execPath, ['--import', TSX_IMPORT, CLI_ENTRY, ...args], {
    encoding: 'utf8',
    timeout: options?.timeout ?? 180000,
    cwd: options?.cwd ?? process.cwd(),
    env: {
      ...process.env,
      NODE_NO_WARNINGS: '1',
      ...options?.env,
    },
  });

  return {
    stdout: result.stdout ?? '',
    stderr: `${result.stderr ?? ''}${result.error ? `${result.stderr ? '\n' : ''}[spawn-error] ${result.error.message}` : ''}`,
    status: result.status ?? (result.error ? 1 : null),
    error: result.error ?? null,
  };
}
