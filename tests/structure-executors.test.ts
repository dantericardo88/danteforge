import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeDeleteNode,
  executeCloneNode,
  executeGroupNodes,
  executeUngroupNodes,
  executeReparentNode,
  executeFlattenNode,
  executeDuplicatePage,
  executeReorderNode,
  executeAlignNodes,
} from '../src/harvested/openpencil/executors/structure-executors.js';
import { createContext, getNodeById } from '../src/harvested/openpencil/tool-context.js';
import type { OPDocument, OPNode } from '../src/harvested/openpencil/op-codec.js';

function makeNode(id: string, overrides: Partial<OPNode> = {}): OPNode {
  return { id, type: 'rectangle', name: `Node ${id}`, ...overrides };
}

function makeDoc(nodes: OPNode[] = []): OPDocument {
  return {
    formatVersion: '1.0',
    generator: 'test',
    created: '2026-01-01T00:00:00.000Z',
    document: { name: 'Test Doc', pages: [{ id: 'page-1', type: 'page', name: 'Page 1' }] },
    nodes,
  };
}

describe('executeDeleteNode', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeDeleteNode({ nodeId: 'nonexistent' }, ctx) as any;
    assert.ok('error' in result);
    assert.ok(result.error.includes('nonexistent'));
  });

  it('removes a node and returns metadata', () => {
    const node = makeNode('del-1');
    const ctx = createContext(makeDoc([node]));
    const result = executeDeleteNode({ nodeId: 'del-1' }, ctx) as any;
    assert.equal(result.deleted, true);
    assert.equal(result.nodeId, 'del-1');
    assert.equal(getNodeById(ctx, 'del-1'), undefined);
  });

  it('marks context as modified', () => {
    const node = makeNode('del-2');
    const ctx = createContext(makeDoc([node]));
    executeDeleteNode({ nodeId: 'del-2' }, ctx);
    assert.equal(ctx.modified, true);
  });
});

