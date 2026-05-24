import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterTools, formatToolList, formatToolDetail } from '../src/cli/commands/mcp-tools.js';
import { TOOL_DEFINITIONS } from '../src/core/mcp-tool-definitions.js';

// ── filterTools ───────────────────────────────────────────────────────────────

describe('filterTools', () => {
  it('returns all tools when no filter applied', () => {
    const result = filterTools(TOOL_DEFINITIONS);
    assert.equal(result.length, TOOL_DEFINITIONS.length);
  });

  it('filters by category', () => {
    const result = filterTools(TOOL_DEFINITIONS, { category: 'Scoring' });
    assert.ok(result.length > 0, 'should find some Scoring tools');
    assert.ok(result.length < TOOL_DEFINITIONS.length, 'should filter some out');
  });

  it('filters by query substring', () => {
    const result = filterTools(TOOL_DEFINITIONS, { query: 'lessons' });
    assert.ok(result.length > 0, 'should find lessons-related tools');
    for (const t of result) {
      const hay = `${t.name} ${t.description}`.toLowerCase();
      assert.ok(hay.includes('lessons'), `tool ${t.name} should match query`);
    }
  });

  it('combines category and query filters', () => {
    const result = filterTools(TOOL_DEFINITIONS, { category: 'Workflow', query: 'specify' });
    assert.ok(result.length >= 1, 'should find specify-related Workflow tools');
  });

  it('returns empty array for non-matching filter', () => {
    const result = filterTools(TOOL_DEFINITIONS, { query: 'NONEXISTENT_TOOL_XYZ_QQQ' });
    assert.equal(result.length, 0);
  });
});

// ── formatToolList ────────────────────────────────────────────────────────────

describe('formatToolList', () => {
  it('produces non-empty grouped output', () => {
    const text = formatToolList(TOOL_DEFINITIONS);
    // eslint-disable-next-line no-control-regex
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(stripped.includes('DanteForge MCP Tools'));
    assert.ok(stripped.length > 500);
  });

  it('includes tool count in header', () => {
    const text = formatToolList(TOOL_DEFINITIONS);
    // eslint-disable-next-line no-control-regex
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(stripped.includes(String(TOOL_DEFINITIONS.length)));
  });
});

// ── formatToolDetail ──────────────────────────────────────────────────────────

describe('formatToolDetail', () => {
  it('includes tool name, description, and schema', () => {
    const tool = TOOL_DEFINITIONS[0]!;
    const text = formatToolDetail(tool);
    // eslint-disable-next-line no-control-regex
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(stripped.includes(tool.name));
    assert.ok(stripped.includes('Description:'));
    assert.ok(stripped.includes('Input schema:'));
  });

  it('renders inputSchema as JSON', () => {
    const tool = TOOL_DEFINITIONS.find(t => t.name === 'danteforge_score')!;
    const text = formatToolDetail(tool);
    // eslint-disable-next-line no-control-regex
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(stripped.includes('artifact'), 'should mention the artifact param');
  });
});
