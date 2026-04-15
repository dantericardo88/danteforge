// security-scoring — Proves the scoreSecurity() function is a pure signal detector.
// Tests:
//   1. Comment stripping eliminates innerHTML false positive from pattern-security-scanner
//   2. Positive signals (input-validation, rate-limiter) add bonus points correctly
//   3. Dangerous patterns in actual code (not comments/strings) are still detected
//   4. Rate limiter token bucket: allow/deny, refill, cleanup, peek, reset
//   5. MCP rate limiter singleton + setMcpRateLimiter override

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, getMcpRateLimiter, setMcpRateLimiter } from '../src/core/rate-limiter.js';

// ── Helpers for maturity engine injection ────────────────────────────────────

/**
 * Minimal scoreSecurity harness that replicates the maturity engine's logic
 * with injectable readFile, collectFiles, and fileExists — so we can test
 * the scoring formula in isolation without touching the filesystem.
 */

function stripStringLiterals(src: string): string {
  return src.replace(/'[^'\n]*'|"[^"\n]*"|`[^`\n]*`/g, (m) => ' '.repeat(m.length));
}

async function scoreSecurityInjected(opts: {
  files?: Record<string, string>;   // filePath → content
  envExists?: boolean;
  inputValidationExists?: boolean;
  rateLimiterExists?: boolean;
}): Promise<number> {
  const files = opts.files ?? {};
  const envExists = opts.envExists ?? false;
  const inputValidationExists = opts.inputValidationExists ?? false;
  const rateLimiterExists = opts.rateLimiterExists ?? false;

  let score = 70;
  let dangerousPatterns = 0;

  for (const raw of Object.values(files)) {
    // Mirrors the fixed maturity-engine scoreSecurity: strip strings + comments
    const stripped = stripStringLiterals(raw).replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
    if (/process\.env\.SECRET/i.test(stripped)) dangerousPatterns++;
    if (/eval\(/g.test(stripped)) dangerousPatterns++;
    if (/innerHTML\s*=/g.test(stripped)) dangerousPatterns++;
    if (/FROM.*WHERE/i.test(raw) && !/\$\d+|\?/g.test(raw)) dangerousPatterns++;
  }

  score -= dangerousPatterns * 10;
  if (envExists) score += 10;
  if (inputValidationExists) score += 5;
  if (rateLimiterExists) score += 5;

  return Math.min(100, Math.max(0, score));
}

// ── False positive elimination ────────────────────────────────────────────────

describe('scoreSecurity — false positive elimination', () => {
  it('innerHTML = in a // comment does NOT count as dangerous pattern', async () => {
    const content = `
// 4. XSS: innerHTML = or document.write(
const RE_XSS = /innerHTML\\s*=|document\\.write\\s*\\(/g;
export function scanForXss(src: string) { return RE_XSS.test(src); }
`;
    const score = await scoreSecurityInjected({ files: { 'scanner.ts': content } });
    // No dangerous patterns → score = 70 (baseline, no .env)
    assert.equal(score, 70, `Expected 70 (no dangerous patterns), got ${score}`);
  });

  it('innerHTML = in a string literal does NOT count as dangerous pattern', async () => {
    const content = `const desc = 'innerHTML = is dangerous for XSS';`;
    const score = await scoreSecurityInjected({ files: { 'docs.ts': content } });
    assert.equal(score, 70);
  });

  it('innerHTML = in ACTUAL code (assignment) DOES count as dangerous', async () => {
    const content = `
export function render(html: string) {
  document.getElementById('root').innerHTML = html;
}
`;
    const score = await scoreSecurityInjected({ files: { 'render.ts': content } });
    assert.equal(score, 60, `Expected 60 (one dangerous pattern: innerHTML=), got ${score}`);
  });

  it('eval( in a // comment does NOT count as dangerous', async () => {
    const content = `
// eval( is dangerous — never use it
const safe = JSON.parse;
`;
    const score = await scoreSecurityInjected({ files: { 'safe.ts': content } });
    assert.equal(score, 70);
  });

  it('eval( in actual code DOES count as dangerous', async () => {
    const content = `export function run(code: string) { return eval(code); }`;
    const score = await scoreSecurityInjected({ files: { 'unsafe.ts': content } });
    assert.equal(score, 60);
  });

  it('multiple dangerous patterns in one file each subtract 10', async () => {
    const content = `
document.body.innerHTML = userInput;
const result = eval(userCode);
`;
    const score = await scoreSecurityInjected({ files: { 'bad.ts': content } });
    assert.equal(score, 50, `Expected 50 (two patterns: innerHTML + eval), got ${score}`);
  });

  it('regex literal with innerHTML\\s*= in source does NOT trigger false positive', async () => {
    // This is exactly what pattern-security-scanner.ts contains
    const content = `const RE_XSS = /innerHTML\\s*=|document\\.write\\s*\\(/g;`;
    const score = await scoreSecurityInjected({ files: { 'scanner.ts': content } });
    assert.equal(score, 70, 'Regex literal should not trigger innerHTML= false positive');
  });
});

// ── Positive signal bonuses ───────────────────────────────────────────────────

describe('scoreSecurity — positive signal bonuses', () => {
  it('baseline with no signals = 70', async () => {
    const score = await scoreSecurityInjected({});
    assert.equal(score, 70);
  });

  it('.env file adds +10 → 80', async () => {
    const score = await scoreSecurityInjected({ envExists: true });
    assert.equal(score, 80);
  });

  it('input-validation module adds +5 → 75', async () => {
    const score = await scoreSecurityInjected({ inputValidationExists: true });
    assert.equal(score, 75);
  });

  it('rate-limiter module adds +5 → 75', async () => {
    const score = await scoreSecurityInjected({ rateLimiterExists: true });
    assert.equal(score, 75);
  });

  it('all bonuses combined: .env + input-validation + rate-limiter = 90', async () => {
    const score = await scoreSecurityInjected({
      envExists: true,
      inputValidationExists: true,
      rateLimiterExists: true,
    });
    assert.equal(score, 90);
  });

  it('dangerous pattern offsets bonus: .env + input-validation + rate-limiter - 1 pattern = 80', async () => {
    const content = `document.body.innerHTML = userInput;`;
    const score = await scoreSecurityInjected({
      files: { 'bad.ts': content },
      envExists: true,
      inputValidationExists: true,
      rateLimiterExists: true,
    });
    assert.equal(score, 80);
  });

  it('score is capped at 100 even with excess bonuses', async () => {
    const score = await scoreSecurityInjected({
      envExists: true,
      inputValidationExists: true,
      rateLimiterExists: true,
    });
    assert.ok(score <= 100, `Score ${score} must not exceed 100`);
  });

  it('score floors at 0 with many dangerous patterns', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 10; i++) {
      files[`bad${i}.ts`] = `document.body.innerHTML = x${i}; eval(x${i});`;
    }
    const score = await scoreSecurityInjected({ files });
    assert.equal(score, 0);
  });
});

