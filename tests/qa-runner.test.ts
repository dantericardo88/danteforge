// QA Runner tests — report structure, scoring, regression diff, baseline
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  computeQAScore,
  saveQABaseline,
  type QAReport,
  type QAIssue,
  type QARunMode,
} from '../src/core/qa-runner.js';

function makeIssue(severity: QAIssue['severity'], category = 'test'): QAIssue {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    severity,
    category,
    description: `Test ${severity} issue`,
    remediation: 'Fix it',
  };
}

function makeReport(overrides: Partial<QAReport> = {}): QAReport {
  return {
    score: 100,
    mode: 'full' as QARunMode,
    url: 'https://example.com',
    timestamp: new Date().toISOString(),
    issues: [],
    screenshots: [],
    ...overrides,
  };
}

describe('computeQAScore', () => {
  it('returns 100 for no issues', () => {
    assert.strictEqual(computeQAScore([]), 100);
  });

  it('deducts 25 points per critical issue', () => {
    const issues = [makeIssue('critical')];
    const score = computeQAScore(issues);
    assert.strictEqual(score, 75);
  });

  it('deducts 10 points per high issue', () => {
    const issues = [makeIssue('high')];
    const score = computeQAScore(issues);
    assert.strictEqual(score, 90);
  });

  it('deducts 3 points per medium issue', () => {
    const issues = [makeIssue('medium')];
    const score = computeQAScore(issues);
    assert.strictEqual(score, 97);
  });

  it('does not deduct for informational issues', () => {
    const issues = [makeIssue('informational')];
    const score = computeQAScore(issues);
    assert.strictEqual(score, 100);
  });

  it('never goes below 0', () => {
    const issues = Array.from({ length: 10 }, () => makeIssue('critical'));
    const score = computeQAScore(issues);
    assert.strictEqual(score, 0);
  });

  it('accumulates deductions from mixed severities', () => {
    const issues = [
      makeIssue('critical'),
      makeIssue('high'),
      makeIssue('medium'),
      makeIssue('informational'),
    ];
    // 25 + 10 + 3 + 0 = 38 deductions
    const score = computeQAScore(issues);
    assert.strictEqual(score, 62);
  });
});

describe('QAReport structure', () => {
  it('has all required fields', () => {
    const report = makeReport();
    assert.ok(typeof report.score === 'number');
    assert.ok(typeof report.mode === 'string');
    assert.ok(typeof report.url === 'string');
    assert.ok(typeof report.timestamp === 'string');
    assert.ok(Array.isArray(report.issues));
    assert.ok(Array.isArray(report.screenshots));
  });

  it('supports regression mode with regressions array', () => {
    const report = makeReport({
      mode: 'regression',
      regressions: [makeIssue('high')],
      baselineCompared: '.danteforge/qa-baseline.json',
    });
    assert.strictEqual(report.mode, 'regression');
    assert.ok(Array.isArray(report.regressions));
    assert.strictEqual(report.regressions!.length, 1);
  });
});

describe('saveQABaseline', () => {
  it('writes a JSON file to the specified path', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-test-'));
    const baselinePath = path.join(tmpDir, 'baseline.json');

    const report = makeReport({ score: 95 });
    await saveQABaseline(report, baselinePath);

    const content = await fs.readFile(baselinePath, 'utf8');
    const parsed = JSON.parse(content) as QAReport;
    assert.strictEqual(parsed.score, 95);

    await fs.rm(tmpDir, { recursive: true });
  });
});
