import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  executeCreateVariable,
  executeUpdateVariable,
  executeDeleteVariable,
  executeBindVariable,
  executeUnbindVariable,
  executeGetCollection,
  executeListCollections,
  executeCreateCollection,
  executeDeleteCollection,
  executeRenameCollection,
  executeGetVariableBindings,
} from '../src/harvested/openpencil/executors/variable-executors.js';
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

function makeCtxWithCollection() {
  const ctx = createContext(makeDoc());
  ctx.document.variableCollections = [{ id: 'col-1', name: 'Colors', modes: [], variables: [] }];
  return ctx;
}

describe('executeListCollections', () => {
  it('returns empty list for fresh doc', () => {
    const ctx = createContext(makeDoc());
    const result = executeListCollections({}, ctx) as any;
    assert.equal(result.count, 0);
    assert.deepEqual(result.collections, []);
  });

  it('lists existing collections', () => {
    const ctx = makeCtxWithCollection();
    const result = executeListCollections({}, ctx) as any;
    assert.equal(result.count, 1);
    assert.equal(result.collections[0].id, 'col-1');
    assert.equal(result.collections[0].name, 'Colors');
  });
});

describe('executeCreateCollection', () => {
  it('creates a new collection', () => {
    const ctx = createContext(makeDoc());
    const result = executeCreateCollection({ name: 'Typography' }, ctx) as any;
    assert.equal(result.created, true);
    assert.ok(typeof result.collectionId === 'string');
    assert.equal(result.name, 'Typography');
    assert.equal(ctx.document.variableCollections?.length, 1);
  });

  it('adds to existing collections', () => {
    const ctx = makeCtxWithCollection();
    executeCreateCollection({ name: 'Spacing' }, ctx);
    assert.equal(ctx.document.variableCollections?.length, 2);
  });
});

