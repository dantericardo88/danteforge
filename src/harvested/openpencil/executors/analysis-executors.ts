// Analysis Executors — 6 tools for design analysis and diffing
import type { ToolContext } from '../tool-context.js';
import { findNodes } from '../tool-context.js';
import { parseOP, diffOP } from '../op-codec.js';
import type { OPNode } from '../op-codec.js';

export function executeAnalyzeColors(params: Record<string, unknown>, ctx: ToolContext) {
  const allNodes = findNodes(ctx, () => true);
  const colorUsage = new Map<string, { count: number; nodeNames: string[] }>();

  for (const node of allNodes) {
    if (node.fills) {
      for (const fill of node.fills) {
        if (fill.color) {
          const normalized = fill.color.toUpperCase();
          const entry = colorUsage.get(normalized) ?? { count: 0, nodeNames: [] };
          entry.count++;
          entry.nodeNames.push(node.name);
          colorUsage.set(normalized, entry);
        }
      }
    }
    if (node.strokes) {
      for (const stroke of node.strokes) {
        const normalized = stroke.color.toUpperCase();
        const entry = colorUsage.get(normalized) ?? { count: 0, nodeNames: [] };
        entry.count++;
        entry.nodeNames.push(`${node.name} (stroke)`);
        colorUsage.set(normalized, entry);
      }
    }
  }

  const colors = Array.from(colorUsage.entries())
    .map(([color, info]) => ({ color, usageCount: info.count, nodeNames: info.nodeNames.slice(0, 5) }))
    .sort((a, b) => b.usageCount - a.usageCount);

  return {
    totalUniqueColors: colors.length,
    colors,
    recommendation: colors.length > 12
      ? 'Consider consolidating your color palette. More than 12 unique colors can reduce visual consistency.'
      : 'Color count is within recommended limits.',
  };
}

export function executeAnalyzeTypography(params: Record<string, unknown>, ctx: ToolContext) {
  const textNodes = findNodes(ctx, n => n.type === 'text');
  const fontUsage = new Map<string, { count: number; sizes: Set<number>; weights: Set<number> }>();

  for (const node of textNodes) {
    const family = node.fontFamily ?? 'Unknown';
    const entry = fontUsage.get(family) ?? { count: 0, sizes: new Set(), weights: new Set() };
    entry.count++;
    if (node.fontSize) entry.sizes.add(node.fontSize);
    if (node.fontWeight) entry.weights.add(node.fontWeight);
    fontUsage.set(family, entry);
  }

  const fonts = Array.from(fontUsage.entries()).map(([family, info]) => ({
    family,
    usageCount: info.count,
    sizes: Array.from(info.sizes).sort((a, b) => a - b),
    weights: Array.from(info.weights).sort((a, b) => a - b),
  }));

  // Check for typographic scale consistency
  const allSizes = Array.from(new Set(textNodes.map(n => n.fontSize).filter((s): s is number => s !== undefined))).sort((a, b) => a - b);
  const scaleRatios: number[] = [];
  for (let i = 1; i < allSizes.length; i++) {
    scaleRatios.push(Number((allSizes[i] / allSizes[i - 1]).toFixed(2)));
  }

  return {
    totalTextNodes: textNodes.length,
    uniqueFontFamilies: fonts.length,
    fonts,
    typographicScale: { sizes: allSizes, ratios: scaleRatios },
    recommendation: fonts.length > 3
      ? 'More than 3 font families detected. Consider reducing to improve consistency.'
      : 'Font family count is within recommended limits.',
  };
}

