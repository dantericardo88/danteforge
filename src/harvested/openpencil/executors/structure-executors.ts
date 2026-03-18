// Structure Executors — 17 tools for tree manipulation on the OPDocument
import type { ToolContext } from '../tool-context.js';
import { getNodeById, removeNode, addNode, findParent, deepCloneNode, withUndo, generateNodeId, findNodes } from '../tool-context.js';
import type { OPNode } from '../op-codec.js';

export function executeDeleteNode(params: Record<string, unknown>, ctx: ToolContext) {
  const mutCtx = withUndo(ctx);
  const removed = removeNode(mutCtx, params.nodeId as string);
  if (!removed) return { error: `Node not found: ${params.nodeId}` };
  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true, document: mutCtx.document });
  return { deleted: true, nodeId: removed.id, name: removed.name };
}

export function executeCloneNode(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const original = getNodeById(ctx, nodeId);
  if (!original) return { error: `Node not found: ${nodeId}` };

  const mutCtx = withUndo(ctx);
  const clone = deepCloneNode(original);
  clone.name = `${original.name} (Copy)`;
  if (clone.x !== undefined) clone.x += 20;
  if (clone.y !== undefined) clone.y += 20;

  const parent = findParent(ctx, nodeId);
  addNode(mutCtx, parent?.id ?? null, clone);
  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true, document: mutCtx.document });
  return { cloned: true, originalId: nodeId, cloneId: clone.id, name: clone.name };
}

export function executeGroupNodes(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeIds = params.nodeIds as string[];
  const groupName = (params.name as string) ?? 'Group';

  const nodes = nodeIds.map(id => getNodeById(ctx, id)).filter((n): n is OPNode => n !== undefined);
  if (nodes.length === 0) return { error: 'No valid nodes found' };

  const mutCtx = withUndo(ctx);

  // Calculate bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    const x = n.x ?? 0, y = n.y ?? 0;
    const w = n.width ?? 0, h = n.height ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w);
    maxY = Math.max(maxY, y + h);
  }

  // Remove nodes from their current positions
  const removedNodes: OPNode[] = [];
  for (const id of nodeIds) {
    const removed = removeNode(mutCtx, id);
    if (removed) removedNodes.push(removed);
  }

  // Create group node
  const group: OPNode = {
    id: generateNodeId('group'),
    type: 'group',
    name: groupName,
    x: minX === Infinity ? 0 : minX,
    y: minY === Infinity ? 0 : minY,
    width: maxX - minX || 100,
    height: maxY - minY || 100,
    children: removedNodes,
  };

  addNode(mutCtx, null, group);
  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true, document: mutCtx.document });
  return { grouped: true, groupId: group.id, childCount: removedNodes.length };
}

export function executeUngroupNodes(params: Record<string, unknown>, ctx: ToolContext) {
  const groupId = params.groupId as string;
  const group = getNodeById(ctx, groupId);
  if (!group) return { error: `Node not found: ${groupId}` };
  if (group.type !== 'group') return { error: `Node ${groupId} is not a group` };

  const mutCtx = withUndo(ctx);
  const children = group.children ?? [];
  const parent = findParent(ctx, groupId);

  removeNode(mutCtx, groupId);
  for (const child of children) {
    addNode(mutCtx, parent?.id ?? null, child);
  }

  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true, document: mutCtx.document });
  return { ungrouped: true, childCount: children.length };
}

export function executeReparentNode(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const newParentId = params.newParentId as string;
  const index = params.index as number | undefined;

  const mutCtx = withUndo(ctx);
  const removed = removeNode(mutCtx, nodeId);
  if (!removed) return { error: `Node not found: ${nodeId}` };

  addNode(mutCtx, newParentId, removed, index);
  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true, document: mutCtx.document });
  return { reparented: true, nodeId, newParentId };
}

export function executeFlattenNode(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };

  const mutCtx = withUndo(ctx);
  // Flatten: convert to a single vector node, merging child properties
  const childCount = node.children?.length ?? 0;
  (node as unknown as Record<string, unknown>).type = 'vector';
  (node as unknown as Record<string, unknown>).name = `${node.name} (Flattened)`;
  delete (node as unknown as Record<string, unknown>).children;

  mutCtx.modified = true;
  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true });
  return { flattened: true, nodeId, childrenMerged: childCount };
}

