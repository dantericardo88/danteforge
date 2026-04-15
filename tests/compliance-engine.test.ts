import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  runComplianceChecks,
  generateComplianceReport,
  type ComplianceCheck,
} from '../src/core/compliance-engine.js';

describe('runComplianceChecks', () => {
  it('returns an array of compliance checks', async () => {
    const checks = await runComplianceChecks();
    assert.ok(Array.isArray(checks));
    assert.ok(checks.length > 0);
  });

  it('each check has required fields', async () => {
    const checks = await runComplianceChecks();
    for (const check of checks) {
      assert.ok(typeof check.framework === 'string' && check.framework.length > 0, 'framework missing');
      assert.ok(typeof check.requirement === 'string' && check.requirement.length > 0, 'requirement missing');
      assert.ok(typeof check.implemented === 'boolean', 'implemented must be boolean');
    }
  });

  it('includes SOX checks', async () => {
    const checks = await runComplianceChecks();
    const sox = checks.filter(c => c.framework === 'SOX');
    assert.ok(sox.length >= 1, 'should have at least one SOX check');
  });

  it('includes GDPR checks', async () => {
    const checks = await runComplianceChecks();
    const gdpr = checks.filter(c => c.framework === 'GDPR');
    assert.ok(gdpr.length >= 1, 'should have at least one GDPR check');
  });

  it('some checks are implemented and some are not', async () => {
    const checks = await runComplianceChecks();
    const implemented = checks.filter(c => c.implemented);
    const notImplemented = checks.filter(c => !c.implemented);
    assert.ok(implemented.length > 0, 'at least one check should be implemented');
    assert.ok(notImplemented.length > 0, 'at least one check should be pending');
  });
});

describe('generateComplianceReport', () => {
  it('returns a non-empty string', async () => {
    const report = await generateComplianceReport();
    assert.ok(typeof report === 'string');
    assert.ok(report.length > 50);
  });

  it('contains Compliance Report heading', async () => {
    const report = await generateComplianceReport();
    assert.ok(report.includes('# Compliance Report'));
  });

  it('includes Date field', async () => {
    const report = await generateComplianceReport();
    assert.ok(report.includes('**Date:**'));
  });

  it('includes Compliance Score', async () => {
    const report = await generateComplianceReport();
    assert.ok(report.includes('**Compliance Score:**'));
  });

  it('includes framework sections', async () => {
    const report = await generateComplianceReport();
    assert.ok(report.includes('### SOX') || report.includes('### GDPR'));
  });

  it('contains check/cross markers', async () => {
    const report = await generateComplianceReport();
    assert.ok(report.includes('✅') || report.includes('❌'));
  });
});
