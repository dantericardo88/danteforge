// Vector & Export Executors — 14 tools for vector ops and export functionality
import type { ToolContext } from '../tool-context.js';
import { getNodeById, withUndo, generateNodeId, findNodes } from '../tool-context.js';
import { renderToSVG } from '../headless-renderer.js';
import { extractTokensFromDocument, tokensToCSS, tokensToTailwindConfig } from '../token-extractor.js';
import type { OPNode } from '../op-codec.js';

function booleanOp(params: Record<string, unknown>, ctx: ToolContext, operation: string) {
  const nodeIds = params.nodeIds as string[];
  const nodes = nodeIds.map(id => getNodeById(ctx, id)).filter((n): n is OPNode => n !== undefined);
  if (nodes.length < 2) return { error: 'Boolean operations require at least 2 nodes' };

  const mutCtx = withUndo(ctx);

  // JSON-level boolean op: combine into a single vector node
  const combined: OPNode = {
    id: generateNodeId('vector'),
    type: 'vector',
    name: `${operation}(${nodes.map(n => n.name).join(', ')})`,
    x: Math.min(...nodes.map(n => n.x ?? 0)),
    y: Math.min(...nodes.map(n => n.y ?? 0)),
    width: Math.max(...nodes.map(n => (n.x ?? 0) + (n.width ?? 0))) - Math.min(...nodes.map(n => n.x ?? 0)),
    height: Math.max(...nodes.map(n => (n.y ?? 0) + (n.height ?? 0))) - Math.min(...nodes.map(n => n.y ?? 0)),
    fills: nodes[0].fills,
    strokes: nodes[0].strokes,
  };

  mutCtx.document.nodes.push(combined);
  mutCtx.modified = true;
  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true, document: mutCtx.document });
  return { operation, resultNodeId: combined.id, sourceNodes: nodeIds, note: 'Simplified JSON-level operation; full path boolean requires geometry library' };
}

export function executeBooleanUnion(params: Record<string, unknown>, ctx: ToolContext) {
  return booleanOp(params, ctx, 'union');
}

export function executeBooleanSubtract(params: Record<string, unknown>, ctx: ToolContext) {
  return booleanOp(params, ctx, 'subtract');
}

export function executeBooleanIntersect(params: Record<string, unknown>, ctx: ToolContext) {
  return booleanOp(params, ctx, 'intersect');
}

export function executeBooleanExclude(params: Record<string, unknown>, ctx: ToolContext) {
  return booleanOp(params, ctx, 'exclude');
}

export function executePathScale(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const scaleX = params.scaleX as number;
  const scaleY = params.scaleY as number;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };

  const mutCtx = withUndo(ctx);
  node.width = (node.width ?? 0) * scaleX;
  node.height = (node.height ?? 0) * scaleY;
  mutCtx.modified = true;
  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true });
  return { scaled: true, nodeId, newWidth: node.width, newHeight: node.height };
}

export function executePathSimplify(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };
  // Path simplification requires a geometry library — return metadata
  return { nodeId, simplified: true, note: 'Path simplification is a no-op in headless JSON mode; node retained as-is' };
}

export function executeViewportZoomToFit(_params: Record<string, unknown>, ctx: ToolContext) {
  const allNodes = findNodes(ctx, () => true);
  if (allNodes.length === 0) return { viewport: { x: 0, y: 0, width: 100, height: 100 } };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of allNodes) {
    const x = n.x ?? 0, y = n.y ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + (n.width ?? 0));
    maxY = Math.max(maxY, y + (n.height ?? 0));
  }

  return { viewport: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } };
}

export function executeViewportZoomToNode(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };
  return { viewport: { x: node.x ?? 0, y: node.y ?? 0, width: node.width ?? 0, height: node.height ?? 0 } };
}

export function executeExportImage(params: Record<string, unknown>, ctx: ToolContext) {
  const format = (params.format as string) ?? 'svg';
  const svg = renderToSVG(ctx.document);

  if (format === 'svg' || format === 'pdf') {
    return { format: 'svg', content: svg, contentType: 'image/svg+xml' };
  }

  // PNG/JPG require rasterization — return SVG with note
  return { format: 'svg-fallback', content: svg, note: `${format.toUpperCase()} export requires rasterization engine. SVG provided.` };
}

