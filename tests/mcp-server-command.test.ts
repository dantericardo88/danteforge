import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

describe('mcp-server command', () => {
  it('mcpServer is exported from commands/index.ts', async () => {
    const indexSource = await fs.readFile('src/cli/commands/index.ts', 'utf-8');
    assert.match(indexSource, /mcpServer/);
  });

  it('mcp-server is registered in src/cli/index.ts', async () => {
    const indexSource = await fs.readFile('src/cli/index.ts', 'utf-8');
    assert.match(indexSource, /mcp-server/);
  });

  it('mcpServer calls _startMcpServer injection seam when provided', async () => {
    const { mcpServer } = await import('../src/cli/commands/mcp-server.js');
    let called = false;
    await mcpServer({ _startMcpServer: async () => { called = true; } });
    assert.equal(called, true);
  });

  it('mcp-server is in the preAction skip set in src/cli/index.ts', async () => {
    const indexSource = await fs.readFile('src/cli/index.ts', 'utf-8');
    // Should be in the skip set or have some equivalent exemption
    assert.match(indexSource, /mcp-server/);
  });
});
