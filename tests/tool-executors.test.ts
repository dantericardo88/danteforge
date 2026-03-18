// Tool Executors — integration tests for real (non-stub) OpenPencil executors
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createMediumOP, createComplexOP } from './helpers/mock-op.js';
import { createContext } from '../src/harvested/openpencil/tool-context.js';
import type { ToolContext } from '../src/harvested/openpencil/tool-context.js';

// Read executors
import { executeGetSelection, executeGetNode, executeFindNodes, executeListFonts, executeGetStyles, executeGetDocumentInfo, executeGetNodeChildren } from '../src/harvested/openpencil/executors/read-executors.js';
// Create executors
import { executeCreateShape, executeCreateText, executeCreateFrame } from '../src/harvested/openpencil/executors/create-executors.js';
// Modify executors
import { executeSetFill, executeSetOpacity, executeSetSize, executeSetPadding, executeSetName } from '../src/harvested/openpencil/executors/modify-executors.js';
// Structure executors
import { executeCloneNode, executeGroupNodes, executeDeleteNode, executeAlignNodes } from '../src/harvested/openpencil/executors/structure-executors.js';
// Variable executors
import { executeCreateCollection, executeCreateVariable, executeBindVariable, executeListCollections } from '../src/harvested/openpencil/executors/variable-executors.js';
// Vector/export executors
import { executeExportCSS, executeExportJSX, executeExportTailwind, executeViewportZoomToFit } from '../src/harvested/openpencil/executors/vector-executors.js';
// Analysis executors
import { executeAnalyzeColors, executeAnalyzeTypography, executeAnalyzeSpacing } from '../src/harvested/openpencil/executors/analysis-executors.js';

let ctx: ToolContext;

describe('Read Executors', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeGetSelection returns empty when nothing selected', () => {
    const result = executeGetSelection({}, ctx) as { nodeIds: string[] };
    assert.deepStrictEqual(result.nodeIds, []);
  });

  it('executeGetSelection returns selected nodes', () => {
    ctx.selection = ['header', 'logo'];
    const result = executeGetSelection({}, ctx) as { nodeIds: string[]; nodes: { id: string }[] };
    assert.strictEqual(result.nodeIds.length, 2);
    assert.strictEqual(result.nodes.length, 2);
    assert.strictEqual(result.nodes[0].id, 'header');
  });

  it('executeGetNode returns full node data', () => {
    const result = executeGetNode({ nodeId: 'login-card' }, ctx) as Record<string, unknown>;
    assert.strictEqual(result.id, 'login-card');
    assert.strictEqual(result.type, 'frame');
    assert.strictEqual(result.name, 'Login Card');
    assert.strictEqual(result.childCount, 4);
  });

  it('executeGetNode returns error for missing node', () => {
    const result = executeGetNode({ nodeId: 'nonexistent' }, ctx) as { error: string };
    assert.ok(result.error.includes('not found'));
  });

  it('executeFindNodes searches by name', () => {
    const result = executeFindNodes({ query: 'input' }, ctx) as { count: number; nodes: { id: string }[] };
    assert.strictEqual(result.count, 2); // email-input, password-input
  });

  it('executeFindNodes filters by type', () => {
    const result = executeFindNodes({ query: '', type: 'text' }, ctx) as { count: number; nodes: { id: string }[] };
    assert.ok(result.count >= 3); // Logo, Title, Button Label
  });

  it('executeListFonts finds Inter usage', () => {
    const result = executeListFonts({}, ctx) as { fonts: { family: string; usageCount: number }[] };
    assert.ok(result.fonts.length > 0);
    const inter = result.fonts.find(f => f.family === 'Inter');
    assert.ok(inter, 'Should find Inter font');
    assert.ok(inter.usageCount >= 3);
  });

  it('executeGetStyles lists fill colors and stroke styles', () => {
    const result = executeGetStyles({}, ctx) as { fillColors: string[]; strokeStyles: string[] };
    assert.ok(result.fillColors.length > 0);
    assert.ok(result.fillColors.includes('#FFFFFF'));
    assert.ok(result.strokeStyles.length > 0);
  });

  it('executeGetDocumentInfo returns correct metadata', () => {
    const result = executeGetDocumentInfo({}, ctx) as Record<string, unknown>;
    assert.strictEqual(result.name, 'Login Page');
    assert.strictEqual(result.pageCount, 1);
    assert.ok((result.nodeCount as number) > 5);
  });

  it('executeGetNodeChildren lists children', () => {
    const result = executeGetNodeChildren({ nodeId: 'login-card' }, ctx) as { count: number; children: { id: string }[] };
    assert.strictEqual(result.count, 4);
    assert.strictEqual(result.children[0].id, 'title');
  });
});