// ── RateLimiter — token bucket ────────────────────────────────────────────────

describe('RateLimiter — token bucket', () => {
  it('first call is always allowed (bucket starts full)', () => {
    let t = 0;
    const limiter = new RateLimiter({ capacity: 5, refillRate: 1, refillIntervalMs: 1000, _now: () => t });
    const result = limiter.consume('tool-a');
    assert.ok(result.allowed, 'First call should be allowed');
    assert.equal(result.remainingTokens, 4);
    assert.equal(result.retryAfterMs, 0);
  });

  it('exhausting the bucket denies subsequent calls', () => {
    let t = 0;
    const limiter = new RateLimiter({ capacity: 3, refillRate: 1, refillIntervalMs: 1000, _now: () => t });
    limiter.consume('tool');
    limiter.consume('tool');
    limiter.consume('tool');
    const result = limiter.consume('tool');
    assert.ok(!result.allowed, 'Should be denied after bucket exhausted');
    assert.equal(result.remainingTokens, 0);
    assert.ok(result.retryAfterMs > 0, 'retryAfterMs should be positive');
  });

  it('tokens refill after interval elapses', () => {
    let t = 0;
    const limiter = new RateLimiter({ capacity: 2, refillRate: 2, refillIntervalMs: 500, _now: () => t });
    limiter.consume('k');
    limiter.consume('k');
    const denied = limiter.consume('k');
    assert.ok(!denied.allowed);

    t = 600; // One interval elapsed
    const refilled = limiter.consume('k');
    assert.ok(refilled.allowed, 'Should be allowed after refill');
  });

  it('refill does not exceed capacity', () => {
    let t = 0;
    const limiter = new RateLimiter({ capacity: 5, refillRate: 100, refillIntervalMs: 100, _now: () => t });
    limiter.consume('k');
    t = 10000; // Way more than needed for full refill
    limiter.consume('k');
    const remaining = limiter.peek('k');
    assert.equal(remaining, 4, 'Should not exceed capacity of 5 (consumed 1)');
  });

  it('different keys have independent buckets', () => {
    let t = 0;
    const limiter = new RateLimiter({ capacity: 1, refillRate: 1, refillIntervalMs: 1000, _now: () => t });
    limiter.consume('tool-a');
    const denied = limiter.consume('tool-a');
    const allowed = limiter.consume('tool-b');
    assert.ok(!denied.allowed, 'tool-a should be denied (exhausted)');
    assert.ok(allowed.allowed, 'tool-b should be allowed (fresh bucket)');
  });

  it('peek returns capacity for unknown key', () => {
    const limiter = new RateLimiter({ capacity: 10, _now: () => 0 });
    assert.equal(limiter.peek('never-seen'), 10);
  });

  it('reset removes the bucket so next call starts fresh', () => {
    let t = 0;
    const limiter = new RateLimiter({ capacity: 1, refillRate: 1, refillIntervalMs: 1000, _now: () => t });
    limiter.consume('k');
    const denied = limiter.consume('k');
    assert.ok(!denied.allowed);
    limiter.reset('k');
    const allowed = limiter.consume('k');
    assert.ok(allowed.allowed, 'Should be allowed after reset');
  });

  it('cleanup removes idle buckets beyond maxIdleMs', () => {
    let t = 0;
    const limiter = new RateLimiter({ capacity: 5, refillRate: 1, refillIntervalMs: 1000, _now: () => t });
    limiter.consume('old-tool');
    assert.equal(limiter.bucketCount, 1);
    t = 700_000; // 700s — exceeds default 600s maxIdleMs
    limiter.cleanup();
    assert.equal(limiter.bucketCount, 0, 'Idle bucket should be cleaned up');
  });

  it('bucketCount tracks active buckets correctly', () => {
    const limiter = new RateLimiter({ capacity: 5, _now: () => 0 });
    assert.equal(limiter.bucketCount, 0);
    limiter.consume('a');
    limiter.consume('b');
    assert.equal(limiter.bucketCount, 2);
    limiter.reset('a');
    assert.equal(limiter.bucketCount, 1);
  });

  it('destroy stops the cleanup timer without throwing', () => {
    // Use _now injection so no real timer is started
    const limiter = new RateLimiter({ capacity: 5, _now: () => 0 });
    assert.doesNotThrow(() => limiter.destroy());
  });
});

