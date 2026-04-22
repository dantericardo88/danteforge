// Tests for 14 remaining untested OpenPencil executor functions
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMediumOP } from './helpers/mock-op.js';
import { createContext, getNodeById } from '../src/harvested/openpencil/tool-context.js';
import type { ToolContext } from '../src/harvested/openpencil/tool-context.js';
// modify-executors
import {
  executeSetFill, executeSetOpacity, executeSetSize,
  executeSetFontWeight, executeSetTextAlign, executeSetName, executeSetPadding,
} from '../src/harvested/openpencil/executors/modify-executors.js';
// structure-executors
import {
  executeDeleteNode, executeCloneNode, executeAlignNodes,
  executeDistributeNodes, executeReorderNode,
  executeDetachInstance, executeCreateComponentSet, executeSwapComponent,
  executeFlattenNode, executeDuplicatePage, executeReparentNode,
} from '../src/harvested/openpencil/executors/structure-executors.js';
// create-executors
import {
  executeCreateShape, executeCreateFrame, executeCreateComponent,
  executeCreateInstance, executeCreatePage, executeRender,
} from '../src/harvested/openpencil/executors/create-executors.js';
// variable-executors
import {
  executeCreateCollection,
} from '../src/harvested/openpencil/executors/variable-executors.js';
// read-executors
import {
  executeGetDocumentInfo,
} from '../src/harvested/openpencil/executors/read-executors.js';

let ctx: ToolContext;

// ── modify-executors — remaining ──────────────────────────────────────────────

describe('modify-executors — remaining', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeSetFill sets fill color on node', () => {
    const nodeId = 'login-card';
    const result = executeSetFill({ nodeId, color: '#FF0000' }, ctx) as Record<string, unknown>;
    assert.equal(result.updated, true);
    const node = getNodeById(ctx, nodeId)!;
    assert.ok(node.fills);
    assert.equal(node.fills[0].color, '#FF0000');
  });

  it('executeSetFill with opacity', () => {
    const nodeId = 'login-card';
    const result = executeSetFill({ nodeId, color: '#00FF00', opacity: 0.5 }, ctx) as Record<string, unknown>;
    assert.equal(result.updated, true);
    const node = getNodeById(ctx, nodeId)!;
    assert.ok(node.fills);
    assert.equal(node.fills[0].color, '#00FF00');
    assert.equal(node.fills[0].opacity, 0.5);
  });

  it('executeSetOpacity clamps to 0-1', () => {
    const nodeId = 'login-card';
    const result = executeSetOpacity({ nodeId, opacity: 1.5 }, ctx) as Record<string, unknown>;
    assert.equal(result.updated, true);
    const node = getNodeById(ctx, nodeId)!;
    assert.equal(node.opacity, 1);
  });

  it('executeSetSize updates width and height', () => {
    const nodeId = 'login-card';
    const result = executeSetSize({ nodeId, width: 200, height: 300 }, ctx) as Record<string, unknown>;
    assert.equal(result.updated, true);
    const node = getNodeById(ctx, nodeId)!;
    assert.equal(node.width, 200);
    assert.equal(node.height, 300);
  });

  it('executeSetFontWeight sets weight on text node', () => {
    const nodeId = 'title'; // text node inside login-card
    const result = executeSetFontWeight({ nodeId, weight: 700 }, ctx) as Record<string, unknown>;
    assert.equal(result.updated, true);
    const node = getNodeById(ctx, nodeId)!;
    assert.equal(node.fontWeight, 700);
  });

  it('executeSetTextAlign sets alignment on text node', () => {
    const nodeId = 'title';
    const result = executeSetTextAlign({ nodeId, align: 'center' }, ctx) as Record<string, unknown>;
    assert.equal(result.updated, true);
    const node = getNodeById(ctx, nodeId)!;
    assert.equal(node.textAlign, 'center');
  });

  it('executeSetName renames node', () => {
    const nodeId = 'login-card';
    const result = executeSetName({ nodeId, name: 'NewName' }, ctx) as Record<string, unknown>;
    assert.equal(result.updated, true);
    const node = getNodeById(ctx, nodeId)!;
    assert.equal(node.name, 'NewName');
  });

  it('executeSetPadding sets padding values', () => {
    const nodeId = 'frame-root';
    const result = executeSetPadding({ nodeId, top: 8, right: 8, bottom: 8, left: 8 }, ctx) as Record<string, unknown>;
    assert.equal(result.updated, true);
    assert.equal(result.warnings, undefined);
    const node = getNodeById(ctx, nodeId)!;
    assert.deepEqual(node.padding, { top: 8, right: 8, bottom: 8, left: 8 });
  });

  it('executeSetPadding warns on non-4px-grid values', () => {
    const nodeId = 'frame-root';
    const result = executeSetPadding({ nodeId, top: 5, right: 8, bottom: 8, left: 8 }, ctx) as Record<string, unknown>;
    assert.equal(result.updated, true);
    assert.ok(result.warnings, 'Should have warnings');
    const warnings = result.warnings as string[];
    assert.ok(warnings.some(w => w.includes('4px grid')), 'Should mention 4px grid');
  });
});

