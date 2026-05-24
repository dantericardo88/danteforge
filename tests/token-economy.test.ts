/**
 * Token Economy Tests — covers TokenLedger, estimateCostByModel,
 * BudgetExceededError, checkPreflightBudget, and efficiency report computation.
 *
 * All I/O is injected so no real filesystem writes occur.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  TokenLedger,
  estimateCostByModel,
  checkPreflightBudget,
  BudgetExceededError,
  loadLedgerHistory,
  summariseLedger,
  ledgerPath,
  LEDGER_FILENAME,
} from '../src/core/token-ledger.js';
import type { TokenRecord } from '../src/core/token-ledger.js';
import { computeEfficiencyReport } from '../src/cli/commands/cost.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInMemoryLedger(cwd: string): {
  ledger: TokenLedger;
  lines: string[];
} {
  const lines: string[] = [];
  const ledger = new TokenLedger(cwd, {
    _appendLine: async (_filePath: string, line: string) => { lines.push(line); },
    _mkdir: async () => { /* no-op */ },
    _readFile: async () => lines.join('\n'),
  });
  return { ledger, lines };
}

// ── estimateCostByModel ───────────────────────────────────────────────────────

describe('estimateCostByModel', () => {
  it('claude-3-5-sonnet: correct input+output pricing', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'claude-3-5-sonnet-20241022');
    // $3/MTok input + $15/MTok output = $18
    assert.strictEqual(cost, 18.00);
  });

  it('claude-3-haiku: cheaper model', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'claude-3-haiku-20240307');
    // $0.25 + $1.25 = $1.50
    assert.strictEqual(cost, 1.50);
  });

  it('gpt-4o: correct pricing', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'gpt-4o');
    // $5 + $15 = $20
    assert.strictEqual(cost, 20.00);
  });

  it('gpt-4o-mini: cheaper than gpt-4o', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'gpt-4o-mini');
    assert.ok(cost < 5);
  });

  it('ollama: free (zero cost)', () => {
    const cost = estimateCostByModel(100_000, 50_000, 'ollama');
    assert.strictEqual(cost, 0);
  });

  it('llama3: free (local model)', () => {
    const cost = estimateCostByModel(50_000, 20_000, 'llama3');
    assert.strictEqual(cost, 0);
  });

  it('unknown model: falls back to conservative rate', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'some-unknown-model-xyz');
    // $2.50 + $10 = $12.50
    assert.strictEqual(cost, 12.50);
  });

  it('gemini-2.0-flash: low cost', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'gemini-2.0-flash');
    // $0.10 + $0.40 = $0.50
    assert.strictEqual(cost, 0.50);
  });

  it('zero tokens → zero cost', () => {
    const cost = estimateCostByModel(0, 0, 'gpt-4o');
    assert.strictEqual(cost, 0);
  });

  it('prefix matching: claude-sonnet matches claude-sonnet-4', () => {
    const cost = estimateCostByModel(1_000_000, 0, 'claude-sonnet-4');
    // $3/MTok input
    assert.strictEqual(cost, 3.00);
  });
});

// ── TokenLedger ───────────────────────────────────────────────────────────────

describe('TokenLedger.record', () => {
  it('appends a JSON line', async () => {
    const { ledger, lines } = makeInMemoryLedger('/fake/cwd');
    await ledger.record('forge', 1000, 500, 'claude-3-5-sonnet');
    assert.strictEqual(lines.length, 1);
    const entry = JSON.parse(lines[0]!) as TokenRecord;
    assert.strictEqual(entry.command, 'forge');
    assert.strictEqual(entry.inputTokens, 1000);
    assert.strictEqual(entry.outputTokens, 500);
    assert.strictEqual(entry.modelId, 'claude-3-5-sonnet');
    assert.ok(entry.estimatedCostUsd > 0);
    assert.ok(!isNaN(Date.parse(entry.timestamp)));
  });

  it('multiple records accumulate', async () => {
    const { ledger, lines } = makeInMemoryLedger('/fake/cwd');
    await ledger.record('forge', 100, 50, 'ollama');
    await ledger.record('verify', 200, 100, 'ollama');
    assert.strictEqual(lines.length, 2);
  });
});

