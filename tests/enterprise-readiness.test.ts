import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { generateEnterpriseReadinessReport } from '../src/core/enterprise-readiness.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir = '';

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'enterprise-readiness-test-'));
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('generateEnterpriseReadinessReport', () => {
  it('returns a report with required fields', async () => {
    const output = path.join(tmpDir, 'report.json');
    const report = await generateEnterpriseReadinessReport({ output });
    assert.ok(typeof report.enterpriseReadinessScore === 'number', 'should have a score');
    assert.ok(typeof report.featuresImplemented === 'number');
    assert.ok(typeof report.totalFeatures === 'number');
    assert.ok(typeof report.implementationRate === 'number');
    assert.ok(typeof report.timestamp === 'string');
    assert.ok(Array.isArray(report.recommendations));
    assert.ok(Array.isArray(report.complianceFrameworks));
  });

  it('score is within 0-10 range', async () => {
    const output = path.join(tmpDir, 'report2.json');
    const report = await generateEnterpriseReadinessReport({ output });
    assert.ok(report.enterpriseReadinessScore >= 0);
    assert.ok(report.enterpriseReadinessScore <= 10);
  });

  it('features are all implemented', async () => {
    const output = path.join(tmpDir, 'report3.json');
    const report = await generateEnterpriseReadinessReport({ output });
    assert.equal(report.featuresImplemented, report.totalFeatures, 'all features should be implemented');
  });

  it('implementation rate is 100% when all implemented', async () => {
    const output = path.join(tmpDir, 'report4.json');
    const report = await generateEnterpriseReadinessReport({ output });
    assert.equal(report.implementationRate, 100);
  });

  it('writes JSON output file by default format', async () => {
    const output = path.join(tmpDir, 'report5.json');
    await generateEnterpriseReadinessReport({ output });
    const content = await fs.readFile(output, 'utf8');
    assert.doesNotThrow(() => JSON.parse(content), 'output should be valid JSON');
  });

  it('generates markdown format when format=markdown', async () => {
    const output = path.join(tmpDir, 'report.md');
    await generateEnterpriseReadinessReport({ output, format: 'markdown' });
    const content = await fs.readFile(output, 'utf8');
    assert.ok(content.includes('# Enterprise Readiness Report'), 'should have markdown heading');
  });

  it('generates HTML format when format=html', async () => {
    const output = path.join(tmpDir, 'report.html');
    await generateEnterpriseReadinessReport({ output, format: 'html' });
    const content = await fs.readFile(output, 'utf8');
    assert.ok(content.includes('<html>') || content.includes('<!DOCTYPE html'), 'should have HTML tags');
  });

  it('includes security controls in report', async () => {
    const output = path.join(tmpDir, 'security.json');
    const report = await generateEnterpriseReadinessReport({ output });
    assert.ok(report.securityControls !== undefined);
    assert.ok(typeof report.securityControls === 'object');
  });

  it('includes compliance frameworks', async () => {
    const output = path.join(tmpDir, 'compliance.json');
    const report = await generateEnterpriseReadinessReport({ output });
    assert.ok(report.complianceFrameworks.length > 0);
    assert.ok(report.complianceFrameworks.some((f: string) => f.includes('GDPR')));
  });

  it('does not throw when output directory does not exist', async () => {
    const output = path.join(tmpDir, 'nested', 'deep', 'report.json');
    await assert.doesNotReject(() => generateEnterpriseReadinessReport({ output }));
  });

  it('returns the same report regardless of format', async () => {
    const output1 = path.join(tmpDir, 'same1.json');
    const output2 = path.join(tmpDir, 'same2.json');
    const json = await generateEnterpriseReadinessReport({ output: output1, format: 'json' });
    const md = await generateEnterpriseReadinessReport({ output: output2, format: 'markdown' });
    assert.equal(json.enterpriseReadinessScore, md.enterpriseReadinessScore);
    assert.equal(json.featuresImplemented, md.featuresImplemented);
  });
});
