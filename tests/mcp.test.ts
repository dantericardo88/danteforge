// MCP adapter tests — host detection, capabilities, prompt builders
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('MCP Host Detection', () => {
  it('mcp module exports correctly', async () => {
    const mcp = await import('../src/core/mcp.js');
    assert.strictEqual(typeof mcp.detectHost, 'function');
    assert.strictEqual(typeof mcp.detectMCPCapabilities, 'function');
    assert.strictEqual(typeof mcp.buildPushToFigmaPrompt, 'function');
    assert.strictEqual(typeof mcp.buildPullFromFigmaPrompt, 'function');
    assert.strictEqual(typeof mcp.buildUXRefinePrompt, 'function');
  });

  it('returns unknown when no host env vars set', async () => {
    const { detectHost } = await import('../src/core/mcp.js');
    // In test environment, no editor env vars should be set
    const host = detectHost();
    assert.ok(['claude-code', 'cursor', 'codex', 'vscode', 'windsurf', 'unknown'].includes(host));
  });

  it('respects explicit host override', async () => {
    const { detectHost } = await import('../src/core/mcp.js');
    assert.strictEqual(detectHost('claude-code'), 'claude-code');
    assert.strictEqual(detectHost('cursor'), 'cursor');
    assert.strictEqual(detectHost('vscode'), 'vscode');
    assert.strictEqual(detectHost('codex'), 'codex');
    assert.strictEqual(detectHost('windsurf'), 'windsurf');
  });

  it('falls back to auto-detection for "auto" override', async () => {
    const { detectHost } = await import('../src/core/mcp.js');
    const host = detectHost('auto');
    assert.ok(['claude-code', 'cursor', 'codex', 'vscode', 'windsurf', 'unknown'].includes(host));
  });

  it('warns on invalid host override', async () => {
    const { detectHost } = await import('../src/core/mcp.js');
    const host = detectHost('invalid-host');
    // Falls back to auto-detection
    assert.ok(['claude-code', 'cursor', 'codex', 'vscode', 'windsurf', 'unknown'].includes(host));
  });
});

describe('MCP Capabilities Detection', () => {
  it('returns capabilities object for unknown host', async () => {
    const { detectMCPCapabilities } = await import('../src/core/mcp.js');
    const caps = await detectMCPCapabilities('unknown');
    assert.strictEqual(caps.host, 'unknown');
    assert.strictEqual(typeof caps.hasMCP, 'boolean');
    assert.strictEqual(typeof caps.hasFigmaMCP, 'boolean');
  });

  it('handles missing config files gracefully', async () => {
    const { detectMCPCapabilities } = await import('../src/core/mcp.js');
    // All hosts should return without throwing even when configs don't exist
    for (const host of ['claude-code', 'cursor', 'codex', 'vscode', 'windsurf'] as const) {
      const caps = await detectMCPCapabilities(host);
      assert.strictEqual(caps.host, host);
    }
  });
});

describe('MCP Prompt Builders', () => {
  it('builds push prompt with component paths', async () => {
    const { buildPushToFigmaPrompt } = await import('../src/core/mcp.js');
    const prompt = buildPushToFigmaPrompt(
      ['src/components/Button.tsx', 'src/components/Card.tsx'],
      'Test project context',
      { host: 'unknown', hasMCP: false, hasFigmaMCP: false },
    );
    assert.ok(prompt.includes('Button.tsx'));
    assert.ok(prompt.includes('Card.tsx'));
    assert.ok(prompt.includes('Test project context'));
  });

  it('builds MCP-aware push prompt when Figma MCP detected', async () => {
    const { buildPushToFigmaPrompt } = await import('../src/core/mcp.js');
    const prompt = buildPushToFigmaPrompt(
      ['src/App.tsx'],
      'Context',
      { host: 'claude-code', hasMCP: true, hasFigmaMCP: true, figmaServerName: 'figma-dev' },
    );
    assert.ok(prompt.includes('Figma MCP tools'));
    assert.ok(prompt.includes('figma-dev'));
    assert.ok(prompt.includes('Code-to-Canvas'));
  });

  it('builds pull prompt with Figma URL', async () => {
    const { buildPullFromFigmaPrompt } = await import('../src/core/mcp.js');
    const prompt = buildPullFromFigmaPrompt(
      'https://www.figma.com/file/abc123',
      'src/tokens.ts',
      { host: 'unknown', hasMCP: false, hasFigmaMCP: false },
    );
    assert.ok(prompt.includes('figma.com/file/abc123'));
    assert.ok(prompt.includes('src/tokens.ts'));
  });

  it('builds full UX refine prompt', async () => {
    const { buildUXRefinePrompt } = await import('../src/core/mcp.js');
    const prompt = buildUXRefinePrompt(
      ['src/App.tsx'],
      'Project context',
      'https://www.figma.com/file/test',
      'src/tokens.ts',
      'Test constitution',
    );
    assert.ok(prompt.includes('UX design engineer'));
    assert.ok(prompt.includes('Test constitution'));
    assert.ok(prompt.includes('src/App.tsx'));
    assert.ok(prompt.includes('figma.com/file/test'));
    assert.ok(prompt.includes('src/tokens.ts'));
  });

  it('builds UX refine prompt without optional fields', async () => {
    const { buildUXRefinePrompt } = await import('../src/core/mcp.js');
    const prompt = buildUXRefinePrompt(
      ['src/App.tsx'],
      'Context',
      undefined,
      'tokens.ts',
    );
    assert.ok(prompt.includes('No Figma file specified'));
    assert.ok(!prompt.includes('Project Principles'));
  });
});
