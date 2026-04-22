// Headless Claude Code agent spawner — parallel execution engine for party mode.
import { spawn } from 'node:child_process';
import { logger } from './logger.js';

import type { AgentRole } from './subagent-isolator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HeadlessAgentConfig {
  role: AgentRole;
  prompt: string;
  model?: string;
  maxBudgetUsd?: number;
  allowedTools?: string[];
  timeoutMs?: number;
  sessionId?: string;
  cwd?: string;
}

export interface HeadlessAgentResult {
  role: AgentRole;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  tokenUsage?: { input: number; output: number; cost: number };
}

export interface SpawnerOptions {
  maxParallel?: number;
  fallbackToApi?: boolean;
  /** Injection seam for testing — replaces child_process.spawn */
  _spawnFn?: (cmd: string, args: string[], opts: Record<string, unknown>) => {
    stdout: { on(event: string, cb: (data: Buffer) => void): void };
    stderr: { on(event: string, cb: (data: Buffer) => void): void };
    on(event: string, cb: (code: number | null) => void): void;
    kill(signal?: string): boolean;
    pid?: number;
  };
  /** Injection seam for testing — replaces the LLM API call used in fallback mode */
  _apiCaller?: (prompt: string) => Promise<string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PARALLEL = 4;
const ABSOLUTE_MAX_PARALLEL = 8;
const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const CLAUDE_CLI_BINARY = 'claude';

// ---------------------------------------------------------------------------
// CLI availability cache
// ---------------------------------------------------------------------------

let cachedCliAvailable: boolean | null = null;

/**
 * Reset the cached CLI availability result.
 * Exported for tests that need to verify caching behaviour.
 */
export function resetCliAvailabilityCache(): void {
  cachedCliAvailable = null;
}

/**
 * Check whether the `claude` CLI is available on the system PATH.
 * Uses `where` on Windows and `which` on Unix. The result is cached after
 * the first successful probe so subsequent calls are free.
 */
export async function isClaudeCliAvailable(
  options?: { _spawnFn?: SpawnerOptions['_spawnFn'] },
): Promise<boolean> {
  if (cachedCliAvailable !== null) return cachedCliAvailable;

  const isWindows = process.platform === 'win32';
  const lookupCmd = isWindows ? 'where' : 'which';
  const spawnFn = options?._spawnFn ?? defaultSpawn;

  try {
    const available = await new Promise<boolean>((resolve) => {
      const child = spawnFn(lookupCmd, [CLAUDE_CLI_BINARY], { stdio: 'pipe', shell: false });

      let resolved = false;
      const finish = (result: boolean) => {
        if (resolved) return;
        resolved = true;
        resolve(result);
      };

      child.on('close', (code: number | null) => finish(code === 0));
      child.on('error', () => finish(false));
    });

    cachedCliAvailable = available;
    return available;
  } catch {
    cachedCliAvailable = false;
    return false;
  }
}

// ---------------------------------------------------------------------------
// CLI arg builder
// ---------------------------------------------------------------------------

/**
 * Build the CLI argument array from a HeadlessAgentConfig.
 * Exported separately for testability.
 */
export function buildCliArgs(config: HeadlessAgentConfig): string[] {
  const args: string[] = ['-p', '--output-format', 'stream-json'];

  if (config.model) {
    args.push('--model', config.model);
  }

  if (config.maxBudgetUsd !== undefined && config.maxBudgetUsd > 0) {
    args.push('--max-budget-usd', String(config.maxBudgetUsd));
  }

  if (config.allowedTools && config.allowedTools.length > 0) {
    for (const tool of config.allowedTools) {
      args.push('--allowedTools', tool);
    }
  }

  // The prompt itself is appended last as a positional argument
  args.push(config.prompt);

  return args;
}

// ---------------------------------------------------------------------------
// Stream-JSON parser
// ---------------------------------------------------------------------------

/**
 * Parse Claude CLI stream-json output.
 *
 * Each line of stdout is a JSON object. We look for `type: "result"` messages
 * to extract the final text and optional token usage information.
 */
export function parseStreamJsonOutput(
  stdout: string,
): { text: string; tokenUsage?: { input: number; output: number; cost: number } } {
  let text = '';
  let tokenUsage: { input: number; output: number; cost: number } | undefined;

  const lines = stdout.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;

      if (parsed.type === 'result') {
        // The result message carries the final text payload
        if (typeof parsed.result === 'string') {
          text = parsed.result;
        } else if (typeof parsed.text === 'string') {
          text = parsed.text;
        }

        // Token usage may be nested under a usage or cost_info key
        const usage = (parsed.usage ?? parsed.cost_info ?? parsed.token_usage) as Record<string, unknown> | undefined;
        if (usage && typeof usage === 'object') {
          const input = Number(usage.input_tokens ?? usage.input ?? 0);
          const output = Number(usage.output_tokens ?? usage.output ?? 0);
          const cost = Number(usage.cost ?? usage.total_cost ?? 0);
          if (input > 0 || output > 0 || cost > 0) {
            tokenUsage = { input, output, cost };
          }
        }
      }

      // Also accumulate content_block_delta text fragments for streaming output
      if (parsed.type === 'content_block_delta') {
        const delta = parsed.delta as Record<string, unknown> | undefined;
        if (delta && typeof delta.text === 'string') {
          text += delta.text;
        }
      }

      // Handle assistant message content array
      if (parsed.type === 'message' && Array.isArray(parsed.content)) {
        for (const block of parsed.content as Array<Record<string, unknown>>) {
          if (block.type === 'text' && typeof block.text === 'string') {
            text += block.text;
          }
        }
      }
    } catch {
      // Non-JSON lines are silently skipped — Claude CLI may emit progress output
    }
  }

  return { text, tokenUsage };
}

