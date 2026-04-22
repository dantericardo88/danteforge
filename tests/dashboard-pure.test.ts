import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDashboardPort, renderDashboardHtml } from '../src/cli/commands/dashboard.js';

function makeInput(overrides: Record<string, unknown> = {}) {
  return {
    state: {
      project: 'TestProject',
      workflowStage: 'forge',
      currentPhase: 2,
      profile: 'standard',
      tasks: { forge: ['task1', 'task2'] },
      auditLog: ['2026-01-01 | forge started', '2026-01-02 | forge complete'],
    },
    config: { defaultProvider: 'claude' },
    host: 'claude-code',
    capabilities: { hasFigmaMCP: false },
    tier: 'standard',
    packageVersion: '0.58.0',
    totalTokensEstimated: 1500,
    wikiHealth: null,
    ...overrides,
  } as any;
}

describe('parseDashboardPort', () => {
  it('returns 4242 for undefined input', () => {
    assert.equal(parseDashboardPort(undefined), 4242);
  });

  it('parses valid port string', () => {
    assert.equal(parseDashboardPort('3000'), 3000);
  });

  it('parses port with whitespace', () => {
    assert.equal(parseDashboardPort(' 8080 '), 8080);
  });

  it('throws for non-numeric input', () => {
    assert.throws(() => parseDashboardPort('abc'), /Invalid --port/);
  });

  it('throws for port 0', () => {
    assert.throws(() => parseDashboardPort('0'), /Invalid --port/);
  });

  it('throws for port above 65535', () => {
    assert.throws(() => parseDashboardPort('65536'), /Invalid --port/);
  });

  it('accepts port 1', () => {
    assert.equal(parseDashboardPort('1'), 1);
  });

  it('accepts port 65535', () => {
    assert.equal(parseDashboardPort('65535'), 65535);
  });

  it('throws for float', () => {
    assert.throws(() => parseDashboardPort('3000.5'), /Invalid --port/);
  });
});

describe('renderDashboardHtml', () => {
  it('includes project name', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.includes('TestProject'));
  });

  it('includes workflow stage', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.includes('forge'));
  });

  it('includes provider name', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.includes('claude'));
  });

  it('includes package version', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.includes('0.58.0'));
  });

  it('shows figma not configured when hasFigmaMCP is false', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.includes('Not configured'));
  });

  it('shows figma connected when hasFigmaMCP is true', () => {
    const html = renderDashboardHtml(makeInput({ capabilities: { hasFigmaMCP: true } }));
    assert.ok(html.includes('Connected'));
  });

  it('includes audit log entries', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.includes('forge started') || html.includes('forge complete'));
  });

  it('includes total tasks count', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.includes('2'));
  });

  it('shows wiki health section when provided', () => {
    const wikiHealth = {
      pageCount: 10,
      linkDensity: 4.5,
      orphanRatio: 0.02,
      lintPassRate: 0.98,
      anomalyCount: 0,
      lastLint: '2026-01-01T10:00:00.000Z',
    };
    const html = renderDashboardHtml(makeInput({ wikiHealth }));
    assert.ok(html.includes('Wiki Health'));
    assert.ok(html.includes('10'));
  });

  it('omits wiki health section when null', () => {
    const html = renderDashboardHtml(makeInput({ wikiHealth: null }));
    assert.ok(!html.includes('Wiki Health'));
  });

  it('escapes HTML in project name', () => {
    const html = renderDashboardHtml(makeInput({ state: makeInput().state }));
    const maliciousInput = makeInput();
    maliciousInput.state.project = '<script>alert("xss")</script>';
    const htmlWithXss = renderDashboardHtml(maliciousInput);
    assert.ok(!htmlWithXss.includes('<script>'));
    assert.ok(htmlWithXss.includes('&lt;script&gt;'));
  });

  it('shows execution wave when phase > 0', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.includes('Execution Wave'));
  });

  it('returns valid html document', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('</html>'));
  });
});