describe('executeGetCollection', () => {
  it('returns error for unknown collection', () => {
    const ctx = createContext(makeDoc());
    const result = executeGetCollection({ collectionId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns collection details', () => {
    const ctx = makeCtxWithCollection();
    const result = executeGetCollection({ collectionId: 'col-1' }, ctx) as any;
    assert.equal(result.id, 'col-1');
    assert.equal(result.name, 'Colors');
    assert.equal(result.variableCount, 0);
    assert.deepEqual(result.variables, []);
  });
});

describe('executeCreateVariable', () => {
  it('returns error for unknown collection', () => {
    const ctx = createContext(makeDoc());
    const result = executeCreateVariable({ collectionId: 'ghost', name: 'primary', type: 'color', value: '#000' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('creates variable in collection', () => {
    const ctx = makeCtxWithCollection();
    const result = executeCreateVariable({ collectionId: 'col-1', name: 'primary', type: 'color', value: '#FF0000' }, ctx) as any;
    assert.equal(result.created, true);
    assert.equal(result.name, 'primary');
    assert.equal(result.collectionId, 'col-1');
    assert.ok(typeof result.variableId === 'string');
    assert.equal(ctx.document.variableCollections![0].variables.length, 1);
  });

  it('marks context as modified', () => {
    const ctx = makeCtxWithCollection();
    ctx.modified = false;
    executeCreateVariable({ collectionId: 'col-1', name: 'v1', type: 'number', value: 42 }, ctx);
    assert.equal(ctx.modified, true);
  });
});

describe('executeUpdateVariable', () => {
  it('returns error for unknown variable', () => {
    const ctx = createContext(makeDoc());
    const result = executeUpdateVariable({ variableId: 'ghost', value: 'blue' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('updates variable value', () => {
    const ctx = makeCtxWithCollection();
    ctx.document.variableCollections![0].variables.push({ id: 'var-1', name: 'primary', collection: 'col-1', type: 'color', value: '#000' });
    const result = executeUpdateVariable({ variableId: 'var-1', value: '#FF0000' }, ctx) as any;
    assert.equal(result.updated, true);
    assert.equal(result.newValue, '#FF0000');
    assert.equal(ctx.document.variableCollections![0].variables[0].value, '#FF0000');
  });
});

describe('executeDeleteVariable', () => {
  it('returns error for unknown variable', () => {
    const ctx = createContext(makeDoc());
    const result = executeDeleteVariable({ variableId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('deletes variable from collection', () => {
    const ctx = makeCtxWithCollection();
    ctx.document.variableCollections![0].variables.push({ id: 'var-1', name: 'primary', collection: 'col-1', type: 'color', value: '#000' });
    const result = executeDeleteVariable({ variableId: 'var-1' }, ctx) as any;
    assert.equal(result.deleted, true);
    assert.equal(ctx.document.variableCollections![0].variables.length, 0);
  });
});

describe('executeBindVariable', () => {
  it('returns error for unknown node', () => {
    const ctx = makeCtxWithCollection();
    ctx.document.variableCollections![0].variables.push({ id: 'var-1', name: 'v', collection: 'col-1', type: 'color', value: '#000' });
    const result = executeBindVariable({ nodeId: 'ghost', property: 'fill', variableId: 'var-1' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns error for unknown variable', () => {
    const ctx = createContext(makeDoc([makeNode('n1')]));
    const result = executeBindVariable({ nodeId: 'n1', property: 'fill', variableId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('binds variable to node property', () => {
    const ctx = createContext(makeDoc([makeNode('n1')]));
    ctx.document.variableCollections = [{ id: 'col-1', name: 'Colors', modes: [], variables: [{ id: 'var-1', name: 'primary', collection: 'col-1', type: 'color', value: '#000' }] }];
    const result = executeBindVariable({ nodeId: 'n1', property: 'fill', variableId: 'var-1' }, ctx) as any;
    assert.equal(result.bound, true);
    assert.equal(result.nodeId, 'n1');
    assert.equal(result.property, 'fill');
    assert.equal(result.variableId, 'var-1');
  });
});

describe('executeUnbindVariable', () => {
  it('returns error for unknown node', () => {
    const ctx = createContext(makeDoc());
    const result = executeUnbindVariable({ nodeId: 'ghost', property: 'fill' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('returns error when no binding exists', () => {
    const ctx = createContext(makeDoc([makeNode('n1')]));
    const result = executeUnbindVariable({ nodeId: 'n1', property: 'fill' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('unbinds property from node', () => {
    const ctx = createContext(makeDoc([makeNode('n1')]));
    ctx.document.variableCollections = [{ id: 'col-1', name: 'Colors', modes: [], variables: [{ id: 'var-1', name: 'primary', collection: 'col-1', type: 'color', value: '#000' }] }];
    executeBindVariable({ nodeId: 'n1', property: 'fill', variableId: 'var-1' }, ctx);
    const result = executeUnbindVariable({ nodeId: 'n1', property: 'fill' }, ctx) as any;
    assert.equal(result.unbound, true);
    assert.equal(result.property, 'fill');
  });
});

describe('executeDeleteCollection', () => {
  it('returns error for unknown collection', () => {
    const ctx = createContext(makeDoc());
    const result = executeDeleteCollection({ collectionId: 'ghost' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('deletes collection', () => {
    const ctx = makeCtxWithCollection();
    const result = executeDeleteCollection({ collectionId: 'col-1' }, ctx) as any;
    assert.equal(result.deleted, true);
    assert.equal(ctx.document.variableCollections?.length, 0);
  });
});

describe('executeRenameCollection', () => {
  it('returns error for unknown collection', () => {
    const ctx = createContext(makeDoc());
    const result = executeRenameCollection({ collectionId: 'ghost', name: 'New Name' }, ctx) as any;
    assert.ok('error' in result);
  });

  it('renames collection', () => {
    const ctx = makeCtxWithCollection();
    const result = executeRenameCollection({ collectionId: 'col-1', name: 'Palette' }, ctx) as any;
    assert.equal(result.renamed, true);
    assert.equal(result.oldName, 'Colors');
    assert.equal(result.newName, 'Palette');
    assert.equal(ctx.document.variableCollections![0].name, 'Palette');
  });
});

describe('executeGetVariableBindings', () => {
  it('returns empty bindings for unbound variable', () => {
    const ctx = createContext(makeDoc([makeNode('n1')]));
    const result = executeGetVariableBindings({ variableId: 'var-1' }, ctx) as any;
    assert.equal(result.bindingCount, 0);
    assert.deepEqual(result.bindings, []);
  });

  it('finds all nodes bound to a variable', () => {
    const ctx = createContext(makeDoc([makeNode('n1'), makeNode('n2')]));
    ctx.document.variableCollections = [{ id: 'col-1', name: 'Colors', modes: [], variables: [{ id: 'var-1', name: 'primary', collection: 'col-1', type: 'color', value: '#000' }] }];
    executeBindVariable({ nodeId: 'n1', property: 'fill', variableId: 'var-1' }, ctx);
    executeBindVariable({ nodeId: 'n2', property: 'stroke', variableId: 'var-1' }, ctx);
    const result = executeGetVariableBindings({ variableId: 'var-1' }, ctx) as any;
    assert.equal(result.bindingCount, 2);
  });
});
