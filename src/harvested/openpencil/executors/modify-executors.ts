// Modify Executors — 20 tools that mutate node properties on the OPDocument
import type { ToolContext } from '../tool-context.js';
import { getNodeById, withUndo } from '../tool-context.js';

function requireNode(ctx: ToolContext, nodeId: string) {
  const node = getNodeById(ctx, nodeId);
  if (!node) return { error: `Node not found: ${nodeId}` };
  return node;
}

function applyChange(ctx: ToolContext, nodeId: string, apply: (node: Record<string, unknown>) => void) {
  const node = requireNode(ctx, nodeId);
  if ('error' in node) return node;
  const mutCtx = withUndo(ctx);
  apply(node as unknown as Record<string, unknown>);
  mutCtx.modified = true;
  Object.assign(ctx, { undoStack: mutCtx.undoStack, modified: true });
  return { updated: true, nodeId };
}

export function executeSetFill(params: Record<string, unknown>, ctx: ToolContext) {
  return applyChange(ctx, params.nodeId as string, n => {
    n.fills = [{ type: 'solid', color: params.color as string, opacity: (params.opacity as number) ?? 1 }];
  });
}

export function executeSetStroke(params: Record<string, unknown>, ctx: ToolContext) {
  return applyChange(ctx, params.nodeId as string, n => {
    n.strokes = [{ type: 'solid', color: params.color as string, weight: params.weight as number }];
  });
}

export function executeSetLayout(params: Record<string, unknown>, ctx: ToolContext) {
  return applyChange(ctx, params.nodeId as string, n => {
    n.layoutMode = params.mode as string;
    if (params.gap !== undefined) n.layoutGap = params.gap as number;
    if (params.padding !== undefined) {
      const p = params.padding as number;
      n.padding = { top: p, right: p, bottom: p, left: p };
    }
  });
}

export function executeSetConstraints(params: Record<string, unknown>, ctx: ToolContext) {
  return applyChange(ctx, params.nodeId as string, n => {
    const current = (n.constraints as Record<string, string>) ?? { horizontal: 'min', vertical: 'min' };
    if (params.horizontal) current.horizontal = params.horizontal as string;
    if (params.vertical) current.vertical = params.vertical as string;
    n.constraints = current;
  });
}

export function executeSetText(params: Record<string, unknown>, ctx: ToolContext) {
  const node = requireNode(ctx, params.nodeId as string);
  if ('error' in node) return node;
  if (node.type !== 'text') return { error: `Node ${params.nodeId} is not a text node (type: ${node.type})` };
  return applyChange(ctx, params.nodeId as string, n => {
    n.characters = params.content as string;
  });
}

export function executeSetOpacity(params: Record<string, unknown>, ctx: ToolContext) {
  const opacity = Math.max(0, Math.min(1, params.opacity as number));
  return applyChange(ctx, params.nodeId as string, n => {
    n.opacity = opacity;
  });
}

export function executeSetSize(params: Record<string, unknown>, ctx: ToolContext) {
  return applyChange(ctx, params.nodeId as string, n => {
    if (params.width !== undefined) n.width = params.width as number;
    if (params.height !== undefined) n.height = params.height as number;
  });
}

export function executeSetPosition(params: Record<string, unknown>, ctx: ToolContext) {
  return applyChange(ctx, params.nodeId as string, n => {
    n.x = params.x as number;
    n.y = params.y as number;
  });
}

export function executeSetCornerRadius(params: Record<string, unknown>, ctx: ToolContext) {
  return applyChange(ctx, params.nodeId as string, n => {
    n.cornerRadius = params.radius as number;
  });
}

export function executeSetFontSize(params: Record<string, unknown>, ctx: ToolContext) {
  const node = requireNode(ctx, params.nodeId as string);
  if ('error' in node) return node;
  if (node.type !== 'text') return { error: `Node ${params.nodeId} is not a text node` };
  return applyChange(ctx, params.nodeId as string, n => { n.fontSize = params.size as number; });
}

export function executeSetFontFamily(params: Record<string, unknown>, ctx: ToolContext) {
  const node = requireNode(ctx, params.nodeId as string);
  if ('error' in node) return node;
  if (node.type !== 'text') return { error: `Node ${params.nodeId} is not a text node` };
  return applyChange(ctx, params.nodeId as string, n => { n.fontFamily = params.family as string; });
}

export function executeSetFontWeight(params: Record<string, unknown>, ctx: ToolContext) {
  const node = requireNode(ctx, params.nodeId as string);
  if ('error' in node) return node;
  if (node.type !== 'text') return { error: `Node ${params.nodeId} is not a text node` };
  return applyChange(ctx, params.nodeId as string, n => { n.fontWeight = params.weight as number; });
}

export function executeSetLineHeight(params: Record<string, unknown>, ctx: ToolContext) {
  const node = requireNode(ctx, params.nodeId as string);
  if ('error' in node) return node;
  if (node.type !== 'text') return { error: `Node ${params.nodeId} is not a text node` };
  return applyChange(ctx, params.nodeId as string, n => { n.lineHeight = params.lineHeight as number; });
}

export function executeSetTextAlign(params: Record<string, unknown>, ctx: ToolContext) {
  const node = requireNode(ctx, params.nodeId as string);
  if ('error' in node) return node;
  if (node.type !== 'text') return { error: `Node ${params.nodeId} is not a text node` };
  return applyChange(ctx, params.nodeId as string, n => { n.textAlign = params.align as string; });
}

export function executeSetVisible(params: Record<string, unknown>, ctx: ToolContext) {
  return applyChange(ctx, params.nodeId as string, n => { n.visible = params.visible as boolean; });
}

export function executeSetLocked(params: Record<string, unknown>, ctx: ToolContext) {
  return applyChange(ctx, params.nodeId as string, n => { n.locked = params.locked as boolean; });
}

export function executeSetName(params: Record<string, unknown>, ctx: ToolContext) {
  return applyChange(ctx, params.nodeId as string, n => { n.name = params.name as string; });
}

export function executeSetRotation(params: Record<string, unknown>, ctx: ToolContext) {
  return applyChange(ctx, params.nodeId as string, n => { n.rotation = params.rotation as number; });
}

export function executeSetEffect(params: Record<string, unknown>, ctx: ToolContext) {
  return applyChange(ctx, params.nodeId as string, n => {
    const effects = (n.effects as unknown[]) ?? [];
    const effect: Record<string, unknown> = {
      type: params.type as string,
      visible: true,
    };
    if (params.color) effect.color = params.color;
    if (params.radius !== undefined) effect.radius = params.radius;
    if (params.offset) effect.offset = params.offset;
    effects.push(effect);
    n.effects = effects;
  });
}

export function executeSetPadding(params: Record<string, unknown>, ctx: ToolContext) {
  const node = requireNode(ctx, params.nodeId as string);
  if ('error' in node) return node;

  const current = node.padding ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const newPadding = {
    top: (params.top as number) ?? current.top,
    right: (params.right as number) ?? current.right,
    bottom: (params.bottom as number) ?? current.bottom,
    left: (params.left as number) ?? current.left,
  };

  // Warn if not on 4px grid
  const warnings: string[] = [];
  for (const [side, value] of Object.entries(newPadding)) {
    if (value % 4 !== 0) warnings.push(`${side}: ${value}px is not on 4px grid`);
  }

  const result = applyChange(ctx, params.nodeId as string, n => { n.padding = newPadding; });
  if (warnings.length > 0) return { ...result, warnings };
  return result;
}
