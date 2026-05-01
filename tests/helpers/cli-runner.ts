import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const TSX_IMPORT = pathToFileURL(require.resolve('tsx')).href;
const CLI_ENTRY = path.resolve('src/cli/index.ts');
const PROVIDER_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'DANTEFORGE_ANTHROPIC_API_KEY',
  'DANTEFORGE_CLAUDE_API_KEY',
  'DANTEFORGE_DELEGATE52_LIVE',
  'DANTEFORGE_GEMINI_API_KEY',
  'DANTEFORGE_GROK_API_KEY',
  'DANTEFORGE_LIVE_PROVIDERS',
  'DANTEFORGE_LLM_API_KEY',
  'DANTEFORGE_OPENAI_API_KEY',
  'DANTEFORGE_XAI_API_KEY',
  'GEMINI_API_KEY',
  'GROK_API_KEY',
  'OPENAI_API_KEY',
  'XAI_API_KEY',
];

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
  const env = { ...process.env };
  for (const key of PROVIDER_ENV_KEYS) {
    delete env[key];
  }

  const result = spawnSync(process.execPath, ['--import', TSX_IMPORT, CLI_ENTRY, ...args], {
    encoding: 'utf8',
    timeout: options?.timeout ?? 180000,
    cwd: options?.cwd ?? process.cwd(),
    env: {
      ...env,
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
