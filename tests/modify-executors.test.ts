import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeSetFill,
  executeSetStroke,
  executeSetLayout,
  executeSetConstraints,
  executeSetText,
} from '../src/harvested/openpencil/executors/modify-executors.js';
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

describe('executeSetFill', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeSetFill({ nodeId: 'ghost', color: '#FF0000' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('sets fill on a node', () => {
    const node = makeNode('n1');
    const ctx = createContext(makeDoc([node]));
    const result = executeSetFill({ nodeId: 'n1', color: '#FF0000', opacity: 0.8 }, ctx) as any;
    assert.equal(result.updated, true);
    const updated = getNodeById(ctx, 'n1') as any;
    assert.equal(updated.fills[0].color, '#FF0000');
    assert.equal(updated.fills[0].opacity, 0.8);
  });

  it('defaults opacity to 1 when not provided', () => {
    const node = makeNode('n1');
    const ctx = createContext(makeDoc([node]));
    executeSetFill({ nodeId: 'n1', color: '#0000FF' }, ctx);
    const updated = getNodeById(ctx, 'n1') as any;
    assert.equal(updated.fills[0].opacity, 1);
  });
});

describe('executeSetStroke', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeSetStroke({ nodeId: 'ghost', color: '#000000', weight: 1 }, ctx) as any;
    assert.ok('error' in result);
  });

  it('sets stroke on a node', () => {
    const node = makeNode('n1');
    const ctx = createContext(makeDoc([node]));
    executeSetStroke({ nodeId: 'n1', color: '#000000', weight: 2 }, ctx);
    const updated = getNodeById(ctx, 'n1') as any;
    assert.equal(updated.strokes[0].color, '#000000');
    assert.equal(updated.strokes[0].weight, 2);
  });
});

describe('executeSetLayout', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeSetLayout({ nodeId: 'ghost', mode: 'horizontal' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('sets layout mode', () => {
    const node = makeNode('n1');
    const ctx = createContext(makeDoc([node]));
    executeSetLayout({ nodeId: 'n1', mode: 'horizontal', gap: 8, padding: 16 }, ctx);
    const updated = getNodeById(ctx, 'n1') as any;
    assert.equal(updated.layoutMode, 'horizontal');
    assert.equal(updated.layoutGap, 8);
    assert.equal(updated.padding.top, 16);
  });
});

describe('executeSetConstraints', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeSetConstraints({ nodeId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('sets horizontal and vertical constraints', () => {
    const node = makeNode('n1');
    const ctx = createContext(makeDoc([node]));
    executeSetConstraints({ nodeId: 'n1', horizontal: 'stretch', vertical: 'center' }, ctx);
    const updated = getNodeById(ctx, 'n1') as any;
    assert.equal(updated.constraints.horizontal, 'stretch');
    assert.equal(updated.constraints.vertical, 'center');
  });
});

describe('executeSetText', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeSetText({ nodeId: 'ghost', content: 'Hello' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns error when node is not a text type', () => {
    const node = makeNode('n1'); // rectangle
    const ctx = createContext(makeDoc([node]));
    const result = executeSetText({ nodeId: 'n1', content: 'Hello' }, ctx) as any;
    assert.ok('error' in result);
    assert.ok(result.error.includes('not a text node'));
  });

  it('sets content on a text node', () => {
    const node = makeNode('t1', { type: 'text' });
    const ctx = createContext(makeDoc([node]));
    const result = executeSetText({ nodeId: 't1', content: 'Hello World' }, ctx) as any;
    assert.equal(result.updated, true);
    const updated = getNodeById(ctx, 't1') as any;
    assert.equal(updated.characters, 'Hello World');
  });
});
