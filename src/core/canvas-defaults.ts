// canvas-defaults — seed design template for the canvas preset.
// Provides a high-quality starting point with brand palette, font pairing,
// responsive layout structure, and design tokens. Scored by canvas-quality-scorer.

import type { OPDocument, OPNode, OPVariableCollection } from '../harvested/openpencil/op-codec.js';

export interface CanvasSeedOptions {
  projectName?: string;
  primaryColor?: string;
  accentColor?: string;
  fontHeading?: string;
  fontBody?: string;
}

interface SeedPalette {
  primary: string; accent: string; surface: string;
  textPrimary: string; textMuted: string; border: string;
  violet: string; navText: string;
  fontHeading: string; fontBody: string;
}

function buildNavButton(id: string, label: string, active: boolean, p: SeedPalette): OPNode {
  return {
    id, type: 'frame', name: 'btn-nav', width: 208, height: 44, cornerRadius: 8,
    fills: active ? [{ type: 'solid', color: p.accent }] : [],
    children: [{
      id: `${id}t`, type: 'text', name: 'NavLabel', characters: label,
      fontSize: 14, fontFamily: p.fontBody, fontWeight: active ? 600 : 400,
      fills: [{ type: 'solid', color: active ? p.primary : p.navText }],
    }],
  };
}

function buildSidebarNode(projectName: string, p: SeedPalette): OPNode {
  return {
    id: 'sidebar', type: 'frame', name: 'Sidebar',
    width: 240, height: 900, layoutMode: 'vertical', layoutGap: 8,
    padding: { top: 32, right: 16, bottom: 32, left: 16 },
    fills: [{ type: 'solid', color: p.primary }],
    constraints: { horizontal: 'min', vertical: 'stretch' },
    children: [
      {
        id: 'logo', type: 'text', name: 'Logo', characters: projectName,
        fontSize: 22, fontFamily: p.fontHeading, fontWeight: 700,
        fills: [{ type: 'solid', color: p.accent }],
      },
      {
        id: 'nav', type: 'frame', name: 'Nav',
        layoutMode: 'vertical', layoutGap: 4, width: 208, height: 200, fills: [],
        children: [
          buildNavButton('nav1', 'Dashboard', true, p),
          buildNavButton('nav2', 'Analytics', false, p),
          buildNavButton('nav3', 'Reports', false, p),
        ],
      },
    ],
  };
}

function buildMetricCardsRow(p: SeedPalette): OPNode {
  return {
    id: 'cards', type: 'frame', name: 'MetricCards',
    layoutMode: 'horizontal', layoutGap: 20, height: 120, width: 1104, fills: [],
    constraints: { horizontal: 'stretch', vertical: 'min' },
    children: [
      {
        id: 'c1', type: 'frame', name: 'MetricCard', width: 256, height: 120, cornerRadius: 12,
        fills: [{ type: 'solid', color: p.primary }],
        effects: [{ type: 'drop-shadow', offset: { x: 0, y: 4 }, radius: 16, color: '#1A0B3B30' }],
        children: [
          { id: 'c1v', type: 'text', name: 'MetricValue', characters: '$2.4M', fontSize: 36, fontFamily: p.fontHeading, fontWeight: 700, fills: [{ type: 'solid', color: p.accent }] },
          { id: 'c1l', type: 'text', name: 'MetricLabel', characters: 'Revenue', fontSize: 12, fontFamily: p.fontBody, fontWeight: 500, fills: [{ type: 'solid', color: p.navText }] },
        ],
      },
      {
        id: 'c2', type: 'frame', name: 'MetricCard', width: 256, height: 120, cornerRadius: 12,
        fills: [{ type: 'solid', color: '#FFFFFF' }],
        strokes: [{ type: 'solid', color: p.border, weight: 1 }],
        children: [
          { id: 'c2v', type: 'text', name: 'MetricValue', characters: '12,847', fontSize: 36, fontFamily: p.fontHeading, fontWeight: 700, fills: [{ type: 'solid', color: p.primary }] },
          { id: 'c2l', type: 'text', name: 'MetricLabel', characters: 'Users', fontSize: 12, fontFamily: p.fontBody, fontWeight: 500, fills: [{ type: 'solid', color: p.textMuted }] },
        ],
      },
      {
        id: 'c3', type: 'frame', name: 'MetricCard', width: 256, height: 120, cornerRadius: 12,
        fills: [{ type: 'gradient-linear', color: p.violet }],
        children: [
          { id: 'c3v', type: 'text', name: 'MetricValue', characters: '98.2%', fontSize: 36, fontFamily: p.fontHeading, fontWeight: 700, fills: [{ type: 'solid', color: '#FFFFFF' }] },
          { id: 'c3l', type: 'text', name: 'MetricLabel', characters: 'Uptime', fontSize: 12, fontFamily: p.fontBody, fontWeight: 500, fills: [{ type: 'solid', color: '#E8D8FF' }] },
        ],
      },
    ],
  };
}

