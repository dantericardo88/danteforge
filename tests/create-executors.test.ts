import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeCreateShape,
  executeCreateFrame,
  executeCreateText,
  executeCreateComponent,
  executeCreateInstance,
  executeCreatePage,
  executeRender,
} from '../src/harvested/openpencil/executors/create-executors.js';
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

describe('executeCreateShape', () => {
  it('creates a rectangle node', () => {
    const ctx = createContext(makeDoc());
    const result = executeCreateShape({ type: 'rectangle', name: 'MyRect', width: 200, height: 100 }, ctx) as any;
    assert.equal(result.created, true);
    assert.equal(result.type, 'rectangle');
    assert.equal(result.name, 'MyRect');
    assert.ok(typeof result.nodeId === 'string');
  });

  it('uses default dimensions when not provided', () => {
    const ctx = createContext(makeDoc());
    const result = executeCreateShape({ type: 'ellipse' }, ctx) as any;
    assert.equal(result.created, true);
    const node = ctx.document.nodes.find((n: OPNode) => n.id === result.nodeId) as OPNode;
    assert.equal(node.width, 100);
    assert.equal(node.height, 100);
  });

  it('adds node to document', () => {
    const ctx = createContext(makeDoc());
    const before = ctx.document.nodes.length;
    executeCreateShape({ type: 'rectangle', name: 'R', width: 50, height: 50 }, ctx);
    assert.equal(ctx.document.nodes.length, before + 1);
  });
});

describe('executeCreateFrame', () => {
  it('creates a frame node', () => {
    const ctx = createContext(makeDoc());
    const result = executeCreateFrame({ name: 'MyFrame', width: 1440, height: 900 }, ctx) as any;
    assert.equal(result.created, true);
    assert.equal(result.type, 'frame');
    assert.equal(result.name, 'MyFrame');
  });

  it('uses defaults when no params', () => {
    const ctx = createContext(makeDoc());
    const result = executeCreateFrame({}, ctx) as any;
    assert.equal(result.created, true);
    const node = ctx.document.nodes.find((n: OPNode) => n.id === result.nodeId) as OPNode;
    assert.equal(node.width, 1440);
    assert.equal(node.height, 900);
    assert.equal(node.layoutMode, 'vertical');
  });

  it('respects layoutMode param', () => {
    const ctx = createContext(makeDoc());
    const result = executeCreateFrame({ layoutMode: 'horizontal' }, ctx) as any;
    const node = ctx.document.nodes.find((n: OPNode) => n.id === result.nodeId) as OPNode;
    assert.equal(node.layoutMode, 'horizontal');
  });
});

describe('executeCreateText', () => {
  it('creates a text node', () => {
    const ctx = createContext(makeDoc());
    const result = executeCreateText({ content: 'Hello World', fontFamily: 'Roboto', fontSize: 24 }, ctx) as any;
    assert.equal(result.created, true);
    assert.equal(result.type, 'text');
  });

  it('sets characters from content param', () => {
    const ctx = createContext(makeDoc());
    const result = executeCreateText({ content: 'Button Label' }, ctx) as any;
    const node = ctx.document.nodes.find((n: OPNode) => n.id === result.nodeId) as OPNode;
    assert.equal(node.characters, 'Button Label');
  });

  it('uses default font when not specified', () => {
    const ctx = createContext(makeDoc());
    const result = executeCreateText({ content: 'test' }, ctx) as any;
    const node = ctx.document.nodes.find((n: OPNode) => n.id === result.nodeId) as OPNode;
    assert.equal(node.fontFamily, 'Inter');
    assert.equal(node.fontSize, 16);
  });

  it('truncates long content for name', () => {
    const ctx = createContext(makeDoc());
    const longContent = 'A'.repeat(50);
    const result = executeCreateText({ content: longContent }, ctx) as any;
    assert.equal(result.name.length, 30);
  });
});

describe('executeCreateComponent', () => {
  it('creates a component node', () => {
    const ctx = createContext(makeDoc());
    const result = executeCreateComponent({ name: 'Button' }, ctx) as any;
    assert.equal(result.created, true);
    assert.equal(result.type, 'component');
    assert.equal(result.name, 'Button');
  });

  it('initializes component with empty children', () => {
    const ctx = createContext(makeDoc());
    const result = executeCreateComponent({ name: 'Card' }, ctx) as any;
    const node = ctx.document.nodes.find((n: OPNode) => n.id === result.nodeId) as OPNode;
    assert.deepEqual(node.children, []);
  });
});

describe('executeCreateInstance', () => {
  it('returns error for unknown component', () => {
    const ctx = createContext(makeDoc());
    const result = executeCreateInstance({ componentId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns error when node is not a component', () => {
    const ctx = createContext(makeDoc([makeNode('n1')]));
    const result = executeCreateInstance({ componentId: 'n1' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('creates an instance from a component', () => {
    const ctx = createContext(makeDoc());
    const compResult = executeCreateComponent({ name: 'Button' }, ctx) as any;
    const result = executeCreateInstance({ componentId: compResult.nodeId }, ctx) as any;
    assert.equal(result.created, true);
    assert.equal(result.type, 'instance');
    assert.equal(result.componentId, compResult.nodeId);
    assert.ok(result.name.includes('Button'));
  });
});

describe('executeCreatePage', () => {
  it('creates a new page', () => {
    const ctx = createContext(makeDoc());
    const before = ctx.document.document.pages.length;
    const result = executeCreatePage({ name: 'Onboarding' }, ctx) as any;
    assert.equal(result.created, true);
    assert.equal(result.name, 'Onboarding');
    assert.ok(typeof result.pageId === 'string');
    assert.equal(ctx.document.document.pages.length, before + 1);
  });

  it('marks context as modified', () => {
    const ctx = createContext(makeDoc());
    ctx.modified = false;
    executeCreatePage({ name: 'Settings' }, ctx);
    assert.equal(ctx.modified, true);
  });
});

describe('executeRender', () => {
  it('returns SVG for default format', () => {
    const ctx = createContext(makeDoc());
    const result = executeRender({}, ctx) as any;
    assert.equal(result.format, 'svg');
    assert.ok(typeof result.content === 'string');
    assert.equal(result.contentType, 'image/svg+xml');
  });

  it('returns SVG fallback for png format', () => {
    const ctx = createContext(makeDoc());
    const result = executeRender({ format: 'png' }, ctx) as any;
    assert.equal(result.format, 'svg-fallback');
    assert.ok(typeof result.content === 'string');
    assert.ok(result.note.includes('PNG'));
  });

  it('returns HTML for html format', () => {
    const ctx = createContext(makeDoc());
    const result = executeRender({ format: 'html' }, ctx) as any;
    assert.equal(result.format, 'html');
    assert.ok(typeof result.content === 'string');
    assert.equal(result.contentType, 'text/html');
  });
});
