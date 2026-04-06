// Adapter coverage tests — exercises executeToolBatch, buildToolPromptSummary,
// getRelevantTools, and executeToolCall type-validation paths from adapter.ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeToolBatch,
  buildToolPromptSummary,
  getRelevantTools,
  executeToolCall,
} from '../src/harvested/openpencil/adapter.js';

// ── executeToolBatch ────────────────────────────────────────────────

describe('executeToolBatch', () => {
  it('returns empty results for empty calls', async () => {
    const results = await executeToolBatch([]);
    assert.equal(results.length, 0);
  });

  it('returns result for single valid call', async () => {
    const results = await executeToolBatch([
      { tool: 'createText', params: { content: 'Hello' } },
    ]);
    assert.equal(results.length, 1);
    assert.equal(results[0].success, true);
    assert.equal(results[0].tool, 'createText');
    assert.ok(results[0].durationMs >= 0, 'durationMs should be non-negative');
  });

  it('processes multiple calls', async () => {
    const results = await executeToolBatch([
      { tool: 'createText', params: { content: 'One' } },
      { tool: 'createShape', params: { type: 'rectangle' } },
      { tool: 'createText', params: { content: 'Three' } },
    ]);
    assert.equal(results.length, 3);
    // All should succeed (execution returns no-context result, but no thrown error)
    for (const r of results) {
      assert.equal(r.success, true);
    }
  });

  it('handles partial failures gracefully', async () => {
    const results = await executeToolBatch([
      { tool: 'createText', params: { content: 'Hi' } },
      { tool: 'nonExistentTool', params: {} },
    ]);
    assert.equal(results.length, 2);

    const successResult = results.find(r => r.tool === 'createText');
    const failResult = results.find(r => r.tool === 'nonExistentTool');

    assert.ok(successResult, 'Should contain createText result');
    assert.equal(successResult.success, true);

    assert.ok(failResult, 'Should contain nonExistentTool result');
    assert.equal(failResult.success, false);
    assert.ok(failResult.error?.includes('Unknown tool'), `Error should mention unknown tool, got: ${failResult.error}`);
  });
});

// ── buildToolPromptSummary ──────────────────────────────────────────

describe('buildToolPromptSummary', () => {
  it('returns markdown with category headers', async () => {
    const summary = await buildToolPromptSummary();
    assert.ok(summary.includes('###'), 'Summary should contain markdown headers');
    assert.ok(summary.length > 100, 'Summary should be substantial');
  });

  it('includes all 7 categories', async () => {
    const summary = await buildToolPromptSummary();
    const categories = ['read', 'create', 'modify', 'structure', 'variables', 'vector', 'analysis'];
    for (const cat of categories) {
      assert.ok(summary.toLowerCase().includes(cat), `Summary should include category "${cat}"`);
    }
  });
});

// ── getRelevantTools ────────────────────────────────────────────────

describe('getRelevantTools', () => {
  it('"create a button" context includes create category', async () => {
    const tools = await getRelevantTools('create a button');
    assert.ok(tools.length > 0, 'Should return some tools');
    const hasCreateTools = tools.some(t => t.name.toLowerCase().startsWith('create'));
    assert.ok(hasCreateTools, 'Should include tools whose name starts with "create"');
  });

  it('"inspect the layout" context includes read tools', async () => {
    const tools = await getRelevantTools('inspect the layout');
    assert.ok(tools.length > 0, 'Should return some tools');
    // read category always included; inspect triggers read explicitly
    const readToolNames = ['get_selection', 'get_page_tree', 'get_node', 'find_nodes'];
    const hasReadTools = tools.some(t => readToolNames.includes(t.name));
    assert.ok(hasReadTools, 'Should include read-category tools');
  });

  it('no matching keywords defaults to read+create+modify', async () => {
    const tools = await getRelevantTools('random gibberish xyz');
    assert.ok(tools.length > 0, 'Should fall back to default categories (not empty)');
    // With defaults: read + create + modify
    const names = tools.map(t => t.name);
    const hasRead = names.some(n => n.startsWith('get_') || n === 'find_nodes' || n === 'list_fonts');
    const hasCreate = names.some(n => n.startsWith('create'));
    assert.ok(hasRead, 'Default should include read tools');
    assert.ok(hasCreate, 'Default should include create tools');
  });

  it('"delete and restructure" includes structure tools', async () => {
    const tools = await getRelevantTools('delete and restructure');
    assert.ok(tools.length > 0, 'Should return some tools');
    const structureToolNames = ['deleteNode', 'cloneNode', 'groupNodes', 'flattenNode', 'reparentNode'];
    const hasStructureTools = tools.some(t => structureToolNames.includes(t.name));
    assert.ok(hasStructureTools, 'Should include structure-category tools like deleteNode');
  });
});

// ── executeToolCall — type validation ───────────────────────────────

describe('executeToolCall — type validation', () => {
  it('rejects number for string parameter', async () => {
    // createText has content: { type: 'string', required: true }
    const result = await executeToolCall('createText', { content: 123 as unknown as string });
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('must be a string'), `Error should mention "must be a string", got: ${result.error}`);
  });

  it('rejects invalid enum value', async () => {
    // setLayout has mode: { type: 'string', enum: ['horizontal', 'vertical', 'none'], required: true }
    const result = await executeToolCall('setLayout', {
      nodeId: 'test-node',
      mode: 'diagonal',
    });
    assert.equal(result.success, false);
    assert.ok(result.error?.includes('must be one of'), `Error should mention "must be one of", got: ${result.error}`);
  });
});
