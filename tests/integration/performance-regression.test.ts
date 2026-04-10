import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

describe('Performance Regression Tests', () => {
  it('should detect and prevent performance regression', async () => {
    const perfDir = path.join(process.cwd(), 'test-performance-regression');
    await fs.mkdir(perfDir, { recursive: true });

    try {
      // Initialize project
      execSync('node dist/index.js init --non-interactive', { cwd: perfDir, stdio: 'pipe' });

      // Establish baseline
      execSync('node dist/index.js performance --baseline', { cwd: perfDir, stdio: 'pipe' });

      // Performance should pass initially
      execSync('node dist/index.js performance --check', { cwd: perfDir, stdio: 'pipe' });

      // Simulate performance degradation by creating artificial load
      // (In real scenario, this would be detected by actual performance changes)
      const baselinePath = path.join(perfDir, '.danteforge', 'performance-baseline.json');
      if (await fs.access(baselinePath).then(() => true).catch(() => false)) {
        const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));

        // Artificially degrade baseline to test detection
        baseline.startupTime.avg = baseline.startupTime.avg * 2; // Double startup time
        await fs.writeFile(baselinePath, JSON.stringify(baseline, null, 2));

        // This should now fail (detected regression)
        let failed = false;
        try {
          execSync('node dist/index.js performance --check', { cwd: perfDir, stdio: 'pipe' });
        } catch {
          failed = true; // Expected to fail due to regression
        }

        assert(failed, 'Performance regression should be detected and fail the check');
      }

      console.log('✅ Performance regression detection validated');

    } finally {
      await fs.rm(perfDir, { recursive: true, force: true });
    }
  });

  it('should maintain performance baseline across runs', async () => {
    const baselineDir = path.join(process.cwd(), 'test-baseline-maintenance');
    await fs.mkdir(baselineDir, { recursive: true });

    try {
      // Initialize project
      execSync('node dist/index.js init --non-interactive', { cwd: baselineDir, stdio: 'pipe' });

      // First run - establish baseline
      execSync('node dist/index.js performance --baseline', { cwd: baselineDir, stdio: 'pipe' });

      // Second run - should use existing baseline
      execSync('node dist/index.js performance --check', { cwd: baselineDir, stdio: 'pipe' });

      // Verify baseline exists and is valid
      const baselinePath = path.join(baselineDir, '.danteforge', 'performance-baseline.json');
      const baselineExists = await fs.access(baselinePath).then(() => true).catch(() => false);
      assert(baselineExists, 'Performance baseline should be created and maintained');

      const baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
      assert(baseline.startupTime, 'Baseline should contain startup time metrics');
      assert(baseline.lastUpdated, 'Baseline should have last updated timestamp');

      console.log('✅ Performance baseline maintenance validated');

    } finally {
      await fs.rm(baselineDir, { recursive: true, force: true });
    }
  });

  it('should integrate with CI pipeline', async () => {
    // Test that performance checks work in CI-like environment
    const ciPerfDir = path.join(process.cwd(), 'test-ci-performance');
    await fs.mkdir(ciPerfDir, { recursive: true });

    try {
      // Initialize project
      execSync('node dist/index.js init --non-interactive', { cwd: ciPerfDir, stdio: 'pipe' });

      // Simulate CI environment variables
      process.env.CI = 'true';

      // Establish baseline (like CI setup)
      execSync('node dist/index.js performance --baseline', { cwd: ciPerfDir, stdio: 'pipe' });

      // Run check (like CI gate)
      execSync('node dist/index.js performance --check', { cwd: ciPerfDir, stdio: 'pipe' });

      // Verify CI integration works
      const metricsPath = path.join(ciPerfDir, '.danteforge', 'performance-metrics.json');
      const metricsExist = await fs.access(metricsPath).then(() => true).catch(() => false);
      assert(metricsExist, 'Performance metrics should be logged for CI');

      console.log('✅ CI performance integration validated');

    } finally {
      delete process.env.CI;
      await fs.rm(ciPerfDir, { recursive: true, force: true });
    }
  });
});