// ---------------------------------------------------------------------------
// Single agent spawner
// ---------------------------------------------------------------------------

/**
 * Spawn a single headless Claude Code CLI instance.
 *
 * The function builds the CLI args, spawns the process, collects stdout/stderr,
 * enforces an optional timeout, and parses stream-json for token usage.
 */
export async function spawnHeadlessAgent(
  config: HeadlessAgentConfig,
  options?: SpawnerOptions,
): Promise<HeadlessAgentResult> {
  const spawnFn = options?._spawnFn ?? defaultSpawn;
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const start = Date.now();

  const cliArgs = buildCliArgs(config);
  const spawnOpts: Record<string, unknown> = {
    stdio: 'pipe',
    shell: false,
    ...(config.cwd ? { cwd: config.cwd } : {}),
  };

  logger.verbose(`[HeadlessSpawner] Spawning ${config.role} agent (timeout=${timeoutMs}ms)`);

  try {
    const result = await new Promise<HeadlessAgentResult>((resolve) => {
      const child = spawnFn(CLAUDE_CLI_BINARY, cliArgs, spawnOpts);

      let stdoutBuf = '';
      let stderrBuf = '';
      let resolved = false;
      let timedOut = false;

      const finish = (exitCode: number) => {
        if (resolved) return;
        resolved = true;

        if (timer !== null) {
          clearTimeout(timer);
        }

        const durationMs = Date.now() - start;
        const parsed = parseStreamJsonOutput(stdoutBuf);

        if (timedOut) {
          stderrBuf += (stderrBuf ? '\n' : '') + `Process timed out after ${timeoutMs}ms`;
        }

        resolve({
          role: config.role,
          exitCode,
          stdout: parsed.text || stdoutBuf,
          stderr: stderrBuf,
          durationMs,
          tokenUsage: parsed.tokenUsage,
        });
      };

      child.stdout.on('data', (data: Buffer) => {
        stdoutBuf += data.toString();
      });

      child.stderr.on('data', (data: Buffer) => {
        stderrBuf += data.toString();
      });

      child.on('close', (code: number | null) => {
        finish(code ?? 1);
      });

      child.on('error', (errOrCode: number | null) => {
        // The _spawnFn type collapses all event signatures; on a real process
        // the 'error' callback receives an Error, so we handle both shapes.
        const errObj = errOrCode as unknown;
        const msg = (typeof errObj === 'object' && errObj !== null && 'message' in errObj)
          ? String((errObj as { message: unknown }).message)
          : `spawn failed (code ${String(errOrCode)})`;
        stderrBuf += (stderrBuf ? '\n' : '') + `Spawn error: ${msg}`;
        finish(1);
      });

      // Timeout enforcement — kill the child if it exceeds the deadline
      const timer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        if (resolved) return;
        timedOut = true;
        logger.warn(`[HeadlessSpawner] ${config.role} agent timed out after ${timeoutMs}ms — killing`);
        try {
          child.kill('SIGTERM');
        } catch {
          // best-effort kill — process may already have exited
        }
      }, timeoutMs);
    });

    if (result.exitCode !== 0) {
      logger.warn(`[HeadlessSpawner] ${config.role} agent exited with code ${result.exitCode}`);
    } else {
      logger.verbose(`[HeadlessSpawner] ${config.role} agent completed in ${result.durationMs}ms`);
    }

    if (result.exitCode !== 0 && options?.fallbackToApi) {
      logger.info(`[HeadlessSpawner] ${config.role} agent spawn failed — attempting API fallback`);
      try {
        const apiCaller = options._apiCaller ?? (async (prompt: string) => {
          const { callLLM } = await import('./llm.js');
          return callLLM(prompt);
        });
        const apiResponse = await apiCaller(config.prompt);
        const fallbackDuration = Date.now() - start;
        logger.info(`[HeadlessSpawner] ${config.role} API fallback succeeded in ${fallbackDuration}ms`);
        return {
          role: config.role,
          exitCode: 0,
          stdout: apiResponse,
          stderr: '',
          durationMs: fallbackDuration,
        };
      } catch (apiErr) {
        const msg = apiErr instanceof Error ? apiErr.message : String(apiErr);
        logger.warn(`[HeadlessSpawner] ${config.role} API fallback also failed: ${msg}`);
        // Return original spawn error
      }
    }

    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`[HeadlessSpawner] ${config.role} agent crashed: ${message}`);

    return {
      role: config.role,
      exitCode: 1,
      stdout: '',
      stderr: message,
      durationMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Parallel spawner
// ---------------------------------------------------------------------------

/**
 * Resolve the effective maximum parallelism.
 *
 * Priority: `DANTEFORGE_MAX_PARALLEL_AGENTS` env var > options.maxParallel > default (4).
 * The value is clamped between 1 and ABSOLUTE_MAX_PARALLEL (8).
 */
function resolveMaxParallel(options?: SpawnerOptions): number {
  const envValue = process.env.DANTEFORGE_MAX_PARALLEL_AGENTS;
  const fromEnv = envValue ? parseInt(envValue, 10) : NaN;

  let raw: number;
  if (!Number.isNaN(fromEnv) && fromEnv > 0) {
    raw = fromEnv;
  } else if (options?.maxParallel !== undefined && options.maxParallel > 0) {
    raw = options.maxParallel;
  } else {
    raw = DEFAULT_MAX_PARALLEL;
  }

  return Math.max(1, Math.min(raw, ABSOLUTE_MAX_PARALLEL));
}

/**
 * Spawn multiple headless Claude Code agents in parallel, respecting a
 * configurable concurrency limit.
 *
 * Configs are chunked into batches of size `maxParallel`. Each batch runs
 * with `Promise.all()` before the next batch starts.
 */
export async function spawnParallelAgents(
  configs: HeadlessAgentConfig[],
  options?: SpawnerOptions,
): Promise<HeadlessAgentResult[]> {
  if (configs.length === 0) return [];

  const maxParallel = resolveMaxParallel(options);
  logger.info(`[HeadlessSpawner] Spawning ${configs.length} agent(s) with maxParallel=${maxParallel}`);

  const results: HeadlessAgentResult[] = [];
  const chunks = chunkArray(configs, maxParallel);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;
    logger.verbose(`[HeadlessSpawner] Running batch ${i + 1}/${chunks.length} (${chunk.length} agent(s))`);

    const batchResults = await Promise.all(
      chunk.map((config) => spawnHeadlessAgent(config, options)),
    );
    results.push(...batchResults);
  }

  const failed = results.filter((r) => r.exitCode !== 0);
  if (failed.length > 0) {
    logger.warn(`[HeadlessSpawner] ${failed.length}/${results.length} agent(s) failed`);
  } else {
    logger.info(`[HeadlessSpawner] All ${results.length} agent(s) completed successfully`);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Default spawn wrapper that delegates to child_process.spawn.
 * This is the production code path — tests inject `_spawnFn` instead.
 */
function defaultSpawn(
  cmd: string,
  args: string[],
  opts: Record<string, unknown>,
): ReturnType<NonNullable<SpawnerOptions['_spawnFn']>> {
  const child = spawn(cmd, args, opts as Parameters<typeof spawn>[2]);
  return {
    stdout: child.stdout!,
    stderr: child.stderr!,
    on: child.on.bind(child) as ReturnType<NonNullable<SpawnerOptions['_spawnFn']>>['on'],
    kill: (sig?: string) => child.kill(sig as NodeJS.Signals | undefined),
    pid: child.pid,
  };
}

/**
 * Split an array into chunks of a given size.
 */
function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
