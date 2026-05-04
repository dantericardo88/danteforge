// MCP Adapter tests — tiered support, UI detection, Figma mode selection
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('MCP Adapter', () => {
  it('exports all adapter functions', async () => {
    const adapter = await import('../src/core/mcp-adapter.js');
    assert.strictEqual(typeof adapter.resolveTier, 'function');
    assert.strictEqual(typeof adapter.initMCPAdapter, 'function');
    assert.strictEqual(typeof adapter.getMCPSetupCommand, 'function');
    assert.strictEqual(typeof adapter.testMCPConnection, 'function');
    assert.strictEqual(typeof adapter.selectFigmaMode, 'function');
    assert.strictEqual(typeof adapter.isUIProject, 'function');
    assert.strictEqual(typeof adapter.saveFigmaConfig, 'function');
  });

  it('resolves full tier for Claude Code with Figma MCP', async () => {
    const { resolveTier } = await import('../src/core/mcp-adapter.js');
    assert.strictEqual(resolveTier('claude-code', true), 'full');
    assert.strictEqual(resolveTier('codex', true), 'full');
  });

  it('resolves pull-only tier for Cursor/VS Code with Figma MCP', async () => {
    const { resolveTier } = await import('../src/core/mcp-adapter.js');
    assert.strictEqual(resolveTier('cursor', true), 'pull-only');
    assert.strictEqual(resolveTier('vscode', true), 'pull-only');
    assert.strictEqual(resolveTier('windsurf', true), 'pull-only');
  });

  it('resolves prompt-only tier when no Figma MCP', async () => {
    const { resolveTier } = await import('../src/core/mcp-adapter.js');
    assert.strictEqual(resolveTier('claude-code', false), 'prompt-only');
    assert.strictEqual(resolveTier('unknown', false), 'prompt-only');
    assert.strictEqual(resolveTier('unknown', true), 'prompt-only');
  });

  it('generates setup command for Claude Code', async () => {
    const { getMCPSetupCommand } = await import('../src/core/mcp-adapter.js');
    const cmd = getMCPSetupCommand('claude-code');
    assert.ok(cmd.includes('claude mcp add'));
    assert.ok(cmd.includes('mcp.figma.com'));
  });

  it('generates setup JSON for Cursor', async () => {
    const { getMCPSetupCommand } = await import('../src/core/mcp-adapter.js');
    const cmd = getMCPSetupCommand('cursor');
    assert.ok(cmd.includes('.cursor/mcp.json'));
    assert.ok(cmd.includes('mcpServers'));
  });

  it('generates setup JSON for VS Code', async () => {
    const { getMCPSetupCommand } = await import('../src/core/mcp-adapter.js');
    const cmd = getMCPSetupCommand('vscode');
    assert.ok(cmd.includes('.vscode/mcp.json'));
  });

  it('selects full mode for small payloads', async () => {
    const { selectFigmaMode } = await import('../src/core/mcp-adapter.js');
    const result = selectFigmaMode(10000); // small
    assert.strictEqual(result.mode, 'full');
    assert.strictEqual(result.withinBudget, true);
  });

  it('selects summary mode for medium payloads', async () => {
    const { selectFigmaMode } = await import('../src/core/mcp-adapter.js');
    const result = selectFigmaMode(250000); // ~62k tokens
    assert.strictEqual(result.mode, 'summary');
    assert.strictEqual(result.withinBudget, true);
  });

  it('selects screenshot-only mode for large payloads', async () => {
    const { selectFigmaMode } = await import('../src/core/mcp-adapter.js');
    const result = selectFigmaMode(500000); // ~125k tokens, exceeds 80k budget
    assert.strictEqual(result.mode, 'screenshot-only');
    assert.strictEqual(result.withinBudget, false);
  });

  it('isUIProject returns false for DanteForge (a CLI project)', async () => {
    const { isUIProject } = await import('../src/core/mcp-adapter.js');
    const result = await isUIProject();
    // DanteForge is a CLI — no React/Vue/etc.
    assert.strictEqual(result, false);
  });

  it('initMCPAdapter returns valid result', async () => {
    const { initMCPAdapter } = await import('../src/core/mcp-adapter.js');
    const result = await initMCPAdapter();
    assert.ok(result.host);
    assert.ok(result.tier);
    assert.ok(result.capabilities);
    assert.ok(result.mcpEndpoint.includes('figma.com'));
  });
});

describe('New Command Exports', () => {
  it('setup-figma command exports correctly', async () => {
    const { setupFigma } = await import('../src/cli/commands/setup-figma.js');
    assert.strictEqual(typeof setupFigma, 'function');
  });

  it('doctor command exports correctly', async () => {
    const { doctor } = await import('../src/cli/commands/doctor.js');
    assert.strictEqual(typeof doctor, 'function');
  });

  it('dashboard command exports correctly', async () => {
    const { dashboard } = await import('../src/cli/commands/dashboard.js');
    assert.strictEqual(typeof dashboard, 'function');
  });

  it('magic command exports correctly', async () => {
    const { magic } = await import('../src/cli/commands/magic.js');
    assert.strictEqual(typeof magic, 'function');
  });

  it('spark command exports correctly', async () => {
    const { spark } = await import('../src/cli/commands/magic.js');
    assert.strictEqual(typeof spark, 'function');
  });

  it('ember command exports correctly', async () => {
    const { ember } = await import('../src/cli/commands/magic.js');
    assert.strictEqual(typeof ember, 'function');
  });

  it('blaze command exports correctly', async () => {
    const { blaze } = await import('../src/cli/commands/magic.js');
    assert.strictEqual(typeof blaze, 'function');
  });

  it('inferno command exports correctly', async () => {
    const { inferno } = await import('../src/cli/commands/magic.js');
    assert.strictEqual(typeof inferno, 'function');
  });

  it('update-mcp command exports correctly', async () => {
    const { updateMcp } = await import('../src/cli/commands/update-mcp.js');
    assert.strictEqual(typeof updateMcp, 'function');
  });

  it('tech-decide command exports correctly', async () => {
    const { techDecide } = await import('../src/cli/commands/tech-decide.js');
    assert.strictEqual(typeof techDecide, 'function');
  });

  it('lessons command exports correctly', async () => {
    const { lessons } = await import('../src/cli/commands/lessons.js');
    assert.strictEqual(typeof lessons, 'function');
  });
});
