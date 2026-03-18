// Token Extractor — Extracts design tokens from .op documents and converts to CSS/Tailwind/styled-components
// Bridges the gap between .op design files and frontend code.

import type { OPDocument, OPNode, OPVariable, OPVariableCollection } from './op-codec.js';

/**
 * Structured design tokens extracted from a .op document.
 */
export interface DesignTokens {
  colors: Record<string, string>;
  typography: Record<string, { family: string; size: string; weight: number; lineHeight: string }>;
  spacing: Record<string, string>;
  radii: Record<string, string>;
  shadows: Record<string, string>;
}

/**
 * Extract design tokens from an OPDocument.
 * Combines explicit variableCollections with inferred values from nodes.
 */
export function extractTokensFromDocument(doc: OPDocument): DesignTokens {
  const tokens: DesignTokens = {
    colors: {},
    typography: {},
    spacing: {},
    radii: {},
    shadows: {},
  };

  // 1. Extract from variable collections (explicit tokens)
  if (doc.variableCollections) {
    for (const collection of doc.variableCollections) {
      extractFromCollection(collection, tokens);
    }
  }

  // 2. Infer from nodes (implicit tokens)
  extractFromNodes(doc.nodes, tokens);

  return tokens;
}

/**
 * Extract tokens from a variable collection.
 */
function extractFromCollection(collection: OPVariableCollection, tokens: DesignTokens): void {
  for (const variable of collection.variables) {
    const name = toTokenName(variable.name);

    switch (variable.type) {
      case 'color':
        tokens.colors[name] = String(variable.value);
        break;
      case 'number':
        if (collection.name.toLowerCase().includes('spacing') || collection.name.toLowerCase().includes('space')) {
          tokens.spacing[name] = `${variable.value}px`;
        } else if (collection.name.toLowerCase().includes('radius') || collection.name.toLowerCase().includes('radii')) {
          tokens.radii[name] = `${variable.value}px`;
        }
        break;
    }
  }
}

/**
 * Extract tokens by analyzing node properties (colors, fonts, spacing patterns).
 */
function extractFromNodes(nodes: OPNode[], tokens: DesignTokens): void {
  const colorSet = new Set<string>();
  const fontSizes = new Set<number>();
  const fontFamilies = new Set<string>();
  const fontWeights = new Set<number>();
  const radiiSet = new Set<number>();
  const spacingSet = new Set<number>();

  function walk(nodeList: OPNode[]) {
    for (const node of nodeList) {
      // Colors from fills
      if (node.fills) {
        for (const fill of node.fills) {
          if (fill.color && fill.type === 'solid') {
            colorSet.add(fill.color);
          }
        }
      }

      // Colors from strokes
      if (node.strokes) {
        for (const stroke of node.strokes) {
          if (stroke.color) {
            colorSet.add(stroke.color);
          }
        }
      }

      // Typography
      if (node.fontSize) fontSizes.add(node.fontSize);
      if (node.fontFamily) fontFamilies.add(node.fontFamily);
      if (node.fontWeight) fontWeights.add(node.fontWeight);

      // Corner radius
      if (node.cornerRadius && node.cornerRadius > 0) {
        radiiSet.add(node.cornerRadius);
      }

      // Spacing from padding
      if (node.padding) {
        const { top, right, bottom, left } = node.padding;
        for (const val of [top, right, bottom, left]) {
          if (val > 0) spacingSet.add(val);
        }
      }

      // Spacing from layout gap
      if (node.layoutGap && node.layoutGap > 0) {
        spacingSet.add(node.layoutGap);
      }

      // Shadows from effects
      if (node.effects) {
        for (const effect of node.effects) {
          if (effect.type === 'drop-shadow' || effect.type === 'inner-shadow') {
            const offsetX = effect.offset?.x ?? 0;
            const offsetY = effect.offset?.y ?? 0;
            const radius = effect.radius ?? 0;
            const spread = effect.spread ?? 0;
            const color = effect.color ?? '#00000020';
            const key = `shadow-${radius}`;
            tokens.shadows[key] = `${offsetX}px ${offsetY}px ${radius}px ${spread}px ${color}`;
          }
        }
      }

      if (node.children) walk(node.children);
    }
  }

  walk(nodes);

  // Merge inferred colors (only if not already defined)
  for (const color of colorSet) {
    const name = colorToTokenName(color);
    if (!tokens.colors[name]) {
      tokens.colors[name] = color;
    }
  }

  // Build typography tokens from unique combinations
  const sortedSizes = [...fontSizes].sort((a, b) => a - b);
  const sizeNames = ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl'];
  for (let i = 0; i < sortedSizes.length && i < sizeNames.length; i++) {
    const sizeName = sizeNames[i];
    const fontSize = sortedSizes[i];
    const family = [...fontFamilies][0] ?? 'system-ui';
    const weight = 400;
    tokens.typography[`text-${sizeName}`] = {
      family,
      size: `${fontSize}px`,
      weight,
      lineHeight: `${Math.round(fontSize * 1.5)}px`,
    };
  }

  // Build spacing tokens
  const sortedSpacing = [...spacingSet].sort((a, b) => a - b);
  const spaceNames = ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl'];
  for (let i = 0; i < sortedSpacing.length && i < spaceNames.length; i++) {
    const name = `space-${spaceNames[i]}`;
    if (!tokens.spacing[name]) {
      tokens.spacing[name] = `${sortedSpacing[i]}px`;
    }
  }

  // Build radii tokens
  const sortedRadii = [...radiiSet].sort((a, b) => a - b);
  const radiiNames = ['sm', 'md', 'lg', 'xl', '2xl', 'full'];
  for (let i = 0; i < sortedRadii.length && i < radiiNames.length; i++) {
    const name = `radius-${radiiNames[i]}`;
    if (!tokens.radii[name]) {
      tokens.radii[name] = `${sortedRadii[i]}px`;
    }
  }
}

