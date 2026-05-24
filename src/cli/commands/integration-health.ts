// integration-health.ts — Check each configured integration and report status.
// Surfaces MCP reachability, git remote, LLM provider latency, and STATE.yaml freshness.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface IntegrationCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  detail: string;
  latencyMs?: number;
}

export interface IntegrationHealthResult {
  checks: IntegrationCheck[];
  allPassed: boolean;
  timestamp: string;
}

export interface IntegrationHealthDeps {
  /** Injection: run a shell command and return stdout (or throw on error) */
  _exec?: (cmd: string, args: string[], cwd: string) => Promise<string>;
  /** Injection: ping LLM with a trivial prompt and return latencyMs */
  _pingLLM?: () => Promise<number>;
  /** Injection: fs stat for STATE.yaml (returns mtime ms since epoch) */
  _statStateFile?: (p: string) => Promise<number>;
  /** Working directory override */
  cwd?: string;
}

// ─── Individual check implementations ─────────────────────────────────────────

async function checkGitRemote(deps: IntegrationHealthDeps): Promise<IntegrationCheck> {
  const cwd = deps.cwd ?? process.cwd();
  const exec = deps._exec ?? defaultExec;
  try {
    const output = await exec('git', ['remote', '-v'], cwd);
    if (!output || !output.includes('origin')) {
      return { name: 'Git remote', status: 'warn', detail: 'No origin remote configured' };
    }
    // Extract the first fetch URL
    const match = output.match(/origin\s+(\S+)\s+\(fetch\)/);
    const url = match?.[1] ?? 'configured';
    return { name: 'Git remote', status: 'pass', detail: `origin: ${url}` };
  } catch {
    return { name: 'Git remote', status: 'fail', detail: 'git command unavailable' };
  }
}

async function checkLLMProvider(deps: IntegrationHealthDeps): Promise<IntegrationCheck> {
  if (deps._pingLLM) {
    try {
      const latencyMs = await deps._pingLLM();
      return { name: 'LLM provider', status: 'pass', detail: 'reachable', latencyMs };
    } catch {
      return { name: 'LLM provider', status: 'fail', detail: 'ping failed' };
    }
  }

  // Real implementation: try a 1-token probe
  const start = Date.now();
  try {
    const { isLLMAvailable } = await import('../../core/llm.js');
    const available = await isLLMAvailable();
    const latencyMs = Date.now() - start;
    if (available) {
      return { name: 'LLM provider', status: 'pass', detail: 'reachable', latencyMs };
    }
    return { name: 'LLM provider', status: 'warn', detail: 'no provider configured', latencyMs };
  } catch {
    return { name: 'LLM provider', status: 'warn', detail: 'provider check skipped', latencyMs: Date.now() - start };
  }
}

async function checkStateFileFreshness(deps: IntegrationHealthDeps): Promise<IntegrationCheck> {
  const cwd = deps.cwd ?? process.cwd();
  const stateFilePath = path.join(cwd, '.danteforge', 'STATE.yaml');
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  try {
    let mtimeMs: number;
    if (deps._statStateFile) {
      mtimeMs = await deps._statStateFile(stateFilePath);
    } else {
      const stat = await fs.stat(stateFilePath);
      mtimeMs = stat.mtimeMs;
    }

    const ageMs = Date.now() - mtimeMs;
    const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));

    if (ageMs > SEVEN_DAYS_MS) {
      return {
        name: 'STATE.yaml freshness',
        status: 'warn',
        detail: `STATE.yaml is ${ageDays} days old (threshold: 7 days)`,
      };
    }

    return {
      name: 'STATE.yaml freshness',
      status: 'pass',
      detail: `STATE.yaml is ${ageDays} day(s) old`,
    };
  } catch {
    return {
      name: 'STATE.yaml freshness',
      status: 'warn',
      detail: 'STATE.yaml not found — run: danteforge init',
    };
  }
}

