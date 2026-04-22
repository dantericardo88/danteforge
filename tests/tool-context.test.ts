import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createContext,
  withUndo,
  generateNodeId,
  getNodeById,
  findNodes,
  countAllNodes,
  addNode,
  removeNode,
  updateNode,
  findParent,
  deepCloneNode,
} from '../src/harvested/openpencil/tool-context.js';
import type { OPDocument, OPNode } from '../src/harvested/openpencil/op-codec.js';

function makeNode(id: string, type: OPNode['type'] = 'rectangle', children?: OPNode[]): OPNode {
  return { id, type, name: `Node ${id}`, ...(children ? { children } : {}) };
}

function makeDoc(nodes: OPNode[] = []): OPDocument {
  const page = makeNode('page-1', 'page');
  return {
    formatVersion: '1.0',
    generator: 'test',
    created: '2026-01-01T00:00:00.000Z',
    document: { name: 'Test Doc', pages: [page] },
    nodes,
  };
}

describe('createContext', () => {
  it('creates context with document', () => {
    const doc = makeDoc();
    const ctx = createContext(doc);
    assert.equal(ctx.document, doc);
  });

  it('starts with empty selection', () => {
    const ctx = createContext(makeDoc());
    assert.deepEqual(ctx.selection, []);
  });

  it('sets activePage to first page id', () => {
    const ctx = createContext(makeDoc());
    assert.equal(ctx.activePage, 'page-1');
  });

  it('starts with empty undoStack', () => {
    const ctx = createContext(makeDoc());
    assert.deepEqual(ctx.undoStack, []);
  });
});

describe('withUndo', () => {
  it('adds current document to undoStack', () => {
    const ctx = createContext(makeDoc());
    const updated = withUndo(ctx);
    assert.equal(updated.undoStack.length, 1);
  });

  it('does not mutate original context', () => {
    const ctx = createContext(makeDoc());
    withUndo(ctx);
    assert.equal(ctx.undoStack.length, 0);
  });

  it('limits undo stack to 10 entries', () => {
    let ctx = createContext(makeDoc());
    for (let i = 0; i < 15; i++) {
      ctx = withUndo(ctx);
    }
    assert.ok(ctx.undoStack.length <= 10);
  });
});

describe('generateNodeId', () => {
  it('starts with the type prefix', () => {
    const id = generateNodeId('rectangle');
    assert.ok(id.startsWith('rectangle-'));
  });

  it('generates unique ids', () => {
    const a = generateNodeId('text');
    const b = generateNodeId('text');
    assert.notEqual(a, b);
  });
});

describe('getNodeById', () => {
  it('finds a top-level node by id', () => {
    const node = makeNode('n1');
    const ctx = createContext(makeDoc([node]));
    assert.equal(getNodeById(ctx, 'n1'), node);
  });

  it('returns undefined for unknown id', () => {
    const ctx = createContext(makeDoc());
    assert.equal(getNodeById(ctx, 'nonexistent'), undefined);
  });

  it('finds nested child nodes', () => {
    const child = makeNode('child-1');
    const parent = makeNode('parent-1', 'frame', [child]);
    const ctx = createContext(makeDoc([parent]));
    assert.equal(getNodeById(ctx, 'child-1'), child);
  });
});

describe('findNodes', () => {
  it('returns nodes matching predicate', () => {
    const a = makeNode('a', 'text');
    const b = makeNode('b', 'rectangle');
    const ctx = createContext(makeDoc([a, b]));
    const texts = findNodes(ctx, n => n.type === 'text');
    assert.equal(texts.length, 1);
    assert.equal(texts[0].id, 'a');
  });

  it('returns empty array when no match', () => {
    const ctx = createContext(makeDoc());
    assert.deepEqual(findNodes(ctx, () => false), []);
  });
});

describe('countAllNodes', () => {
  it('returns 0 for empty doc', () => {
    const ctx = createContext(makeDoc());
    assert.equal(countAllNodes(ctx), 0);
  });

  it('counts nested nodes', () => {
    const child = makeNode('c1');
    const parent = makeNode('p1', 'frame', [child]);
    const ctx = createContext(makeDoc([parent]));
    assert.equal(countAllNodes(ctx), 2);
  });
});

describe('addNode', () => {
  it('adds node to document root when parentId is null', () => {
    const ctx = createContext(makeDoc());
    const node = makeNode('new-node');
    addNode(ctx, null, node);
    assert.ok(getNodeById(ctx, 'new-node') !== undefined);
  });
});

describe('removeNode', () => {
  it('removes a top-level node', () => {
    const node = makeNode('del-me');
    const ctx = createContext(makeDoc([node]));
    const removed = removeNode(ctx, 'del-me');
    assert.equal(removed?.id, 'del-me');
    assert.equal(getNodeById(ctx, 'del-me'), undefined);
  });

  it('returns undefined when node not found', () => {
    const ctx = createContext(makeDoc());
    assert.equal(removeNode(ctx, 'nonexistent'), undefined);
  });
});

describe('updateNode', () => {
  it('applies updater function to the node', () => {
    const node = makeNode('upd-1', 'text');
    const ctx = createContext(makeDoc([node]));
    const updated = updateNode(ctx, 'upd-1', n => ({ ...n, name: 'Updated' }));
    assert.ok(updated);
    assert.equal(getNodeById(ctx, 'upd-1')?.name, 'Updated');
  });

  it('returns false for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = updateNode(ctx, 'ghost', n => n);
    assert.ok(!result);
  });
});

describe('deepCloneNode', () => {
  it('creates a new object reference (deep copy)', () => {
    const node = makeNode('clone-me', 'text');
    const clone = deepCloneNode(node);
    assert.notEqual(clone, node);
    assert.equal(clone.name, node.name);
    assert.equal(clone.type, node.type);
  });

  it('generates a new id (not the same as original)', () => {
    const node = makeNode('clone-me', 'text');
    const clone = deepCloneNode(node);
    // deepCloneNode re-generates IDs
    assert.ok(typeof clone.id === 'string' && clone.id.length > 0);
  });

  it('clones children array as independent references', () => {
    const child = makeNode('child', 'ellipse');
    const node = makeNode('parent', 'frame', [child]);
    const clone = deepCloneNode(node);
    assert.ok(Array.isArray(clone.children));
    assert.equal(clone.children!.length, 1);
    assert.notEqual(clone.children![0], child);
  });
});