/**
 * Convert a variable name to a CSS custom property name.
 */
function toTokenName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Convert a hex color to an approximate token name.
 */
function colorToTokenName(hex: string): string {
  const clean = hex.toLowerCase().replace('#', '');
  // Common color mappings
  const knownColors: Record<string, string> = {
    'ffffff': 'white',
    '000000': 'black',
    'f9fafb': 'gray-50',
    'f3f4f6': 'gray-100',
    'e5e7eb': 'gray-200',
    'd1d5db': 'gray-300',
    '9ca3af': 'gray-400',
    '6b7280': 'gray-500',
    '4b5563': 'gray-600',
    '374151': 'gray-700',
    '1f2937': 'gray-800',
    '111827': 'gray-900',
    '3b82f6': 'blue-500',
    '2563eb': 'blue-600',
    '1d4ed8': 'blue-700',
    'ef4444': 'red-500',
    '10b981': 'green-500',
    'f59e0b': 'amber-500',
    '8b5cf6': 'violet-500',
  };

  return knownColors[clean] ?? `color-${clean.slice(0, 6)}`;
}

/**
 * Convert design tokens to CSS custom properties.
 */
export function tokensToCSS(tokens: DesignTokens): string {
  const lines: string[] = [':root {'];

  // Colors
  if (Object.keys(tokens.colors).length > 0) {
    lines.push('  /* Colors */');
    for (const [name, value] of Object.entries(tokens.colors)) {
      lines.push(`  --color-${name}: ${value};`);
    }
    lines.push('');
  }

  // Typography
  if (Object.keys(tokens.typography).length > 0) {
    lines.push('  /* Typography */');
    for (const [name, value] of Object.entries(tokens.typography)) {
      lines.push(`  --${name}-family: ${value.family};`);
      lines.push(`  --${name}-size: ${value.size};`);
      lines.push(`  --${name}-weight: ${value.weight};`);
      lines.push(`  --${name}-line-height: ${value.lineHeight};`);
    }
    lines.push('');
  }

  // Spacing
  if (Object.keys(tokens.spacing).length > 0) {
    lines.push('  /* Spacing */');
    for (const [name, value] of Object.entries(tokens.spacing)) {
      lines.push(`  --${name}: ${value};`);
    }
    lines.push('');
  }

  // Radii
  if (Object.keys(tokens.radii).length > 0) {
    lines.push('  /* Border Radius */');
    for (const [name, value] of Object.entries(tokens.radii)) {
      lines.push(`  --${name}: ${value};`);
    }
    lines.push('');
  }

  // Shadows
  if (Object.keys(tokens.shadows).length > 0) {
    lines.push('  /* Shadows */');
    for (const [name, value] of Object.entries(tokens.shadows)) {
      lines.push(`  --${name}: ${value};`);
    }
    lines.push('');
  }

  lines.push('}');
  return lines.join('\n');
}

/**
 * Convert design tokens to Tailwind CSS theme configuration.
 */
export function tokensToTailwindConfig(tokens: DesignTokens): string {
  const theme: Record<string, unknown> = {};

  // Colors
  if (Object.keys(tokens.colors).length > 0) {
    const colors: Record<string, string> = {};
    for (const [name, value] of Object.entries(tokens.colors)) {
      colors[name] = value;
    }
    theme.colors = colors;
  }

  // Font sizes
  if (Object.keys(tokens.typography).length > 0) {
    const fontSize: Record<string, [string, { lineHeight: string }]> = {};
    for (const [name, value] of Object.entries(tokens.typography)) {
      const shortName = name.replace('text-', '');
      fontSize[shortName] = [value.size, { lineHeight: value.lineHeight }];
    }
    theme.fontSize = fontSize;
  }

  // Spacing
  if (Object.keys(tokens.spacing).length > 0) {
    const spacing: Record<string, string> = {};
    for (const [name, value] of Object.entries(tokens.spacing)) {
      const shortName = name.replace('space-', '');
      spacing[shortName] = value;
    }
    theme.spacing = spacing;
  }

  // Border radius
  if (Object.keys(tokens.radii).length > 0) {
    const borderRadius: Record<string, string> = {};
    for (const [name, value] of Object.entries(tokens.radii)) {
      const shortName = name.replace('radius-', '');
      borderRadius[shortName] = value;
    }
    theme.borderRadius = borderRadius;
  }

  return `/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: ${JSON.stringify(theme, null, 6).replace(/^/gm, '    ').trim()},
  },
};`;
}

/**
 * Convert design tokens to a styled-components theme object.
 */
export function tokensToStyledTheme(tokens: DesignTokens): string {
  const theme: Record<string, unknown> = {
    colors: tokens.colors,
    typography: tokens.typography,
    spacing: tokens.spacing,
    radii: tokens.radii,
    shadows: tokens.shadows,
  };

  return `export const theme = ${JSON.stringify(theme, null, 2)} as const;

export type Theme = typeof theme;
`;
}
