import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadToolRegistry,
  toolToMCPFormat,
  getToolsByCategory,
  findTool,
  getToolSummary,
} from '../src/harvested/openpencil/tool-registry.js';
import {
  initOpenPencilAdapter,
  executeToolCall,
  buildToolPromptSummary,
} from '../src/harvested/openpencil/adapter.js';

describe('loadToolRegistry', () => {
  it('returns exactly 86 tools', async () => {
    const tools = await loadToolRegistry();
    // 11 read + 7 create + 20 modify + 17 structure + 11 variables + 14 vector + 6 analysis = 86
    assert.strictEqual(tools.length, 86);
  });

  it('has all 7 categories', async () => {
    const tools = await loadToolRegistry();
    const categories = [...new Set(tools.map(t => t.category))].sort();
    assert.deepStrictEqual(categories, [
      'analysis',
      'create',
      'modify',
      'read',
      'structure',
      'variables',
      'vector',
    ]);
  });

  it('category counts match spec', async () => {
    const summary = await getToolSummary();
    assert.strictEqual(summary['read'].count, 11);
    assert.strictEqual(summary['create'].count, 7);
    assert.strictEqual(summary['modify'].count, 20);
    assert.strictEqual(summary['structure'].count, 17);
    assert.strictEqual(summary['variables'].count, 11);
    assert.strictEqual(summary['vector'].count, 14);
    assert.strictEqual(summary['analysis'].count, 6);
  });
});

describe('toolToMCPFormat', () => {
  it('produces valid schema with required fields', async () => {
    const tool = await findTool('createText');
    assert.ok(tool, 'createText tool should exist');

    const mcp = toolToMCPFormat(tool);

    // Must have name, description, and inputSchema
    assert.strictEqual(mcp.name, 'createText');
    assert.ok(mcp.description.length > 0);
    assert.strictEqual(mcp.inputSchema.type, 'object');
    assert.ok(typeof mcp.inputSchema.properties === 'object');
    assert.ok(Array.isArray(mcp.inputSchema.required));

    // content is required for createText
    assert.ok(mcp.inputSchema.required.includes('content'));

    // Verify property structure
    assert.ok(mcp.inputSchema.properties['content']);
    assert.strictEqual(mcp.inputSchema.properties['content'].type, 'string');
    assert.ok(mcp.inputSchema.properties['content'].description.length > 0);
  });
});

describe('findTool', () => {
  it('returns correct tool by name', async () => {
    const tool = await findTool('get_selection');
    assert.ok(tool);
    assert.strictEqual(tool.name, 'get_selection');
    assert.strictEqual(tool.category, 'read');
    assert.ok(tool.description.length > 0);
    assert.strictEqual(typeof tool.execute, 'function');
  });

  it('returns undefined for unknown tool', async () => {
    const tool = await findTool('nonexistent_tool_xyz');
    assert.strictEqual(tool, undefined);
  });
});

describe('getToolsByCategory', () => {
  it('filters correctly', async () => {
    const analysisTools = await getToolsByCategory('analysis');
    assert.strictEqual(analysisTools.length, 6);
    for (const tool of analysisTools) {
      assert.strictEqual(tool.category, 'analysis');
    }

    const createTools = await getToolsByCategory('create');
    assert.strictEqual(createTools.length, 7);
    for (const tool of createTools) {
      assert.strictEqual(tool.category, 'create');
    }
  });
});

describe('initOpenPencilAdapter', () => {
  it('returns 86 tools', async () => {
    const result = await initOpenPencilAdapter();
    assert.strictEqual(result.toolCount, 86);
    assert.strictEqual(result.tools.length, 86);
    assert.strictEqual(result.mcpTools.length, 86);
    assert.ok(result.categories.length === 7);
  });
});

describe('executeToolCall', () => {
  it('validates required parameters', async () => {
    // createText requires 'content' parameter
    const result = await executeToolCall('createText', {});
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error.includes('Missing required parameter'));
    assert.ok(result.error.includes('content'));
    assert.strictEqual(result.tool, 'createText');
    assert.ok(typeof result.durationMs === 'number');
  });

  it('rejects unknown tools', async () => {
    const result = await executeToolCall('totally_fake_tool', { foo: 'bar' });
    assert.strictEqual(result.success, false);
    assert.ok(result.error);
    assert.ok(result.error.includes('Unknown tool'));
    assert.ok(result.error.includes('totally_fake_tool'));
    assert.strictEqual(result.tool, 'totally_fake_tool');
  });

  it('loads and persists DESIGN.op when no explicit ToolContext is provided', async () => {
    const originalCwd = process.cwd();
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-tool-registry-'));

    try {
      await fs.mkdir(path.join(tempRoot, '.danteforge'), { recursive: true });
      await fs.writeFile(path.join(tempRoot, '.danteforge', 'DESIGN.op'), JSON.stringify({
        formatVersion: '1.0.0',
        generator: 'danteforge/test',
        created: new Date().toISOString(),
        document: { name: 'Persist Test', pages: [{ id: 'page-1', type: 'page', name: 'Main' }] },
        nodes: [{ id: 'frame-1', type: 'frame', name: 'Original Name', width: 100, height: 100, children: [] }],
        variableCollections: [],
      }, null, 2), 'utf8');
      process.chdir(tempRoot);

      const result = await executeToolCall('setName', { nodeId: 'frame-1', name: 'Persisted Name' });
      assert.strictEqual(result.success, true, result.error);

      const persisted = JSON.parse(await fs.readFile(path.join(tempRoot, '.danteforge', 'DESIGN.op'), 'utf8')) as {
        nodes: Array<{ id: string; name: string }>;
      };
      assert.strictEqual(persisted.nodes[0]?.name, 'Persisted Name');
    } finally {
      process.chdir(originalCwd);
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
