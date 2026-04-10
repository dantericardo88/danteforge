import fs from 'fs/promises';
import path from 'path';
import { logger } from '../core/logger.js';

export interface PerformanceMetrics {
  startupTime: number;
  memoryUsage: number;
  cpuUsage: number;
  timestamp: string;
}

export interface PerformanceBaseline {
  startupTime: { avg: number; p95: number };
  memoryUsage: { avg: number; peak: number };
  lastUpdated: string;
}

export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private baseline: PerformanceBaseline | null = null;
  private baselinePath: string;

  constructor(cwd: string = process.cwd()) {
    this.baselinePath = path.join(cwd, '.danteforge', 'performance-baseline.json');
    this.loadBaseline();
  }

  async recordStartupTime(duration: number): Promise<void> {
    const metrics: PerformanceMetrics = {
      startupTime: duration,
      memoryUsage: process.memoryUsage().heapUsed,
      cpuUsage: process.cpuUsage().user + process.cpuUsage().system,
      timestamp: new Date().toISOString()
    };

    this.metrics.push(metrics);

    // Keep only last 100 measurements
    if (this.metrics.length > 100) {
      this.metrics = this.metrics.slice(-100);
    }

    await this.saveMetrics();
  }

  async getCurrentMetrics(): Promise<{
    recent: PerformanceMetrics[];
    averages: { startupTime: number; memoryUsage: number; cpuUsage: number };
    regression: boolean;
  }> {
    const recent = this.metrics.slice(-10); // Last 10 measurements

    const averages = recent.reduce(
      (acc, m) => ({
        startupTime: acc.startupTime + m.startupTime,
        memoryUsage: acc.memoryUsage + m.memoryUsage,
        cpuUsage: acc.cpuUsage + m.cpuUsage
      }),
      { startupTime: 0, memoryUsage: 0, cpuUsage: 0 }
    );

    if (recent.length > 0) {
      averages.startupTime /= recent.length;
      averages.memoryUsage /= recent.length;
      averages.cpuUsage /= recent.length;
    }

    // Check for regression
    let regression = false;
    if (this.baseline) {
      const regressionThreshold = 1.2; // 20% slower
      if (averages.startupTime > this.baseline.startupTime.avg * regressionThreshold) {
        regression = true;
        logger.warn(`Performance regression detected: startup time ${averages.startupTime.toFixed(0)}ms vs baseline ${this.baseline.startupTime.avg.toFixed(0)}ms`);
      }
    }

    return { recent, averages, regression };
  }

  async updateBaseline(): Promise<void> {
    const { averages } = await this.getCurrentMetrics();

    this.baseline = {
      startupTime: { avg: averages.startupTime, p95: averages.startupTime * 1.1 }, // Rough P95 estimate
      memoryUsage: { avg: averages.memoryUsage, peak: averages.memoryUsage },
      lastUpdated: new Date().toISOString()
    };

    await this.saveBaseline();
    logger.info('Performance baseline updated');
  }

  private async loadBaseline(): Promise<void> {
    try {
      const data = await fs.readFile(this.baselinePath, 'utf8');
      this.baseline = JSON.parse(data);
    } catch {
      // No baseline exists yet
    }
  }

  private async saveBaseline(): Promise<void> {
    if (this.baseline) {
      const dir = path.dirname(this.baselinePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.baselinePath, JSON.stringify(this.baseline, null, 2));
    }
  }

  private async saveMetrics(): Promise<void> {
    const metricsPath = path.join(path.dirname(this.baselinePath), 'performance-metrics.json');
    const dir = path.dirname(metricsPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(metricsPath, JSON.stringify(this.metrics, null, 2));
  }
}