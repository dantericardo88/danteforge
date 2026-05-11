// Tests for DanteSanitize cost guardrails (Sprint 8)
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  TokenBudget,
  estimateSanitizeCost,
  writeBudgetSnapshot,
  writeBudgetExhausted,
  DEFAULT_MAX_TOKENS_PER_SESSION,
  SANITIZE_BUDGET_FILE,
  SANITIZE_BUDGET_EXHAUSTED_FILE,
} from '../src/core/sanitize-cost.js';

const tmpDirs: string[] = [];
async function makeTmp(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), 'dante-cost-'));
  tmpDirs.push(d);
  return d;
}
after(async () => {
  for (const d of tmpDirs) await fs.rm(d, { recursive: true, force: true }).catch(() => {});
});

// ── estimateSanitizeCost ─────────────────────────────────────────────────────

describe('estimateSanitizeCost', () => {
  it('returns zero for empty queue', () => {
    const r = estimateSanitizeCost({ queueLocs: [] });
    assert.equal(r.estimatedTokens, 0);
    assert.equal(r.fileCount, 0);
  });

  it('scales linearly with total LOC', () => {
    const r1 = estimateSanitizeCost({ queueLocs: [1000] });
    const r2 = estimateSanitizeCost({ queueLocs: [1000, 1000] });
    assert.equal(r2.estimatedTokens, r1.estimatedTokens * 2);
    assert.equal(r2.fileCount, 2);
  });

  it('uses 30 tokens/LOC default heuristic', () => {
    const r = estimateSanitizeCost({ queueLocs: [100] });
    assert.equal(r.estimatedTokens, 3000);
  });

  it('respects override of tokensPerLoc', () => {
    const r = estimateSanitizeCost({ queueLocs: [100], tokensPerLoc: 50 });
    assert.equal(r.estimatedTokens, 5000);
  });

  it('computes USD range using $3/$15 per 1M tokens', () => {
    // 1M tokens = 1M / 30 = 33,333.33 LOC. Use exact integer to dodge float drift.
    const r = estimateSanitizeCost({ queueLocs: [1_000_000], tokensPerLoc: 1 });
    assert.equal(r.estimatedTokens, 1_000_000);
    assert.equal(r.estimatedUsdLow, 3);
    assert.equal(r.estimatedUsdHigh, 15);
  });
});

// ── TokenBudget ──────────────────────────────────────────────────────────────

describe('TokenBudget', () => {
  it('starts not-exhausted with full budget remaining', () => {
    const b = new TokenBudget(10_000);
    assert.equal(b.exhausted(), false);
    assert.equal(b.remaining(), 10_000);
    assert.equal(b.percentUsed(), 0);
  });

  it('tracks consumption correctly', () => {
    const b = new TokenBudget(10_000);
    b.consume(3_000, 'analysis');
    assert.equal(b.remaining(), 7_000);
    assert.equal(b.percentUsed(), 30);
  });

  it('marks exhausted when consumed >= budget', () => {
    const b = new TokenBudget(10_000);
    b.consume(10_000, 'extraction');
    assert.equal(b.exhausted(), true);
    assert.equal(b.remaining(), 0);
  });

  it('marks exhausted on overshoot', () => {
    const b = new TokenBudget(10_000);
    b.consume(12_000, 'extraction');
    assert.equal(b.exhausted(), true);
    assert.equal(b.remaining(), 0);  // clamped to 0
    assert.equal(b.percentUsed(), 100); // clamped
  });

  it('records per-call breakdown', () => {
    const b = new TokenBudget(10_000);
    b.consume(2_000, 'analysis');
    b.consume(3_000, 'extraction');
    b.consume(1_000, 'rewrite');
    const snap = b.snapshot();
    assert.equal(snap.calls.length, 3);
    assert.equal(snap.calls[0]!.phase, 'analysis');
    assert.equal(snap.calls[2]!.tokens, 1_000);
  });

  it('uses DEFAULT_MAX_TOKENS_PER_SESSION when no arg passed', () => {
    const b = new TokenBudget();
    assert.equal(b.remaining(), DEFAULT_MAX_TOKENS_PER_SESSION);
  });
});

// ── writeBudgetSnapshot ──────────────────────────────────────────────────────

describe('writeBudgetSnapshot', () => {
  it('writes a valid JSON file with the budget state', async () => {
    const cwd = await makeTmp();
    const b = new TokenBudget(5_000);
    b.consume(1_000, 'analysis');
    b.consume(500, 'extraction');
    await writeBudgetSnapshot(cwd, b);
    const filePath = path.join(cwd, SANITIZE_BUDGET_FILE);
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.maxTokens, 5_000);
    assert.equal(parsed.consumed, 1_500);
    assert.equal(parsed.calls.length, 2);
  });
});

// ── writeBudgetExhausted ─────────────────────────────────────────────────────

describe('writeBudgetExhausted', () => {
  it('writes an exhausted marker file with diagnostic info', async () => {
    const cwd = await makeTmp();
    const b = new TokenBudget(5_000);
    b.consume(5_000, 'extraction');
    const written = await writeBudgetExhausted(cwd, b);
    assert.ok(written.includes('budget-exhausted.json'));
    const content = await fs.readFile(path.join(cwd, SANITIZE_BUDGET_EXHAUSTED_FILE), 'utf8');
    const parsed = JSON.parse(content);
    assert.ok(parsed.reason.includes('exhausted'));
    assert.ok(parsed.suggestedActions.length >= 2);
    assert.equal(parsed.snapshot.consumed, 5_000);
  });
});
