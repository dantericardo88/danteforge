// performance — CLI command for performance monitoring, regression detection,
// and structured metric reporting (p50/p95/p99 latency percentiles).
// Usage: danteforge performance [--json] [--update-baseline] [--reset-cache]

import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import {
  PerformanceMonitor,
  computePercentileStats,
  type PerformanceReport,
  type RegressionAlert,
} from '../../core/performance-monitor.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PerformanceCommandOptions {
  cwd?: string;
  json?: boolean;
  updateBaseline?: boolean;
  /** Load metrics from saved file rather than live in-process data */
  fromFile?: boolean;
  // Injection seams
  _monitor?: PerformanceMonitor;
  _stdout?: (line: string) => void;
  _isTTY?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function alertSeverityColor(severity: RegressionAlert['severity'], text: string, isTTY: boolean): string {
  if (!isTTY) return text;
  return severity === 'critical' ? chalk.red(text) : chalk.yellow(text);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderReport(report: PerformanceReport, emit: (l: string) => void, isTTY: boolean): void {
  const sep = isTTY
    ? chalk.gray('  ─────────────────────────────────────────────')
    : '  ─────────────────────────────────────────────';

  emit('');
  emit(isTTY ? chalk.bold('  DanteForge  —  Performance Report') : '  DanteForge  —  Performance Report');
  emit(sep);
  emit('');
  emit(`  Samples: ${report.sampleCount}   Reported: ${new Date(report.reportedAt).toLocaleString()}`);
  emit('');

  // Startup time percentiles
  const st = report.startupTimePercentiles;
  if (st.count > 0) {
    emit(isTTY ? chalk.bold('  Startup Time') : '  Startup Time');
    emit(`    p50   ${fmtMs(st.p50).padStart(10)}    (median)`);
    emit(`    p95   ${fmtMs(st.p95).padStart(10)}    (tail latency)`);
    emit(`    p99   ${fmtMs(st.p99).padStart(10)}    (worst-case)`);
    emit(`    avg   ${fmtMs(st.avg).padStart(10)}    min: ${fmtMs(st.min)}  max: ${fmtMs(st.max)}`);
    emit('');
  } else {
    emit('  No startup time samples recorded yet.');
    emit('  Run: danteforge performance --update-baseline  after a few runs.');
    emit('');
  }

  // Memory percentiles
  const mem = report.memoryPercentiles;
  if (mem.count > 0) {
    emit(isTTY ? chalk.bold('  Heap Memory Usage') : '  Heap Memory Usage');
    emit(`    p50   ${fmtBytes(mem.p50).padStart(12)}`);
    emit(`    p95   ${fmtBytes(mem.p95).padStart(12)}    (tail usage)`);
    emit(`    avg   ${fmtBytes(mem.avg).padStart(12)}    peak: ${fmtBytes(mem.max)}`);
    emit('');
  }

  // Cache hit rate
  const cache = report.cacheHitStats;
  if (cache.totalLookups > 0) {
    const rateStr = fmtPct(cache.hitRate);
    const rateColored = isTTY
      ? (cache.hitRate >= 0.8 ? chalk.green(rateStr) : cache.hitRate >= 0.5 ? chalk.yellow(rateStr) : chalk.red(rateStr))
      : rateStr;
    emit(isTTY ? chalk.bold('  Cache Performance') : '  Cache Performance');
    emit(`    Hit rate   ${rateColored}    (${cache.hits} hits / ${cache.totalLookups} lookups)`);
    emit('');
  }

  // Baseline
  if (report.baseline) {
    const b = report.baseline;
    emit(isTTY ? chalk.gray('  Baseline') : '  Baseline');
    emit(`    Startup   avg ${fmtMs(b.startupTime.avg)}  p95 ${fmtMs(b.startupTime.p95)}  p99 ${fmtMs(b.startupTime.p99)}`);
    emit(`    Memory    avg ${fmtBytes(b.memoryUsage.avg)}  peak ${fmtBytes(b.memoryUsage.peak)}`);
    emit(`    Updated   ${new Date(b.lastUpdated).toLocaleString()}`);
    emit('');
  } else {
    emit(isTTY ? chalk.gray('  No baseline set.') : '  No baseline set.');
    emit(`  Run: ${isTTY ? chalk.cyan('danteforge performance --update-baseline') : 'danteforge performance --update-baseline'}`);
    emit('');
  }

  // Regression alerts
  if (report.regressionAlerts.length > 0) {
    emit(isTTY ? chalk.red('  Regression Alerts') : '  Regression Alerts');
    for (const alert of report.regressionAlerts) {
      const label = alertSeverityColor(alert.severity, `  [${alert.severity.toUpperCase()}]`, isTTY);
      emit(`${label} ${alert.metric}: +${alert.percentIncrease}% vs baseline`);
      emit(`    current: ${alert.metric === 'startupTime' ? fmtMs(alert.currentValue) : fmtBytes(alert.currentValue)}`);
      emit(`    baseline: ${alert.metric === 'startupTime' ? fmtMs(alert.baselineValue) : fmtBytes(alert.baselineValue)}`);
    }
    emit('');
  } else if (report.baseline && report.sampleCount > 0) {
    emit(isTTY ? chalk.green('  No regressions detected.') : '  No regressions detected.');
    emit('');
  }

  emit(sep);
  emit('');
}

// ── JSON builder ──────────────────────────────────────────────────────────────

export function buildPerformanceJson(report: PerformanceReport): string {
  return JSON.stringify(
    {
      sampleCount: report.sampleCount,
      reportedAt: report.reportedAt,
      startupTime: {
        p50: report.startupTimePercentiles.p50,
        p95: report.startupTimePercentiles.p95,
        p99: report.startupTimePercentiles.p99,
        avg: report.startupTimePercentiles.avg,
        min: report.startupTimePercentiles.min,
        max: report.startupTimePercentiles.max,
        count: report.startupTimePercentiles.count,
      },
      memoryUsage: {
        p50: report.memoryPercentiles.p50,
        p95: report.memoryPercentiles.p95,
        avg: report.memoryPercentiles.avg,
        peak: report.memoryPercentiles.max,
        count: report.memoryPercentiles.count,
      },
      cacheHitRate: report.cacheHitStats.hitRate,
      cacheHits: report.cacheHitStats.hits,
      cacheMisses: report.cacheHitStats.misses,
      cacheLookups: report.cacheHitStats.totalLookups,
      regressionAlerts: report.regressionAlerts.map((a) => ({
        metric: a.metric,
        severity: a.severity,
        percentIncrease: a.percentIncrease,
        currentValue: a.currentValue,
        baselineValue: a.baselineValue,
        message: a.message,
        timestamp: a.timestamp,
      })),
      hasRegressions: report.regressionAlerts.length > 0,
      baseline: report.baseline
        ? {
            startupTime: report.baseline.startupTime,
            memoryUsage: report.baseline.memoryUsage,
            lastUpdated: report.baseline.lastUpdated,
          }
        : null,
    },
    null,
    2,
  );
}

// ── Saved metrics loader ──────────────────────────────────────────────────────

async function loadSavedMetrics(cwd: string): Promise<{ startupTimes: number[]; memoryValues: number[] }> {
  const metricsPath = `${cwd}/.danteforge/performance-metrics.json`;
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(metricsPath, 'utf8');
    const saved = JSON.parse(raw) as Array<{ startupTime: number; memoryUsage: number }>;
    if (!Array.isArray(saved)) return { startupTimes: [], memoryValues: [] };
    return {
      startupTimes: saved.map((m) => m.startupTime).filter((v) => typeof v === 'number'),
      memoryValues: saved.map((m) => m.memoryUsage).filter((v) => typeof v === 'number'),
    };
  } catch {
    return { startupTimes: [], memoryValues: [] };
  }
}