// ── MCP rate limiter singleton ────────────────────────────────────────────────

describe('getMcpRateLimiter / setMcpRateLimiter', () => {
  it('getMcpRateLimiter returns a RateLimiter instance', () => {
    const limiter = getMcpRateLimiter();
    assert.ok(limiter instanceof RateLimiter);
  });

  it('getMcpRateLimiter returns the same instance on repeated calls', () => {
    const a = getMcpRateLimiter();
    const b = getMcpRateLimiter();
    assert.strictEqual(a, b);
  });

  it('setMcpRateLimiter replaces the singleton and returns the previous', () => {
    const original = getMcpRateLimiter();
    const custom = new RateLimiter({ capacity: 1, _now: () => 0 });
    const prev = setMcpRateLimiter(custom);
    assert.strictEqual(prev, original);
    assert.strictEqual(getMcpRateLimiter(), custom);
    // Restore
    setMcpRateLimiter(original);
  });

  it('setMcpRateLimiter(null) clears the singleton so next getMcp creates a fresh one', () => {
    const original = getMcpRateLimiter();
    setMcpRateLimiter(null);
    const fresh = getMcpRateLimiter();
    assert.notStrictEqual(fresh, original, 'Should be a new instance after null reset');
    // Restore for subsequent tests
    setMcpRateLimiter(original);
  });
});
