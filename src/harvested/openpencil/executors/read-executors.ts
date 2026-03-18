// Read Executors — 11 read-only tools that query the OPDocument
import type { ToolContext } from '../tool-context.js';
import { getNodeById, findNodes, countAllNodes } from '../tool-context.js';
import type { OPNode } from '../op-codec.js';

export function executeGetSelection(params: Record<string, unknown>, ctx: ToolContext) {
  const selected = ctx.selection
    .map(id => getNodeById(ctx, id))
    .filter((n): n is OPNode => n !== undefined);
  return { nodeIds: ctx.selection, nodes: selected.map(n => ({ id: n.id, type: n.type, name: n.name })) };
}

export function executeGetPageTree(params: Record<string, unknown>, ctx: ToolContext) {
  const pageId = params.pageId as string | undefined;
  if (pageId) {
    const page = ctx.document.document.pages.find(p => p.id === pageId);
    return page ? buildTreeSummary(page) : { error: `Page not found: ${pageId}` };
  }
  // Return active page tree, or all nodes if no active page
  return { pages: ctx.document.document.pages.map(p => ({ id: p.id, name: p.name })), nodes: ctx.document.nodes.map(n => buildTreeSummary(n)) };
}

export function executeGetNode(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };
  return { ...node, childCount: node.children?.length ?? 0 };
}

export function executeFindNodes(params: Record<string, unknown>, ctx: ToolContext) {
  const query = (params.query as string).toLowerCase();
  const typeFilter = params.type as string | undefined;

  const matches = findNodes(ctx, node => {
    const nameMatch = node.name.toLowerCase().includes(query);
    const typeMatch = !typeFilter || node.type === typeFilter;
    return nameMatch && typeMatch;
  });

  return { count: matches.length, nodes: matches.map(n => ({ id: n.id, type: n.type, name: n.name, x: n.x, y: n.y, width: n.width, height: n.height })) };
}

export function executeListFonts(_params: Record<string, unknown>, ctx: ToolContext) {
  const fonts = new Map<string, { count: number; sizes: Set<number>; weights: Set<number> }>();
  const textNodes = findNodes(ctx, n => n.type === 'text' && !!n.fontFamily);

  for (const node of textNodes) {
    const family = node.fontFamily!;
    const entry = fonts.get(family) ?? { count: 0, sizes: new Set(), weights: new Set() };
    entry.count++;
    if (node.fontSize) entry.sizes.add(node.fontSize);
    if (node.fontWeight) entry.weights.add(node.fontWeight);
    fonts.set(family, entry);
  }

  return {
    fonts: Array.from(fonts.entries()).map(([family, info]) => ({
      family,
      usageCount: info.count,
      sizes: Array.from(info.sizes).sort((a, b) => a - b),
      weights: Array.from(info.weights).sort((a, b) => a - b),
    })),
  };
}

export function executeGetStyles(_params: Record<string, unknown>, ctx: ToolContext) {
  const colors = new Set<string>();
  const strokeStyles = new Set<string>();

  const allNodes = findNodes(ctx, () => true);
  for (const node of allNodes) {
    if (node.fills) {
      for (const fill of node.fills) {
        if (fill.color) colors.add(fill.color);
      }
    }
    if (node.strokes) {
      for (const stroke of node.strokes) {
        strokeStyles.add(`${stroke.color}:${stroke.weight}`);
      }
    }
  }

  return { fillColors: Array.from(colors), strokeStyles: Array.from(strokeStyles) };
}

export function executeGetPageList(_params: Record<string, unknown>, ctx: ToolContext) {
  return { pages: ctx.document.document.pages.map(p => ({ id: p.id, name: p.name })) };
}

export function executeGetNodeCSS(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };

  const css: Record<string, string> = {};
  if (node.width) css.width = `${node.width}px`;
  if (node.height) css.height = `${node.height}px`;
  if (node.cornerRadius) css['border-radius'] = `${node.cornerRadius}px`;
  if (node.opacity !== undefined) css.opacity = `${node.opacity}`;
  if (node.rotation) css.transform = `rotate(${node.rotation}deg)`;
  if (node.fills?.length) {
    const solid = node.fills.find(f => f.type === 'solid' && f.color);
    if (solid?.color) css['background-color'] = solid.color;
  }
  if (node.strokes?.length) {
    const s = node.strokes[0];
    css.border = `${s.weight}px solid ${s.color}`;
  }
  if (node.padding) {
    css.padding = `${node.padding.top}px ${node.padding.right}px ${node.padding.bottom}px ${node.padding.left}px`;
  }
  if (node.layoutMode && node.layoutMode !== 'none') {
    css.display = 'flex';
    css['flex-direction'] = node.layoutMode === 'horizontal' ? 'row' : 'column';
    if (node.layoutGap) css.gap = `${node.layoutGap}px`;
  }
  if (node.fontSize) css['font-size'] = `${node.fontSize}px`;
  if (node.fontFamily) css['font-family'] = node.fontFamily;
  if (node.fontWeight) css['font-weight'] = `${node.fontWeight}`;
  if (node.lineHeight && node.lineHeight !== 'auto') css['line-height'] = `${node.lineHeight}`;
  if (node.textAlign) css['text-align'] = node.textAlign;

  return { nodeId, css };
}

export function executeGetNodeBounds(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };
  return { nodeId, x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? 0, height: node.height ?? 0 };
}

export function executeGetDocumentInfo(_params: Record<string, unknown>, ctx: ToolContext) {
  const doc = ctx.document;
  return {
    name: doc.document.name,
    formatVersion: doc.formatVersion,
    generator: doc.generator,
    created: doc.created,
    modified: doc.modified,
    pageCount: doc.document.pages.length,
    nodeCount: countAllNodes(ctx),
    variableCollectionCount: doc.variableCollections?.length ?? 0,
  };
}

export function executeGetNodeChildren(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };
  const children = node.children ?? [];
  return { parentId: nodeId, count: children.length, children: children.map(c => ({ id: c.id, type: c.type, name: c.name })) };
}

function buildTreeSummary(node: OPNode): Record<string, unknown> {
  const summary: Record<string, unknown> = { id: node.id, type: node.type, name: node.name };
  if (node.children && node.children.length > 0) {
    summary.children = node.children.map(c => buildTreeSummary(c));
  }
  return summary;
}
