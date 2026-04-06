import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { TOOL_HANDLERS, createMcpServer } from '../src/core/mcp-server.js';

describe('mcp-server SDK', () => {
  it('@modelcontextprotocol/sdk is in package.json dependencies', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    assert.ok(
      pkg.dependencies?.['@modelcontextprotocol/sdk'] !== undefined,
      'Expected @modelcontextprotocol/sdk in dependencies',
    );
  });

  it('All TOOL_HANDLERS exports are intact', () => {
    const handlers = Object.keys(TOOL_HANDLERS);
    assert.ok(handlers.length >= 16, `Expected at least 16 tool handlers, got ${handlers.length}`);
    assert.ok(handlers.includes('danteforge_assess'));
    assert.ok(handlers.includes('danteforge_workflow'));
    assert.ok(handlers.includes('danteforge_lessons_add'));
  });

  it('createMcpServer returns a ManualMcpServer with handleRequest method', () => {
    const server = createMcpServer({});
    assert.equal(typeof server.handleRequest, 'function');
  });
});
