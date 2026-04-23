// canvas-quality-scorer — 7-dimension quality scorer for .op design artifacts
// Operates purely over an OPDocument; no filesystem I/O or LLM calls required.

import type { OPDocument, OPNode, OPVariableCollection } from '../harvested/openpencil/op-codec.js';

// ── Public API ─────────────────────────────────────────────────────────────────

export interface CanvasQualityDimensions {
  artifactQuality: number;       // structure completeness and depth
  antiGeneric: number;           // distance from Bootstrap/gray defaults
  colorDistinctiveness: number;  // branded, chromatic palette
  typographyQuality: number;     // font pairing and size hierarchy
  tokenCoherence: number;        // design token consistency
  responsiveness: number;        // responsive layout evidence
  accessibility: number;         // WCAG/touch-target compliance
}

export interface CanvasQualityResult {
  dimensions: CanvasQualityDimensions;
  composite: number;   // 0–100 weighted average
  passingCount: number;    // dims scoring ≥ 70
  gapFromTarget: number;   // 7 − passingCount (autoresearch metric, target 0)
}

const WEIGHTS: Record<keyof CanvasQualityDimensions, number> = {
  artifactQuality:      0.20,
  antiGeneric:          0.15,
  colorDistinctiveness: 0.15,
  typographyQuality:    0.15,
  tokenCoherence:       0.15,
  responsiveness:       0.10,
  accessibility:        0.10,
};

const PASS_THRESHOLD = 70;

// Known Bootstrap/Tailwind-default hex colors (lowercase, 7-char)
const GENERIC_COLORS = new Set([
  '#007bff', '#0d6efd', '#6c757d', '#adb5bd', '#28a745', '#198754',
  '#dc3545', '#ffc107', '#17a2b8', '#0dcaf0', '#f8f9fa', '#e9ecef',
  '#343a40', '#212529',
]);

// System / "invisible" font families
const SYSTEM_FONTS = new Set([
  'arial', 'helvetica', 'helvetica neue', 'verdana', 'tahoma',
  'times new roman', 'georgia', 'courier new', 'system-ui',
  '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'roboto',
  'open sans', 'lato', 'noto sans', 'ubuntu', 'inter',
]);

export function scoreCanvasQuality(doc: OPDocument): CanvasQualityResult {
  const all = walkNodes(doc.nodes);
  const dims: CanvasQualityDimensions = {
    artifactQuality:      scoreArtifactQuality(doc, all),
    antiGeneric:          scoreAntiGeneric(all),
    colorDistinctiveness: scoreColorDistinctiveness(all, doc.variableCollections),
    typographyQuality:    scoreTypographyQuality(all),
    tokenCoherence:       scoreTokenCoherence(doc, all),
    responsiveness:       scoreResponsiveness(all),
    accessibility:        scoreAccessibility(all),
  };
  const composite = Math.round(
    (Object.keys(dims) as (keyof CanvasQualityDimensions)[])
      .reduce((sum, k) => sum + dims[k] * WEIGHTS[k], 0),
  );
  const passingCount = (Object.values(dims) as number[]).filter((v) => v >= PASS_THRESHOLD).length;
  return { dimensions: dims, composite, passingCount, gapFromTarget: 7 - passingCount };
}

// ── Dimension scorers ──────────────────────────────────────────────────────────

function scoreArtifactQuality(doc: OPDocument, all: OPNode[]): number {
  if (all.length === 0) return 0;
  let s = 20;
  if (!all.some((n) => n.type === 'frame')) return 20;
  s += 15;
  if (all.length >= 5) s += 10;
  if (all.length >= 15) s += 10;
  if (all.length >= 30) s += 5;
  const texts = all.filter((n) => n.type === 'text' && n.characters?.trim());
  if (texts.length > 0) s += 10;
  if (texts.length >= 5) s += 5;
  if ((doc.variableCollections?.length ?? 0) > 0) s += 10;
  const depth = maxDepth(doc.nodes);
  if (depth >= 2) s += 5;
  if (depth >= 3) s += 5;
  if (depth >= 4) s += 5;
  return Math.min(100, s);
}

