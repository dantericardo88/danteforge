// Variable Executors — 11 tools for CRUD on design variables and bindings
import type { ToolContext } from '../tool-context.js';
import { getNodeById, findNodes, generateNodeId } from '../tool-context.js';
import type { OPVariable, OPVariableCollection } from '../op-codec.js';

function ensureCollections(ctx: ToolContext) {
  if (!ctx.document.variableCollections) {
    ctx.document.variableCollections = [];
  }
  return ctx.document.variableCollections;
}

function findVariable(collections: OPVariableCollection[], variableId: string): { collection: OPVariableCollection; variable: OPVariable; index: number } | undefined {
  for (const col of collections) {
    const idx = col.variables.findIndex(v => v.id === variableId);
    if (idx !== -1) return { collection: col, variable: col.variables[idx], index: idx };
  }
  return undefined;
}

export function executeCreateVariable(params: Record<string, unknown>, ctx: ToolContext) {
  const collections = ensureCollections(ctx);
  const collectionId = params.collectionId as string;
  const col = collections.find(c => c.id === collectionId);
  if (!col) return { error: `Collection not found: ${collectionId}` };

  const variable: OPVariable = {
    id: generateNodeId('var'),
    name: params.name as string,
    collection: collectionId,
    type: params.type as OPVariable['type'],
    value: params.value as string | number | boolean,
  };

  col.variables.push(variable);
  ctx.modified = true;
  return { created: true, variableId: variable.id, name: variable.name, collectionId };
}

export function executeUpdateVariable(params: Record<string, unknown>, ctx: ToolContext) {
  const collections = ensureCollections(ctx);
  const found = findVariable(collections, params.variableId as string);
  if (!found) return { error: `Variable not found: ${params.variableId}` };

  found.variable.value = params.value as string | number | boolean;
  ctx.modified = true;
  return { updated: true, variableId: found.variable.id, newValue: found.variable.value };
}

export function executeDeleteVariable(params: Record<string, unknown>, ctx: ToolContext) {
  const collections = ensureCollections(ctx);
  const found = findVariable(collections, params.variableId as string);
  if (!found) return { error: `Variable not found: ${params.variableId}` };

  found.collection.variables.splice(found.index, 1);
  ctx.modified = true;
  return { deleted: true, variableId: params.variableId };
}

export function executeBindVariable(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const property = params.property as string;
  const variableId = params.variableId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };

  const collections = ensureCollections(ctx);
  const found = findVariable(collections, variableId);
  if (!found) return { error: `Variable not found: ${variableId}` };

  // Store bindings as metadata extension on the node
  const nodeAny = node as unknown as Record<string, unknown>;
  if (!nodeAny._bindings) nodeAny._bindings = {};
  (nodeAny._bindings as Record<string, string>)[property] = variableId;
  ctx.modified = true;
  return { bound: true, nodeId, property, variableId };
}

export function executeUnbindVariable(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const property = params.property as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };

  const nodeAny = node as unknown as Record<string, unknown>;
  const bindings = nodeAny._bindings as Record<string, string> | undefined;
  if (!bindings || !bindings[property]) return { error: `No binding for property '${property}' on node ${nodeId}` };

  delete bindings[property];
  ctx.modified = true;
  return { unbound: true, nodeId, property };
}

export function executeGetCollection(params: Record<string, unknown>, ctx: ToolContext) {
  const collections = ensureCollections(ctx);
  const col = collections.find(c => c.id === (params.collectionId as string));
  if (!col) return { error: `Collection not found: ${params.collectionId}` };
  return { id: col.id, name: col.name, variableCount: col.variables.length, variables: col.variables };
}

export function executeListCollections(_params: Record<string, unknown>, ctx: ToolContext) {
  const collections = ensureCollections(ctx);
  return {
    count: collections.length,
    collections: collections.map(c => ({
      id: c.id,
      name: c.name,
      variableCount: c.variables.length,
    })),
  };
}

export function executeCreateCollection(params: Record<string, unknown>, ctx: ToolContext) {
  const collections = ensureCollections(ctx);
  const col: OPVariableCollection = {
    id: generateNodeId('collection'),
    name: params.name as string,
    variables: [],
  };
  collections.push(col);
  ctx.modified = true;
  return { created: true, collectionId: col.id, name: col.name };
}

export function executeDeleteCollection(params: Record<string, unknown>, ctx: ToolContext) {
  const collections = ensureCollections(ctx);
  const idx = collections.findIndex(c => c.id === (params.collectionId as string));
  if (idx === -1) return { error: `Collection not found: ${params.collectionId}` };
  const removed = collections.splice(idx, 1)[0];
  ctx.modified = true;
  return { deleted: true, collectionId: removed.id, name: removed.name };
}

export function executeRenameCollection(params: Record<string, unknown>, ctx: ToolContext) {
  const collections = ensureCollections(ctx);
  const col = collections.find(c => c.id === (params.collectionId as string));
  if (!col) return { error: `Collection not found: ${params.collectionId}` };
  const oldName = col.name;
  col.name = params.name as string;
  ctx.modified = true;
  return { renamed: true, collectionId: col.id, oldName, newName: col.name };
}

export function executeGetVariableBindings(params: Record<string, unknown>, ctx: ToolContext) {
  const variableId = params.variableId as string;
  const bindings: { nodeId: string; nodeName: string; property: string }[] = [];

  const allNodes = findNodes(ctx, () => true);
  for (const node of allNodes) {
    const nodeAny = node as unknown as Record<string, unknown>;
    const nodeBindings = nodeAny._bindings as Record<string, string> | undefined;
    if (nodeBindings) {
      for (const [prop, varId] of Object.entries(nodeBindings)) {
        if (varId === variableId) {
          bindings.push({ nodeId: node.id, nodeName: node.name, property: prop });
        }
      }
    }
  }

  return { variableId, bindingCount: bindings.length, bindings };
}
