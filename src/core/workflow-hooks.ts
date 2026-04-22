// Workflow Hooks — load and fire pre/post command hooks from .danteforge/hooks.yaml
import path from 'path';

export interface HookDefinition {
  command: string;           // 'forge' | 'verify' | '*' (wildcard)
  when: 'pre' | 'post';
  run: string;               // shell command
  timeout?: number;          // ms, default 30000
  continueOnError?: boolean;
}

export interface WorkflowHooksOptions {
  _readFile?: (p: string) => Promise<string>;
  _exec?: (cmd: string, opts: { timeout: number; cwd: string }) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  cwd?: string;
}

export interface HookFireResult {
  hook: HookDefinition;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  skipped: boolean;
}

function isHookDefinition(item: unknown): item is HookDefinition {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  const h = item as Record<string, unknown>;
  return (
    typeof h['command'] === 'string' &&
    (h['when'] === 'pre' || h['when'] === 'post') &&
    typeof h['run'] === 'string'
  );
}

async function parseHooksFromYaml(content: string): Promise<HookDefinition[]> {
  if (!content || content.trim().length === 0) return [];
  try {
    const { parse } = await import('yaml');
    const parsed = parse(content) as unknown;
    if (!parsed || !Array.isArray(parsed)) return [];
    const result: HookDefinition[] = [];
    for (const item of parsed) {
      if (isHookDefinition(item)) {
        result.push(item as HookDefinition);
      }
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Reads .danteforge/hooks.yaml. Returns [] if file doesn't exist.
 */
export async function loadHooks(opts?: WorkflowHooksOptions): Promise<HookDefinition[]> {
  const cwd = opts?.cwd ?? process.cwd();
  const readFile = opts?._readFile ?? ((p: string) => import('fs/promises').then(m => m.readFile(p, 'utf8')));
  const hooksPath = path.join(cwd, '.danteforge', 'hooks.yaml');

  try {
    const content = await readFile(hooksPath);
    return await parseHooksFromYaml(content);
  } catch {
    return [];
  }
}

async function defaultExec(
  cmd: string,
  opts: { timeout: number; cwd: string },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { exec } = await import('child_process');
  return new Promise((resolve) => {
    const child = exec(
      cmd,
      { timeout: opts.timeout, cwd: opts.cwd },
      (error, stdout, stderr) => {
        const exitCode = error?.code !== undefined
          ? (typeof error.code === 'number' ? error.code : 1)
          : 0;
        resolve({ exitCode, stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
    // child is unused directly — the callback handles resolution
    void child;
  });
}

/**
 * Fires all hooks matching command+when (also fires wildcard '*' hooks).
 * Returns one HookFireResult per matched hook.
 */
export async function fireHook(
  command: string,
  when: 'pre' | 'post',
  opts?: WorkflowHooksOptions,
): Promise<HookFireResult[]> {
  const hooks = await loadHooks(opts);
  const cwd = opts?.cwd ?? process.cwd();
  const execFn = opts?._exec ?? defaultExec;

  const matching = hooks.filter(h => h.when === when && (h.command === command || h.command === '*'));
  if (matching.length === 0) return [];

  const results: HookFireResult[] = [];

  for (const hook of matching) {
    const timeout = hook.timeout ?? 30000;
    const start = Date.now();
    try {
      const { exitCode, stdout, stderr } = await execFn(hook.run, { timeout, cwd });
      results.push({
        hook,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - start,
        skipped: false,
      });
    } catch (err) {
      results.push({
        hook,
        exitCode: 1,
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
        skipped: false,
      });
    }
  }

  return results;
}