function scoreAntiGeneric(all: OPNode[]): number {
  if (all.length === 0) return 0;
  let s = 100;
  const colors = solidColors(all);
  const fonts = fontFamilies(all);
  const sizes = fontSizes(all);

  const bootstrapHits = colors.filter((c) => GENERIC_COLORS.has(c.toLowerCase())).length;
  if (colors.length > 0 && bootstrapHits / colors.length > 0.5) s -= 25;
  else if (bootstrapHits > 0) s -= 10;

  const chromatic = colors.filter((c) => !isNearGray(c) && !isPureMonochrome(c));
  if (chromatic.length === 0 && colors.length > 0) s -= 30;
  else if (chromatic.length < 2 && colors.length > 3) s -= 15;

  const custom = fonts.filter((f) => !SYSTEM_FONTS.has(f.toLowerCase()));
  if (fonts.length > 0 && custom.length === 0) s -= 20;

  const uniqueSizes = new Set(sizes);
  if (sizes.length > 2 && uniqueSizes.size < 2) s -= 20;

  return Math.max(0, s);
}

function scoreColorDistinctiveness(all: OPNode[], collections?: OPVariableCollection[]): number {
  // Use all fill colors (including gradient) so gradient-only designs aren't penalised
  const colors = all.flatMap((n) => (n.fills ?? []).filter((f) => f.color).map((f) => f.color!));
  const chromatic = [...new Set(colors.filter((c) => !isNearGray(c) && !isPureMonochrome(c)).map((c) => c.toLowerCase()))];
  if (chromatic.length === 0) return 10;

  let s = 20;
  if (chromatic.length >= 1) s += 15;
  if (chromatic.length >= 3) s += 15;
  if (chromatic.length >= 5) s += 10;
  if (chromatic.length >= 8) s += 10;

  const nonGeneric = chromatic.filter((c) => !GENERIC_COLORS.has(c));
  if (nonGeneric.length > 0) s += 15;
  if (nonGeneric.length >= 3) s += 10;

  if (all.some((n) => n.fills?.some((f) => f.type.startsWith('gradient')))) s += 5;

  const colorTokens = collections?.flatMap((col) => col.variables.filter((v) => v.type === 'color')) ?? [];
  if (colorTokens.length >= 5) s += 5;

  return Math.min(100, s);
}

function scoreTypographyQuality(all: OPNode[]): number {
  const texts = all.filter((n) => n.type === 'text');
  if (texts.length === 0) return 30;

  let s = 20;
  const families = new Set(fontFamilies(all).map((f) => f.toLowerCase()));
  if (families.size === 1) s += 10;
  else if (families.size === 2) s += 25;
  else if (families.size >= 3) s += 20;

  if ([...families].some((f) => !SYSTEM_FONTS.has(f))) s += 15;

  const uniqueSizes = new Set(fontSizes(all));
  if (uniqueSizes.size >= 2) s += 10;
  if (uniqueSizes.size >= 3) s += 10;
  if (uniqueSizes.size >= 5) s += 5;

  const uniqueWeights = new Set(all.filter((n) => n.fontWeight !== undefined).map((n) => n.fontWeight!));
  if (uniqueWeights.size >= 2) s += 10;
  if (uniqueWeights.size >= 3) s += 5;

  return Math.min(100, s);
}