export function executeDuplicatePage(params: Record<string, unknown>, ctx: ToolContext) {
  const pageId = params.pageId as string;
  const newName = params.newName as string | undefined;

  const page = ctx.document.document.pages.find(p => p.id === pageId);
  if (!page) return { error: `Page not found: ${pageId}` };

  const clone: OPNode = {
    ...page,
    id: generateNodeId('page'),
    name: newName ?? `${page.name} (Copy)`,
  };
  ctx.document.document.pages.push(clone);
  ctx.modified = true;
  return { duplicated: true, originalPageId: pageId, newPageId: clone.id };
}

export function executeReorderNode(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const direction = params.direction as string;

  const parent = findParent(ctx, nodeId);
  const siblings = parent?.children ?? ctx.document.nodes;
  const index = siblings.findIndex(n => n.id === nodeId);
  if (index === -1) return { error: `Node not found: ${nodeId}` };

  const mutCtx = withUndo(ctx);
  const [node] = siblings.splice(index, 1);

  switch (direction) {
    case 'front': siblings.push(node); break;
    case 'back': siblings.unshift(node); break;
    case 'forward': siblings.splice(Math.min(index + 1, siblings.length), 0, node); break;
    case 'backward': siblings.splice(Math.max(index - 1, 0), 0, node); break;
    default: siblings.splice(index, 0, node); break;
  }

  mutCtx.modified = true;
  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true });
  return { reordered: true, nodeId, direction };
}

export function executeAlignNodes(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeIds = params.nodeIds as string[];
  const alignment = params.alignment as string;
  const nodes = nodeIds.map(id => getNodeById(ctx, id)).filter((n): n is OPNode => n !== undefined);
  if (nodes.length < 2) return { error: 'Need at least 2 nodes to align' };

  const mutCtx = withUndo(ctx);
  const bounds = nodes.map(n => ({ x: n.x ?? 0, y: n.y ?? 0, w: n.width ?? 0, h: n.height ?? 0 }));

  switch (alignment) {
    case 'left': { const minX = Math.min(...bounds.map(b => b.x)); nodes.forEach(n => { n.x = minX; }); break; }
    case 'right': { const maxR = Math.max(...bounds.map(b => b.x + b.w)); nodes.forEach(n => { n.x = maxR - (n.width ?? 0); }); break; }
    case 'top': { const minY = Math.min(...bounds.map(b => b.y)); nodes.forEach(n => { n.y = minY; }); break; }
    case 'bottom': { const maxB = Math.max(...bounds.map(b => b.y + b.h)); nodes.forEach(n => { n.y = maxB - (n.height ?? 0); }); break; }
    case 'center-h': { const avgX = bounds.reduce((s, b) => s + b.x + b.w / 2, 0) / bounds.length; nodes.forEach(n => { n.x = avgX - (n.width ?? 0) / 2; }); break; }
    case 'center-v': { const avgY = bounds.reduce((s, b) => s + b.y + b.h / 2, 0) / bounds.length; nodes.forEach(n => { n.y = avgY - (n.height ?? 0) / 2; }); break; }
  }

  mutCtx.modified = true;
  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true });
  return { aligned: true, alignment, nodeCount: nodes.length };
}

export function executeDistributeNodes(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeIds = params.nodeIds as string[];
  const direction = params.direction as string;
  const nodes = nodeIds.map(id => getNodeById(ctx, id)).filter((n): n is OPNode => n !== undefined);
  if (nodes.length < 3) return { error: 'Need at least 3 nodes to distribute' };

  const mutCtx = withUndo(ctx);

  if (direction === 'horizontal') {
    nodes.sort((a, b) => (a.x ?? 0) - (b.x ?? 0));
    const totalWidth = nodes.reduce((s, n) => s + (n.width ?? 0), 0);
    const first = nodes[0].x ?? 0;
    const last = (nodes[nodes.length - 1].x ?? 0) + (nodes[nodes.length - 1].width ?? 0);
    const gap = (last - first - totalWidth) / (nodes.length - 1);
    let cx = first;
    for (const n of nodes) {
      n.x = cx;
      cx += (n.width ?? 0) + gap;
    }
  } else {
    nodes.sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
    const totalHeight = nodes.reduce((s, n) => s + (n.height ?? 0), 0);
    const first = nodes[0].y ?? 0;
    const last = (nodes[nodes.length - 1].y ?? 0) + (nodes[nodes.length - 1].height ?? 0);
    const gap = (last - first - totalHeight) / (nodes.length - 1);
    let cy = first;
    for (const n of nodes) {
      n.y = cy;
      cy += (n.height ?? 0) + gap;
    }
  }

  mutCtx.modified = true;
  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true });
  return { distributed: true, direction, nodeCount: nodes.length };
}

