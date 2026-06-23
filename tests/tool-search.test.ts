import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTools, toolSchemaTokens, totalSchemaTokens, selectWithinBudget, SEARCH_TOOLS_TOOL } from '../src/core/tool-search.js';
import { TOOL_DEFINITIONS } from '../src/core/mcp-tool-definitions.js';
import { createMcpServer } from '../src/core/mcp-server.js';

test('searchTools ranks real DanteForge tools by relevance to a query', () => {
  const hits = searchTools('score', TOOL_DEFINITIONS, 5);
  assert.ok(hits.length > 0, 'finds score-related tools');
  assert.ok(hits.every(h => h.score > 0));
  assert.ok(hits[0]!.name.includes('score'), `top hit should be a score tool, got ${hits[0]!.name}`);
});

test('searchTools returns [] for an empty/whitespace query and respects the limit', () => {
  assert.deepEqual(searchTools('', TOOL_DEFINITIONS), []);
  assert.deepEqual(searchTools('   ', TOOL_DEFINITIONS), []);
  assert.ok(searchTools('score gate state plan', TOOL_DEFINITIONS, 3).length <= 3);
});

test('schema-token budgeting: total > a single tool, and selectWithinBudget never busts the budget', () => {
  const total = totalSchemaTokens(TOOL_DEFINITIONS);
  const one = toolSchemaTokens(TOOL_DEFINITIONS[0]!);
  assert.ok(total > one, 'whole catalog costs more than one tool');
  const budget = one + 1;
  const picked = selectWithinBudget('score gate state', TOOL_DEFINITIONS, budget);
  const cost = picked.reduce((s, h) => s + toolSchemaTokens(TOOL_DEFINITIONS.find(d => d.name === h.name)!), 0);
  assert.ok(cost <= budget, `picked cost ${cost} must fit budget ${budget}`);
});

test('the discovery tool is LISTED and CALLABLE end-to-end (tools/list + tools/call)', async () => {
  const server = createMcpServer();
  const list = await server.handleRequest({ method: 'tools/list', params: {} }) as { result?: { tools?: Array<{ name: string }> } };
  const names = (list.result?.tools ?? []).map(t => t.name);
  assert.ok(names.includes('danteforge_search_tools'), 'discovery tool appears in the catalog');

  const call = await server.handleRequest({
    method: 'tools/call',
    params: { name: 'danteforge_search_tools', arguments: { query: 'gate' } },
  }) as { result?: { content?: Array<{ text: string }> } };
  const payload = JSON.parse(call.result?.content?.[0]?.text ?? '{}');
  assert.equal(payload.query, 'gate');
  assert.ok(Array.isArray(payload.matches), 'returns a matches array');
  assert.ok(payload.total_tools >= TOOL_DEFINITIONS.length, 'catalog includes the discovery tool itself');
});

test('the discovery tool errors structurally on a missing query', async () => {
  const server = createMcpServer();
  const call = await server.handleRequest({
    method: 'tools/call',
    params: { name: 'danteforge_search_tools', arguments: {} },
  }) as { result?: { content?: Array<{ text: string }> } };
  const payload = JSON.parse(call.result?.content?.[0]?.text ?? '{}');
  assert.equal(payload.code, 'missing_parameter');
  assert.equal(payload.param, 'query');
});

test('SEARCH_TOOLS_TOOL is a well-formed definition requiring a query', () => {
  assert.equal(SEARCH_TOOLS_TOOL.name, 'danteforge_search_tools');
  assert.deepEqual((SEARCH_TOOLS_TOOL.inputSchema as { required?: string[] }).required, ['query']);
});