export function executeAnalyzeSpacing(params: Record<string, unknown>, ctx: ToolContext) {
  const allNodes = findNodes(ctx, () => true);
  const spacingValues = new Map<number, { count: number; type: string; nodeNames: string[] }>();
  const gridViolations: { nodeId: string; nodeName: string; property: string; value: number; nearestGrid: number }[] = [];
  const gridUnit = 4;

  for (const node of allNodes) {
    if (node.padding) {
      for (const [side, value] of Object.entries(node.padding)) {
        const entry = spacingValues.get(value) ?? { count: 0, type: 'padding', nodeNames: [] };
        entry.count++;
        entry.nodeNames.push(`${node.name}.padding.${side}`);
        spacingValues.set(value, entry);

        if (value % gridUnit !== 0) {
          gridViolations.push({
            nodeId: node.id,
            nodeName: node.name,
            property: `padding.${side}`,
            value,
            nearestGrid: Math.round(value / gridUnit) * gridUnit,
          });
        }
      }
    }

    if (node.layoutGap !== undefined) {
      const entry = spacingValues.get(node.layoutGap) ?? { count: 0, type: 'gap', nodeNames: [] };
      entry.count++;
      entry.nodeNames.push(`${node.name}.layoutGap`);
      spacingValues.set(node.layoutGap, entry);

      if (node.layoutGap % gridUnit !== 0) {
        gridViolations.push({
          nodeId: node.id,
          nodeName: node.name,
          property: 'layoutGap',
          value: node.layoutGap,
          nearestGrid: Math.round(node.layoutGap / gridUnit) * gridUnit,
        });
      }
    }
  }

  const spacing = Array.from(spacingValues.entries())
    .map(([value, info]) => ({ value, usageCount: info.count, type: info.type }))
    .sort((a, b) => a.value - b.value);

  return {
    uniqueSpacingValues: spacing.length,
    spacing,
    gridUnit,
    gridViolations,
    recommendation: gridViolations.length > 0
      ? `${gridViolations.length} spacing values violate the ${gridUnit}px grid. Consider aligning to the grid.`
      : `All spacing values align to the ${gridUnit}px grid.`,
  };
}

export function executeAnalyzeClusters(params: Record<string, unknown>, ctx: ToolContext) {
  const allNodes = findNodes(ctx, n => n.width !== undefined && n.height !== undefined);
  if (allNodes.length < 2) return { clusters: [], note: 'Not enough nodes to analyze clusters' };

  // Simple spatial clustering: group nodes by proximity
  const threshold = 50; // pixels
  const clusters: { center: { x: number; y: number }; nodeIds: string[]; nodeNames: string[] }[] = [];

  for (const node of allNodes) {
    const cx = (node.x ?? 0) + (node.width ?? 0) / 2;
    const cy = (node.y ?? 0) + (node.height ?? 0) / 2;
    let assigned = false;

    for (const cluster of clusters) {
      const dx = cx - cluster.center.x;
      const dy = cy - cluster.center.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < threshold * cluster.nodeIds.length) {
        cluster.nodeIds.push(node.id);
        cluster.nodeNames.push(node.name);
        // Update center
        cluster.center.x = (cluster.center.x * (cluster.nodeIds.length - 1) + cx) / cluster.nodeIds.length;
        cluster.center.y = (cluster.center.y * (cluster.nodeIds.length - 1) + cy) / cluster.nodeIds.length;
        assigned = true;
        break;
      }
    }

    if (!assigned) {
      clusters.push({ center: { x: cx, y: cy }, nodeIds: [node.id], nodeNames: [node.name] });
    }
  }

  return {
    totalClusters: clusters.length,
    clusters: clusters
      .filter(c => c.nodeIds.length > 1)
      .map(c => ({ nodeCount: c.nodeIds.length, nodeNames: c.nodeNames, center: c.center })),
  };
}

export function executeDiffCreate(params: Record<string, unknown>, ctx: ToolContext) {
  const beforeJson = params.beforeSnapshot as string;
  const afterJson = params.afterSnapshot as string;

  try {
    const before = parseOP(beforeJson);
    const after = parseOP(afterJson);
    const diff = diffOP(before, after);

    return {
      diffId: `diff-${Date.now()}`,
      summary: {
        addedNodes: diff.summary.added,
        removedNodes: diff.summary.removed,
        modifiedNodes: diff.summary.modified,
      },
      entries: diff.entries,
    };
  } catch (err) {
    return { error: `Failed to parse snapshots: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export function executeDiffShow(params: Record<string, unknown>, ctx: ToolContext) {
  const diffId = params.diffId as string;
  // In a persistent context, diffs would be stored. For headless execution,
  // return the current document state as reference.
  return {
    diffId,
    note: 'Use diffCreate to generate a new diff between two document states.',
    currentDocumentName: ctx.document.document.name,
    currentNodeCount: ctx.document.nodes.length,
  };
}
