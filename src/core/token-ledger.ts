// Per-session token ledger — records every LLM call and persists to JSONL for cost visibility.
// Provides pre-flight cost estimation and cross-session spend totals.
import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';

// ── Pricing table ─────────────────────────────────────────────────────────────

/**
 * Model pricing in USD per 1M tokens (input / output).
 * Keys are matched by prefix so "claude-3-5-sonnet-20241022" matches "claude-3-5-sonnet".
 */
const MODEL_PRICING: Array<{ prefix: string; inputPer1M: number; outputPer1M: number }> = [
  // Claude 4.x models (latest family)
  { prefix: 'claude-opus-4', inputPer1M: 15.00, outputPer1M: 75.00 },
  { prefix: 'claude-sonnet-4-6', inputPer1M: 3.00, outputPer1M: 15.00 },
  { prefix: 'claude-sonnet-4-5', inputPer1M: 3.00, outputPer1M: 15.00 },
  { prefix: 'claude-haiku-4-5', inputPer1M: 0.80, outputPer1M: 4.00 },
  { prefix: 'claude-sonnet-4', inputPer1M: 3.00, outputPer1M: 15.00 },
  { prefix: 'claude-haiku-4', inputPer1M: 0.80, outputPer1M: 4.00 },
  // Claude 3.x models
  { prefix: 'claude-3-7-sonnet', inputPer1M: 3.00, outputPer1M: 15.00 },
  { prefix: 'claude-3-5-sonnet', inputPer1M: 3.00, outputPer1M: 15.00 },
  { prefix: 'claude-3-5-haiku', inputPer1M: 0.80, outputPer1M: 4.00 },
  { prefix: 'claude-3-haiku', inputPer1M: 0.25, outputPer1M: 1.25 },
  { prefix: 'claude-3-opus', inputPer1M: 15.00, outputPer1M: 75.00 },
  { prefix: 'claude-3-sonnet', inputPer1M: 3.00, outputPer1M: 15.00 },
  // Claude generic prefixes (fallback, ordered longest-first above)
  { prefix: 'claude-sonnet', inputPer1M: 3.00, outputPer1M: 15.00 },
  { prefix: 'claude-haiku', inputPer1M: 0.80, outputPer1M: 4.00 },
  { prefix: 'claude-opus', inputPer1M: 15.00, outputPer1M: 75.00 },
  { prefix: 'claude', inputPer1M: 3.00, outputPer1M: 15.00 },
  // OpenAI models
  { prefix: 'gpt-4.1-mini', inputPer1M: 0.40, outputPer1M: 1.60 },
  { prefix: 'gpt-4.1-nano', inputPer1M: 0.10, outputPer1M: 0.40 },
  { prefix: 'gpt-4.1', inputPer1M: 2.00, outputPer1M: 8.00 },
  { prefix: 'gpt-4o-mini', inputPer1M: 0.15, outputPer1M: 0.60 },
  { prefix: 'gpt-4o', inputPer1M: 5.00, outputPer1M: 15.00 },
  { prefix: 'gpt-4-turbo', inputPer1M: 10.00, outputPer1M: 30.00 },
  { prefix: 'gpt-4', inputPer1M: 30.00, outputPer1M: 60.00 },
  { prefix: 'gpt-3.5', inputPer1M: 0.50, outputPer1M: 1.50 },
  // Grok models
  { prefix: 'grok-3-mini', inputPer1M: 0.30, outputPer1M: 0.50 },
  { prefix: 'grok-3', inputPer1M: 3.00, outputPer1M: 15.00 },
  { prefix: 'grok-2', inputPer1M: 2.00, outputPer1M: 10.00 },
  { prefix: 'grok', inputPer1M: 5.00, outputPer1M: 15.00 },
  // Gemini models
  { prefix: 'gemini-2.5-flash', inputPer1M: 0.15, outputPer1M: 0.60 },
  { prefix: 'gemini-2.5-pro', inputPer1M: 1.25, outputPer1M: 10.00 },
  { prefix: 'gemini-2.0-flash', inputPer1M: 0.10, outputPer1M: 0.40 },
  { prefix: 'gemini-1.5-flash', inputPer1M: 0.075, outputPer1M: 0.30 },
  { prefix: 'gemini-1.5-pro', inputPer1M: 3.50, outputPer1M: 10.50 },
  { prefix: 'gemini', inputPer1M: 0.10, outputPer1M: 0.40 },
  // Local / free models
  { prefix: 'ollama', inputPer1M: 0, outputPer1M: 0 },
  { prefix: 'llama', inputPer1M: 0, outputPer1M: 0 },
  { prefix: 'mistral', inputPer1M: 2.00, outputPer1M: 6.00 },
  { prefix: 'deepseek', inputPer1M: 0.14, outputPer1M: 0.28 },
  { prefix: 'qwen', inputPer1M: 0, outputPer1M: 0 },
];