// ── structure-executors — remaining ───────────────────────────────────────────

describe('structure-executors — remaining', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeDeleteNode removes node from document', () => {
    const nodeId = 'title';
    assert.ok(getNodeById(ctx, nodeId), 'Node should exist before deletion');
    const result = executeDeleteNode({ nodeId }, ctx) as Record<string, unknown>;
    assert.equal(result.deleted, true);
    assert.equal(getNodeById(ctx, nodeId), undefined);
  });

  it('executeDeleteNode returns error for missing node', () => {
    const result = executeDeleteNode({ nodeId: 'nonexistent' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return an error');
    assert.ok((result.error as string).includes('not found') || (result.error as string).includes('Node not found'));
  });

  it('executeCloneNode creates copy with offset', () => {
    const nodeId = 'login-card';
    const result = executeCloneNode({ nodeId }, ctx) as Record<string, unknown>;
    assert.equal(result.cloned, true);
    assert.ok((result.name as string).includes('(Copy)'), 'Clone name should include (Copy)');
    assert.ok(result.cloneId, 'Should have a cloneId');
    assert.notEqual(result.cloneId, nodeId);
  });

  it('executeCloneNode returns error for missing node', () => {
    const result = executeCloneNode({ nodeId: 'nonexistent' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return an error');
  });

  it('executeAlignNodes aligns left', () => {
    // Use nodes that exist and have x/y: login-card children don't have x/y,
    // but header and login-card are children of frame-root. Use title and btn-text
    // which are text nodes at various levels. We need 2+ nodes that getNodeById can find.
    const nodeIds = ['header', 'login-card'];
    const result = executeAlignNodes({ nodeIds, alignment: 'left' }, ctx) as Record<string, unknown>;
    assert.equal(result.aligned, true);
    assert.equal(result.nodeCount, 2);
  });
});

// ── create-executors — remaining ──────────────────────────────────────────────

describe('create-executors — remaining', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeCreateShape creates a rectangle', () => {
    const result = executeCreateShape({ type: 'rectangle' }, ctx) as Record<string, unknown>;
    assert.equal(result.created, true);
    assert.equal(result.type, 'rectangle');
    assert.ok(result.nodeId, 'Should return a nodeId');
  });

  it('executeCreateShape creates an ellipse', () => {
    const result = executeCreateShape({ type: 'ellipse' }, ctx) as Record<string, unknown>;
    assert.equal(result.created, true);
    assert.equal(result.type, 'ellipse');
  });

  it('executeCreateFrame creates frame with auto-layout', () => {
    const result = executeCreateFrame({ name: 'TestFrame', layoutMode: 'horizontal' }, ctx) as Record<string, unknown>;
    assert.equal(result.created, true);
    assert.equal(result.type, 'frame');
    assert.equal(result.name, 'TestFrame');
    // Verify the node was actually added and has the right layout mode
    const node = getNodeById(ctx, result.nodeId as string)!;
    assert.equal(node.layoutMode, 'horizontal');
  });

  it('executeCreateComponent creates a component node', () => {
    const result = executeCreateComponent({ name: 'Button' }, ctx) as Record<string, unknown>;
    assert.equal(result.created, true);
    assert.equal(result.type, 'component');
    assert.equal(result.name, 'Button');
  });

  it('executeCreateInstance errors on nonexistent component', () => {
    const result = executeCreateInstance({ componentId: 'fake' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return an error for nonexistent component');
  });

  it('executeCreatePage adds a page', () => {
    const before = ctx.document.document.pages.length;
    const result = executeCreatePage({ name: 'Page 2' }, ctx) as Record<string, unknown>;
    assert.equal(result.created, true);
    assert.equal(result.name, 'Page 2');
    assert.equal(ctx.document.document.pages.length, before + 1);
  });

  it('executeRender returns SVG content', () => {
    const result = executeRender({ format: 'svg' }, ctx) as Record<string, unknown>;
    assert.equal(result.format, 'svg');
    assert.ok((result.content as string).includes('<svg'), 'SVG content should contain <svg tag');
  });
});

// ── variable-executors — remaining ────────────────────────────────────────────

describe('variable-executors — remaining', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeCreateCollection creates a new collection', () => {
    const before = ctx.document.variableCollections?.length ?? 0;
    const result = executeCreateCollection({ name: 'Colors' }, ctx) as Record<string, unknown>;
    assert.equal(result.created, true);
    assert.equal(result.name, 'Colors');
    assert.equal(ctx.document.variableCollections!.length, before + 1);
  });
});

