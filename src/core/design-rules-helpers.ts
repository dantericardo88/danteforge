// Design Rules Helpers — pure utility functions for WCAG contrast, grid snapping, color math

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse a hex color string to RGB (0–255).
 * Supports #RGB, #RRGGBB, #RRGGBBAA formats.
 */
export function hexToRgb(hex: string): RGB | null {
  const cleaned = hex.replace('#', '');
  let r: number, g: number, b: number;

  if (cleaned.length === 3) {
    r = parseInt(cleaned[0] + cleaned[0], 16);
    g = parseInt(cleaned[1] + cleaned[1], 16);
    b = parseInt(cleaned[2] + cleaned[2], 16);
  } else if (cleaned.length === 6 || cleaned.length === 8) {
    r = parseInt(cleaned.slice(0, 2), 16);
    g = parseInt(cleaned.slice(2, 4), 16);
    b = parseInt(cleaned.slice(4, 6), 16);
  } else {
    return null;
  }

  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { r, g, b };
}

/**
 * Calculate the relative luminance of a color per WCAG 2.0.
 * https://www.w3.org/TR/WCAG20/#relativeluminancedef
 */
export function relativeLuminance(rgb: RGB): number {
  const [rs, gs, bs] = [rgb.r / 255, rgb.g / 255, rgb.b / 255].map(c =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate the WCAG contrast ratio between two colors.
 * Returns a value between 1 and 21.
 */
export function contrastRatio(fg: RGB, bg: RGB): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Snap a value to the nearest grid unit.
 */
export function nearestGridValue(value: number, gridUnit: number): number {
  return Math.round(value / gridUnit) * gridUnit;
}

/**
 * Check if a value is aligned to the grid.
 */
export function isGridAligned(value: number, gridUnit: number): boolean {
  return value % gridUnit === 0;
}

/**
 * Find the background color of the nearest parent frame/node.
 * Walks up the tree by checking all nodes for containment.
 */
export function findParentBackground(
  nodeId: string,
  nodes: TreeNode[],
): string | null {
  // Simple approach: find the first ancestor with a solid fill
  const parentChain = findAncestors(nodeId, nodes);
  for (const parent of parentChain) {
    if (parent.fills) {
      const solidFill = parent.fills.find(f => f.type === 'solid' && f.color);
      if (solidFill?.color) return solidFill.color;
    }
  }
  return null;
}

// Structural type that is compatible with OPNode
export interface TreeNode {
  id: string;
  name?: string;
  fills?: Array<{ type: string; color?: string }>;
  children?: TreeNode[];
}

function findAncestors(nodeId: string, nodes: TreeNode[]): TreeNode[] {
  const ancestors: TreeNode[] = [];

  function search(node: TreeNode, path: TreeNode[]): boolean {
    if (node.id === nodeId) {
      ancestors.push(...path.reverse());
      return true;
    }
    if (node.children) {
      for (const child of node.children) {
        if (search(child, [...path, node])) return true;
      }
    }
    return false;
  }

  for (const root of nodes) {
    if (search(root, [])) break;
  }

  return ancestors;
}
