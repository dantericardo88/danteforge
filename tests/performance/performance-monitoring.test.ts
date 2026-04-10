import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PerformanceMonitor } from '../src/core/performance-monitor.js';
import { CostTracker } from '../src/core/cost-tracker.js';

describe('Performance Tests', () => {
  it('should monitor performance metrics', async () => {
    const monitor = new PerformanceMonitor();

    // Record some metrics
    await monitor.recordStartupTime(500);
    await monitor.recordStartupTime(450);
    await monitor.recordStartupTime(550);

    const { averages, regression } = await monitor.getCurrentMetrics();

    assert(averages.startupTime > 0, 'Should calculate startup time average');
    assert(!regression, 'Should not detect regression with consistent times');
  });

  it('should detect performance regression', async () => {
    const monitor = new PerformanceMonitor();

    // Establish baseline
    await monitor.recordStartupTime(500);
    await monitor.recordStartupTime(500);
    await monitor.updateBaseline();

    // Add slower measurements
    await monitor.recordStartupTime(1000); // 2x slower

    const { regression } = await monitor.getCurrentMetrics();
    assert(regression, 'Should detect performance regression');
  });

  it('should track costs', () => {
    const tracker = new CostTracker();

    tracker.trackCost('llm-call', 0.50);
    tracker.trackCost('api-call', 0.20);
    tracker.trackCost('llm-call', 0.75);

    const report = tracker.getCostReport();
    assert(report.total === 1.45, 'Should track total costs');
    assert(report.monthly.llm === 1.25, 'Should track LLM costs');
    assert(report.monthly.api === 0.20, 'Should track API costs');
  });

  it('should enforce budget limits', () => {
    const tracker = new CostTracker({
      budgetLimits: { monthlyLLM: 1.0 }
    });

    tracker.trackCost('llm-call', 0.60);
    const report1 = tracker.getCostReport();
    assert(report1.budgetStatus === 'ok', 'Should be ok under budget');

    tracker.trackCost('llm-call', 0.60); // Now over budget
    const report2 = tracker.getCostReport();
    assert(report2.budgetStatus === 'exceeded', 'Should detect budget exceeded');
  });
});