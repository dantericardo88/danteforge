// QA Scorer tests — accessibility, console, network, performance scoring
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  scoreAccessibility,
  scoreConsoleErrors,
  scoreNetworkFailures,
  scorePerformance,
  rankIssues,
  computeQAScoreFromIssues,
} from '../src/core/qa-scorer.js';
import type { QAIssue } from '../src/core/qa-runner.js';

describe('scoreAccessibility', () => {
  it('detects missing alt text', () => {
    const issues = scoreAccessibility('img element has missing alt attribute');
    assert.ok(issues.length > 0);
    assert.ok(issues.some(i => i.category === 'accessibility'));
  });

  it('detects empty links', () => {
    const issues = scoreAccessibility('empty link found in navigation');
    assert.ok(issues.length > 0);
  });

  it('detects missing form labels', () => {
    const issues = scoreAccessibility('input has missing label association');
    assert.ok(issues.length > 0);
  });

  it('returns empty array for clean output', () => {
    const issues = scoreAccessibility('All checks passed, no issues found');
    assert.strictEqual(issues.length, 0);
  });
});

describe('scoreConsoleErrors', () => {
  it('detects console errors as high severity', () => {
    const issues = scoreConsoleErrors('Error: Cannot read property of undefined');
    assert.ok(issues.length > 0);
    assert.ok(issues.some(i => i.severity === 'high'));
  });

  it('detects uncaught errors as critical', () => {
    const issues = scoreConsoleErrors('Uncaught TypeError: x is not a function');
    assert.ok(issues.length > 0);
    assert.ok(issues.some(i => i.severity === 'critical'));
  });

  it('detects warnings as informational', () => {
    const issues = scoreConsoleErrors('Warning: React key prop is missing');
    assert.ok(issues.length > 0);
    assert.ok(issues.some(i => i.severity === 'informational'));
  });

  it('returns empty array for clean console', () => {
    const issues = scoreConsoleErrors('');
    assert.strictEqual(issues.length, 0);
  });
});

describe('scoreNetworkFailures', () => {
  it('detects 500 errors as critical', () => {
    const issues = scoreNetworkFailures('GET /api/users 500 Internal Server Error');
    assert.ok(issues.length > 0);
    assert.ok(issues.some(i => i.severity === 'critical'));
  });

  it('detects 404 errors as high', () => {
    const issues = scoreNetworkFailures('GET /api/missing 404 Not Found');
    assert.ok(issues.length > 0);
    assert.ok(issues.some(i => i.severity === 'high'));
  });

  it('detects connection failures', () => {
    const issues = scoreNetworkFailures('ERR_CONNECTION_REFUSED localhost:3000');
    assert.ok(issues.length > 0);
  });

  it('returns empty array for clean network', () => {
    const issues = scoreNetworkFailures('GET /api/health 200 OK');
    assert.strictEqual(issues.length, 0);
  });
});

describe('scorePerformance', () => {
  it('flags high LCP', () => {
    const issues = scorePerformance('LCP: 5000ms');
    assert.ok(issues.length > 0);
    assert.ok(issues.some(i => i.id === 'perf-lcp'));
  });

  it('flags high CLS', () => {
    const issues = scorePerformance('CLS: 0.3');
    assert.ok(issues.length > 0);
    assert.ok(issues.some(i => i.id === 'perf-cls'));
  });

  it('returns empty for good performance', () => {
    const issues = scorePerformance('LCP: 1500ms CLS: 0.05');
    assert.strictEqual(issues.length, 0);
  });
});

describe('rankIssues', () => {
  it('sorts critical first, then high, medium, informational', () => {
    const issues: QAIssue[] = [
      { id: '1', severity: 'informational', category: 'test', description: 'info', remediation: 'fix' },
      { id: '2', severity: 'critical', category: 'test', description: 'crit', remediation: 'fix' },
      { id: '3', severity: 'medium', category: 'test', description: 'med', remediation: 'fix' },
      { id: '4', severity: 'high', category: 'test', description: 'high', remediation: 'fix' },
    ];
    const ranked = rankIssues(issues);
    assert.strictEqual(ranked[0].severity, 'critical');
    assert.strictEqual(ranked[1].severity, 'high');
    assert.strictEqual(ranked[2].severity, 'medium');
    assert.strictEqual(ranked[3].severity, 'informational');
  });

  it('does not mutate the original array', () => {
    const issues: QAIssue[] = [
      { id: '1', severity: 'medium', category: 'test', description: 'med', remediation: 'fix' },
      { id: '2', severity: 'critical', category: 'test', description: 'crit', remediation: 'fix' },
    ];
    const ranked = rankIssues(issues);
    assert.strictEqual(issues[0].severity, 'medium'); // unchanged
    assert.strictEqual(ranked[0].severity, 'critical');
  });
});

describe('computeQAScoreFromIssues', () => {
  it('returns 100 for no issues', () => {
    assert.strictEqual(computeQAScoreFromIssues([]), 100);
  });

  it('deducts based on severity weights', () => {
    const issues: QAIssue[] = [
      { id: '1', severity: 'critical', category: 'test', description: 'crit', remediation: 'fix' },
    ];
    assert.strictEqual(computeQAScoreFromIssues(issues), 75);
  });

  it('floors at 0', () => {
    const issues: QAIssue[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(i), severity: 'critical' as const, category: 'test', description: 'crit', remediation: 'fix',
    }));
    assert.strictEqual(computeQAScoreFromIssues(issues), 0);
  });
});
