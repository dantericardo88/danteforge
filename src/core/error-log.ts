// Structured error logger — persists errors to a JSONL ledger for rate tracking and observability.
// Written to .danteforge/error-log.jsonl: one JSON object per line.
// Called from the global uncaughtException handler, circuit breaker trips, and enrichError.

import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StructuredErrorEntry {
  timestamp: string;
  code: string;
  message: string;
  command?: string;
  phase?: string;
  cwd?: string;
  stack?: string; // first 3 lines of stack only
}

export interface ErrorRateResult {
  total: number;
  byCode: Record<string, number>;
  byCommand: Record<string, number>;
  windowMs: number;
  windowLabel: string;
}

export interface ErrorLogOptions {
  /** Override the log file path (for testing). Default: <cwd>/.danteforge/error-log.jsonl */
  logFilePath?: string;
  /** Override the file writer (for testing). */
  _writeFile?: (filePath: string, line: string) => void;
  /** Override the file reader (for testing). */
  _readFile?: (filePath: string) => string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function resolveLogPath(options?: ErrorLogOptions): string {
  if (options?.logFilePath) return options.logFilePath;
  return path.join(process.cwd(), '.danteforge', 'error-log.jsonl');
}

function truncateStack(stack: string | undefined): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n');
  return lines.slice(0, 3).join('\n');
}

function ensureLogDir(logFilePath: string): void {
  const dir = path.dirname(logFilePath);
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // If we can't create the dir, logging silently fails — never block main path
    }
  }
}

function defaultWriteFile(filePath: string, line: string): void {
  ensureLogDir(filePath);
  try {
    fs.appendFileSync(filePath, line + '\n', 'utf8');
  } catch {
    // Best-effort: never throw from a logging helper
  }
}