describe('Create Executors', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeCreateShape adds a rectangle node', () => {
    const before = ctx.document.nodes.length;
    const result = executeCreateShape({ shape: 'rectangle', width: 200, height: 100 }, ctx) as { nodeId: string };
    assert.ok(result.nodeId);
    assert.strictEqual(ctx.document.nodes.length, before + 1);
    assert.ok(ctx.modified);
  });

  it('executeCreateText adds a text node', () => {
    const result = executeCreateText({ content: 'Hello World', fontSize: 18 }, ctx) as { nodeId: string };
    assert.ok(result.nodeId);
    const node = ctx.document.nodes.find(n => n.id === result.nodeId);
    assert.ok(node);
    assert.strictEqual(node.type, 'text');
    assert.strictEqual(node.characters, 'Hello World');
  });

  it('executeCreateFrame adds a frame with layout', () => {
    const result = executeCreateFrame({ name: 'Test Frame', layoutMode: 'horizontal' }, ctx) as { nodeId: string };
    assert.ok(result.nodeId);
    const node = ctx.document.nodes.find(n => n.id === result.nodeId);
    assert.ok(node);
    assert.strictEqual(node.layoutMode, 'horizontal');
  });
});

describe('Modify Executors', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeSetFill changes node fill color', () => {
    const result = executeSetFill({ nodeId: 'login-card', color: '#FF0000' }, ctx) as { updated: boolean };
    assert.strictEqual(result.updated, true);
    const node = ctx.document.nodes[0].children![1]; // login-card
    assert.strictEqual(node.fills![0].color, '#FF0000');
  });

  it('executeSetOpacity changes node opacity', () => {
    const result = executeSetOpacity({ nodeId: 'header', opacity: 0.5 }, ctx) as { updated: boolean };
    assert.strictEqual(result.updated, true);
  });

  it('executeSetSize changes width and height', () => {
    const result = executeSetSize({ nodeId: 'login-card', width: 500, height: 600 }, ctx) as { updated: boolean };
    assert.strictEqual(result.updated, true);
    const node = ctx.document.nodes[0].children![1];
    assert.strictEqual(node.width, 500);
    assert.strictEqual(node.height, 600);
  });

  it('executeSetPadding warns on non-4px grid', () => {
    const result = executeSetPadding({ nodeId: 'login-card', top: 13, right: 16, bottom: 16, left: 16 }, ctx) as { updated: boolean; warnings?: string[] };
    assert.strictEqual(result.updated, true);
    assert.ok(result.warnings);
    assert.ok(result.warnings.length > 0);
  });

  it('executeSetPadding succeeds cleanly on 4px grid', () => {
    const result = executeSetPadding({ nodeId: 'login-card', top: 24, right: 24, bottom: 24, left: 24 }, ctx) as { updated: boolean; warnings?: string[] };
    assert.strictEqual(result.updated, true);
    assert.ok(!result.warnings || result.warnings.length === 0);
  });

  it('executeSetName renames a node', () => {
    const result = executeSetName({ nodeId: 'header', name: 'NavBar' }, ctx) as { updated: boolean };
    assert.strictEqual(result.updated, true);
  });
});