describe('TokenLedger.getSessionTotal', () => {
  it('sums across all records', async () => {
    const { ledger } = makeInMemoryLedger('/fake/cwd');
    await ledger.record('forge', 1000, 500, 'claude-3-5-sonnet');
    await ledger.record('verify', 2000, 800, 'claude-3-5-sonnet');
    const total = ledger.getSessionTotal();
    assert.strictEqual(total.inputTokens, 3000);
    assert.strictEqual(total.outputTokens, 1300);
    assert.strictEqual(total.callCount, 2);
    assert.ok(total.estimatedCostUsd > 0);
  });

  it('starts at zero with no records', () => {
    const { ledger } = makeInMemoryLedger('/fake/cwd');
    const total = ledger.getSessionTotal();
    assert.strictEqual(total.inputTokens, 0);
    assert.strictEqual(total.outputTokens, 0);
    assert.strictEqual(total.estimatedCostUsd, 0);
    assert.strictEqual(total.callCount, 0);
  });
});

describe('TokenLedger.getByCommand', () => {
  it('groups by command', async () => {
    const { ledger } = makeInMemoryLedger('/fake/cwd');
    await ledger.record('forge', 1000, 400, 'claude-3-5-sonnet');
    await ledger.record('forge', 500, 200, 'claude-3-5-sonnet');
    await ledger.record('verify', 800, 300, 'claude-3-5-sonnet');
    const byCmd = ledger.getByCommand();
    assert.ok(byCmd.has('forge'));
    assert.ok(byCmd.has('verify'));
    assert.strictEqual(byCmd.get('forge')!.inputTokens, 1500);
    assert.strictEqual(byCmd.get('verify')!.inputTokens, 800);
  });
});

describe('TokenLedger.loadHistory', () => {
  it('parses previously written lines', async () => {
    const records: TokenRecord[] = [
      {
        timestamp: new Date().toISOString(),
        command: 'forge',
        inputTokens: 100,
        outputTokens: 40,
        modelId: 'claude-3-5-sonnet',
        estimatedCostUsd: 0.001,
      },
    ];
    const serialized = records.map(r => JSON.stringify(r)).join('\n');
    const ledger = new TokenLedger('/fake/cwd', {
      _appendLine: async () => { /* no-op */ },
      _mkdir: async () => { /* no-op */ },
      _readFile: async () => serialized,
    });
    const history = await ledger.loadHistory();
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0]!.command, 'forge');
  });

  it('returns empty array when file does not exist', async () => {
    const ledger = new TokenLedger('/fake/cwd', {
      _appendLine: async () => { /* no-op */ },
      _mkdir: async () => { /* no-op */ },
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    const history = await ledger.loadHistory();
    assert.strictEqual(history.length, 0);
  });
});

// ── ledgerPath ────────────────────────────────────────────────────────────────

describe('ledgerPath', () => {
  it('resolves to .danteforge/token-ledger.jsonl', () => {
    const p = ledgerPath('/my/project');
    assert.ok(p.endsWith(path.join('.danteforge', LEDGER_FILENAME)));
  });
});

// ── checkPreflightBudget ──────────────────────────────────────────────────────

