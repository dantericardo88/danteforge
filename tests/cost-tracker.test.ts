import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CostTracker } from '../src/core/cost-tracker.js';

describe('CostTracker', () => {
  it('constructs with default options', () => {
    const tracker = new CostTracker();
    assert.ok(tracker);
  });

  it('constructs with custom options', () => {
    const tracker = new CostTracker({
      enableLLMTracking: false,
      budgetLimits: { monthlyLLM: 50 },
    });
    assert.ok(tracker);
  });

  it('getCostReport returns zero total when empty', () => {
    const tracker = new CostTracker();
    const report = tracker.getCostReport();
    assert.equal(report.total, 0);
    assert.deepEqual(report.byOperation, {});
    assert.equal(report.budgetStatus, 'ok');
  });

  it('trackCost increments total', () => {
    const tracker = new CostTracker();
    tracker.trackCost('test-op', 1.5);
    tracker.trackCost('test-op', 2.0);
    const report = tracker.getCostReport();
    assert.ok(Math.abs(report.total - 3.5) < 0.001);
  });

  it('getCostReport groups by operation', () => {
    const tracker = new CostTracker();
    tracker.trackCost('llm-call', 0.10);
    tracker.trackCost('llm-call', 0.05);
    tracker.trackCost('api-call', 0.02);
    const report = tracker.getCostReport();
    assert.ok(Math.abs(report.byOperation['llm-call'] - 0.15) < 0.001);
    assert.ok(Math.abs(report.byOperation['api-call'] - 0.02) < 0.001);
  });

  it('getMonthlyCosts separates llm vs api', () => {
    const tracker = new CostTracker();
    tracker.trackCost('llm-completion', 0.20);
    tracker.trackCost('api-request', 0.05);
    tracker.trackCost('other', 0.01);
    const monthly = tracker.getMonthlyCosts();
    assert.ok(monthly.llm >= 0.20);
    assert.ok(monthly.api >= 0.05);
    assert.ok(monthly.total >= 0.26);
  });

  it('getMonthlyCosts ai operations count as llm', () => {
    const tracker = new CostTracker();
    tracker.trackCost('ai-inference', 0.30);
    const monthly = tracker.getMonthlyCosts();
    assert.ok(monthly.llm >= 0.30);
  });

  it('budgetStatus is ok when under limits', () => {
    const tracker = new CostTracker({ budgetLimits: { monthlyLLM: 100 } });
    tracker.trackCost('llm-call', 5.0);
    const report = tracker.getCostReport();
    assert.equal(report.budgetStatus, 'ok');
  });

  it('budgetStatus is warning when near limit', () => {
    const tracker = new CostTracker({ budgetLimits: { monthlyLLM: 10 } });
    tracker.trackCost('llm-call', 9.0); // 90% of limit
    const report = tracker.getCostReport();
    assert.equal(report.budgetStatus, 'warning');
  });

  it('budgetStatus is exceeded when over limit', () => {
    const tracker = new CostTracker({ budgetLimits: { monthlyLLM: 10 } });
    tracker.trackCost('llm-call', 15.0);
    const report = tracker.getCostReport();
    assert.equal(report.budgetStatus, 'exceeded');
  });

  it('budgetStatus ok when no limits configured', () => {
    const tracker = new CostTracker();
    tracker.trackCost('llm-call', 999.0);
    const report = tracker.getCostReport();
    assert.equal(report.budgetStatus, 'ok');
  });

  it('trackCost accepts metadata', () => {
    const tracker = new CostTracker();
    tracker.trackCost('llm-call', 0.01, 'USD', { model: 'gpt-4', tokens: 100 });
    const report = tracker.getCostReport();
    assert.ok(report.total > 0);
  });
});
