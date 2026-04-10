import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

describe('Integration Tests', () => {
  it('should run full workflow from constitution to verify', async () => {
    const testDir = path.join(process.cwd(), 'test-integration-workspace');
    await fs.mkdir(testDir, { recursive: true });

    try {
      // Initialize project
      execSync('node dist/index.js init --non-interactive', { cwd: testDir, stdio: 'pipe' });

      // Constitution
      execSync('node dist/index.js constitution', {
        cwd: testDir,
        stdio: 'pipe',
        input: 'Zero ambiguity in requirements\nProgressive enhancement approach\nAccessible by default\nPerformance-first development\n'
      });

      // Specify
      execSync('node dist/index.js specify "Create a simple todo app"', { cwd: testDir, stdio: 'pipe' });

      // Plan and tasks
      execSync('node dist/index.js plan', { cwd: testDir, stdio: 'pipe' });
      execSync('node dist/index.js tasks', { cwd: testDir, stdio: 'pipe' });

      // Verify
      const result = execSync('node dist/index.js verify', { cwd: testDir, stdio: 'pipe' });
      assert(result, 'Verification should pass');

    } finally {
      // Cleanup
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('should handle MCP server communication', async () => {
    // Test MCP server initialization
    const { mcpServer } = await import('../src/core/mcp-server.js');
    assert(mcpServer, 'MCP server should be available');

    // Test basic functionality
    const server = new mcpServer();
    assert(server, 'MCP server instance should be created');
  });

  it('should validate enterprise readiness', async () => {
    const { generateEnterpriseReadinessReport } = await import('../src/core/enterprise-readiness.js');

    const report = await generateEnterpriseReadinessReport();
    assert(report.enterpriseReadinessScore >= 0, 'Should have a valid score');
    assert(report.featuresImplemented >= 0, 'Should track implemented features');
    assert(report.implementationRate >= 0, 'Should have implementation rate');
  });

  it('should run benchmark harness', async () => {
    const { benchmarkHarness } = await import('../src/core/benchmark-harness.js');

    const result = await benchmarkHarness.runBenchmark('completion-truthfulness', 'genuine-completion');
    if (result) {
      assert(result.overallScore >= 0, 'Should have valid score');
      assert(result.verdict, 'Should have completion verdict');
      assert(result.executionTime > 0, 'Should have execution time');
    }
  });
});