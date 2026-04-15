// PerformanceMonitor tests

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { PerformanceMonitor } from '../src/core/performance-monitor.js';

// Use a temp directory to isolate file I/O from the real project
function makeTmpCwd(): string {
  return os.tmpdir();
}

describe('PerformanceMonitor', () => {
  it('constructs without throwing', () => {
    const cwd = makeTmpCwd();
    assert.doesNotThrow(() => new PerformanceMonitor(cwd));
  });

  it('getCurrentMetrics returns expected shape when no data', async () => {
    const monitor = new PerformanceMonitor(makeTmpCwd());
    const result = await monitor.getCurrentMetrics();
    assert.ok(Array.isArray(result.recent));
    assert.ok(typeof result.averages === 'object');
    assert.ok(typeof result.averages.startupTime === 'number');
    assert.ok(typeof result.averages.memoryUsage === 'number');
    assert.ok(typeof result.averages.cpuUsage === 'number');
    assert.ok(typeof result.regression === 'boolean');
  });

  it('recordStartupTime adds a measurement', async () => {
    const monitor = new PerformanceMonitor(makeTmpCwd());
    await monitor.recordStartupTime(100);
    const result = await monitor.getCurrentMetrics();
    assert.ok(result.recent.length >= 1);
  });

  it('averages.startupTime equals the recorded value for single measurement', async () => {
    const monitor = new PerformanceMonitor(makeTmpCwd());
    await monitor.recordStartupTime(250);
    const result = await monitor.getCurrentMetrics();
    assert.ok(Math.abs(result.averages.startupTime - 250) < 1);
  });

  it('getCurrentMetrics returns regression=false without baseline', async () => {
    const monitor = new PerformanceMonitor(makeTmpCwd());
    await monitor.recordStartupTime(100);
    const result = await monitor.getCurrentMetrics();
    // No baseline exists for a fresh monitor, so regression should be false
    assert.equal(result.regression, false);
  });

  it('updateBaseline does not throw', async () => {
    const monitor = new PerformanceMonitor(makeTmpCwd());
    await monitor.recordStartupTime(100);
    await assert.doesNotReject(() => monitor.updateBaseline());
  });

  it('multiple recordStartupTime calls accumulate measurements', async () => {
    const monitor = new PerformanceMonitor(makeTmpCwd());
    await monitor.recordStartupTime(100);
    await monitor.recordStartupTime(200);
    await monitor.recordStartupTime(300);
    const result = await monitor.getCurrentMetrics();
    assert.ok(result.recent.length >= 3);
  });

  it('averages.startupTime averages recent measurements', async () => {
    const monitor = new PerformanceMonitor(makeTmpCwd());
    await monitor.recordStartupTime(100);
    await monitor.recordStartupTime(200);
    const result = await monitor.getCurrentMetrics();
    const avg = result.averages.startupTime;
    assert.ok(avg >= 100 && avg <= 200);
  });

  it('recent slice is limited to last 10', async () => {
    const monitor = new PerformanceMonitor(makeTmpCwd());
    for (let i = 0; i < 15; i++) {
      await monitor.recordStartupTime(i * 10);
    }
    const result = await monitor.getCurrentMetrics();
    assert.ok(result.recent.length <= 10);
  });

  it('each measurement has a timestamp', async () => {
    const monitor = new PerformanceMonitor(makeTmpCwd());
    await monitor.recordStartupTime(100);
    const result = await monitor.getCurrentMetrics();
    assert.ok(result.recent.length > 0);
    for (const m of result.recent) {
      assert.ok(typeof m.timestamp === 'string');
      assert.ok(!isNaN(Date.parse(m.timestamp)));
    }
  });
});
