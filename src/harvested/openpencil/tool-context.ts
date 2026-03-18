// Tool Context — session-level document holder for OpenPencil tool execution
import type { OPDocument, OPNode } from './op-codec.js';

export interface ToolContext {
  document: OPDocument;
  selection: string[];
  activePage: string;
  undoStack: OPDocument[];
  modified: boolean;
}

const MAX_UNDO_DEPTH = 10;

export function createContext(doc: OPDocument): ToolContext {
  const firstPage = doc.document.pages[0];
  return {
    document: doc,
    selection: [],
    activePage: firstPage?.id ?? '',
    undoStack: [],
    modified: false,
  };
}

export function withUndo(ctx: ToolContext): ToolContext {
  const snapshot = JSON.parse(JSON.stringify(ctx.document)) as OPDocument;
  const undoStack = [...ctx.undoStack, snapshot];
  if (undoStack.length > MAX_UNDO_DEPTH) {
    undoStack.shift();
  }
  return { ...ctx, undoStack };
}

export function generateNodeId(type: string): string {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Recursively find a node by ID in the document tree.
 */
export function getNodeById(ctx: ToolContext, nodeId: string): OPNode | undefined {
  for (const node of ctx.document.nodes) {
    const found = findInTree(node, nodeId);
    if (found) return found;
  }
  return undefined;
}

function findInTree(node: OPNode, nodeId: string): OPNode | undefined {
  if (node.id === nodeId) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findInTree(child, nodeId);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Find all nodes matching a predicate.
 */
export function findNodes(ctx: ToolContext, predicate: (node: OPNode) => boolean): OPNode[] {
  const results: OPNode[] = [];
  for (const node of ctx.document.nodes) {
    collectMatches(node, predicate, results);
  }
  return results;
}

function collectMatches(node: OPNode, predicate: (node: OPNode) => boolean, results: OPNode[]): void {
  if (predicate(node)) results.push(node);
  if (node.children) {
    for (const child of node.children) {
      collectMatches(child, predicate, results);
    }
  }
}

/**
 * Count all nodes in the document (recursive).
 */
export function countAllNodes(ctx: ToolContext): number {
  let count = 0;
  for (const node of ctx.document.nodes) {
    count += countTree(node);
  }
  return count;
}

function countTree(node: OPNode): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countTree(child);
    }
  }
  return count;
}

/**
 * Update a node in-place by ID. Returns true if found and updated.
 */
export function updateNode(ctx: ToolContext, nodeId: string, updater: (node: OPNode) => OPNode): boolean {
  for (let i = 0; i < ctx.document.nodes.length; i++) {
    if (updateInTree(ctx.document.nodes, i, nodeId, updater)) {
      ctx.modified = true;
      return true;
    }
  }
  return false;
}

function updateInTree(
  siblings: OPNode[],
  index: number,
  nodeId: string,
  updater: (node: OPNode) => OPNode,
): boolean {
  const node = siblings[index];
  if (node.id === nodeId) {
    siblings[index] = updater(node);
    return true;
  }
  if (node.children) {
    for (let i = 0; i < node.children.length; i++) {
      if (updateInTree(node.children, i, nodeId, updater)) return true;
    }
  }
  return false;
}

/**
 * Remove a node from the document tree by ID. Returns the removed node or undefined.
 */
export function removeNode(ctx: ToolContext, nodeId: string): OPNode | undefined {
  for (let i = 0; i < ctx.document.nodes.length; i++) {
    if (ctx.document.nodes[i].id === nodeId) {
      ctx.modified = true;
      return ctx.document.nodes.splice(i, 1)[0];
    }
    const removed = removeFromChildren(ctx.document.nodes[i], nodeId);
    if (removed) {
      ctx.modified = true;
      return removed;
    }
  }
  return undefined;
}

function removeFromChildren(parent: OPNode, nodeId: string): OPNode | undefined {
  if (!parent.children) return undefined;
  for (let i = 0; i < parent.children.length; i++) {
    if (parent.children[i].id === nodeId) {
      return parent.children.splice(i, 1)[0];
    }
    const removed = removeFromChildren(parent.children[i], nodeId);
    if (removed) return removed;
  }
  return undefined;
}

/**
 * Add a node as a child of a parent node. If parentId is not found, add to document root.
 */
export function addNode(ctx: ToolContext, parentId: string | null, node: OPNode, index?: number): void {
  ctx.modified = true;

  if (!parentId) {
    if (index !== undefined && index >= 0 && index <= ctx.document.nodes.length) {
      ctx.document.nodes.splice(index, 0, node);
    } else {
      ctx.document.nodes.push(node);
    }
    return;
  }

  const parent = getNodeById(ctx, parentId);
  if (!parent) {
    ctx.document.nodes.push(node);
    return;
  }

  if (!parent.children) parent.children = [];

  if (index !== undefined && index >= 0 && index <= parent.children.length) {
    parent.children.splice(index, 0, node);
  } else {
    parent.children.push(node);
  }
}

/**
 * Find the parent of a node by its ID. Returns undefined if at root level.
 */
export function findParent(ctx: ToolContext, nodeId: string): OPNode | undefined {
  for (const node of ctx.document.nodes) {
    const parent = findParentInTree(node, nodeId);
    if (parent) return parent;
  }
  return undefined;
}

function findParentInTree(node: OPNode, nodeId: string): OPNode | undefined {
  if (!node.children) return undefined;
  for (const child of node.children) {
    if (child.id === nodeId) return node;
    const found = findParentInTree(child, nodeId);
    if (found) return found;
  }
  return undefined;
}

/**
 * Deep clone a node with new IDs for the clone and all descendants.
 */
export function deepCloneNode(node: OPNode): OPNode {
  const clone = { ...node, id: generateNodeId(node.type) };
  if (node.children) {
    clone.children = node.children.map(child => deepCloneNode(child));
  }
  return clone;
}
