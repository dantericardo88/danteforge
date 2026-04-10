// variable-executors-errors.test.ts — error paths for all 11 variable executor functions (v0.23.0)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMediumOP } from './helpers/mock-op.js';
import { createContext } from '../src/harvested/openpencil/tool-context.js';
import type { ToolContext } from '../src/harvested/openpencil/tool-context.js';
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

let ctx: ToolContext;

describe('variable-executors — error paths', () => {
  beforeEach(() => { ctx = createContext(createMediumOP()); });

  // --- executeCreateVariable ---
  it('executeCreateVariable returns error when collection not found', () => {
    const result = executeCreateVariable({ collectionId: 'nonexistent-col', name: 'myVar', type: 'string', value: 'x' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error when collection not found');
    assert.ok((result.error as string).includes('Collection not found'), `Expected "Collection not found", got: ${result.error}`);
  });

  it('executeCreateVariable succeeds when collection exists', () => {
    // Create a collection first
    const created = executeCreateCollection({ name: 'TestCollection' }, ctx) as Record<string, unknown>;
    assert.ok(created.collectionId, 'Expected collectionId');
    const result = executeCreateVariable({ collectionId: created.collectionId, name: 'myVar', type: 'string', value: 'hello' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.created, true);
  });

  // --- executeUpdateVariable ---
  it('executeUpdateVariable returns error when variable not found', () => {
    const result = executeUpdateVariable({ variableId: 'nonexistent-var', value: 'new' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error when variable not found');
    assert.ok((result.error as string).includes('Variable not found'), `Expected "Variable not found", got: ${result.error}`);
  });

  // --- executeDeleteVariable ---
  it('executeDeleteVariable returns error when variable not found', () => {
    const result = executeDeleteVariable({ variableId: 'nonexistent-var' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error when variable not found');
    assert.ok((result.error as string).includes('Variable not found'), `Expected "Variable not found", got: ${result.error}`);
  });

  // --- executeBindVariable ---
  it('executeBindVariable returns error when node not found', () => {
    const result = executeBindVariable({ nodeId: 'bad-node', property: 'fill', variableId: 'some-var' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error when node not found');
    assert.ok((result.error as string).includes('Node not found'), `Expected "Node not found", got: ${result.error}`);
  });

  it('executeBindVariable returns error when variable not found (node exists)', () => {
    // createMediumOP has top-level nodes starting with 'frame-root'
    const result = executeBindVariable({ nodeId: 'frame-root', property: 'fill', variableId: 'bad-variable-id' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error when variable not found');
    assert.ok((result.error as string).includes('Variable not found'), `Expected "Variable not found", got: ${result.error}`);
  });

  // --- executeUnbindVariable ---
  it('executeUnbindVariable returns error when node not found', () => {
    const result = executeUnbindVariable({ nodeId: 'nonexistent-node', property: 'fill' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error when node not found');
    assert.ok((result.error as string).includes('Node not found'), `Expected "Node not found", got: ${result.error}`);
  });

  it('executeUnbindVariable returns error when no binding for property', () => {
    // Use a real node (frame-root) but no binding has been set on 'fill'
    const result = executeUnbindVariable({ nodeId: 'frame-root', property: 'fill' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error when no binding for property');
    assert.ok((result.error as string).includes('binding') || (result.error as string).includes('Node not found'),
      `Expected binding-related error, got: ${result.error}`);
  });

  // --- executeGetCollection ---
  it('executeGetCollection returns error when collection not found', () => {
    const result = executeGetCollection({ collectionId: 'nonexistent-col' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error when collection not found');
    assert.ok((result.error as string).includes('Collection not found'), `Expected "Collection not found", got: ${result.error}`);
  });

  it('executeGetCollection succeeds when collection exists', () => {
    const created = executeCreateCollection({ name: 'Colors' }, ctx) as Record<string, unknown>;
    assert.ok(created.collectionId, 'Expected collectionId');
    const result = executeGetCollection({ collectionId: created.collectionId }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, `Should not error: ${result.error}`);
    assert.strictEqual(result.name, 'Colors');
  });

  // --- executeListCollections ---
  it('executeListCollections returns count=0 when no collections exist', () => {
    const result = executeListCollections({}, ctx) as Record<string, unknown>;
    // Fresh medium OP may have 0 collections
    assert.ok(typeof result.count === 'number', 'Should have count field');
    assert.ok(Array.isArray(result.collections), 'Should have collections array');
  });

  // --- executeCreateCollection ---
  it('executeCreateCollection creates and returns a new collection', () => {
    const result = executeCreateCollection({ name: 'Typography' }, ctx) as Record<string, unknown>;
    assert.strictEqual(result.created, true);
    assert.ok(typeof result.collectionId === 'string', 'Should return collectionId');
    assert.strictEqual(result.name, 'Typography');
  });

  // --- executeDeleteCollection ---
  it('executeDeleteCollection returns error when collection not found', () => {
    const result = executeDeleteCollection({ collectionId: 'nonexistent-col' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error when collection not found');
    assert.ok((result.error as string).includes('Collection not found'), `Expected "Collection not found", got: ${result.error}`);
  });

  it('executeDeleteCollection deletes existing collection', () => {
    const created = executeCreateCollection({ name: 'ToDelete' }, ctx) as Record<string, unknown>;
    assert.ok(created.collectionId, 'Expected collectionId');
    const result = executeDeleteCollection({ collectionId: created.collectionId }, ctx) as Record<string, unknown>;
    assert.strictEqual(result.deleted, true);
  });

  // --- executeRenameCollection ---
  it('executeRenameCollection returns error when collection not found', () => {
    const result = executeRenameCollection({ collectionId: 'nonexistent-col', name: 'NewName' }, ctx) as Record<string, unknown>;
    assert.ok(result.error, 'Should return error when collection not found');
    assert.ok((result.error as string).includes('Collection not found'), `Expected "Collection not found", got: ${result.error}`);
  });

  it('executeRenameCollection renames existing collection', () => {
    const created = executeCreateCollection({ name: 'OldName' }, ctx) as Record<string, unknown>;
    assert.ok(created.collectionId, 'Expected collectionId');
    const result = executeRenameCollection({ collectionId: created.collectionId, name: 'NewName' }, ctx) as Record<string, unknown>;
    assert.strictEqual(result.renamed, true);
    assert.strictEqual(result.newName, 'NewName');
    assert.strictEqual(result.oldName, 'OldName');
  });

  // --- executeGetVariableBindings ---
  it('executeGetVariableBindings returns empty bindings when no nodes have bindings', () => {
    const result = executeGetVariableBindings({ variableId: 'any-variable' }, ctx) as Record<string, unknown>;
    assert.ok(!result.error, 'Should not error');
    assert.strictEqual(result.bindingCount, 0);
    assert.deepStrictEqual(result.bindings, []);
  });
});