/**
 * Estimate cost in USD for a given model and token counts.
 *
 * Matches `modelId` against a prefix table (longest match wins). Falls back
 * to a conservative $2.50/$10.00 per-1M-token rate for unknown models.
 *
 * @param inputTokens  - Number of input (prompt) tokens for the call.
 * @param outputTokens - Number of output (completion) tokens for the call.
 * @param modelId      - Stable model identifier, e.g. `"claude-3-5-sonnet-20241022"`.
 *   Matched case-insensitively against known prefixes.
 * @returns Estimated cost in USD as a floating-point number.
 *
 * @example
 * const cost = estimateCostByModel(1000, 500, 'claude-3-5-sonnet-20241022');
 * // Returns approximately 0.003 + 0.0075 = 0.0105
 */
export function estimateCostByModel(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
): number {
  const normalized = modelId.toLowerCase();
  const pricing =
    MODEL_PRICING.find(p => normalized.startsWith(p.prefix)) ??
    { inputPer1M: 2.50, outputPer1M: 10.00 };

  return (
    (inputTokens / 1_000_000) * pricing.inputPer1M +
    (outputTokens / 1_000_000) * pricing.outputPer1M
  );
}

// ── Error ─────────────────────────────────────────────────────────────────────

/** Thrown when a pre-flight cost estimate would exceed the remaining budget. */
export class BudgetExceededError extends Error {
  public readonly estimatedCostUsd: number;
  public readonly remainingBudgetUsd: number;

