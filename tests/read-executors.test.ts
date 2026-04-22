import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeGetSelection,
  executeGetPageTree,
  executeGetNode,
  executeFindNodes,
  executeListFonts,
  executeGetStyles,
  executeGetPageList,
  executeGetNodeCSS,
  executeGetNodeBounds,
  executeGetDocumentInfo,
  executeGetNodeChildren,
} from '../src/harvested/openpencil/executors/read-executors.js';
import { createContext } from '../src/harvested/openpencil/tool-context.js';
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

describe('executeGetSelection', () => {
  it('returns empty selection for new context', () => {
    const ctx = createContext(makeDoc());
    const result = executeGetSelection({}, ctx) as any;
    assert.deepEqual(result.nodeIds, []);
    assert.deepEqual(result.nodes, []);
  });

  it('returns selected nodes', () => {
    const node = makeNode('n1');
    const ctx = createContext(makeDoc([node]));
    ctx.selection = ['n1'];
    const result = executeGetSelection({}, ctx) as any;
    assert.equal(result.nodeIds.length, 1);
    assert.equal(result.nodes[0].id, 'n1');
  });
});

describe('executeGetPageTree', () => {
  it('returns pages list when no pageId specified', () => {
    const ctx = createContext(makeDoc());
    const result = executeGetPageTree({}, ctx) as any;
    assert.ok(Array.isArray(result.pages));
    assert.equal(result.pages[0].id, 'page-1');
  });

  it('returns error for unknown pageId', () => {
    const ctx = createContext(makeDoc());
    const result = executeGetPageTree({ pageId: 'ghost-page' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns page summary for known pageId', () => {
    const ctx = createContext(makeDoc());
    const result = executeGetPageTree({ pageId: 'page-1' }, ctx) as any;
    assert.ok('id' in result || 'name' in result);
  });
});

describe('executeGetNode', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeGetNode({ nodeId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns node properties', () => {
    const node = makeNode('n1', { width: 100, height: 50 });
    const ctx = createContext(makeDoc([node]));
    const result = executeGetNode({ nodeId: 'n1' }, ctx) as any;
    assert.equal(result.id, 'n1');
    assert.equal(result.width, 100);
    assert.equal(result.childCount, 0);
  });
});

describe('executeFindNodes', () => {
  it('finds nodes matching query string', () => {
    const n1 = makeNode('n1', { name: 'Header Text' });
    const n2 = makeNode('n2', { name: 'Footer' });
    const ctx = createContext(makeDoc([n1, n2]));
    const result = executeFindNodes({ query: 'header' }, ctx) as any;
    assert.equal(result.count, 1);
    assert.equal(result.nodes[0].id, 'n1');
  });

  it('returns all nodes for empty query match', () => {
    const n1 = makeNode('n1');
    const ctx = createContext(makeDoc([n1]));
    const result = executeFindNodes({ query: 'node' }, ctx) as any;
    assert.equal(result.count, 1);
  });

  it('filters by type when typeFilter provided', () => {
    const r = makeNode('n1', { type: 'rectangle', name: 'rect node' });
    const t = makeNode('n2', { type: 'text', name: 'text node' });
    const ctx = createContext(makeDoc([r, t]));
    const result = executeFindNodes({ query: 'node', type: 'text' }, ctx) as any;
    assert.equal(result.count, 1);
    assert.equal(result.nodes[0].id, 'n2');
  });
});

describe('executeListFonts', () => {
  it('returns empty fonts list for non-text doc', () => {
    const ctx = createContext(makeDoc());
    const result = executeListFonts({}, ctx) as any;
    assert.deepEqual(result.fonts, []);
  });

  it('lists fonts from text nodes', () => {
    const text = makeNode('t1', { type: 'text', fontFamily: 'Inter', fontSize: 16 });
    const ctx = createContext(makeDoc([text]));
    const result = executeListFonts({}, ctx) as any;
    assert.equal(result.fonts.length, 1);
    assert.equal(result.fonts[0].family, 'Inter');
    assert.equal(result.fonts[0].usageCount, 1);
  });
});

describe('executeGetStyles', () => {
  it('returns empty style sets for empty doc', () => {
    const ctx = createContext(makeDoc());
    const result = executeGetStyles({}, ctx) as any;
    assert.deepEqual(result.fillColors, []);
    assert.deepEqual(result.strokeStyles, []);
  });

  it('extracts fill colors', () => {
    const node = makeNode('n1', { fills: [{ type: 'solid', color: '#FF0000', opacity: 1 }] });
    const ctx = createContext(makeDoc([node]));
    const result = executeGetStyles({}, ctx) as any;
    assert.ok(result.fillColors.includes('#FF0000'));
  });
});

describe('executeGetPageList', () => {
  it('returns all pages', () => {
    const ctx = createContext(makeDoc());
    const result = executeGetPageList({}, ctx) as any;
    assert.equal(result.pages.length, 1);
    assert.equal(result.pages[0].id, 'page-1');
    assert.equal(result.pages[0].name, 'Page 1');
  });
});

describe('executeGetNodeCSS', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeGetNodeCSS({ nodeId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns CSS properties for a node', () => {
    const node = makeNode('n1', { width: 200, height: 100 });
    const ctx = createContext(makeDoc([node]));
    const result = executeGetNodeCSS({ nodeId: 'n1' }, ctx) as any;
    assert.equal(result.css.width, '200px');
    assert.equal(result.css.height, '100px');
  });
});

describe('executeGetNodeBounds', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeGetNodeBounds({ nodeId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns node bounds', () => {
    const node = makeNode('n1', { x: 10, y: 20, width: 100, height: 50 });
    const ctx = createContext(makeDoc([node]));
    const result = executeGetNodeBounds({ nodeId: 'n1' }, ctx) as any;
    assert.equal(result.x, 10);
    assert.equal(result.y, 20);
    assert.equal(result.width, 100);
    assert.equal(result.height, 50);
  });
});

describe('executeGetDocumentInfo', () => {
  it('returns document name and stats', () => {
    const node = makeNode('n1');
    const ctx = createContext(makeDoc([node]));
    const result = executeGetDocumentInfo({}, ctx) as any;
    assert.equal(result.name, 'Test Doc');
    assert.ok(typeof result.nodeCount === 'number');
    assert.equal(result.nodeCount, 1);
  });
});

describe('executeGetNodeChildren', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeGetNodeChildren({ nodeId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns children of a node', () => {
    const child = makeNode('c1');
    const parent: OPNode = { id: 'p1', type: 'frame', name: 'Frame', children: [child] };
    const ctx = createContext(makeDoc([parent]));
    const result = executeGetNodeChildren({ nodeId: 'p1' }, ctx) as any;
    assert.equal(result.count, 1);
    assert.equal(result.children[0].id, 'c1');
  });

  it('returns empty children for leaf node', () => {
    const node = makeNode('n1');
    const ctx = createContext(makeDoc([node]));
    const result = executeGetNodeChildren({ nodeId: 'n1' }, ctx) as any;
    assert.equal(result.count, 0);
    assert.deepEqual(result.children, []);
  });
});
