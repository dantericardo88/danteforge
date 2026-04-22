// P0–P4 OpenPencil executor tests — ~47 untested functions across all executor categories
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createMediumOP, createComplexOP } from './helpers/mock-op.js';
import { createContext } from '../src/harvested/openpencil/tool-context.js';
import type { ToolContext } from '../src/harvested/openpencil/tool-context.js';

// P0: modify-executors
import {
  executeSetStroke, executeSetText, executeSetPosition, executeSetVisible,
  executeSetCornerRadius, executeSetFontSize, executeSetFontFamily,
  executeSetRotation, executeSetLocked, executeSetEffect, executeSetLayout,
  executeSetLineHeight,
} from '../src/harvested/openpencil/executors/modify-executors.js';

// P1: structure-executors
import {
  executeReparentNode, executeFlattenNode, executeReorderNode,
  executeSelectNodes, executeDuplicatePage, executeScrollToNode,
  executeLockAllChildren, executeGroupNodes,
} from '../src/harvested/openpencil/executors/structure-executors.js';

// P2: create-executors
import {
  executeCreateComponent, executeCreateInstance, executeCreatePage,
  executeRender,
} from '../src/harvested/openpencil/executors/create-executors.js';

// P3: variable-executors
import {
  executeUpdateVariable, executeDeleteVariable, executeUnbindVariable,
  executeGetCollection, executeRenameCollection, executeGetVariableBindings,
} from '../src/harvested/openpencil/executors/variable-executors.js';

// P3: read-executors
import {
  executeGetPageTree, executeGetPageList, executeGetNodeCSS,
  executeGetNodeBounds,
} from '../src/harvested/openpencil/executors/read-executors.js';

// P4: vector-executors
import {
  executeBooleanSubtract, executeBooleanIntersect, executeBooleanExclude,
  executePathSimplify, executeExportSvg,
} from '../src/harvested/openpencil/executors/vector-executors.js';

// P3: analysis-executors
import { executeDiffShow } from '../src/harvested/openpencil/executors/analysis-executors.js';

let ctx: ToolContext;