describe('executeCloneNode', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeCloneNode({ nodeId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('clones a node with offset and "(Copy)" suffix', () => {
    const node = makeNode('orig', { x: 10, y: 20 });
    const ctx = createContext(makeDoc([node]));
    const result = executeCloneNode({ nodeId: 'orig' }, ctx) as any;
    assert.equal(result.cloned, true);
    assert.ok(result.name.includes('(Copy)'));
    const clone = getNodeById(ctx, result.cloneId) as any;
    assert.ok(clone);
    assert.equal(clone.x, 30); // 10 + 20
    assert.equal(clone.y, 40); // 20 + 20
  });
});

describe('executeGroupNodes', () => {
  it('returns error when no valid nodes found', () => {
    const ctx = createContext(makeDoc());
    const result = executeGroupNodes({ nodeIds: ['ghost-1', 'ghost-2'] }, ctx) as any;
    assert.ok('error' in result);
  });

  it('groups existing nodes into a group', () => {
    const n1 = makeNode('n1', { x: 0, y: 0, width: 100, height: 100 });
    const n2 = makeNode('n2', { x: 200, y: 0, width: 100, height: 100 });
    const ctx = createContext(makeDoc([n1, n2]));
    const result = executeGroupNodes({ nodeIds: ['n1', 'n2'], name: 'MyGroup' }, ctx) as any;
    assert.equal(result.grouped, true);
    assert.equal(result.childCount, 2);
    const group = getNodeById(ctx, result.groupId) as any;
    assert.equal(group.type, 'group');
    assert.equal(group.name, 'MyGroup');
  });
});

describe('executeUngroupNodes', () => {
  it('returns error for unknown group', () => {
    const ctx = createContext(makeDoc());
    const result = executeUngroupNodes({ groupId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns error when node is not a group', () => {
    const node = makeNode('not-group');
    const ctx = createContext(makeDoc([node]));
    const result = executeUngroupNodes({ groupId: 'not-group' }, ctx) as any;
    assert.ok('error' in result);
    assert.ok(result.error.includes('not a group'));
  });

  it('ungroups a group and returns children to parent', () => {
    const child = makeNode('child-1');
    const group: OPNode = { id: 'grp', type: 'group', name: 'Grp', children: [child] };
    const ctx = createContext(makeDoc([group]));
    const result = executeUngroupNodes({ groupId: 'grp' }, ctx) as any;
    assert.equal(result.ungrouped, true);
    assert.equal(result.childCount, 1);
  });
});

describe('executeReparentNode', () => {
  it('returns error when node not found', () => {
    const ctx = createContext(makeDoc());
    const result = executeReparentNode({ nodeId: 'ghost', newParentId: null }, ctx) as any;
    assert.ok('error' in result);
  });

  it('reparents a node to a new parent', () => {
    const frame: OPNode = { id: 'frame-1', type: 'frame', name: 'Frame', children: [] };
    const node = makeNode('node-1');
    const ctx = createContext(makeDoc([frame, node]));
    const result = executeReparentNode({ nodeId: 'node-1', newParentId: 'frame-1' }, ctx) as any;
    assert.equal(result.reparented, true);
    assert.equal(result.newParentId, 'frame-1');
  });
});

describe('executeFlattenNode', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeFlattenNode({ nodeId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('flattens a node to vector type', () => {
    const child = makeNode('c1');
    const parent: OPNode = { id: 'p1', type: 'frame', name: 'Frame', children: [child] };
    const ctx = createContext(makeDoc([parent]));
    const result = executeFlattenNode({ nodeId: 'p1' }, ctx) as any;
    assert.equal(result.flattened, true);
    assert.equal(result.nodeId, 'p1');
    assert.equal(result.childrenMerged, 1);
  });
});

describe('executeDuplicatePage', () => {
  it('returns error for unknown page', () => {
    const ctx = createContext(makeDoc());
    const result = executeDuplicatePage({ pageId: 'nonexistent-page' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('duplicates a page with "(Copy)" suffix', () => {
    const ctx = createContext(makeDoc());
    const result = executeDuplicatePage({ pageId: 'page-1' }, ctx) as any;
    assert.equal(result.duplicated, true);
    assert.equal(result.originalPageId, 'page-1');
    const pages = ctx.document.document.pages;
    assert.equal(pages.length, 2);
    assert.ok(pages[1].name.includes('Copy'));
  });

  it('duplicates with custom name', () => {
    const ctx = createContext(makeDoc());
    const result = executeDuplicatePage({ pageId: 'page-1', newName: 'Page 2' }, ctx) as any;
    assert.equal(result.duplicated, true);
    const newPage = ctx.document.document.pages.find(p => p.id === result.newPageId);
    assert.equal(newPage?.name, 'Page 2');
  });
});

describe('executeReorderNode', () => {
  it('returns error when node not found', () => {
    const ctx = createContext(makeDoc());
    const result = executeReorderNode({ nodeId: 'ghost', direction: 'front' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('moves node to front', () => {
    const n1 = makeNode('n1');
    const n2 = makeNode('n2');
    const ctx = createContext(makeDoc([n1, n2]));
    const result = executeReorderNode({ nodeId: 'n1', direction: 'front' }, ctx) as any;
    assert.equal(result.reordered, true);
    assert.equal(ctx.document.nodes[ctx.document.nodes.length - 1].id, 'n1');
  });

  it('moves node to back', () => {
    const n1 = makeNode('n1');
    const n2 = makeNode('n2');
    const ctx = createContext(makeDoc([n1, n2]));
    const result = executeReorderNode({ nodeId: 'n2', direction: 'back' }, ctx) as any;
    assert.equal(result.reordered, true);
    assert.equal(ctx.document.nodes[0].id, 'n2');
  });
});

describe('executeAlignNodes', () => {
  it('returns error when fewer than 2 nodes', () => {
    const ctx = createContext(makeDoc([makeNode('n1')]));
    const result = executeAlignNodes({ nodeIds: ['n1'], alignment: 'left' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('aligns nodes to left', () => {
    const n1 = makeNode('n1', { x: 100, y: 0, width: 50, height: 50 });
    const n2 = makeNode('n2', { x: 200, y: 0, width: 50, height: 50 });
    const ctx = createContext(makeDoc([n1, n2]));
    executeAlignNodes({ nodeIds: ['n1', 'n2'], alignment: 'left' }, ctx);
    const node1 = getNodeById(ctx, 'n1') as any;
    const node2 = getNodeById(ctx, 'n2') as any;
    assert.equal(node1.x, node2.x);
  });

  it('aligns nodes to top', () => {
    const n1 = makeNode('n1', { x: 0, y: 100, width: 50, height: 50 });
    const n2 = makeNode('n2', { x: 0, y: 200, width: 50, height: 50 });
    const ctx = createContext(makeDoc([n1, n2]));
    executeAlignNodes({ nodeIds: ['n1', 'n2'], alignment: 'top' }, ctx);
    const node1 = getNodeById(ctx, 'n1') as any;
    const node2 = getNodeById(ctx, 'n2') as any;
    assert.equal(node1.y, node2.y);
  });
});
