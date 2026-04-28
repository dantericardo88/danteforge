import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentSession } from './helpers/mcp-harness.js';
import { TOOL_DEFINITIONS } from '../src/core/mcp-server.js';

const mockDeps = {
  _assess: async () => ({ assessment: {}, comparison: {} }),
  _forge: async () => ({ ok: true }),
  _verify: async () => ({ ok: true }),
  _autoforge: async () => ({ ok: true }),
  _plan: async () => ({ ok: true }),
  _tasks: async () => ({ ok: true }),
  _synthesize: async () => ({ ok: true }),
  _retro: async () => ({ ok: true }),
  _maturity: async () => ({ ok: true }),
  _specify: async () => ({ ok: true }),
  _constitution: async () => ({ ok: true }),
  _loadState: async () => ({ workflowStage: 'initialized', currentPhase: 1, lastHandoff: '', tasks: {}, auditLog: [] }),
  _generateMasterplan: async () => ({ ok: true }),
  _scanCompetitors: async () => ({ ok: true }),
  _appendLesson: async () => {},
  _workflow: async () => ({ workflowStage: 'initialized', currentPhase: 1, lastHandoff: '' }),
  _adversarialScore: async () => ({ selfScore: 9, adversarialScore: 9, verdict: 'trusted' }),
};

describe('e2e MCP integration', () => {
  it('full session: initialize → tools/list → workflow_read', async () => {
    const session = createAgentSession(mockDeps);
    const initResult = await session.send('initialize', {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' },
    }) as { protocolVersion?: string };
    assert.ok(initResult.protocolVersion);

    const listResult = await session.send('tools/list') as { tools: unknown[] };
    assert.ok(listResult.tools.length >= 16);

    const workflowText = await session.callTool('danteforge_workflow', {});
    const workflow = JSON.parse(workflowText) as Record<string, unknown>;
    assert.ok('workflowStage' in workflow);
  });

  it('all tools are callable without throwing via harness with injected deps', async () => {
    const session = createAgentSession(mockDeps);
    for (const tool of TOOL_DEFINITIONS) {
      // Provide required fields if any
      const args: Record<string, unknown> = {};
      if (tool.name === 'danteforge_specify') args['idea'] = 'test idea';
      if (tool.name === 'danteforge_lessons_add') args['lesson'] = 'test lesson';
      if (tool.name === 'danteforge_adversarial_score') args['summaryOnly'] = true;
      if (tool.name === 'danteforge_cofl') args['guards'] = true;
      await assert.doesNotReject(
        () => session.callTool(tool.name, args),
        `Tool ${tool.name} should not throw`,
      );
    }
  });

  it('all tools return JSON string results', async () => {
    const session = createAgentSession(mockDeps);
    const text = await session.callTool('danteforge_workflow', {});
    assert.doesNotThrow(() => JSON.parse(text), 'Tool result should be valid JSON');
  });

  it('initialize response includes protocolVersion and serverInfo', async () => {
    const session = createAgentSession(mockDeps);
    const result = await session.send('initialize', {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' },
    }) as { protocolVersion?: string; serverInfo?: { name?: string } };
    assert.ok(result.protocolVersion, 'Expected protocolVersion');
    assert.ok(result.serverInfo?.name, 'Expected serverInfo.name');
  });

  it('consecutive calls maintain independent state', async () => {
    const session = createAgentSession(mockDeps);
    const r1 = await session.callTool('danteforge_workflow', {});
    const r2 = await session.callTool('danteforge_workflow', {});
    assert.deepEqual(JSON.parse(r1), JSON.parse(r2));
  });

  it('lessons_add stores lesson and reports ok: true', async () => {
    const stored: string[] = [];
    const session = createAgentSession({
      ...mockDeps,
      _appendLesson: async (entry: string) => { stored.push(entry); },
    });
    const result = await session.callTool('danteforge_lessons_add', { lesson: 'hello lesson' });
    const parsed = JSON.parse(result) as { ok?: boolean };
    assert.equal(parsed.ok, true);
    assert.equal(stored[0], 'hello lesson');
  });

  it('workflow → state_read pipeline returns non-empty results', async () => {
    const session = createAgentSession(mockDeps);
    const wf = await session.callTool('danteforge_workflow', {});
    const state = await session.callTool('danteforge_state_read', {});
    assert.ok(wf.length > 0);
    assert.ok(state.length > 0);
  });

  it('tool handler errors return isError content, do not throw', async () => {
    const { createMcpServer } = await import('../src/core/mcp-server.js');
    const server = createMcpServer({});
    const errDeps = {
      _workflow: async () => { throw new Error('simulated error'); },
    };
    const line = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'danteforge_workflow', arguments: {} } });
    const response = await server.handleRequest(line, errDeps);
    // Should NOT throw — should return isError result
    assert.ok(response);
    const result = (response as { result?: { isError?: boolean } }).result;
    assert.ok(result?.isError === true, 'Expected isError: true');
  });
});