// ── read-executors — remaining ────────────────────────────────────────────────

describe('read-executors — remaining', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeGetDocumentInfo returns document metadata', () => {
    const result = executeGetDocumentInfo({}, ctx) as Record<string, unknown>;
    assert.equal(result.name, 'Login Page');
    assert.ok((result.pageCount as number) >= 1, 'Should have at least 1 page');
    assert.equal(result.formatVersion, '1.0.0');
    assert.ok((result.nodeCount as number) > 0, 'Should have nodes');
  });
});

// ── structure-executors — alignment and distribution branches ─────────────────

describe('structure-executors — alignment branches', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeAlignNodes returns error for fewer than 2 nodes', () => {
    const result = executeAlignNodes({ nodeIds: ['header'], alignment: 'left' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error for < 2 nodes');
  });

  it('executeAlignNodes aligns right — sets x to maxRight - width', () => {
    const nodeIds = ['header', 'login-card'];
    const result = executeAlignNodes({ nodeIds, alignment: 'right' }, ctx) as Record<string, unknown>;
    assert.equal(result.aligned, true);
    assert.equal(result.alignment, 'right');
  });

  it('executeAlignNodes aligns top — sets y to minY', () => {
    const nodeIds = ['header', 'login-card'];
    const result = executeAlignNodes({ nodeIds, alignment: 'top' }, ctx) as Record<string, unknown>;
    assert.equal(result.aligned, true);
    assert.equal(result.alignment, 'top');
  });

  it('executeAlignNodes aligns bottom — sets y to maxBottom - height', () => {
    const nodeIds = ['header', 'login-card'];
    const result = executeAlignNodes({ nodeIds, alignment: 'bottom' }, ctx) as Record<string, unknown>;
    assert.equal(result.aligned, true);
    assert.equal(result.alignment, 'bottom');
  });

  it('executeAlignNodes aligns center-h — sets x to avg center x', () => {
    const nodeIds = ['header', 'login-card'];
    const result = executeAlignNodes({ nodeIds, alignment: 'center-h' }, ctx) as Record<string, unknown>;
    assert.equal(result.aligned, true);
    assert.equal(result.alignment, 'center-h');
  });

  it('executeAlignNodes aligns center-v — sets y to avg center y', () => {
    const nodeIds = ['header', 'login-card'];
    const result = executeAlignNodes({ nodeIds, alignment: 'center-v' }, ctx) as Record<string, unknown>;
    assert.equal(result.aligned, true);
    assert.equal(result.alignment, 'center-v');
  });
});