function scoreTokenCoherence(doc: OPDocument, all: OPNode[]): number {
  const cols = doc.variableCollections ?? [];
  if (cols.length === 0) return 25;

  let s = 30 + 20; // has collections
  const colorTokens = cols.flatMap((c) => c.variables.filter((v) => v.type === 'color'));
  if (colorTokens.length >= 3) s += 10;
  if (colorTokens.length >= 8) s += 10;

  const numericTokens = cols.flatMap((c) => c.variables.filter((v) => v.type === 'number'));
  if (numericTokens.length >= 3) s += 10;

  const spacingVals = all.flatMap((n) => n.padding
    ? [n.padding.top, n.padding.right, n.padding.bottom, n.padding.left]
    : []).concat(all.map((n) => n.layoutGap ?? 0)).filter((v) => v > 0);
  const gridAligned = spacingVals.filter((v) => v % 4 === 0);
  if (spacingVals.length > 0 && gridAligned.length / spacingVals.length >= 0.8) s += 10;

  return Math.min(100, s);
}

function scoreResponsiveness(all: OPNode[]): number {
  const frames = all.filter((n) => n.type === 'frame');
  if (frames.length === 0) return 20;
  let s = 20;
  const withLayout = frames.filter((n) => n.layoutMode && n.layoutMode !== 'none');
  if (withLayout.length > 0) s += 20;
  if (frames.length > 0 && withLayout.length / frames.length >= 0.5) s += 15;
  if (all.some((n) => n.constraints)) s += 15;
  if (all.some((n) => n.constraints?.horizontal === 'stretch' || n.constraints?.vertical === 'stretch' || n.layoutAlign === 'stretch')) s += 15;
  if (frames.some((n) => (n.layoutGap ?? 0) > 0)) s += 15;
  return Math.min(100, s);
}

function scoreAccessibility(all: OPNode[]): number {
  if (all.length === 0) return 0;
  let s = 100;
  const interactive = all.filter(
    (n) => (n.type === 'frame' || n.type === 'component' || n.type === 'instance')
      && n.width !== undefined && n.height !== undefined
      && /button|btn|icon|checkbox|radio|toggle/i.test(n.name),
  );
  const smallTargets = interactive.filter((n) => n.width! < 44 || n.height! < 44);
  s -= Math.min(30, smallTargets.length * 10);

  const texts = all.filter((n) => n.type === 'text');
  s -= Math.min(20, texts.filter((n) => (n.fontSize ?? 14) < 12).length * 5);
  if (texts.length === 0) s -= 20;

  const lowContrast = texts.filter((n) => {
    const c = n.fills?.[0]?.color;
    return c && contrastRatio(c, '#ffffff') < 3.0 && contrastRatio(c, '#000000') < 3.0;
  });
  s -= Math.min(30, lowContrast.length * 10);

  return Math.max(0, s);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function walkNodes(nodes: OPNode[]): OPNode[] {
  const out: OPNode[] = [];
  const visit = (list: OPNode[]) => {
    for (const n of list) { out.push(n); if (n.children) visit(n.children); }
  };
  visit(nodes);
  return out;
}

function maxDepth(nodes: OPNode[], d = 0): number {
  if (nodes.length === 0) return d;
  return Math.max(...nodes.map((n) => maxDepth(n.children ?? [], d + 1)));
}

function solidColors(nodes: OPNode[]): string[] {
  return nodes.flatMap((n) => [
    ...(n.fills ?? []).filter((f) => f.type === 'solid' && f.color).map((f) => f.color!),
    ...(n.strokes ?? []).map((s) => s.color),
  ]);
}

function fontFamilies(nodes: OPNode[]): string[] {
  return nodes.filter((n) => n.fontFamily).map((n) => n.fontFamily!);
}

function fontSizes(nodes: OPNode[]): number[] {
  return nodes.filter((n) => n.fontSize !== undefined).map((n) => n.fontSize!);
}

function isNearGray(hex: string): boolean {
  if (hex.length < 7) return true;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return Math.max(r, g, b) - Math.min(r, g, b) < 25;
}

function isPureMonochrome(hex: string): boolean {
  const l = hex.toLowerCase();
  return l === '#ffffff' || l === '#000000' || l === '#fff' || l === '#000';
}

function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