function defaultReadFile(filePath: string): string {
  try {
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write a structured error entry to the JSONL error log.
 *
 * Best-effort: never throws, never blocks the main execution path. The error
 * code is derived automatically via `deriveErrorCode`. Stack traces are
 * truncated to the first 3 lines for brevity.
 *
 * @param err     - The error that was caught.
 * @param context - Optional context fields attached to the log entry:
 *   - `command` — CLI command that was running (e.g. `"forge"`)
 *   - `phase`   — pipeline phase (e.g. `"verify"`)
 *   - `cwd`     — working directory at the time of the error
 * @param options - Optional overrides for log path and I/O seams (for testing).
 */
export function logStructuredError(
  err: Error,
  context: { command?: string; phase?: string; cwd?: string },
  options?: ErrorLogOptions,
): void {
  try {
    const code = deriveErrorCode(err);
    const entry: StructuredErrorEntry = {
      timestamp: new Date().toISOString(),
      code,
      message: err.message,
      ...(context.command ? { command: context.command } : {}),
      ...(context.phase ? { phase: context.phase } : {}),
      ...(context.cwd ? { cwd: context.cwd } : {}),
      ...(err.stack ? { stack: truncateStack(err.stack) } : {}),
    };

    const line = JSON.stringify(entry);
    const logFilePath = resolveLogPath(options);
    const writer = options?._writeFile ?? defaultWriteFile;
    writer(logFilePath, line);
  } catch {
    // Absolute last resort — never propagate from logging
  }
}

/**
 * Read all error log entries within a time window and return aggregated counts.
 *
 * @param windowMs - How far back to look in milliseconds (default: 1 hour = 3 600 000 ms).
 * @param options  - Optional log path override and I/O seams for testing.
 * @returns An `ErrorRateResult` with:
 *   - `total` — total errors in the window
 *   - `byCode` — count per error code
 *   - `byCommand` — count per CLI command
 *   - `windowMs` / `windowLabel` — the configured window
 */
export function getErrorRate(
  windowMs = DEFAULT_WINDOW_MS,
  options?: ErrorLogOptions,
): ErrorRateResult {
  const logFilePath = resolveLogPath(options);
  const reader = options?._readFile ?? defaultReadFile;
  const raw = reader(logFilePath);

  const cutoff = Date.now() - windowMs;
  const byCode: Record<string, number> = {};
  const byCommand: Record<string, number> = {};
  let total = 0;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let entry: StructuredErrorEntry;
    try {
      entry = JSON.parse(trimmed) as StructuredErrorEntry;
    } catch {
      continue; // skip malformed lines
    }

    const ts = new Date(entry.timestamp).getTime();
    if (Number.isNaN(ts) || ts < cutoff) continue;

    total++;
    byCode[entry.code] = (byCode[entry.code] ?? 0) + 1;
    if (entry.command) {
      byCommand[entry.command] = (byCommand[entry.command] ?? 0) + 1;
    }
  }

  const minutes = Math.round(windowMs / 60_000);
  const windowLabel = minutes >= 60
    ? `${Math.round(minutes / 60)}h`
    : `${minutes}m`;

  return { total, byCode, byCommand, windowMs, windowLabel };
}

/**
 * Clear the error log file by overwriting it with an empty string.
 *
 * @param options - Optional log path override for testing.
 * @returns The number of entries that were removed, or 0 if the file
 *   did not exist or could not be cleared.
 */
export function clearErrorLog(options?: ErrorLogOptions): number {
  const logFilePath = resolveLogPath(options);
  try {
    if (!fs.existsSync(logFilePath)) return 0;
    const raw = defaultReadFile(logFilePath);
    const count = raw.split('\n').filter(l => l.trim()).length;
    fs.writeFileSync(logFilePath, '', 'utf8');
    return count;
  } catch {
    return 0;
  }
}

/**
 * Read raw JSONL entries for live polling (used by `--watch` tail mode).
 *
 * Returns only entries at or after `afterLine`, enabling incremental polling
 * without re-reading previously-seen lines.
 *
 * @param afterLine - Zero-based line offset to start from (default: 0).
 * @param options   - Optional log path override and `_readFile` injection.
 * @returns `{ entries, totalLines }` — parsed entries from `afterLine` onward,
 *   and the current total line count for the next polling offset.
 */
export function readErrorLogEntries(
  afterLine = 0,
  options?: ErrorLogOptions,
): { entries: StructuredErrorEntry[]; totalLines: number } {
  const logFilePath = resolveLogPath(options);
  const reader = options?._readFile ?? defaultReadFile;
  const raw = reader(logFilePath);

  const allLines = raw.split('\n').filter(l => l.trim());
  const entries: StructuredErrorEntry[] = [];

  for (let i = afterLine; i < allLines.length; i++) {
    try {
      entries.push(JSON.parse(allLines[i]!) as StructuredErrorEntry);
    } catch {
      // skip malformed lines
    }
  }

  return { entries, totalLines: allLines.length };
}

// ---------------------------------------------------------------------------
// Code derivation (must align with actionable-errors patterns)
// ---------------------------------------------------------------------------

const CODE_PATTERNS: Array<[RegExp, string]> = [
  [/state\.yaml.*corrupt|corrupt.*state\.yaml|state.*invalid yaml|state\.yaml.*not valid|not valid yaml/i, 'ERR_STATE_CORRUPT'],
  [/config\.yaml.*not found|config.*missing|no config found/i, 'ERR_CONFIG_MISSING'],
  [/llm.*timeout|request timed out.*provider/i, 'ERR_LLM_TIMEOUT'],
  [/rate.?limit|http 429|429 too many/i, 'ERR_LLM_RATE_LIMIT'],
  [/budget.?exceeded|cost budget|agent exceeded.*budget/i, 'ERR_BUDGET_EXCEEDED'],
  [/gate.?failed|gate.*blocked|hard gate/i, 'ERR_GATE_FAILED'],
  [/worktree.*dirty|dirty.*worktree|working tree.*dirty/i, 'ERR_WORKTREE_DIRTY'],
  [/no spec found|spec\.md.*missing|spec not found/i, 'ERR_NO_SPEC'],
  [/build failed|npm run build.*failed|compilation.*failed/i, 'ERR_BUILD_FAILED'],
  [/no tests found|tests.*not found|empty test/i, 'ERR_NO_TESTS'],
  [/circuit.*open|circuit breaker.*open/i, 'ERR_CIRCUIT_OPEN'],
  [/circuit.*reset|circuit breaker.*reset/i, 'ERR_CIRCUIT_RESET'],
  [/enoent .danteforge|no state\.yaml/i, 'ERR_NO_INIT'],
  [/connection refused|econnrefused/i, 'ERR_CONNECTION_REFUSED'],
  [/permission denied|eacces/i, 'ERR_PERMISSION_DENIED'],
];

/**
 * Derive a stable error code from an `Error` instance.
 *
 * Matches the error message against a priority-ordered list of regex patterns
 * covering the most common DanteForge failure modes. Falls back to the error's
 * own `.code` property (if it is a string), then `'ERR_UNKNOWN'`.
 *
 * @param err - The error to classify.
 * @returns A string error code such as `'ERR_LLM_TIMEOUT'`, `'ERR_NO_SPEC'`,
 *   or `'ERR_UNKNOWN'` when no pattern matches.
 *
 * @example
 * const code = deriveErrorCode(new Error('STATE.yaml is not valid YAML'));
 * // 'ERR_STATE_CORRUPT'
 */
export function deriveErrorCode(err: Error): string {
  const msg = err.message;
  for (const [pattern, code] of CODE_PATTERNS) {
    if (pattern.test(msg)) return code;
  }
  // Check if err has a .code property (DanteError / DanteForgeError)
  const codeish = (err as unknown as Record<string, unknown>)['code'];
  if (typeof codeish === 'string' && codeish && codeish !== 'ERR_UNKNOWN') {
    return codeish;
  }
  return 'ERR_UNKNOWN';
}
