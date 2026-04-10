import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

describe('Enterprise Integration Tests', () => {
  it('should validate enterprise security controls', async () => {
    const { validateSecurityControls } = await import('../src/core/security-controls.js');

    const results = await validateSecurityControls({
      checkSecrets: true,
      checkPermissions: true,
      checkIntegrity: true
    });

    assert(typeof results.secretsSecure === 'boolean', 'Should check secrets');
    assert(typeof results.permissionsValid === 'boolean', 'Should check permissions');
    assert(typeof results.integrityVerified === 'boolean', 'Should check integrity');
    assert(Array.isArray(results.issues), 'Should provide issues array');
  });

  it('should generate compliance reports', async () => {
    const { runComplianceChecks, generateComplianceReport } = await import('../src/core/compliance-engine.js');

    const checks = await runComplianceChecks();
    assert(checks.length > 0, 'Should have compliance checks');

    const report = await generateComplianceReport();
    assert(typeof report === 'string', 'Should generate report');
    assert(report.includes('Compliance Report'), 'Should contain report header');
  });

  it('should run enterprise readiness assessment', async () => {
    const enterpriseDir = path.join(process.cwd(), 'test-enterprise-integration');
    await fs.mkdir(enterpriseDir, { recursive: true });

    try {
      // Initialize
      execSync('node dist/index.js init --non-interactive', { cwd: enterpriseDir, stdio: 'pipe' });

      // Run enterprise readiness
      const result = execSync('node dist/index.js enterprise-readiness --format json', {
        cwd: enterpriseDir,
        stdio: 'pipe'
      });

      const report = JSON.parse(result.toString());
      assert(report.enterpriseReadinessScore >= 0, 'Should have enterprise score');
      assert(report.securityValidation, 'Should include security validation');

    } finally {
      await fs.rm(enterpriseDir, { recursive: true, force: true });
    }
  });

  it('should validate audit export functionality', async () => {
    const auditDir = path.join(process.cwd(), 'test-audit-integration');
    await fs.mkdir(auditDir, { recursive: true });

    try {
      // Initialize
      execSync('node dist/index.js init --non-interactive', { cwd: auditDir, stdio: 'pipe' });

      // Run a command to generate audit logs
      execSync('node dist/index.js constitution', {
        cwd: auditDir,
        stdio: 'pipe',
        input: 'Test constitution\n'
      });

      // Export audit logs
      execSync('node dist/index.js audit export --format json --output audit-export.json', {
        cwd: auditDir,
        stdio: 'pipe'
      });

      // Check if export file exists
      const exportPath = path.join(auditDir, 'audit-export.json');
      const exists = await fs.access(exportPath).then(() => true).catch(() => false);
      assert(exists, 'Audit export should create file');

    } finally {
      await fs.rm(auditDir, { recursive: true, force: true });
    }
  });
});