export function executeResizeToFit(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };
  if (!node.children || node.children.length === 0) return { error: 'Node has no children to fit' };

  const mutCtx = withUndo(ctx);
  let maxW = 0, maxH = 0;
  for (const child of node.children) {
    const right = (child.x ?? 0) + (child.width ?? 0);
    const bottom = (child.y ?? 0) + (child.height ?? 0);
    maxW = Math.max(maxW, right);
    maxH = Math.max(maxH, bottom);
  }

  const pad = node.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
  node.width = maxW + pad.left + pad.right;
  node.height = maxH + pad.top + pad.bottom;

  mutCtx.modified = true;
  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true });
  return { resized: true, nodeId, width: node.width, height: node.height };
}

export function executeDetachInstance(params: Record<string, unknown>, ctx: ToolContext) {
  const instanceId = params.instanceId as string;
  const node = getNodeById(ctx, instanceId);
  if (!node) return { error: `Node not found: ${instanceId}` };
  if (node.type !== 'instance') return { error: `Node ${instanceId} is not an instance` };

  const mutCtx = withUndo(ctx);
  (node as unknown as Record<string, unknown>).type = 'frame';
  (node as unknown as Record<string, unknown>).name = `${node.name} (Detached)`;

  mutCtx.modified = true;
  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true });
  return { detached: true, nodeId: instanceId };
}

export function executeCreateComponentSet(params: Record<string, unknown>, ctx: ToolContext) {
  const componentIds = params.componentIds as string[];
  const name = params.name as string;
  const components = componentIds.map(id => getNodeById(ctx, id)).filter((n): n is OPNode => n !== undefined && n.type === 'component');
  if (components.length === 0) return { error: 'No valid component nodes found' };

  const setNode: OPNode = {
    id: generateNodeId('group'),
    type: 'group',
    name: `${name} (Component Set)`,
    children: [],
  };

  ctx.document.nodes.push(setNode);
  ctx.modified = true;
  return { created: true, setId: setNode.id, componentCount: components.length };
}

export function executeSwapComponent(params: Record<string, unknown>, ctx: ToolContext) {
  const instanceId = params.instanceId as string;
  const newComponentId = params.newComponentId as string;
  const instance = getNodeById(ctx, instanceId);
  if (!instance || instance.type !== 'instance') return { error: `Instance not found: ${instanceId}` };
  const newComponent = getNodeById(ctx, newComponentId);
  if (!newComponent || newComponent.type !== 'component') return { error: `Component not found: ${newComponentId}` };

  const mutCtx = withUndo(ctx);
  instance.name = `${newComponent.name} Instance`;
  instance.children = newComponent.children ? newComponent.children.map(c => deepCloneNode(c)) : [];
  instance.width = newComponent.width;
  instance.height = newComponent.height;

  mutCtx.modified = true;
  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true });
  return { swapped: true, instanceId, newComponentId };
}

export function executeSelectNodes(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeIds = params.nodeIds as string[];
  ctx.selection = nodeIds;
  return { selected: nodeIds.length, nodeIds };
}

export function executeScrollToNode(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };
  // Headless mode — return viewport coordinates
  return { viewportTarget: { x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? 0, height: node.height ?? 0 }, note: 'Headless mode: viewport info returned for reference' };
}

export function executeLockAllChildren(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };

  let count = 0;
  function lockRecursive(n: OPNode) {
    n.locked = true;
    count++;
    if (n.children) n.children.forEach(lockRecursive);
  }

  if (node.children) node.children.forEach(lockRecursive);
  ctx.modified = true;
  return { locked: true, parentId: nodeId, childrenLocked: count };
}