function buildChartArea(p: SeedPalette): OPNode {
  return {
    id: 'chart', type: 'frame', name: 'ChartArea',
    width: 1104, height: 280, cornerRadius: 12,
    layoutMode: 'vertical', layoutGap: 16,
    padding: { top: 24, right: 24, bottom: 24, left: 24 },
    fills: [{ type: 'solid', color: '#FFFFFF' }],
    strokes: [{ type: 'solid', color: p.border, weight: 1 }],
    constraints: { horizontal: 'stretch', vertical: 'min' },
    children: [
      { id: 'ctitle', type: 'text', name: 'ChartTitle', characters: 'Revenue Trend', fontSize: 18, fontFamily: p.fontHeading, fontWeight: 600, fills: [{ type: 'solid', color: p.textPrimary }] },
      { id: 'carea', type: 'rectangle', name: 'ChartPlaceholder', width: 1056, height: 180, cornerRadius: 8, fills: [{ type: 'solid', color: p.surface }] },
    ],
  };
}

function buildMainNode(p: SeedPalette): OPNode {
  return {
    id: 'main', type: 'frame', name: 'Main',
    width: 1200, height: 900, layoutMode: 'vertical', layoutGap: 24,
    padding: { top: 40, right: 48, bottom: 40, left: 48 },
    fills: [{ type: 'solid', color: p.surface }],
    constraints: { horizontal: 'stretch', vertical: 'stretch' },
    children: [
      {
        id: 'header', type: 'frame', name: 'Header',
        layoutMode: 'horizontal', layoutGap: 0, height: 64, width: 1104, fills: [],
        children: [
          { id: 'title', type: 'text', name: 'PageTitle', characters: 'Overview', fontSize: 32, fontFamily: p.fontHeading, fontWeight: 700, fills: [{ type: 'solid', color: p.textPrimary }], constraints: { horizontal: 'stretch', vertical: 'center' } },
          { id: 'subtitle', type: 'text', name: 'DateRange', characters: 'Q4 2026', fontSize: 14, fontFamily: p.fontBody, fontWeight: 400, fills: [{ type: 'solid', color: p.textMuted }] },
        ],
      },
      buildMetricCardsRow(p),
      buildChartArea(p),
    ],
  };
}

function buildBrandCollection(p: SeedPalette): OPVariableCollection {
  return {
    id: 'brand', name: 'Brand',
    variables: [
      { id: 'b1', name: 'color-bg-primary', collection: 'brand', type: 'color', value: p.primary },
      { id: 'b2', name: 'color-accent', collection: 'brand', type: 'color', value: p.accent },
      { id: 'b3', name: 'color-surface', collection: 'brand', type: 'color', value: p.surface },
      { id: 'b4', name: 'color-text-primary', collection: 'brand', type: 'color', value: p.textPrimary },
      { id: 'b5', name: 'color-text-muted', collection: 'brand', type: 'color', value: p.textMuted },
      { id: 'b6', name: 'color-border', collection: 'brand', type: 'color', value: p.border },
      { id: 'b7', name: 'color-violet', collection: 'brand', type: 'color', value: p.violet },
      { id: 'b8', name: 'color-nav-text', collection: 'brand', type: 'color', value: p.navText },
      { id: 's1', name: 'space-xs', collection: 'brand', type: 'number', value: 4 },
      { id: 's2', name: 'space-sm', collection: 'brand', type: 'number', value: 8 },
      { id: 's3', name: 'space-md', collection: 'brand', type: 'number', value: 16 },
      { id: 's4', name: 'space-lg', collection: 'brand', type: 'number', value: 24 },
      { id: 's5', name: 'space-xl', collection: 'brand', type: 'number', value: 40 },
      { id: 's6', name: 'space-2xl', collection: 'brand', type: 'number', value: 48 },
    ],
  };
}

export function getCanvasSeedDocument(options: CanvasSeedOptions = {}): OPDocument {
  const {
    projectName = 'App',
    primaryColor = '#1A0B3B',
    accentColor = '#F5E642',
    fontHeading = 'Playfair Display',
    fontBody = 'Syne',
  } = options;

  const p: SeedPalette = {
    primary: primaryColor, accent: accentColor,
    surface: '#F7F4FF', textPrimary: '#1A0B3B', textMuted: '#8B7BAD',
    border: '#E2D9F3', violet: '#6B2FBD', navText: '#C8B8E8',
    fontHeading, fontBody,
  };

  return {
    formatVersion: '1.0.0',
    generator: 'danteforge/canvas-defaults',
    created: new Date().toISOString(),
    document: { name: projectName, pages: [] },
    nodes: [{
      id: 'root', type: 'frame', name: projectName,
      width: 1440, height: 900, layoutMode: 'horizontal', layoutGap: 0,
      fills: [{ type: 'solid', color: p.surface }],
      constraints: { horizontal: 'stretch', vertical: 'stretch' },
      children: [buildSidebarNode(projectName, p), buildMainNode(p)],
    }],
    variableCollections: [buildBrandCollection(p)],
  };
}
