// DanteSanitize — Cost guardrails (Sprint 8)
//
// Tracks cumulative LLM token usage across a sanitize session and enforces
// a hard budget. Pre-flight estimator lets callers see expected cost before
// the loop runs.
import fs from 'node:fs/promises';
import path from 'node:path';

export const DEFAULT_MAX_TOKENS_PER_SESSION = 200_000;
export const SANITIZE_BUDGET_FILE = '.danteforge/sanitize/budget.json';
export const SANITIZE_BUDGET_EXHAUSTED_FILE = '.danteforge/sanitize/budget-exhausted.json';

/**
 * Rough heuristic: each forge wave on a 1000-LOC file uses ~4 LLM calls
 * (analysis + ~2 extractions + rewrite), each consuming ~4 tokens per line
 * of code in the prompt + ~1.5x for response. Total ~30 tokens per LOC per
 * sanitize cycle. Calibrated against observed Anthropic + OpenAI usage.
 */
export const TOKENS_PER_LOC_HEURISTIC = 30;

export interface CostEstimateInput {
  /** List of file LOCs in the work queue. */
  queueLocs: number[];
  /** Override the tokens-per-LOC heuristic. */
  tokensPerLoc?: number;
}

export interface CostEstimateResult {
  estimatedTokens: number;
  estimatedUsdLow: number;   // $3 / 1M tokens (Sonnet input rate)
  estimatedUsdHigh: number;  // $15 / 1M tokens (Sonnet output, rough)
  fileCount: number;
}

export function estimateSanitizeCost(input: CostEstimateInput): CostEstimateResult {
  const perLoc = input.tokensPerLoc ?? TOKENS_PER_LOC_HEURISTIC;
  const total = input.queueLocs.reduce((sum, loc) => sum + loc * perLoc, 0);
  return {
    estimatedTokens: total,
    estimatedUsdLow: (total / 1_000_000) * 3,
    estimatedUsdHigh: (total / 1_000_000) * 15,
    fileCount: input.queueLocs.length,
  };
}

// ── Budget tracker ───────────────────────────────────────────────────────────

export interface TokenBudgetState {
  maxTokens: number;
  consumed: number;
  startedAt: string;
  /** Per-call breakdown (for telemetry). */
  calls: { ts: string; tokens: number; phase: string }[];
}

export class TokenBudget {
  private state: TokenBudgetState;

  constructor(maxTokens: number = DEFAULT_MAX_TOKENS_PER_SESSION) {
    this.state = {
      maxTokens,
      consumed: 0,
      startedAt: new Date().toISOString(),
      calls: [],
    };
  }

  /** Record tokens consumed by a single LLM call. */
  consume(tokens: number, phase: string): void {
    this.state.consumed += tokens;
    this.state.calls.push({
      ts: new Date().toISOString(),
      tokens,
      phase,
    });
  }

  /** Returns true if the consumed tokens exceed the budget. */
  exhausted(): boolean {
    return this.state.consumed >= this.state.maxTokens;
  }

  remaining(): number {
    return Math.max(0, this.state.maxTokens - this.state.consumed);
  }

  percentUsed(): number {
    return Math.min(100, (this.state.consumed / this.state.maxTokens) * 100);
  }

  snapshot(): TokenBudgetState {
    return { ...this.state, calls: [...this.state.calls] };
  }
}

/**
 * Persist budget state to disk. Used to surface exhaustion across sessions
 * and to allow inspection of per-call breakdown.
 */
export async function writeBudgetSnapshot(cwd: string, budget: TokenBudget): Promise<void> {
  const filePath = path.join(cwd, SANITIZE_BUDGET_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(budget.snapshot(), null, 2), 'utf8');
}

/**
 * Write a "budget exhausted" marker so the next sanitize run can detect
 * and avoid blowing past the budget.
 */
export async function writeBudgetExhausted(cwd: string, budget: TokenBudget): Promise<string> {
  const filePath = path.join(cwd, SANITIZE_BUDGET_EXHAUSTED_FILE);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const payload = {
    ts: new Date().toISOString(),
    reason: 'Token budget exhausted before queue was empty.',
    snapshot: budget.snapshot(),
    suggestedActions: [
      'Re-run with --max-tokens <higher> to extend budget',
      'Re-run on a feature branch and review backups in .danteforge/sanitize/backups/',
      'Manually split the remaining files',
    ],
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}