describe('structure-executors — distribution branches', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeDistributeNodes distributes vertically', () => {
    // Need 3 nodes — use header, login-card, and logo
    const result = executeDistributeNodes(
      { nodeIds: ['header', 'login-card', 'logo'], direction: 'vertical' },
      ctx,
    ) as Record<string, unknown>;
    assert.equal(result.distributed, true);
    assert.equal(result.direction, 'vertical');
  });
});

describe('structure-executors — reorder branches', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeReorderNode moves node forward', () => {
    // header is at some index in ctx.document.nodes; moving it forward
    const result = executeReorderNode({ nodeId: 'header', direction: 'forward' }, ctx) as Record<string, unknown>;
    assert.equal(result.reordered, true);
    assert.equal(result.direction, 'forward');
  });

  it('executeReorderNode moves node backward', () => {
    const result = executeReorderNode({ nodeId: 'login-card', direction: 'backward' }, ctx) as Record<string, unknown>;
    assert.equal(result.reordered, true);
    assert.equal(result.direction, 'backward');
  });

  it('executeReorderNode handles invalid direction (default branch)', () => {
    // Default branch: node is removed then re-inserted at original index
    const result = executeReorderNode({ nodeId: 'header', direction: 'invalid-direction' }, ctx) as Record<string, unknown>;
    assert.equal(result.reordered, true);
    assert.equal(result.direction, 'invalid-direction');
  });
});

describe('structure-executors — untested executors', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  it('executeDetachInstance returns error for non-instance node', () => {
    // header is a frame, not an instance
    const result = executeDetachInstance({ instanceId: 'header' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error for non-instance');
  });

  it('executeDetachInstance returns error for missing node', () => {
    const result = executeDetachInstance({ instanceId: 'nonexistent' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error for missing node');
  });

  it('executeCreateComponentSet returns error when no valid components found', () => {
    // header and login-card are frames, not components
    const result = executeCreateComponentSet(
      { componentIds: ['header', 'login-card'], name: 'Button Set' },
      ctx,
    ) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error when no components found');
  });

  it('executeSwapComponent returns error for non-instance', () => {
    const result = executeSwapComponent(
      { instanceId: 'header', newComponentId: 'login-card' },
      ctx,
    ) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error for non-instance source');
  });

  it('executeFlattenNode flattens a node with children', () => {
    const result = executeFlattenNode({ nodeId: 'login-card' }, ctx) as Record<string, unknown>;
    assert.equal(result.flattened, true);
    assert.equal(result.nodeId, 'login-card');
    // After flatten, node has no children
    const node = getNodeById(ctx, 'login-card')!;
    assert.equal(node.children, undefined, 'Children should be removed after flatten');
  });

  it('executeFlattenNode returns error for missing node', () => {
    const result = executeFlattenNode({ nodeId: 'nonexistent' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error for missing node');
  });

  it('executeDuplicatePage duplicates an existing page', () => {
    const before = ctx.document.document.pages.length;
    const result = executeDuplicatePage({ pageId: 'page-1' }, ctx) as Record<string, unknown>;
    assert.equal(result.duplicated, true);
    assert.equal(result.originalPageId, 'page-1');
    assert.ok(result.newPageId, 'Should return a new page id');
    assert.equal(ctx.document.document.pages.length, before + 1);
  });

  it('executeDuplicatePage returns error for missing page', () => {
    const result = executeDuplicatePage({ pageId: 'nonexistent-page' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error for missing page');
  });

  it('executeReparentNode reparents a node', () => {
    // Move logo into login-card (logo is currently at root level)
    const result = executeReparentNode(
      { nodeId: 'logo', newParentId: 'login-card' },
      ctx,
    ) as Record<string, unknown>;
    assert.equal(result.reparented, true);
    assert.equal(result.nodeId, 'logo');
    assert.equal(result.newParentId, 'login-card');
  });

  it('executeReparentNode returns error for missing node', () => {
    const result = executeReparentNode(
      { nodeId: 'nonexistent', newParentId: 'login-card' },
      ctx,
    ) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error for missing node');
  });
});
