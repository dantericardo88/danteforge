// Create Executors — 7 tools that add new nodes to the OPDocument
import type { ToolContext } from '../tool-context.js';
import { generateNodeId, addNode, withUndo, getNodeById } from '../tool-context.js';
import { renderToSVG, renderToHTML } from '../headless-renderer.js';
import type { OPNode, OPDocument } from '../op-codec.js';

export function executeCreateShape(params: Record<string, unknown>, ctx: ToolContext) {
  const mutCtx = withUndo(ctx);
  const type = params.type as OPNode['type'];
  const parentId = params.parentId as string | undefined;
  const name = (params.name as string) ?? `${type}-${Date.now()}`;
  const width = (params.width as number) ?? 100;
  const height = (params.height as number) ?? 100;

  const node: OPNode = {
    id: generateNodeId(type),
    type,
    name,
    width,
    height,
    x: 0,
    y: 0,
    fills: [{ type: 'solid', color: '#D1D5DB' }],
  };

  addNode(mutCtx, parentId ?? null, node);
  Object.assign(ctx, mutCtx);
  return { created: true, nodeId: node.id, type: node.type, name: node.name };
}

export function executeCreateFrame(params: Record<string, unknown>, ctx: ToolContext) {
  const mutCtx = withUndo(ctx);
  const name = (params.name as string) ?? `Frame-${Date.now()}`;
  const width = (params.width as number) ?? 1440;
  const height = (params.height as number) ?? 900;
  const parentId = params.parentId as string | undefined;

  const node: OPNode = {
    id: generateNodeId('frame'),
    type: 'frame',
    name,
    width,
    height,
    x: 0,
    y: 0,
    fills: [{ type: 'solid', color: '#FFFFFF' }],
    layoutMode: ((params.layoutMode as string) ?? 'vertical') as 'horizontal' | 'vertical' | 'none',
    layoutGap: (params.layoutGap as number) ?? 0,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    children: [],
  };

  addNode(mutCtx, parentId ?? null, node);
  Object.assign(ctx, mutCtx);
  return { created: true, nodeId: node.id, type: 'frame', name: node.name };
}

export function executeCreateText(params: Record<string, unknown>, ctx: ToolContext) {
  const mutCtx = withUndo(ctx);
  const content = params.content as string;
  const fontFamily = (params.fontFamily as string) ?? 'Inter';
  const fontSize = (params.fontSize as number) ?? 16;
  const parentId = params.parentId as string | undefined;

  const node: OPNode = {
    id: generateNodeId('text'),
    type: 'text',
    name: content.slice(0, 30),
    characters: content,
    fontFamily,
    fontSize,
    fontWeight: 400,
    fills: [{ type: 'solid', color: '#111827' }],
  };

  addNode(mutCtx, parentId ?? null, node);
  Object.assign(ctx, mutCtx);
  return { created: true, nodeId: node.id, type: 'text', name: node.name };
}

export function executeCreateComponent(params: Record<string, unknown>, ctx: ToolContext) {
  const mutCtx = withUndo(ctx);
  const name = params.name as string;
  const parentId = params.parentId as string | undefined;

  const node: OPNode = {
    id: generateNodeId('component'),
    type: 'component',
    name,
    width: 100,
    height: 100,
    x: 0,
    y: 0,
    children: [],
  };

  addNode(mutCtx, parentId ?? null, node);
  Object.assign(ctx, mutCtx);
  return { created: true, nodeId: node.id, type: 'component', name };
}

export function executeCreateInstance(params: Record<string, unknown>, ctx: ToolContext) {
  const mutCtx = withUndo(ctx);
  const componentId = params.componentId as string;
  const parentId = params.parentId as string | undefined;
  const component = getNodeById(ctx, componentId);

  if (!component || component.type !== 'component') {
    return { error: `Component not found: ${componentId}` };
  }

  const node: OPNode = {
    id: generateNodeId('instance'),
    type: 'instance',
    name: `${component.name} Instance`,
    width: component.width,
    height: component.height,
    x: 0,
    y: 0,
    children: component.children ? component.children.map(c => ({ ...c, id: generateNodeId(c.type) })) : [],
  };

  addNode(mutCtx, parentId ?? null, node);
  Object.assign(ctx, mutCtx);
  return { created: true, nodeId: node.id, type: 'instance', componentId, name: node.name };
}

export function executeCreatePage(params: Record<string, unknown>, ctx: ToolContext) {
  const name = params.name as string;
  const pageNode: OPNode = {
    id: generateNodeId('page'),
    type: 'page',
    name,
  };
  ctx.document.document.pages.push(pageNode);
  ctx.modified = true;
  return { created: true, pageId: pageNode.id, name };
}

export function executeRender(params: Record<string, unknown>, ctx: ToolContext) {
  const format = (params.format as string) ?? 'svg';

  if (format === 'svg') {
    const svg = renderToSVG(ctx.document);
    return { format: 'svg', content: svg, contentType: 'image/svg+xml' };
  }

  if (format === 'png') {
    // No WASM — render SVG and note that PNG requires external conversion
    const svg = renderToSVG(ctx.document);
    return { format: 'svg-fallback', content: svg, note: 'PNG export requires CanvasKit. SVG provided as fallback.' };
  }

  // HTML wrapper
  const html = renderToHTML(ctx.document);
  return { format: 'html', content: html, contentType: 'text/html' };
}