// ---------------------------------------------------------------------------
// P0: Modify Executors (~16 tests)
// ---------------------------------------------------------------------------
describe('Modify Executors — P0 coverage', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  // --- executeSetStroke ---
  it('executeSetStroke sets stroke on valid node', () => {
    const result = executeSetStroke({ nodeId: 'email-input', color: '#ff0000', weight: 2 }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.updated, true);
  });

  it('executeSetStroke errors on missing node', () => {
    const result = executeSetStroke({ nodeId: 'nonexistent', color: '#ff0000', weight: 2 }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should error on missing node');
  });

  // --- executeSetText ---
  it('executeSetText sets text on text node', () => {
    const result = executeSetText({ nodeId: 'title', content: 'New Title' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.updated, true);
  });

  it('executeSetText errors on missing node', () => {
    const result = executeSetText({ nodeId: 'nonexistent', content: 'Hello' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should error on missing node');
  });

  // --- executeSetPosition ---
  it('executeSetPosition sets position on valid node', () => {
    const result = executeSetPosition({ nodeId: 'email-input', x: 100, y: 200 }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.updated, true);
  });

  it('executeSetPosition errors on missing node', () => {
    const result = executeSetPosition({ nodeId: 'nonexistent', x: 100, y: 200 }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should error on missing node');
  });

  // --- executeSetVisible ---
  it('executeSetVisible toggles visibility', () => {
    const result = executeSetVisible({ nodeId: 'email-input', visible: false }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.updated, true);
  });

  // --- executeSetCornerRadius ---
  it('executeSetCornerRadius sets corner radius', () => {
    const result = executeSetCornerRadius({ nodeId: 'email-input', radius: 8 }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.updated, true);
  });

  // --- executeSetFontSize ---
  it('executeSetFontSize sets font size on text node', () => {
    const result = executeSetFontSize({ nodeId: 'title', size: 24 }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.updated, true);
  });

  // --- executeSetFontFamily ---
  it('executeSetFontFamily sets font family on text node', () => {
    const result = executeSetFontFamily({ nodeId: 'title', family: 'Inter' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.updated, true);
  });

  // --- executeSetRotation ---
  it('executeSetRotation sets rotation on valid node', () => {
    const result = executeSetRotation({ nodeId: 'email-input', rotation: 45 }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.updated, true);
  });

  // --- executeSetLocked ---
  it('executeSetLocked toggles locked state', () => {
    const result = executeSetLocked({ nodeId: 'email-input', locked: true }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.updated, true);
  });

  // --- executeSetEffect ---
  it('executeSetEffect adds drop-shadow effect', () => {
    const result = executeSetEffect({ nodeId: 'email-input', type: 'drop-shadow', color: '#000000', radius: 4, offset: { x: 2, y: 2 } }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.updated, true);
  });

  it('executeSetEffect adds blur effect', () => {
    const result = executeSetEffect({ nodeId: 'email-input', type: 'blur', radius: 10 }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.updated, true);
  });

  // --- executeSetLayout ---
  it('executeSetLayout sets auto-layout on frame', () => {
    const result = executeSetLayout({ nodeId: 'login-card', mode: 'vertical', gap: 8 }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.updated, true);
  });

  // --- executeSetLineHeight ---
  it('executeSetLineHeight sets line height on text node', () => {
    const result = executeSetLineHeight({ nodeId: 'title', lineHeight: 1.5 }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.updated, true);
  });
});

// ---------------------------------------------------------------------------
// P1: Structure Executors (~10 tests)
// ---------------------------------------------------------------------------
describe('Structure Executors — P1 coverage', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  // --- executeReparentNode ---
  it('executeReparentNode moves node to new parent', () => {
    const result = executeReparentNode({ nodeId: 'email-input', newParentId: 'frame-root' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.reparented, true);
  });

  it('executeReparentNode errors on missing node', () => {
    const result = executeReparentNode({ nodeId: 'nonexistent', newParentId: 'frame-root' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should error on missing node');
  });

  // --- executeFlattenNode ---
  it('executeFlattenNode flattens a group into a vector', () => {
    // First create a group, then flatten it
    const groupResult = executeGroupNodes({ nodeIds: ['email-input', 'password-input'], name: 'Inputs' }, ctx) as Record<string, unknown>;
    const groupId = groupResult.groupId as string;
    assert.ok(groupId, 'Should have created a group');

    const result = executeFlattenNode({ nodeId: groupId }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.flattened, true);
  });

  it('executeFlattenNode errors on missing node', () => {
    const result = executeFlattenNode({ nodeId: 'nonexistent' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should error on missing node');
  });

  // --- executeReorderNode ---
  it('executeReorderNode moves node to front', () => {
    const result = executeReorderNode({ nodeId: 'email-input', direction: 'front' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.reordered, true);
  });

  it('executeReorderNode moves node to back', () => {
    const result = executeReorderNode({ nodeId: 'email-input', direction: 'back' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.reordered, true);
  });

  // --- executeSelectNodes ---
  it('executeSelectNodes sets selection', () => {
    const result = executeSelectNodes({ nodeIds: ['email-input', 'password-input'] }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.selected, 2);
  });

  // --- executeDuplicatePage ---
  it('executeDuplicatePage duplicates existing page', () => {
    const result = executeDuplicatePage({ pageId: 'page-1' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.duplicated, true);
    assert.ok(result.newPageId, 'Should return new page ID');
  });

  // --- executeScrollToNode ---
  it('executeScrollToNode scrolls to valid node', () => {
    const result = executeScrollToNode({ nodeId: 'email-input' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.ok(result.viewportTarget, 'Should return viewport target');
  });

  // --- executeLockAllChildren ---
  it('executeLockAllChildren locks all children of a frame', () => {
    const result = executeLockAllChildren({ nodeId: 'login-card' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.locked, true);
    assert.ok((result.childrenLocked as number) > 0, 'Should have locked at least one child');
  });
});

// ---------------------------------------------------------------------------
// P2: Create Executors (~6 tests)
// ---------------------------------------------------------------------------
describe('Create Executors — P2 coverage', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  // --- executeCreateComponent ---
  it('executeCreateComponent creates a component node', () => {
    const result = executeCreateComponent({ name: 'Button' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.type, 'component');
    assert.strictEqual(result.created, true);
  });

  it('executeCreateComponent has correct name', () => {
    const result = executeCreateComponent({ name: 'Button' }, ctx) as Record<string, unknown>;
    assert.strictEqual(result.name, 'Button');
  });

  // --- executeCreateInstance ---
  it('executeCreateInstance creates instance from component', () => {
    // First create a component, then instantiate it
    const compResult = executeCreateComponent({ name: 'Button' }, ctx) as Record<string, unknown>;
    const componentId = compResult.nodeId as string;
    assert.ok(componentId, 'Should have created a component');

    const result = executeCreateInstance({ componentId }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.type, 'instance');
    assert.strictEqual(result.created, true);
  });

  it('executeCreateInstance errors on non-existent component', () => {
    const result = executeCreateInstance({ componentId: 'nonexistent' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should error on non-existent component');
  });

  // --- executeCreatePage ---
  it('executeCreatePage creates new page', () => {
    const result = executeCreatePage({ name: 'Settings' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.created, true);
    assert.strictEqual(result.name, 'Settings');
  });

  // --- executeRender ---
  it('executeRender renders SVG format', () => {
    const result = executeRender({ format: 'svg' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.format, 'svg');
    assert.ok(typeof result.content === 'string', 'Should return content string');
    assert.ok((result.content as string).length > 0, 'SVG content should not be empty');
  });
});

// ---------------------------------------------------------------------------
// P3: Variable Executors (~6 tests)
// ---------------------------------------------------------------------------
describe('Variable Executors — P3 coverage', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  // --- executeUpdateVariable ---
  it('executeUpdateVariable updates variable value', () => {
    const varId = ctx.document.variableCollections![0].variables[0].id;
    const result = executeUpdateVariable({ variableId: varId, value: '#00ff00' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.updated, true);
    assert.strictEqual(result.newValue, '#00ff00');
  });

  // --- executeDeleteVariable ---
  it('executeDeleteVariable deletes variable', () => {
    const varId = ctx.document.variableCollections![0].variables[0].id;
    const countBefore = ctx.document.variableCollections![0].variables.length;
    const result = executeDeleteVariable({ variableId: varId }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.deleted, true);
    assert.strictEqual(ctx.document.variableCollections![0].variables.length, countBefore - 1);
  });

  // --- executeUnbindVariable ---
  it('executeUnbindVariable errors when no binding exists', () => {
    const result = executeUnbindVariable({ nodeId: 'email-input', property: 'fill' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should error when no binding exists');
  });

  // --- executeGetCollection ---
  it('executeGetCollection returns collection data', () => {
    const result = executeGetCollection({ collectionId: 'colors' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.id, 'colors');
    assert.strictEqual(result.name, 'Colors');
    assert.ok((result.variableCount as number) > 0, 'Should have variables');
  });

  // --- executeRenameCollection ---
  it('executeRenameCollection renames collection', () => {
    const result = executeRenameCollection({ collectionId: 'colors', name: 'Brand Colors' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.renamed, true);
    assert.strictEqual(result.newName, 'Brand Colors');
  });

  // --- executeGetVariableBindings ---
  it('executeGetVariableBindings returns bindings info', () => {
    const varId = ctx.document.variableCollections![0].variables[0].id;
    const result = executeGetVariableBindings({ variableId: varId }, ctx) as Record<string, unknown>;
    // The mock data has no bindings, so bindingCount should be 0
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(typeof result.bindingCount, 'number');
    assert.ok(Array.isArray(result.bindings), 'Should return bindings array');
  });
});

// ---------------------------------------------------------------------------
// P3: Read Executors (~4 tests)
// ---------------------------------------------------------------------------
describe('Read Executors — P3 coverage', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  // --- executeGetPageTree ---
  it('executeGetPageTree returns page tree structure', () => {
    const result = executeGetPageTree({}, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.ok(result.pages, 'Should have pages');
    assert.ok(result.nodes, 'Should have nodes');
  });

  // --- executeGetPageList ---
  it('executeGetPageList returns page list', () => {
    const result = executeGetPageList({}, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.ok(Array.isArray(result.pages), 'Should return pages array');
    assert.ok((result.pages as unknown[]).length > 0, 'Should have at least one page');
  });

  // --- executeGetNodeCSS ---
  it('executeGetNodeCSS returns CSS for node', () => {
    const result = executeGetNodeCSS({ nodeId: 'email-input' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.ok(result.css, 'Should return css object');
    assert.ok(typeof result.css === 'object', 'CSS should be an object');
  });

  // --- executeGetNodeBounds ---
  it('executeGetNodeBounds returns bounds for node', () => {
    const result = executeGetNodeBounds({ nodeId: 'email-input' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.nodeId, 'email-input');
    assert.strictEqual(typeof result.x, 'number');
    assert.strictEqual(typeof result.y, 'number');
    assert.strictEqual(typeof result.width, 'number');
    assert.strictEqual(typeof result.height, 'number');
  });
});

// ---------------------------------------------------------------------------
// P3: Analysis Executors (~1 test)
// ---------------------------------------------------------------------------
describe('Analysis Executors — P3 coverage', () => {
  it('executeDiffShow returns info for any diffId', () => {
    ctx = createContext(createMediumOP());
    const result = executeDiffShow({ diffId: 'nonexistent' }, ctx) as Record<string, unknown>;
    // executeDiffShow always returns a result (with a note), never an error
    assert.ok(result.diffId, 'Should return diffId');
    assert.strictEqual(result.diffId, 'nonexistent');
    assert.ok(result.currentDocumentName, 'Should return current document name');
  });
});

// ---------------------------------------------------------------------------
// P4: Vector Executors (~5 tests)
// ---------------------------------------------------------------------------
describe('Vector Executors — P4 coverage', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  // --- executeBooleanSubtract ---
  it('executeBooleanSubtract subtracts 2 shapes', () => {
    const result = executeBooleanSubtract({ nodeIds: ['email-input', 'password-input'] }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.operation, 'subtract');
    assert.ok(result.resultNodeId, 'Should return result node ID');
  });

  // --- executeBooleanIntersect ---
  it('executeBooleanIntersect intersects 2 shapes', () => {
    const result = executeBooleanIntersect({ nodeIds: ['email-input', 'password-input'] }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.operation, 'intersect');
    assert.ok(result.resultNodeId, 'Should return result node ID');
  });

  // --- executeBooleanExclude ---
  it('executeBooleanExclude excludes 2 shapes', () => {
    const result = executeBooleanExclude({ nodeIds: ['email-input', 'password-input'] }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.operation, 'exclude');
    assert.ok(result.resultNodeId, 'Should return result node ID');
  });

  // --- executePathSimplify ---
  it('executePathSimplify simplifies path on valid node', () => {
    const result = executePathSimplify({ nodeId: 'email-input' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.simplified, true);
  });

  // --- executeExportSvg ---
  it('executeExportSvg exports SVG for a node', () => {
    const result = executeExportSvg({ nodeId: 'login-card' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.format, 'svg');
    assert.ok(typeof result.content === 'string', 'Should return SVG content string');
    assert.ok((result.content as string).length > 0, 'SVG content should not be empty');
  });
});
