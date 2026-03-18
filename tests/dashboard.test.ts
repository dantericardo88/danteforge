import { describe, it } from 'node:test';
import assert from 'node:assert';
import { dashboard, parseDashboardPort, renderDashboardHtml } from '../src/cli/commands/dashboard.js';

describe('dashboard command', () => {
  it('uses default port when none is provided', () => {
    assert.strictEqual(parseDashboardPort(undefined), 4242);
  });

  it('accepts numeric ports in range', () => {
    assert.strictEqual(parseDashboardPort('3000'), 3000);
  });

  it('rejects non-numeric ports with a friendly error', () => {
    assert.throws(
      () => parseDashboardPort('abc'),
      /Invalid --port value "abc"/,
    );
  });

  it('rejects out-of-range ports with a friendly error', () => {
    assert.throws(
      () => parseDashboardPort('70000'),
      /must be an integer between 1 and 65535/,
    );
  });

  it('handles invalid port input without throwing from dashboard()', async () => {
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await assert.doesNotReject(async () => {
        await dashboard({ port: 'abc' });
      });
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it('sets a non-zero exit code for invalid dashboard port input', async () => {
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await dashboard({ port: 'abc' });
      assert.strictEqual(process.exitCode, 1);
    } finally {
      process.exitCode = originalExitCode;
    }
  });

  it('renders workflow stage and current package version in dashboard html', () => {
    const html = renderDashboardHtml({
      state: {
        project: 'battle-station',
        workflowStage: 'verify',
        currentPhase: 2,
        profile: 'quality',
        tasks: { 1: [{ name: 'Ship it' }] },
        auditLog: ['2026-03-12T00:00:00.000Z | verify: release checks passed'],
      },
      config: {
        defaultProvider: 'openai',
      },
      host: 'codex',
      capabilities: {
        hasFigmaMCP: true,
      },
      tier: 'pull-only',
      packageVersion: '0.7.0',
      totalTokensEstimated: 1234,
    });

    assert.match(html, /Workflow Stage: verify/);
    assert.match(html, /Execution Wave/);
    assert.match(html, /DanteForge v0\.7\.0/);
    assert.doesNotMatch(html, /DanteForge v0\.4\.1/);
  });
});
