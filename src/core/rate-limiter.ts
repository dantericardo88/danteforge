// Rate Limiter — Token bucket algorithm for per-caller request throttling.
// Protects the MCP server and CLI endpoints from DoS abuse and accidental overload.
// Zero external dependencies. Pure in-memory; no Redis needed for single-process CLI.
//
// Harvested pattern: token bucket (capacity + refillRate + refillInterval) from
// jhurliman/node-rate-limiter and oneuptime.com/blog 2026 production guidance.
// Adapted for a single-process CLI context (no distributed coordination needed).

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RateLimiterOptions {
  /** Max tokens the bucket can hold (burst allowance). Default: 30. */
  capacity?: number;
  /** Tokens added per refill interval. Default: 10. */
  refillRate?: number;
  /** Milliseconds between refills. Default: 1000 (1 per second). */
  refillIntervalMs?: number;
  /** Milliseconds between cleanup sweeps of idle buckets. Default: 300_000 (5 min). */
  cleanupIntervalMs?: number;
  /** Injectable time source — for deterministic testing. Default: Date.now. */
  _now?: () => number;
}

export interface RateLimitResult {
  allowed: boolean;
  remainingTokens: number;
  /** Milliseconds until the next token is available (0 when allowed). */
  retryAfterMs: number;
}

interface Bucket {
  tokens: number;
  lastRefillAt: number;
}

// ── RateLimiter class ─────────────────────────────────────────────────────────

export class RateLimiter {
  private readonly capacity: number;
  private readonly refillRate: number;
  private readonly refillIntervalMs: number;
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: RateLimiterOptions = {}) {
    this.capacity = opts.capacity ?? 30;
    this.refillRate = opts.refillRate ?? 10;
    this.refillIntervalMs = opts.refillIntervalMs ?? 1000;
    this.now = opts._now ?? (() => Date.now());

    const cleanupMs = opts.cleanupIntervalMs ?? 300_000;
    // Start cleanup only in non-test contexts (no _now injection)
    if (!opts._now) {
      this.cleanupTimer = setInterval(() => this.cleanup(), cleanupMs).unref();
    }
  }

  /**
   * Attempt to consume one token for `key` (e.g. tool name, caller IP).
   * Returns { allowed: true } if a token was available, { allowed: false } otherwise.
   */
  consume(key: string): RateLimitResult {
    const now = this.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillAt: now };
      this.buckets.set(key, bucket);
    }

    // Refill based on elapsed time
    const elapsed = now - bucket.lastRefillAt;
    const intervals = Math.floor(elapsed / this.refillIntervalMs);
    if (intervals > 0) {
      bucket.tokens = Math.min(this.capacity, bucket.tokens + intervals * this.refillRate);
      bucket.lastRefillAt = now - (elapsed % this.refillIntervalMs);
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remainingTokens: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }

    // Compute how long until the next token refills
    const msUntilNextRefill = this.refillIntervalMs - (now - bucket.lastRefillAt);
    return {
      allowed: false,
      remainingTokens: 0,
      retryAfterMs: msUntilNextRefill > 0 ? msUntilNextRefill : this.refillIntervalMs,
    };
  }

  /** Remaining tokens for a key without consuming. Returns capacity if key is unknown. */
  peek(key: string): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return this.capacity;
    return Math.floor(bucket.tokens);
  }

  /** Remove a specific key's bucket (e.g. after session ends). */
  reset(key: string): void {
    this.buckets.delete(key);
  }

  /** Remove all buckets that have been idle for > 2 × cleanupIntervalMs. */
  cleanup(maxIdleMs = 600_000): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefillAt > maxIdleMs) {
        this.buckets.delete(key);
      }
    }
  }

  /** Stop the background cleanup timer (call in tests / graceful shutdown). */
  destroy(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Current number of tracked buckets (diagnostic). */
  get bucketCount(): number {
    return this.buckets.size;
  }
}

// ── Singleton for MCP server use ──────────────────────────────────────────────
// Each MCP tool call gets throttled per tool name. Capacity 30 / refill 10 per
// second is generous enough for legitimate interactive use but blocks tight loops.

let _mcpLimiter: RateLimiter | null = null;

export function getMcpRateLimiter(): RateLimiter {
  if (!_mcpLimiter) {
    _mcpLimiter = new RateLimiter({ capacity: 30, refillRate: 10, refillIntervalMs: 1000 });
  }
  return _mcpLimiter;
}

/** Replace the singleton (for testing). Returns the previous instance. */
export function setMcpRateLimiter(limiter: RateLimiter | null): RateLimiter | null {
  const prev = _mcpLimiter;
  _mcpLimiter = limiter;
  return prev;
}
