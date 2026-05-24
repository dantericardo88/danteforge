import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';

// ── Budget types ──────────────────────────────────────────────────────────────

/** Per-operation time budgets in milliseconds. */
export interface PerformanceBudget {
  /** Budgets keyed by operation name (e.g. 'forge', 'verify', 'startup'). */
  operations: Record<string, number>;
  /** Default budget applied when no operation-specific entry exists. */
  defaultBudgetMs: number;
}

export interface BudgetCheckResult {
  ok: boolean;
  budget: number;
  elapsed: number;
  overageMs: number;
}

export interface PerformanceMetrics {
  startupTime: number;
  memoryUsage: number;
  cpuUsage: number;
  timestamp: string;
  /** Optional operation label for grouping (e.g. 'forge', 'verify') */
  operation?: string;
}

export interface PercentileStats {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
  count: number;
}

export interface RegressionAlert {
  metric: 'startupTime' | 'memoryUsage';
  currentValue: number;
  baselineValue: number;
  percentIncrease: number;
  threshold: number;
  severity: 'warning' | 'critical';
  timestamp: string;
  message: string;
}

export interface CacheHitStats {
  hits: number;
  misses: number;
  hitRate: number;   // 0–1 fraction
  totalLookups: number;
}

export interface PerformanceBaseline {
  startupTime: { avg: number; p95: number; p99: number };
  memoryUsage: { avg: number; peak: number; p95: number };
  lastUpdated: string;
}

export interface PerformanceReport {
  startupTimePercentiles: PercentileStats;
  memoryPercentiles: PercentileStats;
  regressionAlerts: RegressionAlert[];
  cacheHitStats: CacheHitStats;
  baseline: PerformanceBaseline | null;
  sampleCount: number;
  reportedAt: string;
}

// ── Percentile computation ────────────────────────────────────────────────────

export function computePercentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (pct / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower]!;
  const frac = idx - lower;
  return (sorted[lower]! * (1 - frac)) + (sorted[upper]! * frac);
}

