import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeBooleanUnion,
  executeBooleanSubtract,
  executeBooleanIntersect,
  executeBooleanExclude,
  executePathScale,
  executePathSimplify,
  executeViewportZoomToFit,
  executeViewportZoomToNode,
  executeExportImage,
  executeExportSvg,
  executeExportCSS,
  executeExportJSX,
  executeExportTailwind,
  executeExportDesignTokens,
} from '../src/harvested/openpencil/executors/vector-executors.js';
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

describe('executeBooleanUnion', () => {
  it('returns error with fewer than 2 nodes', () => {
    const n1 = makeNode('n1', { x: 0, y: 0, width: 50, height: 50 });
    const ctx = createContext(makeDoc([n1]));
    const result = executeBooleanUnion({ nodeIds: ['n1'] }, ctx) as any;
    assert.ok('error' in result);
  });

  it('unions 2 nodes into a vector node', () => {
    const n1 = makeNode('n1', { x: 0, y: 0, width: 50, height: 50 });
    const n2 = makeNode('n2', { x: 60, y: 0, width: 50, height: 50 });
    const ctx = createContext(makeDoc([n1, n2]));
    const result = executeBooleanUnion({ nodeIds: ['n1', 'n2'] }, ctx) as any;
    assert.equal(result.operation, 'union');
    assert.ok(typeof result.resultNodeId === 'string');
  });
});

describe('executeBooleanSubtract / Intersect / Exclude', () => {
  it('subtract returns error for single node', () => {
    const ctx = createContext(makeDoc([makeNode('n1')]));
    const result = executeBooleanSubtract({ nodeIds: ['n1'] }, ctx) as any;
    assert.ok('error' in result);
  });

  it('intersect succeeds with 2 nodes', () => {
    const n1 = makeNode('n1', { x: 0, y: 0, width: 50, height: 50 });
    const n2 = makeNode('n2', { x: 10, y: 10, width: 50, height: 50 });
    const ctx = createContext(makeDoc([n1, n2]));
    const result = executeBooleanIntersect({ nodeIds: ['n1', 'n2'] }, ctx) as any;
    assert.equal(result.operation, 'intersect');
  });

  it('exclude succeeds with 2 nodes', () => {
    const n1 = makeNode('n1', { x: 0, y: 0, width: 50, height: 50 });
    const n2 = makeNode('n2', { x: 10, y: 10, width: 50, height: 50 });
    const ctx = createContext(makeDoc([n1, n2]));
    const result = executeBooleanExclude({ nodeIds: ['n1', 'n2'] }, ctx) as any;
    assert.equal(result.operation, 'exclude');
  });
});

describe('executePathScale', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executePathScale({ nodeId: 'ghost', scaleX: 2, scaleY: 2 }, ctx) as any;
    assert.ok('error' in result);
  });

  it('scales a node by X and Y factors', () => {
    const node = makeNode('n1', { width: 100, height: 50 });
    const ctx = createContext(makeDoc([node]));
    const result = executePathScale({ nodeId: 'n1', scaleX: 2, scaleY: 3 }, ctx) as any;
    assert.equal(result.scaled, true);
    assert.equal(result.newWidth, 200);
    assert.equal(result.newHeight, 150);
  });
});

describe('executePathSimplify', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executePathSimplify({ nodeId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns simplified: true for valid node (no-op in headless)', () => {
    const node = makeNode('n1');
    const ctx = createContext(makeDoc([node]));
    const result = executePathSimplify({ nodeId: 'n1' }, ctx) as any;
    assert.equal(result.simplified, true);
  });
});

describe('executeViewportZoomToFit', () => {
  it('returns default viewport for empty doc', () => {
    const ctx = createContext(makeDoc());
    const result = executeViewportZoomToFit({}, ctx) as any;
    assert.deepEqual(result.viewport, { x: 0, y: 0, width: 100, height: 100 });
  });

  it('returns bounding box of all nodes', () => {
    const n1 = makeNode('n1', { x: 10, y: 20, width: 50, height: 60 });
    const ctx = createContext(makeDoc([n1]));
    const result = executeViewportZoomToFit({}, ctx) as any;
    assert.equal(result.viewport.x, 10);
    assert.equal(result.viewport.y, 20);
    assert.equal(result.viewport.width, 50);
    assert.equal(result.viewport.height, 60);
  });
});