describe('checkPreflightBudget', () => {
  it('does not throw when estimated cost fits in remaining budget', () => {
    // 10k tokens on gpt-4o at $5/$15 per MTok = tiny cost
    assert.doesNotThrow(() => {
      checkPreflightBudget(10_000, 2_000, 'gpt-4o', 0.00, 100.00);
    });
  });

  it('throws BudgetExceededError when cost exceeds remaining budget', () => {
    // 10M input tokens on gpt-4o = $50, but remaining budget is $0.01
    assert.throws(
      () => checkPreflightBudget(10_000_000, 2_000_000, 'gpt-4o', 99.99, 100.00),
      BudgetExceededError,
    );
  });

  it('BudgetExceededError includes correct fields', () => {
    let caught: BudgetExceededError | null = null;
    try {
      checkPreflightBudget(10_000_000, 2_000_000, 'gpt-4o', 95.00, 100.00);
    } catch (err) {
      caught = err as BudgetExceededError;
    }
    assert.ok(caught instanceof BudgetExceededError);
    assert.ok(caught.estimatedCostUsd > 0);
    assert.ok(caught.remainingBudgetUsd === 5.00);
    assert.ok(caught.message.includes('Use --budget'));
  });

  it('does not throw when budget is zero (disabled)', () => {
    // budget = 0 means no limit — should still not throw
    // Note: the caller gate checks budget > 0, but checkPreflightBudget
    // should behave predictably if called with 0 budget
    assert.doesNotThrow(() => {
      // remaining = max(0, 0 - 0) = 0, cost = 0 → no throw
      checkPreflightBudget(0, 0, 'gpt-4o', 0, 0);
    });
  });

  it('throws when spend already exceeds budget (no remaining headroom)', () => {
    assert.throws(
      () => checkPreflightBudget(1000, 500, 'claude-3-5-sonnet', 10.00, 10.00),
      BudgetExceededError,
    );
  });
});

// ── BudgetExceededError ───────────────────────────────────────────────────────

describe('BudgetExceededError', () => {
  it('is instanceof Error', () => {
    const err = new BudgetExceededError(0.05, 0.02, 1.00);
    assert.ok(err instanceof Error);
  });

  it('has name BudgetExceededError', () => {
    const err = new BudgetExceededError(0.05, 0.02, 1.00);
    assert.strictEqual(err.name, 'BudgetExceededError');
  });

  it('message contains estimated cost and remaining budget', () => {
    const err = new BudgetExceededError(0.05, 0.02, 1.00);
    assert.ok(err.message.includes('0.0500'));
    assert.ok(err.message.includes('0.0200'));
  });
});

// ── loadLedgerHistory (standalone) ───────────────────────────────────────────

describe('loadLedgerHistory', () => {
  it('parses JSONL correctly', async () => {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      command: 'score',
      inputTokens: 500,
      outputTokens: 200,
      modelId: 'gemini-2.0-flash',
      estimatedCostUsd: 0.0001,
    });
    const records = await loadLedgerHistory('/fake', {
      _readFile: async () => line,
    });
    assert.strictEqual(records.length, 1);
    assert.strictEqual(records[0]!.command, 'score');
  });

  it('skips corrupt lines without throwing', async () => {
    const content = 'not-json\n{"command":"forge","inputTokens":100,"outputTokens":40,"modelId":"ollama","estimatedCostUsd":0,"timestamp":"2026-01-01T00:00:00.000Z"}';
    const records = await loadLedgerHistory('/fake', {
      _readFile: async () => content,
    });
    assert.strictEqual(records.length, 1);
  });
});

// ── summariseLedger ───────────────────────────────────────────────────────────

