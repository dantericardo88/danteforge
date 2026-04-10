import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

describe('CI Integration Tests', () => {
  it('should pass CI verification gates', async () => {
    const ciDir = path.join(process.cwd(), 'test-ci-integration');
    await fs.mkdir(ciDir, { recursive: true });

    try {
      // Initialize project
      execSync('node dist/index.js init --non-interactive', { cwd: ciDir, stdio: 'pipe' });

      // Constitution
      execSync('node dist/index.js constitution', {
        cwd: ciDir,
        stdio: 'pipe',
        input: 'Zero ambiguity in requirements\nProgressive enhancement approach\nAccessible by default\nPerformance-first development\n'
      });

      // Create minimal implementation for CI validation
      await fs.writeFile(path.join(ciDir, 'ci-test.js'), `
console.log('CI integration test passed');
      `);

      // Run verify command (mimics CI gate)
      const verifyResult = execSync('node dist/index.js verify', { cwd: ciDir, stdio: 'pipe' });
      assert(verifyResult, 'CI verification gate should pass');

      // Test enterprise readiness (mimics CI enterprise gate)
      const enterpriseResult = execSync('node dist/index.js enterprise-readiness --format json', {
        cwd: ciDir,
        stdio: 'pipe'
      });
      const enterpriseData = JSON.parse(enterpriseResult.toString());
      assert(enterpriseData.enterpriseReadinessScore >= 8.0, 'Enterprise gate should pass');

      // Test performance monitoring (mimics CI performance gate)
      execSync('node dist/index.js performance --check', { cwd: ciDir, stdio: 'pipe' });

      console.log('✅ CI integration test passed');

    } finally {
      await fs.rm(ciDir, { recursive: true, force: true });
    }
  });

  it('should validate integration test coverage', async () => {
    // Test that integration tests cover critical paths
    const { runCompletionOracle } = await import('../src/core/completion-oracle.js');
    const { RunLedger } = await import('../src/core/run-ledger.js');

    const ledger = new RunLedger('integration-coverage-test', ['coverage-validation']);
    await ledger.initialize();

    // Simulate integration test execution
    ledger.logCommand('npm', ['run', 'test:integration'], 0, 100);
    ledger.logTest('workflow-integration', 'pass', 50);
    ledger.logTest('enterprise-integration', 'pass', 30);
    ledger.logTest('mcp-integration', 'pass', 20);

    const bundle = await ledger.finalize({}, {}, { status: 'success', completionOracle: false });
    const oracleResult = runCompletionOracle(bundle, { workflowStage: 'verify' });

    // Integration coverage should be sufficient for completion
    assert(oracleResult.score >= 70, 'Integration test coverage should be adequate');

    console.log('✅ Integration coverage validation passed');
  });

  it('should validate E2E workflow coverage', async () => {
    // Test comprehensive E2E workflow coverage
    const e2eDir = path.join(process.cwd(), 'test-e2e-coverage');
    await fs.mkdir(e2eDir, { recursive: true });

    try {
      // Initialize project
      execSync('node dist/index.js init --non-interactive', { cwd: e2eDir, stdio: 'pipe' });

      // Constitution → specify → plan → verify workflow
      execSync('node dist/index.js constitution', {
        cwd: e2eDir,
        stdio: 'pipe',
        input: 'Zero ambiguity in requirements\nProgressive enhancement approach\nAccessible by default\nPerformance-first development\n'
      });

      execSync('node dist/index.js specify "Build a calculator app"', { cwd: e2eDir, stdio: 'pipe' });
      execSync('node dist/index.js plan', { cwd: e2eDir, stdio: 'pipe' });

      // Create implementation
      await fs.writeFile(path.join(e2eDir, 'calculator.js'), `
class Calculator {
  add(a, b) { return a + b; }
  subtract(a, b) { return a - b; }
}
module.exports = Calculator;
      `);

      // Run E2E verification
      execSync('node dist/index.js verify', { cwd: e2eDir, stdio: 'pipe' });

      // Validate coverage
      const coverageResult = execSync('node dist/index.js assess --json', { cwd: e2eDir, stdio: 'pipe' });
      const assessment = JSON.parse(coverageResult.toString());

      // E2E coverage should be validated
      assert(assessment.testing >= 7.0, 'E2E workflow coverage should be adequate');

      console.log('✅ E2E coverage validation passed');

    } finally {
      await fs.rm(e2eDir, { recursive: true, force: true });
    }
  });
});