describe('executeViewportZoomToNode', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeViewportZoomToNode({ nodeId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns node bounds as viewport', () => {
    const node = makeNode('n1', { x: 5, y: 10, width: 200, height: 100 });
    const ctx = createContext(makeDoc([node]));
    const result = executeViewportZoomToNode({ nodeId: 'n1' }, ctx) as any;
    assert.equal(result.viewport.x, 5);
    assert.equal(result.viewport.y, 10);
    assert.equal(result.viewport.width, 200);
    assert.equal(result.viewport.height, 100);
  });
});

describe('executeExportImage', () => {
  it('returns SVG content for svg format', () => {
    const ctx = createContext(makeDoc());
    const result = executeExportImage({ format: 'svg' }, ctx) as any;
    assert.equal(result.format, 'svg');
    assert.ok(typeof result.content === 'string');
  });

  it('falls back to SVG for png format', () => {
    const ctx = createContext(makeDoc());
    const result = executeExportImage({ format: 'png' }, ctx) as any;
    assert.equal(result.format, 'svg-fallback');
    assert.ok(result.note.includes('PNG'));
  });
});

describe('executeExportSvg', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeExportSvg({ nodeId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns SVG content for a valid node', () => {
    const node = makeNode('n1', { width: 100, height: 50 });
    const ctx = createContext(makeDoc([node]));
    const result = executeExportSvg({ nodeId: 'n1' }, ctx) as any;
    assert.equal(result.format, 'svg');
    assert.ok(typeof result.content === 'string');
  });
});

describe('executeExportCSS', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeExportCSS({ nodeId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('generates CSS with width and height', () => {
    const node = makeNode('my-box', { width: 200, height: 100 });
    const ctx = createContext(makeDoc([node]));
    const result = executeExportCSS({ nodeId: 'my-box' }, ctx) as any;
    assert.ok(result.css.includes('width: 200px'));
    assert.ok(result.css.includes('height: 100px'));
  });
});

describe('executeExportJSX', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeExportJSX({ nodeId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('generates JSX component', () => {
    const node = makeNode('my-card', { width: 200, height: 100 });
    const ctx = createContext(makeDoc([node]));
    const result = executeExportJSX({ nodeId: 'my-card' }, ctx) as any;
    assert.ok(result.jsx.includes('export function'));
    assert.equal(result.framework, 'react');
  });
});

describe('executeExportTailwind', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeExportTailwind({ nodeId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('generates tailwind classes for sized node', () => {
    const node = makeNode('n1', { width: 100, height: 50, layoutMode: 'horizontal', layoutGap: 8 });
    const ctx = createContext(makeDoc([node]));
    const result = executeExportTailwind({ nodeId: 'n1' }, ctx) as any;
    assert.ok(result.classes.includes('w-[100px]'));
    assert.ok(result.classes.includes('flex'));
  });
});

describe('executeExportDesignTokens', () => {
  it('returns CSS tokens by default', () => {
    const ctx = createContext(makeDoc());
    const result = executeExportDesignTokens({}, ctx) as any;
    assert.equal(result.format, 'css');
    assert.ok(typeof result.content === 'string');
  });

  it('returns JSON tokens for json format', () => {
    const ctx = createContext(makeDoc());
    const result = executeExportDesignTokens({ format: 'json' }, ctx) as any;
    assert.equal(result.format, 'json');
    const parsed = JSON.parse(result.content);
    assert.ok('colors' in parsed || typeof parsed === 'object');
  });

  it('returns tailwind config for tailwind format', () => {
    const ctx = createContext(makeDoc());
    const result = executeExportDesignTokens({ format: 'tailwind' }, ctx) as any;
    assert.equal(result.format, 'tailwind');
  });

  it('returns scss for scss format', () => {
    const ctx = createContext(makeDoc());
    const result = executeExportDesignTokens({ format: 'scss' }, ctx) as any;
    assert.equal(result.format, 'scss');
  });
});
