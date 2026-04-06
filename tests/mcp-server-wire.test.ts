import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentSession } from './helpers/mcp-harness.js';
import { TOOL_DEFINITIONS, createMcpServer } from '../src/core/mcp-server.js';

describe('mcp-server wire protocol', () => {
  it('initialize handshake returns protocolVersion', async () => {
    const session = createAgentSession();
    const result = await session.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' },
    }) as { protocolVersion?: string };
    assert.ok(result.protocolVersion, 'Expected protocolVersion in result');
  });

  it('tools/list returns at least 16 tools', async () => {
    const session = createAgentSession();
    const result = await session.send('tools/list') as { tools: unknown[] };
    assert.ok(result.tools.length >= 16, `Expected at least 16 tools, got ${result.tools.length}`);
  });

  it('all tools have name, description, and inputSchema', () => {
    for (const tool of TOOL_DEFINITIONS) {
      assert.ok(tool.name, `Tool missing name`);
      assert.ok(tool.description, `Tool ${tool.name} missing description`);
      assert.ok(tool.inputSchema, `Tool ${tool.name} missing inputSchema`);
    }
  });

  it('danteforge_workflow tool call returns valid JSON via injected handler', async () => {
    const session = createAgentSession({
      _workflow: async () => ({
        workflowStage: 'initialized',
        currentPhase: 1,
        lastHandoff: '',
        lastVerifyStatus: undefined,
      }),
    });
    const text = await session.callTool('danteforge_workflow', { cwd: '/tmp' });
    const parsed = JSON.parse(text) as Record<string, unknown>;
    assert.ok('workflowStage' in parsed);
  });

  it('unknown tool returns isError: true', async () => {
    const server = createMcpServer({});
    const line = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nonexistent_tool', arguments: {} } });
    const response = await server.handleRequest(line, {});
    // Unknown tool returns error or isError result
    const hasError = ('error' in response && response.error) || (response as { result?: { isError?: boolean } }).result?.isError;
    assert.ok(hasError, 'Expected error response for unknown tool');
  });

  it('unknown method returns JSON-RPC error -32601', async () => {
    const server = createMcpServer({});
    const line = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'unknown/method', params: {} });
    const response = await server.handleRequest(line, {});
    assert.ok('error' in response && response.error?.code === -32601, 'Expected -32601 error code');
  });

  it('malformed JSON returns error -32700', async () => {
    const server = createMcpServer({});
    const response = await server.handleRequest('{invalid json}', {});
    assert.ok('error' in response && response.error?.code === -32700, 'Expected -32700 parse error');
  });

  it('multiple sequential requests handled in order with IDs preserved', async () => {
    const server = createMcpServer({});
    const ids = [1, 2, 3];
    const responses = await Promise.all(
      ids.map(id => server.handleRequest(
        JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list', params: {} }),
        {},
      )),
    );
    for (let i = 0; i < ids.length; i++) {
      assert.equal(responses[i].id, ids[i]);
    }
  });

  it('string IDs are preserved in responses', async () => {
    const server = createMcpServer({});
    const line = JSON.stringify({ jsonrpc: '2.0', id: 'abc-123', method: 'tools/list', params: {} });
    const response = await server.handleRequest(line, {});
    assert.equal(response.id, 'abc-123');
  });

  it('null ID is preserved in response', async () => {
    const server = createMcpServer({});
    const line = JSON.stringify({ jsonrpc: '2.0', id: null, method: 'tools/list', params: {} });
    const response = await server.handleRequest(line, {});
    assert.equal(response.id, null);
  });

  it('empty line returns parse error', async () => {
    const server = createMcpServer({});
    const response = await server.handleRequest('', {});
    assert.ok('error' in response && response.error?.code === -32700);
  });

  it('danteforge_lessons_add + danteforge_state_read pipeline via harness', async () => {
    const lessons: string[] = [];
    const session = createAgentSession({
      _appendLesson: async (entry: string) => { lessons.push(entry); },
      _loadState: async () => ({ workflowStage: 'initialized', currentPhase: 1, lastHandoff: '', tasks: {}, auditLog: [] }),
      _workflow: async () => ({ workflowStage: 'initialized', currentPhase: 1, lastHandoff: '', lastVerifyStatus: undefined }),
    });
    await session.callTool('danteforge_lessons_add', { lesson: 'test lesson' });
    assert.equal(lessons.length, 1);
    const stateText = await session.callTool('danteforge_state_read', {});
    const state = JSON.parse(stateText) as Record<string, unknown>;
    assert.ok('workflowStage' in state);
  });
});