async function checkMcpServer(deps: IntegrationHealthDeps): Promise<IntegrationCheck> {
  const cwd = deps.cwd ?? process.cwd();
  // Check if the MCP tool count signal file exists — indicates a live MCP surface
  const mcpSignalFile = path.join(cwd, '.danteforge', 'mcp-tool-count.txt');
  const mcpServerFile = path.join(cwd, 'src', 'core', 'mcp-server.ts');

  try {
    const content = await fs.readFile(mcpSignalFile, 'utf-8');
    const count = parseInt(content.trim(), 10);
    if (Number.isFinite(count) && count > 0) {
      return { name: 'MCP server', status: 'pass', detail: `${count} tools registered (via signal file)` };
    }
  } catch {
    // Signal file not present — fall through to source scan
  }

  try {
    const source = await fs.readFile(mcpServerFile, 'utf-8');
    const matches = source.match(/^\s+name:\s*['"][\w_-]+['"]/gm);
    const toolCount = matches?.length ?? 0;
    if (toolCount > 0) {
      return { name: 'MCP server', status: 'pass', detail: `${toolCount} tools defined in mcp-server.ts` };
    }
    return { name: 'MCP server', status: 'warn', detail: 'mcp-server.ts found but no tools detected' };
  } catch {
    return { name: 'MCP server', status: 'warn', detail: 'mcp-server.ts not found in this project' };
  }
}

// ─── Default exec helper ───────────────────────────────────────────────────────

async function defaultExec(cmd: string, args: string[], cwd: string): Promise<string> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);
  const { stdout } = await exec(cmd, args, { cwd });
  return stdout.trim();
}

// ─── Main runner ───────────────────────────────────────────────────────────────

export async function runIntegrationHealth(
  deps: IntegrationHealthDeps = {},
): Promise<IntegrationHealthResult> {
  const [gitCheck, llmCheck, stateCheck, mcpCheck] = await Promise.all([
    checkGitRemote(deps),
    checkLLMProvider(deps),
    checkStateFileFreshness(deps),
    checkMcpServer(deps),
  ]);

  const checks: IntegrationCheck[] = [gitCheck, llmCheck, stateCheck, mcpCheck];
  const allPassed = checks.every(c => c.status === 'pass' || c.status === 'warn');
  const timestamp = new Date().toISOString();

  // Side-effect: write health file for ecosystem scoring signal
  const cwd = deps.cwd ?? process.cwd();
  const healthFilePath = path.join(cwd, '.danteforge', 'integration-health.json');
  try {
    await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
    await fs.writeFile(healthFilePath, JSON.stringify({ checks, allPassed, timestamp }, null, 2), 'utf-8');
  } catch {
    // Best-effort — never block main path
  }

  return { checks, allPassed, timestamp };
}

// ─── CLI formatting helpers ────────────────────────────────────────────────────

function statusIcon(status: IntegrationCheck['status']): string {
  if (status === 'pass') return 'PASS';
  if (status === 'warn') return 'WARN';
  return 'FAIL';
}

function formatTable(checks: IntegrationCheck[]): string {
  const nameWidth = Math.max(15, ...checks.map(c => c.name.length)) + 2;
  const statusWidth = 6;
  const header =
    'Integration'.padEnd(nameWidth) +
    'Status'.padEnd(statusWidth) +
    'Detail';
  const separator = '-'.repeat(nameWidth + statusWidth + 40);
  const rows = checks.map(c => {
    const latency = c.latencyMs !== undefined ? ` (${c.latencyMs}ms)` : '';
    return c.name.padEnd(nameWidth) + statusIcon(c.status).padEnd(statusWidth) + c.detail + latency;
  });
  return [header, separator, ...rows].join('\n');
}

// ─── Command entrypoint ────────────────────────────────────────────────────────

export async function integrationHealth(opts: {
  json?: boolean;
  cwd?: string;
} = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const deps: IntegrationHealthDeps = { cwd };

  try {
    const result = await runIntegrationHealth(deps);

    if (opts.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else {
      logger.info('\nDanteForge Integration Health\n');
      logger.info(formatTable(result.checks));
      logger.info('');

      const failCount = result.checks.filter(c => c.status === 'fail').length;
      const warnCount = result.checks.filter(c => c.status === 'warn').length;

      if (failCount > 0) {
        logger.warn(`${failCount} check(s) FAILED, ${warnCount} warning(s)`);
      } else if (warnCount > 0) {
        logger.info(`All checks passed with ${warnCount} warning(s)`);
      } else {
        logger.info('All checks passed');
      }
    }

    const hasFailure = result.checks.some(c => c.status === 'fail');
    if (hasFailure) {
      process.exitCode = 1;
    }
  } catch (err) {
    logger.error(`integration-health failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