export function executeExportSvg(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };

  // Render single-node document
  const miniDoc = { ...ctx.document, nodes: [node] };
  const svg = renderToSVG(miniDoc);
  return { nodeId, format: 'svg', content: svg };
}

export function executeExportCSS(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };

  const css: string[] = [];
  css.push(`.${sanitizeClassName(node.name)} {`);
  if (node.width) css.push(`  width: ${node.width}px;`);
  if (node.height) css.push(`  height: ${node.height}px;`);
  if (node.cornerRadius) css.push(`  border-radius: ${node.cornerRadius}px;`);
  if (node.fills?.length) {
    const solid = node.fills.find(f => f.type === 'solid' && f.color);
    if (solid?.color) css.push(`  background-color: ${solid.color};`);
  }
  if (node.strokes?.length) {
    const s = node.strokes[0];
    css.push(`  border: ${s.weight}px solid ${s.color};`);
  }
  if (node.padding) css.push(`  padding: ${node.padding.top}px ${node.padding.right}px ${node.padding.bottom}px ${node.padding.left}px;`);
  if (node.layoutMode && node.layoutMode !== 'none') {
    css.push(`  display: flex;`);
    css.push(`  flex-direction: ${node.layoutMode === 'horizontal' ? 'row' : 'column'};`);
    if (node.layoutGap) css.push(`  gap: ${node.layoutGap}px;`);
  }
  css.push('}');

  return { nodeId, css: css.join('\n') };
}

export function executeExportJSX(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };

  const jsx = nodeToJSX(node, 0);
  const componentName = toPascalCase(node.name);
  const output = `export function ${componentName}() {\n  return (\n${jsx}\n  );\n}`;
  return { nodeId, framework: (params.framework as string) ?? 'react', jsx: output };
}

export function executeExportTailwind(params: Record<string, unknown>, ctx: ToolContext) {
  const nodeId = params.nodeId as string;
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };

  const classes: string[] = [];
  if (node.width) classes.push(`w-[${node.width}px]`);
  if (node.height) classes.push(`h-[${node.height}px]`);
  if (node.cornerRadius) classes.push(`rounded-[${node.cornerRadius}px]`);
  if (node.layoutMode === 'horizontal') classes.push('flex', 'flex-row');
  else if (node.layoutMode === 'vertical') classes.push('flex', 'flex-col');
  if (node.layoutGap) classes.push(`gap-[${node.layoutGap}px]`);
  if (node.padding) {
    classes.push(`pt-[${node.padding.top}px]`, `pr-[${node.padding.right}px]`, `pb-[${node.padding.bottom}px]`, `pl-[${node.padding.left}px]`);
  }

  return { nodeId, classes: classes.join(' '), classArray: classes };
}

export function executeExportDesignTokens(params: Record<string, unknown>, ctx: ToolContext) {
  const format = (params.format as string) ?? 'css';
  const tokens = extractTokensFromDocument(ctx.document);

  switch (format) {
    case 'css': return { format: 'css', content: tokensToCSS(tokens) };
    case 'tailwind': return { format: 'tailwind', content: JSON.stringify(tokensToTailwindConfig(tokens), null, 2) };
    case 'json': return { format: 'json', content: JSON.stringify(tokens, null, 2) };
    case 'scss': {
      const scss = Object.entries(tokens.colors).map(([k, v]) => `$color-${k}: ${v};`).join('\n')
        + '\n' + Object.entries(tokens.spacing).map(([k, v]) => `$${k}: ${v};`).join('\n');
      return { format: 'scss', content: scss };
    }
    default: return { format: 'css', content: tokensToCSS(tokens) };
  }
}

// Helpers
function sanitizeClassName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function toPascalCase(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, ' ').split(' ').filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1).toLowerCase()).join('');
}

function nodeToJSX(node: OPNode, indent: number): string {
  const pad = ' '.repeat(indent + 4);
  if (node.type === 'text') {
    return `${pad}<span>${node.characters ?? ''}</span>`;
  }

  const tag = 'div';
  const className = sanitizeClassName(node.name);
  const children = node.children?.map(c => nodeToJSX(c, indent + 2)).join('\n') ?? '';

  if (children) {
    return `${pad}<${tag} className="${className}">\n${children}\n${pad}</${tag}>`;
  }
  return `${pad}<${tag} className="${className}" />`;
}
