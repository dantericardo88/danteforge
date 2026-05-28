/**
 * Extended token ledger tests — covers:
 *   - Updated model pricing (Claude 4.x, GPT-4.1, grok-3-mini, Gemini 2.5, deepseek)
 *   - summariseLedgerByDay daily aggregation
 *   - topCostCommands ranking
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateCostByModel,
  summariseLedgerByDay,
  topCostCommands,
} from '../src/core/token-ledger.js';
import type { TokenRecord } from '../src/core/token-ledger.js';

// ── Model pricing: Claude 4.x ─────────────────────────────────────────────────

describe('estimateCostByModel — Claude 4.x', () => {
  it('claude-opus-4: uses $15/$75 per MTok', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'claude-opus-4-20250514');
    // $15 input + $75 output = $90
    assert.strictEqual(cost, 90.00);
  });

  it('claude-sonnet-4-6: uses $3/$15 per MTok', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'claude-sonnet-4-6');
    assert.strictEqual(cost, 18.00);
  });

  it('claude-sonnet-4-5: uses $3/$15 per MTok', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'claude-sonnet-4-5-20251001');
    assert.strictEqual(cost, 18.00);
  });

  it('claude-haiku-4-5: uses $0.80/$4.00 per MTok', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'claude-haiku-4-5-20251001');
    // $0.80 + $4.00 = $4.80
    assert.strictEqual(cost, 4.80);
  });

  it('claude-3-7-sonnet: uses $3/$15 per MTok', () => {
    const cost = estimateCostByModel(1_000_000, 0, 'claude-3-7-sonnet-20250219');
    assert.strictEqual(cost, 3.00);
  });

  it('claude-haiku (generic): uses $0.80/$4.00 per MTok', () => {
    const cost = estimateCostByModel(1_000_000, 0, 'claude-haiku');
    assert.strictEqual(cost, 0.80);
  });

  it('claude-opus (generic): uses $15/$75 per MTok', () => {
    const cost = estimateCostByModel(1_000_000, 0, 'claude-opus');
    assert.strictEqual(cost, 15.00);
  });
});

// ── Model pricing: OpenAI GPT-4.1 ────────────────────────────────────────────

describe('estimateCostByModel — GPT-4.1', () => {
  it('gpt-4.1: uses $2/$8 per MTok', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'gpt-4.1');
    assert.strictEqual(cost, 10.00);
  });

  it('gpt-4.1-mini: uses $0.40/$1.60 per MTok', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'gpt-4.1-mini');
    assert.strictEqual(cost, 2.00);
  });

  it('gpt-4.1-nano: uses $0.10/$0.40 per MTok', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'gpt-4.1-nano');
    assert.strictEqual(cost, 0.50);
  });

  it('gpt-4.1 is cheaper than gpt-4o', () => {
    const gpt41 = estimateCostByModel(1_000_000, 1_000_000, 'gpt-4.1');
    const gpt4o = estimateCostByModel(1_000_000, 1_000_000, 'gpt-4o');
    assert.ok(gpt41 < gpt4o);
  });
});

// ── Model pricing: Grok mini ──────────────────────────────────────────────────

describe('estimateCostByModel — grok variants', () => {
  it('grok-3-mini: cheaper than grok-3', () => {
    const mini = estimateCostByModel(1_000_000, 1_000_000, 'grok-3-mini');
    const full = estimateCostByModel(1_000_000, 1_000_000, 'grok-3');
    assert.ok(mini < full);
  });

  it('grok-3-mini: uses $0.30/$0.50 per MTok', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'grok-3-mini');
    assert.strictEqual(cost, 0.80);
  });
});

// ── Model pricing: Gemini 2.5 ─────────────────────────────────────────────────

describe('estimateCostByModel — Gemini 2.5', () => {
  it('gemini-2.5-flash: uses $0.15/$0.60 per MTok', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'gemini-2.5-flash');
    assert.strictEqual(cost, 0.75);
  });

  it('gemini-2.5-pro: uses $1.25/$10.00 per MTok', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'gemini-2.5-pro');
    assert.strictEqual(cost, 11.25);
  });

  it('gemini-2.5-pro is more expensive than gemini-2.5-flash', () => {
    const flash = estimateCostByModel(1_000_000, 1_000_000, 'gemini-2.5-flash');
    const pro = estimateCostByModel(1_000_000, 1_000_000, 'gemini-2.5-pro');
    assert.ok(pro > flash);
  });
});

// ── Model pricing: deepseek ───────────────────────────────────────────────────

describe('estimateCostByModel — deepseek', () => {
  it('deepseek: uses $0.14/$0.28 per MTok', () => {
    const cost = estimateCostByModel(1_000_000, 1_000_000, 'deepseek-r1');
    // 0.14 + 0.28 = 0.42 (floating point tolerance)
    assert.ok(Math.abs(cost - 0.42) < 0.0001);
  });

  it('deepseek is cheaper than gpt-4o', () => {
    const ds = estimateCostByModel(1_000_000, 1_000_000, 'deepseek-chat');
    const gpt4o = estimateCostByModel(1_000_000, 1_000_000, 'gpt-4o');
    assert.ok(ds < gpt4o);
  });
});

// ── summariseLedgerByDay ──────────────────────────────────────────────────────

function makeRecord(
  command: string,
  timestamp: string,
  inputTokens = 1000,
  outputTokens = 400,
  modelId = 'ollama',
  estimatedCostUsd = 0,
): TokenRecord {
  return { timestamp, command, inputTokens, outputTokens, modelId, estimatedCostUsd };
}

describe('summariseLedgerByDay', () => {
  it('returns empty array for no records', () => {
    const result = summariseLedgerByDay([]);
    assert.deepEqual(result, []);
  });

  it('groups records by UTC calendar day', () => {
    const records = [
      makeRecord('forge', '2026-05-01T10:00:00.000Z'),
      makeRecord('verify', '2026-05-01T15:00:00.000Z'),
      makeRecord('score', '2026-05-02T09:00:00.000Z'),
    ];
    const result = summariseLedgerByDay(records);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0]!.date, '2026-05-01');
    assert.strictEqual(result[1]!.date, '2026-05-02');
  });

  it('sums tokens and callCount per day', () => {
    const records = [
      makeRecord('forge', '2026-05-01T10:00:00.000Z', 1000, 400),
      makeRecord('verify', '2026-05-01T15:00:00.000Z', 500, 200),
    ];
    const result = summariseLedgerByDay(records);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.inputTokens, 1500);
    assert.strictEqual(result[0]!.outputTokens, 600);
    assert.strictEqual(result[0]!.callCount, 2);
  });

  it('returns days sorted ascending', () => {
    const records = [
      makeRecord('forge', '2026-05-03T10:00:00.000Z'),
      makeRecord('verify', '2026-05-01T10:00:00.000Z'),
      makeRecord('score', '2026-05-02T10:00:00.000Z'),
    ];
    const result = summariseLedgerByDay(records);
    assert.strictEqual(result[0]!.date, '2026-05-01');
    assert.strictEqual(result[1]!.date, '2026-05-02');
    assert.strictEqual(result[2]!.date, '2026-05-03');
  });

  it('accumulates estimatedCostUsd per day', () => {
    const records = [
      makeRecord('forge', '2026-05-01T10:00:00.000Z', 100, 40, 'claude-3-5-sonnet', 0.01),
      makeRecord('verify', '2026-05-01T15:00:00.000Z', 200, 80, 'claude-3-5-sonnet', 0.005),
    ];
    const result = summariseLedgerByDay(records);
    assert.ok(Math.abs(result[0]!.estimatedCostUsd - 0.015) < 0.0001);
  });

  it('handles a single record correctly', () => {
    const records = [makeRecord('score', '2026-06-15T08:00:00.000Z', 500, 200)];
    const result = summariseLedgerByDay(records);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.date, '2026-06-15');
    assert.strictEqual(result[0]!.callCount, 1);
  });
});

// ── topCostCommands ───────────────────────────────────────────────────────────

describe('topCostCommands', () => {
  it('returns empty array for no records', () => {
    const result = topCostCommands([]);
    assert.deepEqual(result, []);
  });

  it('sorts by estimated cost descending', () => {
    const records = [
      makeRecord('score', '2026-05-01T10:00:00.000Z', 1000, 400, 'gpt-4o', 0.01),
      makeRecord('forge', '2026-05-01T11:00:00.000Z', 10000, 4000, 'gpt-4o', 0.10),
      makeRecord('verify', '2026-05-01T12:00:00.000Z', 500, 200, 'gpt-4o', 0.005),
    ];
    const result = topCostCommands(records);
    assert.strictEqual(result[0]!.command, 'forge');
    assert.strictEqual(result[1]!.command, 'score');
    assert.strictEqual(result[2]!.command, 'verify');
  });

  it('respects topN limit', () => {
    const records = [
      makeRecord('a', '2026-05-01T10:00:00.000Z', 100, 40, 'gpt-4o', 0.001),
      makeRecord('b', '2026-05-01T11:00:00.000Z', 200, 80, 'gpt-4o', 0.002),
      makeRecord('c', '2026-05-01T12:00:00.000Z', 300, 120, 'gpt-4o', 0.003),
      makeRecord('d', '2026-05-01T13:00:00.000Z', 400, 160, 'gpt-4o', 0.004),
    ];
    const result = topCostCommands(records, 2);
    assert.strictEqual(result.length, 2);
  });

  it('defaults topN to 5', () => {
    const records = Array.from({ length: 7 }, (_, i) =>
      makeRecord(`cmd${i}`, `2026-05-01T${String(i).padStart(2, '0')}:00:00.000Z`, 100, 40, 'gpt-4o', 0.001 * (i + 1)),
    );
    const result = topCostCommands(records);
    assert.ok(result.length <= 5);
  });

  it('includes callCount, inputTokens, outputTokens', () => {
    const records = [
      makeRecord('forge', '2026-05-01T10:00:00.000Z', 1000, 400, 'claude-3-5-sonnet', 0.01),
      makeRecord('forge', '2026-05-01T11:00:00.000Z', 2000, 800, 'claude-3-5-sonnet', 0.02),
    ];
    const result = topCostCommands(records);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0]!.command, 'forge');
    assert.strictEqual(result[0]!.callCount, 2);
    assert.strictEqual(result[0]!.inputTokens, 3000);
    assert.strictEqual(result[0]!.outputTokens, 1200);
    assert.ok(Math.abs(result[0]!.estimatedCostUsd - 0.03) < 0.0001);
  });

  it('free models appear at bottom (zero cost)', () => {
    const records = [
      makeRecord('forge', '2026-05-01T10:00:00.000Z', 1000, 400, 'gpt-4o', 0.01),
      makeRecord('local', '2026-05-01T11:00:00.000Z', 5000, 2000, 'ollama', 0),
    ];
    const result = topCostCommands(records);
    assert.strictEqual(result[0]!.command, 'forge');
    assert.strictEqual(result[1]!.command, 'local');
  });
});
