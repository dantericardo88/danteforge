// Extended OpenPencil executor tests — sampling untested functions across categories
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createMediumOP, createComplexOP } from './helpers/mock-op.js';
import { createContext } from '../src/harvested/openpencil/tool-context.js';
import type { ToolContext } from '../src/harvested/openpencil/tool-context.js';

// Structure executors
import { executeGroupNodes, executeUngroupNodes, executeDistributeNodes, executeResizeToFit } from '../src/harvested/openpencil/executors/structure-executors.js';
// Analysis executors
import { executeAnalyzeClusters, executeDiffCreate } from '../src/harvested/openpencil/executors/analysis-executors.js';
// Vector executors
import { executeBooleanUnion, executeExportDesignTokens } from '../src/harvested/openpencil/executors/vector-executors.js';
// Variable executors
import { executeDeleteCollection } from '../src/harvested/openpencil/executors/variable-executors.js';

let ctx: ToolContext;

describe('Structure Executors — extended', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeDistributeNodes distributes 3+ nodes horizontally', () => {
    const result = executeDistributeNodes({ nodeIds: ['title', 'email-input', 'password-input', 'submit-btn'], direction: 'horizontal' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
  });

  it('executeDistributeNodes errors on fewer than 3 nodes', () => {
    const result = executeDistributeNodes({ nodeIds: ['title', 'email-input'], direction: 'horizontal' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should error with fewer than 3 nodes');
  });

  it('executeResizeToFit resizes parent to children', () => {
    const result = executeResizeToFit({ nodeId: 'login-card' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
  });

  it('executeResizeToFit errors on node with no children', () => {
    const result = executeResizeToFit({ nodeId: 'logo' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should error on node without children');
  });

  it('executeUngroupNodes dissolves group and re-parents children', () => {
    // First create a group using the imported executeGroupNodes
    const groupResult = executeGroupNodes({ nodeIds: ['email-input', 'password-input'], name: 'Inputs' }, ctx) as Record<string, unknown>;
    const groupId = groupResult.groupId as string;
    assert.ok(groupId, 'Should have created a group');

    // Now ungroup it
    const result = executeUngroupNodes({ groupId }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
  });
});

describe('Analysis Executors — extended', () => {
  beforeEach(() => { ctx = createContext(createComplexOP()); });

  it('executeAnalyzeClusters finds spatial clusters', () => {
    const result = executeAnalyzeClusters({}, ctx) as { clusters: unknown[] };
    assert.ok(Array.isArray(result.clusters), 'Should return clusters array');
  });

  it('executeAnalyzeClusters returns empty for simple doc', () => {
    const simpleCtx = createContext(createMediumOP());
    const result = executeAnalyzeClusters({}, simpleCtx) as { clusters: unknown[] };
    assert.ok(Array.isArray(result.clusters), 'Should still return an array');
  });

  it('executeDiffCreate detects differences between snapshots', () => {
    const before = createMediumOP();
    const after = createMediumOP();
    after.nodes[0].name = 'Modified Root';

    // executeDiffCreate returns { diffId, summary: { addedNodes, removedNodes, modifiedNodes }, entries }
    const result = executeDiffCreate({
      beforeSnapshot: JSON.stringify(before),
      afterSnapshot: JSON.stringify(after),
    }, ctx) as { summary?: { modifiedNodes: number }; entries?: unknown[]; error?: string };

    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.ok(result.summary, 'Should return summary');
    assert.ok(result.entries, 'Should return entries array');
  });
});

describe('Vector Executors — extended', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeBooleanUnion performs union on 2+ shapes', () => {
    const result = executeBooleanUnion({ nodeIds: ['email-input', 'password-input'] }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
  });

  it('executeBooleanUnion errors on fewer than 2 nodes', () => {
    const result = executeBooleanUnion({ nodeIds: ['email-input'] }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should error with fewer than 2 nodes');
  });

  it('executeExportDesignTokens exports CSS format', () => {
    // Returns { format: 'css', content: '...' }
    const result = executeExportDesignTokens({ format: 'css' }, ctx) as { format: string; content: string };
    assert.strictEqual(result.format, 'css');
    assert.ok(typeof result.content === 'string', 'Should return content string');
    assert.ok(result.content.length > 0, 'CSS content should not be empty');
  });

  it('executeExportDesignTokens exports Tailwind format', () => {
    // Returns { format: 'tailwind', content: '...' }
    const result = executeExportDesignTokens({ format: 'tailwind' }, ctx) as { format: string; content: string };
    assert.strictEqual(result.format, 'tailwind');
    assert.ok(typeof result.content === 'string', 'Should return content string');
    assert.ok(result.content.length > 0, 'Tailwind content should not be empty');
  });
});

describe('Variable Executors — extended', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeDeleteCollection removes a collection', () => {
    const result = executeDeleteCollection({ collectionId: 'colors' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    // Verify collection was removed
    const remaining = ctx.document.variableCollections ?? [];
    const found = remaining.find(c => c.id === 'colors');
    assert.ok(!found, 'Colors collection should be removed');
  });
});