export function computePercentileStats(values: number[]): PercentileStats {
  if (values.length === 0) {
    return { p50: 0, p95: 0, p99: 0, avg: 0, min: 0, max: 0, count: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  return {
    p50: computePercentile(sorted, 50),
    p95: computePercentile(sorted, 95),
    p99: computePercentile(sorted, 99),
    avg,
    min: sorted[0]!,
    max: sorted[sorted.length - 1]!,
    count: sorted.length,
  };
}

// ── Regression alert builder ──────────────────────────────────────────────────

const REGRESSION_WARNING_THRESHOLD = 1.20;   // 20% slower → warning
const REGRESSION_CRITICAL_THRESHOLD = 1.50;  // 50% slower → critical

function buildRegressionAlert(
  metric: RegressionAlert['metric'],
  current: number,
  baseline: number,
): RegressionAlert | null {
  if (baseline <= 0 || current <= baseline * REGRESSION_WARNING_THRESHOLD) return null;
  const ratio = current / baseline;
  const severity: RegressionAlert['severity'] = ratio >= REGRESSION_CRITICAL_THRESHOLD ? 'critical' : 'warning';
  const percentIncrease = Math.round((ratio - 1) * 100);
  const threshold = severity === 'critical' ? REGRESSION_CRITICAL_THRESHOLD : REGRESSION_WARNING_THRESHOLD;
  return {
    metric,
    currentValue: current,
    baselineValue: baseline,
    percentIncrease,
    threshold,
    severity,
    timestamp: new Date().toISOString(),
    message: `[${severity.toUpperCase()}] ${metric} is ${percentIncrease}% above baseline (${current.toFixed(1)} vs ${baseline.toFixed(1)})`,
  };
}

// ── PerformanceMonitor ────────────────────────────────────────────────────────

export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private baseline: PerformanceBaseline | null = null;
  private cacheHits = 0;
  private cacheMisses = 0;
  private readonly baselinePath: string;
  private budget: PerformanceBudget | null = null;
  private budgetViolationCallback: ((result: BudgetCheckResult & { operation: string }) => void) | null = null;

  constructor(cwd: string = process.cwd()) {
    this.baselinePath = path.join(cwd, '.danteforge', 'performance-baseline.json');
    // Fire-and-forget — constructor must stay sync
    this.loadBaseline().catch(() => { /* best-effort */ });
  }

  // ── Budget API ────────────────────────────────────────────────────────────

  /** Set the active budget. Pass null to clear. */
  setBudget(budget: PerformanceBudget | null): void {
    this.budget = budget;
  }

  /**
   * Check whether `elapsed` is within budget for the given operation.
   * Returns a {@link BudgetCheckResult} with ok=false and overageMs>0 when exceeded.
   */
  checkBudget(operation: string, elapsed: number): BudgetCheckResult {
    const budgetMs = this.budget
      ? (this.budget.operations[operation] ?? this.budget.defaultBudgetMs)
      : Infinity;
    const overageMs = Math.max(0, elapsed - budgetMs);
    return { ok: overageMs === 0, budget: budgetMs, elapsed, overageMs };
  }

  /**
   * Register a callback that fires whenever a budget violation is detected.
   * Pass null to remove the callback.
   * Violations are evaluated inside {@link recordStartupTime} automatically
   * when an operation label is provided and a budget is active.
   */
  alertOnBudgetViolation(
    callback: ((result: BudgetCheckResult & { operation: string }) => void) | null,
  ): void {
    this.budgetViolationCallback = callback;
  }

  // ── Public recording API ──────────────────────────────────────────────────

  async recordStartupTime(duration: number, operation?: string): Promise<void> {
    const metrics: PerformanceMetrics = {
      startupTime: duration,
      memoryUsage: process.memoryUsage().heapUsed,
      cpuUsage: process.cpuUsage().user + process.cpuUsage().system,
      timestamp: new Date().toISOString(),
      ...(operation ? { operation } : {}),
    };

    this.metrics.push(metrics);

    // Keep only last 200 measurements
    if (this.metrics.length > 200) {
      this.metrics = this.metrics.slice(-200);
    }

    await this.saveMetrics();
    this.checkAndLogRegressions(metrics);

    // Fire budget violation callback when an operation label is provided
    if (operation && this.budget && this.budgetViolationCallback) {
      const budgetResult = this.checkBudget(operation, duration);
      if (!budgetResult.ok) {
        this.budgetViolationCallback({ ...budgetResult, operation });
      }
    }
  }

  /** Record a cache hit (for cacheHitRate tracking). */
  recordCacheHit(): void {
    this.cacheHits++;
  }

  /** Record a cache miss (for cacheHitRate tracking). */
  recordCacheMiss(): void {
    this.cacheMisses++;
  }

  /** Reset in-memory cache counters (call at startup or test setup). */
  resetCacheCounters(): void {
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  // ── Query API ─────────────────────────────────────────────────────────────

  getCacheHitStats(): CacheHitStats {
    const totalLookups = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      totalLookups,
      hitRate: totalLookups > 0 ? this.cacheHits / totalLookups : 0,
    };
  }

  async getCurrentMetrics(): Promise<{
    recent: PerformanceMetrics[];
    averages: { startupTime: number; memoryUsage: number; cpuUsage: number };
    regression: boolean;
    regressionAlerts: RegressionAlert[];
  }> {
    const recent = this.metrics.slice(-10); // Last 10 measurements

    const averages = recent.reduce(
      (acc, m) => ({
        startupTime: acc.startupTime + m.startupTime,
        memoryUsage: acc.memoryUsage + m.memoryUsage,
        cpuUsage: acc.cpuUsage + m.cpuUsage,
      }),
      { startupTime: 0, memoryUsage: 0, cpuUsage: 0 },
    );

    if (recent.length > 0) {
      averages.startupTime /= recent.length;
      averages.memoryUsage /= recent.length;
      averages.cpuUsage /= recent.length;
    }

    const regressionAlerts: RegressionAlert[] = [];
    if (this.baseline) {
      const startupAlert = buildRegressionAlert('startupTime', averages.startupTime, this.baseline.startupTime.avg);
      if (startupAlert) {
        regressionAlerts.push(startupAlert);
        logger.warn(startupAlert.message);
      }
      const memAlert = buildRegressionAlert('memoryUsage', averages.memoryUsage, this.baseline.memoryUsage.avg);
      if (memAlert) {
        regressionAlerts.push(memAlert);
        logger.warn(memAlert.message);
      }
    }

    return { recent, averages, regression: regressionAlerts.length > 0, regressionAlerts };
  }

  /** Generate a full structured report with p50/p95/p99 percentiles. */
  async getReport(): Promise<PerformanceReport> {
    const startupTimes = this.metrics.map((m) => m.startupTime);
    const memoryValues = this.metrics.map((m) => m.memoryUsage);
    const startupTimePercentiles = computePercentileStats(startupTimes);
    const memoryPercentiles = computePercentileStats(memoryValues);

    const regressionAlerts: RegressionAlert[] = [];
    if (this.baseline) {
      const startupAlert = buildRegressionAlert('startupTime', startupTimePercentiles.avg, this.baseline.startupTime.avg);
      if (startupAlert) regressionAlerts.push(startupAlert);
      const memAlert = buildRegressionAlert('memoryUsage', memoryPercentiles.avg, this.baseline.memoryUsage.avg);
      if (memAlert) regressionAlerts.push(memAlert);
    }

    return {
      startupTimePercentiles,
      memoryPercentiles,
      regressionAlerts,
      cacheHitStats: this.getCacheHitStats(),
      baseline: this.baseline,
      sampleCount: this.metrics.length,
      reportedAt: new Date().toISOString(),
    };
  }

  async updateBaseline(): Promise<void> {
    const startupTimes = this.metrics.map((m) => m.startupTime);
    const memoryValues = this.metrics.map((m) => m.memoryUsage);

    if (startupTimes.length === 0) {
      logger.warn('No metrics recorded — cannot update baseline');
      return;
    }

    const startupStats = computePercentileStats(startupTimes);
    const memStats = computePercentileStats(memoryValues);

    this.baseline = {
      startupTime: { avg: startupStats.avg, p95: startupStats.p95, p99: startupStats.p99 },
      memoryUsage: { avg: memStats.avg, peak: memStats.max, p95: memStats.p95 },
      lastUpdated: new Date().toISOString(),
    };

    await this.saveBaseline();
    logger.info('Performance baseline updated');
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private async loadBaseline(): Promise<void> {
    try {
      const data = await fs.readFile(this.baselinePath, 'utf8');
      this.baseline = JSON.parse(data) as PerformanceBaseline;
    } catch {
      // No baseline exists yet — first run
    }
  }

  private async saveBaseline(): Promise<void> {
    if (!this.baseline) return;
    const dir = path.dirname(this.baselinePath);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.baselinePath, JSON.stringify(this.baseline, null, 2));
    } catch {
      // best-effort — failure is non-fatal
    }
  }

  private async saveMetrics(): Promise<void> {
    const metricsPath = path.join(path.dirname(this.baselinePath), 'performance-metrics.json');
    const dir = path.dirname(metricsPath);
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(metricsPath, JSON.stringify(this.metrics, null, 2));
    } catch {
      // best-effort — failure is non-fatal
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private checkAndLogRegressions(latest: PerformanceMetrics): void {
    if (!this.baseline) return;
    const startupAlert = buildRegressionAlert('startupTime', latest.startupTime, this.baseline.startupTime.avg);
    if (startupAlert) logger.warn(startupAlert.message);
    const memAlert = buildRegressionAlert('memoryUsage', latest.memoryUsage, this.baseline.memoryUsage.avg);
    if (memAlert) logger.warn(memAlert.message);
  }
}