async function loadSavedBaseline(cwd: string) {
  const baselinePath = `${cwd}/.danteforge/performance-baseline.json`;
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(baselinePath, 'utf8');
    return JSON.parse(raw) as import('../../core/performance-monitor.js').PerformanceBaseline;
  } catch {
    return null;
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function performance(options: PerformanceCommandOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const emit = options._stdout ?? ((line: string) => process.stdout.write(line + '\n'));
  const isTTY = options._isTTY ?? (process.stdout.isTTY === true);

  try {
    let report: PerformanceReport;

    if (options._monitor) {
      // Live monitor provided (e.g., long-running process or tests)
      if (options.updateBaseline) {
        await options._monitor.updateBaseline();
        emit('Performance baseline updated.');
        return;
      }
      report = await options._monitor.getReport();
    } else {
      // Read from saved files on disk (CLI invocation without a live monitor)
      if (options.updateBaseline) {
        // Instantiate a fresh monitor from disk to update baseline
        const monitor = new PerformanceMonitor(cwd);
        await new Promise<void>((resolve) => setTimeout(resolve, 50)); // allow loadBaseline
        await monitor.updateBaseline();
        emit('Performance baseline updated from saved metrics.');
        return;
      }

      const { startupTimes, memoryValues } = await loadSavedMetrics(cwd);
      const baseline = await loadSavedBaseline(cwd);

      const startupTimePercentiles = computePercentileStats(startupTimes);
      const memoryPercentiles = computePercentileStats(memoryValues);

      // Check regressions against baseline
      const regressionAlerts: RegressionAlert[] = [];
      if (baseline && startupTimes.length > 0) {
        // Inline regression check (threshold: 20% warning, 50% critical)
        const avgStartup = startupTimePercentiles.avg;
        if (avgStartup > baseline.startupTime.avg * 1.20 && baseline.startupTime.avg > 0) {
          const pct = Math.round((avgStartup / baseline.startupTime.avg - 1) * 100);
          const severity: RegressionAlert['severity'] = avgStartup > baseline.startupTime.avg * 1.50 ? 'critical' : 'warning';
          regressionAlerts.push({
            metric: 'startupTime',
            currentValue: avgStartup,
            baselineValue: baseline.startupTime.avg,
            percentIncrease: pct,
            threshold: severity === 'critical' ? 1.50 : 1.20,
            severity,
            timestamp: new Date().toISOString(),
            message: `[${severity.toUpperCase()}] startupTime is ${pct}% above baseline (avg: ${Math.round(avgStartup)}ms vs baseline: ${Math.round(baseline.startupTime.avg)}ms)`,
          });
        }
      }

      report = {
        startupTimePercentiles,
        memoryPercentiles,
        regressionAlerts,
        cacheHitStats: { hits: 0, misses: 0, hitRate: 0, totalLookups: 0 },
        baseline,
        sampleCount: startupTimes.length,
        reportedAt: new Date().toISOString(),
      };
    }

    if (options.json) {
      emit(buildPerformanceJson(report));
    } else {
      renderReport(report, emit, isTTY);
    }
  } catch (err) {
    logger.error(`performance: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