describe('Structure Executors', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeDeleteNode removes a node', () => {
    const result = executeDeleteNode({ nodeId: 'logo' }, ctx) as { deleted: boolean };
    assert.strictEqual(result.deleted, true);
    assert.ok(ctx.modified);
  });

  it('executeDeleteNode returns error for missing node', () => {
    const result = executeDeleteNode({ nodeId: 'nonexistent' }, ctx) as { error: string };
    assert.ok(result.error);
  });

  it('executeCloneNode deep-copies with new IDs', () => {
    const result = executeCloneNode({ nodeId: 'submit-btn' }, ctx) as { cloneId: string; originalId: string };
    assert.ok(result.cloneId);
    assert.notStrictEqual(result.cloneId, 'submit-btn');
  });

  it('executeGroupNodes creates a group from multiple nodes', () => {
    // Add two root-level nodes to group
    ctx.document.nodes.push(
      { id: 'rect-a', type: 'rectangle', name: 'A', x: 0, y: 0, width: 50, height: 50 },
      { id: 'rect-b', type: 'rectangle', name: 'B', x: 60, y: 0, width: 50, height: 50 },
    );
    const result = executeGroupNodes({ nodeIds: ['rect-a', 'rect-b'] }, ctx) as { groupId: string };
    assert.ok(result.groupId);
    assert.ok(ctx.modified);
  });

  it('executeAlignNodes aligns to left', () => {
    ctx.document.nodes.push(
      { id: 'a1', type: 'rectangle', name: 'A', x: 10, y: 0, width: 50, height: 50 },
      { id: 'a2', type: 'rectangle', name: 'B', x: 100, y: 0, width: 50, height: 50 },
    );
    const result = executeAlignNodes({ nodeIds: ['a1', 'a2'], alignment: 'left' }, ctx) as { aligned: boolean };
    assert.strictEqual(result.aligned, true);
  });
});

describe('Variable Executors', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeListCollections returns existing collections', () => {
    const result = executeListCollections({}, ctx) as { collections: { id: string; name: string }[] };
    assert.ok(result.collections.length >= 2); // Colors + Spacing from fixture
  });

  it('executeCreateCollection adds a new collection', () => {
    const result = executeCreateCollection({ name: 'Sizes' }, ctx) as { collectionId: string };
    assert.ok(result.collectionId);
  });

  it('executeCreateVariable adds a variable to a collection', () => {
    const result = executeCreateVariable({ collectionId: 'colors', name: 'accent', type: 'color', value: '#10B981' }, ctx) as { variableId: string };
    assert.ok(result.variableId);
  });

  it('executeBindVariable binds a variable to a node property', () => {
    const result = executeBindVariable({ nodeId: 'login-card', variableId: 'var-primary', property: 'fills[0].color' }, ctx) as { bound: boolean };
    assert.strictEqual(result.bound, true);
  });
});

describe('Vector & Export Executors', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeViewportZoomToFit returns bounding viewport', () => {
    const result = executeViewportZoomToFit({}, ctx) as { viewport: { x: number; y: number; width: number; height: number } };
    assert.ok(result.viewport);
    assert.ok(result.viewport.width > 0);
    assert.ok(result.viewport.height > 0);
  });

  it('executeExportCSS generates valid CSS', () => {
    const result = executeExportCSS({ nodeId: 'login-card' }, ctx) as { css: string };
    assert.ok(result.css);
    assert.ok(result.css.includes('width'));
    assert.ok(result.css.includes('border-radius'));
  });

  it('executeExportJSX generates a React component', () => {
    const result = executeExportJSX({ nodeId: 'login-card' }, ctx) as { jsx: string };
    assert.ok(result.jsx);
    assert.ok(result.jsx.includes('export function'));
    assert.ok(result.jsx.includes('LoginCard'));
  });

  it('executeExportTailwind generates utility classes', () => {
    const result = executeExportTailwind({ nodeId: 'login-card' }, ctx) as { classes: string };
    assert.ok(result.classes);
    assert.ok(result.classes.includes('w-[400px]'));
    assert.ok(result.classes.includes('rounded-[12px]'));
  });
});

describe('Analysis Executors', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeAnalyzeColors returns color palette', () => {
    const result = executeAnalyzeColors({}, ctx) as { totalUniqueColors: number; colors: unknown[] };
    assert.ok(result.totalUniqueColors > 0);
    assert.ok(result.colors.length > 0);
  });

  it('executeAnalyzeTypography returns font info', () => {
    const result = executeAnalyzeTypography({}, ctx) as { fonts: unknown[] };
    assert.ok(result.fonts.length > 0);
  });

  it('executeAnalyzeSpacing returns spacing stats', () => {
    const result = executeAnalyzeSpacing({}, ctx) as { spacing: unknown[] };
    assert.ok(result.spacing.length > 0);
  });
});