describe('summariseLedger', () => {
  it('sums input/output tokens and cost', () => {
    const records: TokenRecord[] = [
      { timestamp: '2026-01-01T00:00:00.000Z', command: 'forge', inputTokens: 1000, outputTokens: 400, modelId: 'claude-3-5-sonnet', estimatedCostUsd: 0.01 },
      { timestamp: '2026-01-01T00:00:00.000Z', command: 'verify', inputTokens: 500, outputTokens: 200, modelId: 'claude-3-5-sonnet', estimatedCostUsd: 0.005 },
    ];
    const summary = summariseLedger(records);
    assert.strictEqual(summary.inputTokens, 1500);
    assert.strictEqual(summary.outputTokens, 600);
    assert.strictEqual(summary.callCount, 2);
    assert.ok(Math.abs(summary.estimatedCostUsd - 0.015) < 0.0001);
  });

  it('groups by command correctly', () => {
    const records: TokenRecord[] = [
      { timestamp: '2026-01-01T00:00:00.000Z', command: 'forge', inputTokens: 1000, outputTokens: 400, modelId: 'ollama', estimatedCostUsd: 0 },
      { timestamp: '2026-01-01T00:00:00.000Z', command: 'forge', inputTokens: 2000, outputTokens: 800, modelId: 'ollama', estimatedCostUsd: 0 },
      { timestamp: '2026-01-01T00:00:00.000Z', command: 'verify', inputTokens: 300, outputTokens: 100, modelId: 'ollama', estimatedCostUsd: 0 },
    ];
    const { byCommand } = summariseLedger(records);
    assert.strictEqual(byCommand.get('forge')!.inputTokens, 3000);
    assert.strictEqual(byCommand.get('verify')!.inputTokens, 300);
  });
});

// ── computeEfficiencyReport ───────────────────────────────────────────────────

describe('computeEfficiencyReport', () => {
  it('sorts by cost descending', () => {
    const records: TokenRecord[] = [
      { timestamp: '2026-01-01T00:00:00.000Z', command: 'forge', inputTokens: 100_000, outputTokens: 40_000, modelId: 'gpt-4o', estimatedCostUsd: 1.10 },
      { timestamp: '2026-01-01T00:00:00.000Z', command: 'verify', inputTokens: 5_000, outputTokens: 2_000, modelId: 'gpt-4o', estimatedCostUsd: 0.055 },
      { timestamp: '2026-01-01T00:00:00.000Z', command: 'score', inputTokens: 1_000, outputTokens: 400, modelId: 'gpt-4o', estimatedCostUsd: 0.011 },
    ];
    const report = computeEfficiencyReport(records);
    assert.strictEqual(report[0]!.command, 'forge');
    assert.strictEqual(report[1]!.command, 'verify');
    assert.strictEqual(report[2]!.command, 'score');
  });

  it('aggregates multiple records for the same command', () => {
    const records: TokenRecord[] = [
      { timestamp: '2026-01-01T00:00:00.000Z', command: 'forge', inputTokens: 1000, outputTokens: 400, modelId: 'ollama', estimatedCostUsd: 0 },
      { timestamp: '2026-01-01T00:00:00.000Z', command: 'forge', inputTokens: 2000, outputTokens: 800, modelId: 'ollama', estimatedCostUsd: 0 },
    ];
    const report = computeEfficiencyReport(records);
    assert.strictEqual(report.length, 1);
    assert.strictEqual(report[0]!.inputTokens, 3000);
  });

  it('returns empty array for empty input', () => {
    const report = computeEfficiencyReport([]);
    assert.strictEqual(report.length, 0);
  });
});

// ── Real filesystem integration ───────────────────────────────────────────────

describe('TokenLedger real filesystem', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'token-ledger-test-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('persists records to real JSONL file', async () => {
    const ledger = new TokenLedger(tmpDir);
    await ledger.record('test-cmd', 500, 200, 'ollama');

    const lPath = ledgerPath(tmpDir);
    const raw = await fs.readFile(lPath, 'utf8');
    const parsed = JSON.parse(raw.trim()) as TokenRecord;
    assert.strictEqual(parsed.command, 'test-cmd');
    assert.strictEqual(parsed.inputTokens, 500);
  });

  it('loadHistory reads back from disk', async () => {
    const ledger = new TokenLedger(tmpDir);
    await ledger.record('verify', 300, 100, 'ollama');
    const history = await ledger.loadHistory();
    // At least 1 record (could have 2 from the previous test, same tmpDir)
    assert.ok(history.length >= 1);
    const verifyRecord = history.find(r => r.command === 'verify');
    assert.ok(verifyRecord !== undefined);
  });
});
