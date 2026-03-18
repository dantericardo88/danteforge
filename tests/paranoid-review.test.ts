// Paranoid Review tests — two-pass audit, critical detection, summary formatting
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  runParanoidReview,
  resolveFindings,
  formatReviewSummary,
  type ReviewFinding,
} from '../src/core/paranoid-review.js';

function makeDiff(addedLines: string[], file = 'src/app.ts'): string {
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    '@@ -1,3 +1,5 @@',
    ...addedLines.map(l => `+${l}`),
  ].join('\n');
}

describe('runParanoidReview — Pass 1 (CRITICAL)', () => {
  it('detects potential SQL injection', () => {
    const diff = makeDiff(['const q = `SELECT * FROM users WHERE id = ${userId}`;']);
    const result = runParanoidReview(diff);
    assert.ok(result.critical.some(f => f.category === 'sql-injection'));
  });

  it('detects hardcoded secrets', () => {
    const diff = makeDiff(["const apiKey = 'sk-1234567890abcdef';"]);
    const result = runParanoidReview(diff);
    assert.ok(result.critical.some(f => f.category === 'secrets-exposure'));
  });

  it('detects eval usage', () => {
    const diff = makeDiff(['eval(userInput);']);
    const result = runParanoidReview(diff);
    assert.ok(result.critical.some(f => f.category === 'code-injection'));
  });

  it('detects innerHTML XSS risk', () => {
    const diff = makeDiff(['element.innerHTML = userContent;']);
    const result = runParanoidReview(diff);
    assert.ok(result.critical.some(f => f.category === 'xss'));
  });
});

describe('runParanoidReview — Pass 2 (INFORMATIONAL)', () => {
  it('detects empty catch blocks', () => {
    const diff = makeDiff(['catch (err) {}']);
    const result = runParanoidReview(diff);
    assert.ok(result.informational.some(f => f.category === 'error-swallowing'));
  });

  it('detects console.log in production code', () => {
    const diff = makeDiff(["console.log('debug value:', x);"]);
    const result = runParanoidReview(diff);
    assert.ok(result.informational.some(f => f.category === 'debug-artifacts'));
  });
});

describe('runParanoidReview — clean code', () => {
  it('returns no findings for clean diff', () => {
    const diff = makeDiff([
      'const x = 42;',
      'function greet(name: string) { return `Hello ${name}`; }',
    ]);
    const result = runParanoidReview(diff);
    assert.strictEqual(result.critical.length, 0);
  });

  it('produces appropriate summary for clean code', () => {
    const diff = makeDiff(['const x = 42;']);
    const result = runParanoidReview(diff);
    assert.ok(result.summary.includes('passed'));
  });

  it('produces appropriate summary for critical findings', () => {
    const diff = makeDiff(['eval(input);']);
    const result = runParanoidReview(diff);
    assert.ok(result.summary.includes('CRITICAL'));
  });
});

describe('resolveFindings', () => {
  it('applies resolutions to findings', () => {
    const findings: ReviewFinding[] = [
      { severity: 'critical', category: 'test', filePath: 'a.ts', description: 'issue', recommendation: 'fix' },
    ];
    const resolved = resolveFindings(findings, { 0: 'acknowledge' });
    assert.strictEqual(resolved[0].resolution, 'acknowledge');
  });

  it('leaves unresolved findings unchanged', () => {
    const findings: ReviewFinding[] = [
      { severity: 'critical', category: 'test', filePath: 'a.ts', description: 'issue', recommendation: 'fix' },
    ];
    const resolved = resolveFindings(findings, {});
    assert.strictEqual(resolved[0].resolution, undefined);
  });
});

describe('formatReviewSummary', () => {
  it('includes Pre-Landing Review header', () => {
    const result = runParanoidReview(makeDiff(['const x = 1;']));
    const summary = formatReviewSummary(result);
    assert.ok(summary.includes('## Pre-Landing Review'));
  });

  it('lists critical findings with categories', () => {
    const result = runParanoidReview(makeDiff(['eval(x);']));
    const summary = formatReviewSummary(result);
    assert.ok(summary.includes('CRITICAL'));
    assert.ok(summary.includes('code-injection'));
  });
});
