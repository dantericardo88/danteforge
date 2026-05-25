import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runDependencyAudit,
  scoreDependencyAudit,
  formatAuditSummary,
} from '../src/core/security-dependency-audit.js';

const CLEAN_AUDIT_JSON = JSON.stringify({
  metadata: { totalDependencies: 120, vulnerabilities: {} },
  vulnerabilities: {},
});

const HIGH_VULN_AUDIT_JSON = JSON.stringify({
  metadata: { totalDependencies: 80, vulnerabilities: { high: 2, moderate: 1 } },
  vulnerabilities: {
    'lodash': { name: 'lodash', severity: 'high', via: ['prototype-pollution'], fixAvailable: true },
    'axios': { name: 'axios', severity: 'high', via: ['SSRF'], fixAvailable: false },
    'minimatch': { name: 'minimatch', severity: 'moderate', via: ['ReDoS'], fixAvailable: true },
  },
});

const CRITICAL_AUDIT_JSON = JSON.stringify({
  metadata: { totalDependencies: 50 },
  vulnerabilities: {
    'shelljs': { name: 'shelljs', severity: 'critical', via: ['command-injection'], fixAvailable: true },
  },
});

describe('scoreDependencyAudit', () => {
  it('returns 10 for zero vulnerabilities', () => {
    assert.equal(scoreDependencyAudit({ critical: 0, high: 0, moderate: 0, low: 0, info: 0 }), 10);
  });

  it('returns ≤3 for any critical vulnerability', () => {
    const score = scoreDependencyAudit({ critical: 1, high: 0, moderate: 0, low: 0, info: 0 });
    assert.ok(score <= 3, `expected ≤3, got ${score}`);
  });

  it('returns 3–5 range for high vulnerabilities only', () => {
    const score = scoreDependencyAudit({ critical: 0, high: 2, moderate: 0, low: 0, info: 0 });
    assert.ok(score >= 3 && score <= 5, `expected 3–5, got ${score}`);
  });

  it('returns 6–7 for moderate only', () => {
    const score = scoreDependencyAudit({ critical: 0, high: 0, moderate: 1, low: 0, info: 0 });
    assert.ok(score >= 6 && score <= 7, `expected 6–7, got ${score}`);
  });

  it('returns 8 for low only', () => {
    assert.equal(scoreDependencyAudit({ critical: 0, high: 0, moderate: 0, low: 3, info: 0 }), 8);
  });
});

describe('runDependencyAudit', () => {
  it('parses clean audit and returns score=10 + passed=true', async () => {
    const result = await runDependencyAudit({
      _runAudit: async () => ({ stdout: CLEAN_AUDIT_JSON, exitCode: 0 }),
    });
    assert.equal(result.score, 10);
    assert.equal(result.passed, true);
    assert.equal(result.counts.critical, 0);
    assert.equal(result.counts.high, 0);
  });

  it('parses high-severity audit and returns passed=false', async () => {
    const result = await runDependencyAudit({
      _runAudit: async () => ({ stdout: HIGH_VULN_AUDIT_JSON, exitCode: 1 }),
    });
    assert.equal(result.passed, false);
    assert.equal(result.counts.high, 2);
    assert.equal(result.counts.moderate, 1);
    assert.ok(result.score < 6, `expected score < 6, got ${result.score}`);
  });

  it('identifies fixAvailable correctly on vulnerabilities', async () => {
    const result = await runDependencyAudit({
      _runAudit: async () => ({ stdout: HIGH_VULN_AUDIT_JSON, exitCode: 1 }),
    });
    const axios = result.vulnerabilities.find(v => v.name === 'axios');
    assert.ok(axios, 'axios vuln should be present');
    assert.equal(axios.fixAvailable, false);
    const lodash = result.vulnerabilities.find(v => v.name === 'lodash');
    assert.equal(lodash?.fixAvailable, true);
  });

  it('returns passed=false for critical even with exitCode=0', async () => {
    const result = await runDependencyAudit({
      _runAudit: async () => ({ stdout: CRITICAL_AUDIT_JSON, exitCode: 0 }),
    });
    assert.equal(result.passed, false);
    assert.equal(result.counts.critical, 1);
  });

  it('handles unparseable JSON gracefully and returns score=5', async () => {
    const result = await runDependencyAudit({
      _runAudit: async () => ({ stdout: 'not json at all', exitCode: 1 }),
    });
    assert.equal(result.score, 5);
  });

  it('respects failOnSeverity=moderate', async () => {
    const result = await runDependencyAudit({
      failOnSeverity: 'moderate',
      _runAudit: async () => ({ stdout: HIGH_VULN_AUDIT_JSON, exitCode: 1 }),
    });
    assert.equal(result.passed, false);
  });
});

describe('formatAuditSummary', () => {
  it('includes score and PASS/FAIL', async () => {
    const result = await runDependencyAudit({
      _runAudit: async () => ({ stdout: CLEAN_AUDIT_JSON, exitCode: 0 }),
    });
    const summary = formatAuditSummary(result);
    assert.ok(summary.includes('10/10'), `summary: ${summary}`);
    assert.ok(summary.includes('PASS'), `summary: ${summary}`);
  });

  it('shows FAIL and highlights critical/high in summary', async () => {
    const result = await runDependencyAudit({
      _runAudit: async () => ({ stdout: HIGH_VULN_AUDIT_JSON, exitCode: 1 }),
    });
    const summary = formatAuditSummary(result);
    assert.ok(summary.includes('FAIL'), `summary: ${summary}`);
    assert.ok(summary.includes('HIGH'), `summary: ${summary}`);
  });
});
