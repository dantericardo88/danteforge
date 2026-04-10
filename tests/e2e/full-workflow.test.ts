import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

describe('E2E Tests', () => {
  it('should complete full project lifecycle', async () => {
    const e2eDir = path.join(process.cwd(), 'test-e2e-workspace');
    await fs.mkdir(e2eDir, { recursive: true });

    try {
      // Initialize
      execSync('node dist/index.js init --non-interactive', { cwd: e2eDir, stdio: 'pipe' });

      // Constitution
      execSync('node dist/index.js constitution', {
        cwd: e2eDir,
        stdio: 'pipe',
        input: 'Zero ambiguity in requirements\nProgressive enhancement approach\nAccessible by default\nPerformance-first development\n'
      });

      // Specify and plan
      execSync('node dist/index.js specify "Build a calculator app"', { cwd: e2eDir, stdio: 'pipe' });
      execSync('node dist/index.js plan', { cwd: e2eDir, stdio: 'pipe' });
      execSync('node dist/index.js tasks', { cwd: e2eDir, stdio: 'pipe' });

      // Simulate implementation by creating files
      await fs.writeFile(path.join(e2eDir, 'calculator.js'), `
class Calculator {
  add(a, b) { return a + b; }
  subtract(a, b) { return a - b; }
  multiply(a, b) { return a * b; }
  divide(a, b) { return b !== 0 ? a / b : null; }
}
module.exports = Calculator;
      `);

      await fs.writeFile(path.join(e2eDir, 'test.js'), `
const Calculator = require('./calculator.js');
const calc = new Calculator();
console.log('Tests:', calc.add(2, 3) === 5, calc.subtract(5, 3) === 2);
      `);

      // Run tests
      execSync('node test.js', { cwd: e2eDir, stdio: 'pipe' });

      // Verify
      const verifyResult = execSync('node dist/index.js verify', { cwd: e2eDir, stdio: 'pipe' });
      assert(verifyResult, 'E2E verification should pass');

      // Assess
      const assessResult = execSync('node dist/index.js assess --json', { cwd: e2eDir, stdio: 'pipe' });
      const assessment = JSON.parse(assessResult.toString());
      assert(assessment.overallScore >= 0, 'Should have assessment score');

    } finally {
      // Cleanup
      await fs.rm(e2eDir, { recursive: true, force: true });
    }
  });

  it('should handle enterprise features end-to-end', async () => {
    const enterpriseDir = path.join(process.cwd(), 'test-enterprise-workspace');
    await fs.mkdir(enterpriseDir, { recursive: true });

    try {
      // Initialize
      execSync('node dist/index.js init --non-interactive', { cwd: enterpriseDir, stdio: 'pipe' });

      // Generate enterprise report
      execSync('node dist/index.js enterprise-readiness --format json', { cwd: enterpriseDir, stdio: 'pipe' });

      // Check if report was generated
      const reportPath = path.join(enterpriseDir, '.danteforge', 'enterprise-readiness-report.json');
      const reportExists = await fs.access(reportPath).then(() => true).catch(() => false);
      assert(reportExists, 'Enterprise report should be generated');

      const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
      assert(report.enterpriseReadinessScore >= 0, 'Should have enterprise score');

    } finally {
      // Cleanup
      await fs.rm(enterpriseDir, { recursive: true, force: true });
    }
  });

  it('should validate tool compatibility', async () => {
    const { checkToolCompatibility } = await import('../src/core/compatibility-engine.js');

    const results = await checkToolCompatibility();
    assert(results.length > 0, 'Should check multiple tools');
    assert(results.every(r => typeof r.compatible === 'boolean'), 'Should have compatibility status');
  });
});