  constructor(
    estimatedCostUsd: number,
    remainingBudgetUsd: number,
    budgetUsd: number,
  ) {
    super(
      `Estimated cost $${estimatedCostUsd.toFixed(4)} would exceed remaining budget ` +
      `$${remainingBudgetUsd.toFixed(4)} (total budget $${budgetUsd.toFixed(4)}). ` +
      `Use --budget to increase.`,
    );
    this.name = 'BudgetExceededError';
    this.estimatedCostUsd = estimatedCostUsd;
    this.remainingBudgetUsd = remainingBudgetUsd;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TokenRecord {
  /** ISO timestamp of the call */
  timestamp: string;
  /** CLI command that triggered the call (e.g. "forge", "verify", "score") */
  command: string;
  inputTokens: number;
  outputTokens: number;
  /** Stable model identifier (e.g. "claude-3-5-sonnet-20241022", "ollama") */
  modelId: string;
  /** Estimated cost in USD for this call */
  estimatedCostUsd: number;
}

export interface SessionTotal {
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  callCount: number;
}

// ── Injection seams ───────────────────────────────────────────────────────────

export interface TokenLedgerDeps {
  _appendLine?: (filePath: string, line: string) => Promise<void>;
  _mkdir?: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
  _readFile?: (p: string) => Promise<string>;
}

// ── Ledger file location ──────────────────────────────────────────────────────

export const LEDGER_FILENAME = 'token-ledger.jsonl';

/**
 * Resolve the absolute path to the token ledger file for the given project root.
 *
 * @param cwd - Project root directory.
 * @returns Absolute path: `<cwd>/.danteforge/token-ledger.jsonl`
 */
export function ledgerPath(cwd: string): string {
  return path.join(cwd, '.danteforge', LEDGER_FILENAME);
}

// ── Default I/O ───────────────────────────────────────────────────────────────

async function defaultAppendLine(filePath: string, line: string): Promise<void> {
  await fs.appendFile(filePath, line + '\n', 'utf8');
}

async function defaultMkdir(p: string, opts?: { recursive?: boolean }): Promise<void> {
  await fs.mkdir(p, opts);
}

async function defaultReadFile(p: string): Promise<string> {
  return fs.readFile(p, 'utf8');
}

// ── TokenLedger class ─────────────────────────────────────────────────────────

/**
 * Per-session token ledger.
 *
 * Records every LLM call in an append-only JSONL file at
 * `.danteforge/token-ledger.jsonl`.  The in-memory session data is available
 * immediately after each `record()` call without re-reading the file.
 */
export class TokenLedger {
  private readonly cwd: string;
  private readonly deps: Required<TokenLedgerDeps>;
  private sessionRecords: TokenRecord[] = [];

  /**
   * Create a new `TokenLedger` for the given project root.
   *
   * @param cwd  - Absolute path to the project root. The ledger file is
   *   written to `<cwd>/.danteforge/token-ledger.jsonl`.
   * @param deps - Optional I/O injection for testing. All three seams
   *   (`_appendLine`, `_mkdir`, `_readFile`) can be overridden independently.
   */
  constructor(cwd: string, deps: TokenLedgerDeps = {}) {
    this.cwd = cwd;
    this.deps = {
      _appendLine: deps._appendLine ?? defaultAppendLine,
      _mkdir: deps._mkdir ?? defaultMkdir,
      _readFile: deps._readFile ?? defaultReadFile,
    };
  }

  /**
   * Record one LLM call. Persists immediately to JSONL (best-effort — never
   * throws so it cannot break the calling command). Also updates the
   * in-memory session totals so `getSessionTotal()` reflects this call
   * immediately without re-reading the file.
   *
   * @param command     - CLI command name that triggered the call (e.g. `"forge"`).
   * @param inputTokens - Number of prompt tokens consumed.
   * @param outputTokens - Number of completion tokens generated.
   * @param modelId     - Model identifier used for pricing lookup.
   */
  async record(
    command: string,
    inputTokens: number,
    outputTokens: number,
    modelId: string,
  ): Promise<void> {
    const estimatedCostUsd = estimateCostByModel(inputTokens, outputTokens, modelId);
    const entry: TokenRecord = {
      timestamp: new Date().toISOString(),
      command,
      inputTokens,
      outputTokens,
      modelId,
      estimatedCostUsd,
    };
    this.sessionRecords.push(entry);

    // Persist best-effort
    try {
      const filePath = ledgerPath(this.cwd);
      await this.deps._mkdir(path.dirname(filePath), { recursive: true });
      await this.deps._appendLine(filePath, JSON.stringify(entry));
    } catch (err) {
      logger.verbose(`[TokenLedger] Failed to persist record: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Returns cumulative in-memory session totals since process start.
   *
   * Does not re-read the JSONL file — only counts calls made through
   * this instance's `record()` method in the current process.
   *
   * @returns `SessionTotal` with `inputTokens`, `outputTokens`,
   *   `estimatedCostUsd`, and `callCount`.
   */
  getSessionTotal(): SessionTotal {
    return this.sessionRecords.reduce<SessionTotal>(
      (acc, r) => ({
        inputTokens: acc.inputTokens + r.inputTokens,
        outputTokens: acc.outputTokens + r.outputTokens,
        estimatedCostUsd: acc.estimatedCostUsd + r.estimatedCostUsd,
        callCount: acc.callCount + 1,
      }),
      { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, callCount: 0 },
    );
  }

  /**
   * Returns per-command token totals for this session.
   *
   * Keys are command names as passed to `record()`. Values are aggregated
   * token counts and cost for all calls from that command this session.
   *
   * @returns Map from command name to `{ inputTokens, outputTokens, estimatedCostUsd }`.
   */
  getByCommand(): Map<string, { inputTokens: number; outputTokens: number; estimatedCostUsd: number }> {
    const map = new Map<string, { inputTokens: number; outputTokens: number; estimatedCostUsd: number }>();
    for (const r of this.sessionRecords) {
      const existing = map.get(r.command) ?? { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
      map.set(r.command, {
        inputTokens: existing.inputTokens + r.inputTokens,
        outputTokens: existing.outputTokens + r.outputTokens,
        estimatedCostUsd: existing.estimatedCostUsd + r.estimatedCostUsd,
      });
    }
    return map;
  }

  /**
   * Load all historical token records from the JSONL file on disk.
   *
   * Useful for cross-session cost reporting. Returns an empty array if the
   * ledger file does not exist or cannot be read.
   *
   * @returns Array of `TokenRecord` objects, one per recorded LLM call.
   */
  async loadHistory(): Promise<TokenRecord[]> {
    return loadLedgerHistory(this.cwd, { _readFile: this.deps._readFile });
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * Load historical records from the JSONL file (function form for use without
 * a class instance).
 *
 * Parses each line as JSON and skips malformed lines silently. Returns an
 * empty array if the file does not exist.
 *
 * @param cwd  - Project root directory containing `.danteforge/`.
 * @param deps - Optional `_readFile` injection for testing.
 * @returns Array of `TokenRecord` objects parsed from the ledger.
 */
export async function loadLedgerHistory(
  cwd: string,
  deps: Pick<TokenLedgerDeps, '_readFile'> = {},
): Promise<TokenRecord[]> {
  const readFile = deps._readFile ?? defaultReadFile;
  const filePath = ledgerPath(cwd);
  let raw: string;
  try {
    raw = await readFile(filePath);
  } catch {
    return [];
  }
  const records: TokenRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as TokenRecord);
    } catch {
      // Skip corrupt lines silently
    }
  }
  return records;
}

/**
 * Pre-flight budget check.
 *
 * Throws `BudgetExceededError` when the estimated cost for the proposed LLM
 * call would push the session spend past the configured budget.
 *
 * @param inputTokens    Estimated input tokens for the upcoming call.
 * @param outputTokens   Estimated output tokens for the upcoming call.
 * @param modelId        Model identifier for pricing lookup.
 * @param spentSoFarUsd  How much has already been spent this session.
 * @param budgetUsd      The configured budget ceiling.
 */
export function checkPreflightBudget(
  inputTokens: number,
  outputTokens: number,
  modelId: string,
  spentSoFarUsd: number,
  budgetUsd: number,
): void {
  const estimatedCostUsd = estimateCostByModel(inputTokens, outputTokens, modelId);
  const remaining = Math.max(0, budgetUsd - spentSoFarUsd);
  if (estimatedCostUsd > remaining) {
    throw new BudgetExceededError(estimatedCostUsd, remaining, budgetUsd);
  }
}

/**
 * Summarise an array of historical token records into a single aggregate total.
 *
 * Produces a `SessionTotal` extended with a `byCommand` breakdown, making it
 * convenient for rendering cost dashboards without loading the full class.
 *
 * @param records - Array of `TokenRecord` objects (e.g. from `loadLedgerHistory`).
 * @returns Aggregate `{ inputTokens, outputTokens, estimatedCostUsd, callCount, byCommand }`.
 *
 * @example
 * const records = await loadLedgerHistory(cwd);
 * const totals = summariseLedger(records);
 * console.log(`Total cost: $${totals.estimatedCostUsd.toFixed(4)}`);
 */
export function summariseLedger(records: TokenRecord[]): SessionTotal & { byCommand: Map<string, { inputTokens: number; outputTokens: number; estimatedCostUsd: number }> } {
  const byCommand = new Map<string, { inputTokens: number; outputTokens: number; estimatedCostUsd: number }>();
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd = 0;
  let callCount = 0;

  for (const r of records) {
    inputTokens += r.inputTokens;
    outputTokens += r.outputTokens;
    estimatedCostUsd += r.estimatedCostUsd;
    callCount++;

    const existing = byCommand.get(r.command) ?? { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
    byCommand.set(r.command, {
      inputTokens: existing.inputTokens + r.inputTokens,
      outputTokens: existing.outputTokens + r.outputTokens,
      estimatedCostUsd: existing.estimatedCostUsd + r.estimatedCostUsd,
    });
  }

  return { inputTokens, outputTokens, estimatedCostUsd, callCount, byCommand };
}

/** Daily spend aggregation: one entry per UTC calendar day. */
export interface DailySpend {
  date: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  callCount: number;
}

/**
 * Aggregate token records by UTC calendar day (YYYY-MM-DD).
 *
 * Useful for rendering daily cost trend charts and detecting budget-burn spikes.
 *
 * @param records - Array of `TokenRecord` objects (e.g. from `loadLedgerHistory`).
 * @returns Array of `DailySpend` objects sorted by date ascending.
 *
 * @example
 * const records = await loadLedgerHistory(cwd);
 * const daily = summariseLedgerByDay(records);
 * for (const d of daily) console.log(`${d.date}: $${d.estimatedCostUsd.toFixed(4)}`);
 */
export function summariseLedgerByDay(records: TokenRecord[]): DailySpend[] {
  const byDay = new Map<string, DailySpend>();

  for (const r of records) {
    const day = r.timestamp.slice(0, 10); // YYYY-MM-DD
    const existing = byDay.get(day) ?? {
      date: day,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      callCount: 0,
    };
    byDay.set(day, {
      date: day,
      inputTokens: existing.inputTokens + r.inputTokens,
      outputTokens: existing.outputTokens + r.outputTokens,
      estimatedCostUsd: existing.estimatedCostUsd + r.estimatedCostUsd,
      callCount: existing.callCount + 1,
    });
  }

  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** A command name with its total estimated cost and call count. */
export interface CommandCostEntry {
  command: string;
  estimatedCostUsd: number;
  callCount: number;
  inputTokens: number;
  outputTokens: number;
}

/**
 * Return the top N most expensive commands by total estimated cost.
 *
 * Useful for pointing users at the commands that dominate their token spend
 * so they can selectively apply `--light` mode or caching.
 *
 * @param records - Array of `TokenRecord` objects.
 * @param topN    - Maximum number of entries to return (default 5).
 * @returns Array of `CommandCostEntry` sorted by cost descending, up to `topN` entries.
 *
 * @example
 * const records = await loadLedgerHistory(cwd);
 * const top = topCostCommands(records, 3);
 * // Returns the 3 most expensive commands
 */
export function topCostCommands(records: TokenRecord[], topN = 5): CommandCostEntry[] {
  const { byCommand } = summariseLedger(records);
  const entries: CommandCostEntry[] = [];
  for (const [command, totals] of byCommand.entries()) {
    entries.push({
      command,
      estimatedCostUsd: totals.estimatedCostUsd,
      callCount: records.filter(r => r.command === command).length,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
    });
  }
  return entries
    .sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)
    .slice(0, topN);
}
