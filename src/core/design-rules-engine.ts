// Design Intelligence Rules Engine — 15-rule design quality evaluation engine
import fs from 'fs';
import yaml from 'yaml';
import type { OPDocument, OPNode } from '../harvested/openpencil/op-codec.js';
import {
  hexToRgb,
  contrastRatio,
  isGridAligned,
  nearestGridValue,
  findParentBackground,
} from './design-rules-helpers.js';

export interface DesignViolation {
  ruleId: string;
  ruleName: string;
  severity: 'error' | 'warning' | 'info';
  nodeId?: string;
  nodeName?: string;
  message: string;
  suggestion?: string;
}

export interface RuleConfig {
  minContrastRatio: number;
  gridUnit: number;
  maxFontCount: number;
  maxColorCount: number;
  namingPattern: RegExp;
  minTouchTargetSize: number;
}

export interface DesignRule {
  id: string;
  name: string;
  category: 'accessibility' | 'spacing' | 'typography' | 'color' | 'layout' | 'naming' | 'consistency';
  severity: 'error' | 'warning' | 'info';
  enabled: boolean;
  check: (doc: OPDocument, config: RuleConfig) => DesignViolation[];
}

export interface DesignRuleOverride {
  enabled?: boolean;
  severity?: 'error' | 'warning' | 'info';
}

interface DesignRulesFile {
  config?: Partial<Omit<RuleConfig, 'namingPattern'>> & { namingPattern?: string };
  rules?: Record<string, DesignRuleOverride>;
}

const DEFAULT_CONFIG: RuleConfig = {
  minContrastRatio: 4.5,
  gridUnit: 4,
  maxFontCount: 3,
  maxColorCount: 12,
  namingPattern: /^[a-z][a-z0-9-]*$/i,
  minTouchTargetSize: 44,
};

const DEFAULT_RULES_PATH = '.danteforge/design-rules.yaml';

// Utility: collect all nodes recursively
function collectAllNodes(nodes: OPNode[]): OPNode[] {
  const result: OPNode[] = [];
  function walk(node: OPNode) {
    result.push(node);
    if (node.children) node.children.forEach(walk);
  }
  nodes.forEach(walk);
  return result;
}

// Rule implementations

function checkWCAGContrast(doc: OPDocument, config: RuleConfig): DesignViolation[] {
  const violations: DesignViolation[] = [];
  const allNodes = collectAllNodes(doc.nodes);
  const textNodes = allNodes.filter(n => n.type === 'text');

  for (const node of textNodes) {
    const textColor = node.fills?.find(f => f.type === 'solid' && f.color)?.color;
    if (!textColor) continue;

    const bgColor = findParentBackground(node.id, doc.nodes);
    if (!bgColor) continue;

    const fgRgb = hexToRgb(textColor);
    const bgRgb = hexToRgb(bgColor);
    if (!fgRgb || !bgRgb) continue;

    const ratio = contrastRatio(fgRgb, bgRgb);
    if (ratio < config.minContrastRatio) {
      violations.push({
        ruleId: 'wcag-aa-contrast',
        ruleName: 'WCAG AA Contrast',
        severity: 'error',
        nodeId: node.id,
        nodeName: node.name,
        message: `Text contrast ratio ${ratio.toFixed(2)}:1 is below ${config.minContrastRatio}:1 (${textColor} on ${bgColor})`,
        suggestion: 'Darken the text color or lighten the background to meet WCAG AA requirements.',
      });
    }
  }
  return violations;
}

function checkGridAlignment(doc: OPDocument, config: RuleConfig): DesignViolation[] {
  const violations: DesignViolation[] = [];
  const allNodes = collectAllNodes(doc.nodes);

  for (const node of allNodes) {
    if (node.padding) {
      for (const [side, value] of Object.entries(node.padding)) {
        if (!isGridAligned(value, config.gridUnit)) {
          violations.push({
            ruleId: 'grid-alignment',
            ruleName: 'Grid Alignment',
            severity: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: `padding.${side}: ${value}px not on ${config.gridUnit}px grid`,
            suggestion: `Change to ${nearestGridValue(value, config.gridUnit)}px`,
          });
        }
      }
    }
    if (node.layoutGap !== undefined && !isGridAligned(node.layoutGap, config.gridUnit)) {
      violations.push({
        ruleId: 'grid-alignment',
        ruleName: 'Grid Alignment',
        severity: 'warning',
        nodeId: node.id,
        nodeName: node.name,
        message: `layoutGap: ${node.layoutGap}px not on ${config.gridUnit}px grid`,
        suggestion: `Change to ${nearestGridValue(node.layoutGap, config.gridUnit)}px`,
      });
    }
  }
  return violations;
}

function checkFontCountLimit(doc: OPDocument, config: RuleConfig): DesignViolation[] {
  const allNodes = collectAllNodes(doc.nodes);
  const families = new Set(allNodes.filter(n => n.fontFamily).map(n => n.fontFamily!));
  if (families.size > config.maxFontCount) {
    return [{
      ruleId: 'font-count-limit',
      ruleName: 'Font Count Limit',
      severity: 'warning',
      message: `${families.size} font families detected (limit: ${config.maxFontCount}): ${Array.from(families).join(', ')}`,
      suggestion: `Consolidate to ${config.maxFontCount} or fewer font families.`,
    }];
  }
  return [];
}

function checkColorCountLimit(doc: OPDocument, config: RuleConfig): DesignViolation[] {
  const allNodes = collectAllNodes(doc.nodes);
  const colors = new Set<string>();
  for (const node of allNodes) {
    if (node.fills) node.fills.forEach(f => { if (f.color) colors.add(f.color.toUpperCase()); });
    if (node.strokes) node.strokes.forEach(s => colors.add(s.color.toUpperCase()));
  }
  if (colors.size > config.maxColorCount) {
    return [{
      ruleId: 'color-count-limit',
      ruleName: 'Color Count Limit',
      severity: 'warning',
      message: `${colors.size} unique colors detected (limit: ${config.maxColorCount})`,
      suggestion: 'Consolidate your color palette to improve visual consistency.',
    }];
  }
  return [];
}

function checkMissingAltText(doc: OPDocument, _config: RuleConfig): DesignViolation[] {
  const violations: DesignViolation[] = [];
  const allNodes = collectAllNodes(doc.nodes);
  const imageTypes = new Set(['image', 'vector', 'svg']);

  for (const node of allNodes) {
    if (imageTypes.has(node.type) && (!node.name || node.name === node.type || /^(image|vector|svg)-\d+/.test(node.name))) {
      violations.push({
        ruleId: 'missing-alt-text',
        ruleName: 'Missing Alt Text',
        severity: 'warning',
        nodeId: node.id,
        nodeName: node.name,
        message: `Image/vector node "${node.name}" lacks a descriptive name for accessibility`,
        suggestion: 'Give this node a meaningful name that describes its content.',
      });
    }
  }
  return violations;
}

function checkConsistentSpacing(doc: OPDocument, config: RuleConfig): DesignViolation[] {
  const violations: DesignViolation[] = [];
  const allNodes = collectAllNodes(doc.nodes);
  const spacingValues = new Set<number>();

  for (const node of allNodes) {
    if (node.padding) Object.values(node.padding).forEach(v => spacingValues.add(v));
    if (node.layoutGap !== undefined) spacingValues.add(node.layoutGap);
  }

  const sorted = Array.from(spacingValues).sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i] - sorted[i - 1];
    if (diff > 0 && diff < config.gridUnit && diff !== 0) {
      violations.push({
        ruleId: 'consistent-spacing',
        ruleName: 'Consistent Spacing',
        severity: 'info',
        message: `Near-miss spacing values: ${sorted[i - 1]}px and ${sorted[i]}px differ by only ${diff}px`,
        suggestion: `Consider unifying to ${nearestGridValue(sorted[i], config.gridUnit)}px.`,
      });
    }
  }
  return violations;
}

function checkOrphanNodes(doc: OPDocument, _config: RuleConfig): DesignViolation[] {
  const violations: DesignViolation[] = [];
  for (const node of doc.nodes) {
    if (node.type !== 'frame' && node.type !== 'page' && node.type !== 'group') {
      violations.push({
        ruleId: 'orphan-nodes',
        ruleName: 'Orphan Nodes',
        severity: 'warning',
        nodeId: node.id,
        nodeName: node.name,
        message: `Node "${node.name}" is at root level without a parent frame/group`,
        suggestion: 'Place this node inside a frame or group for better organization.',
      });
    }
  }
  return violations;
}

function checkEmptyFrames(doc: OPDocument, _config: RuleConfig): DesignViolation[] {
  const violations: DesignViolation[] = [];
  const allNodes = collectAllNodes(doc.nodes);

  for (const node of allNodes) {
    if ((node.type === 'frame' || node.type === 'group') && (!node.children || node.children.length === 0)) {
      violations.push({
        ruleId: 'empty-frames',
        ruleName: 'Empty Frames',
        severity: 'info',
        nodeId: node.id,
        nodeName: node.name,
        message: `Frame/group "${node.name}" has no children`,
        suggestion: 'Add content to this frame or remove it if unused.',
      });
    }
  }
  return violations;
}

function checkTextOverflowRisk(doc: OPDocument, _config: RuleConfig): DesignViolation[] {
  const violations: DesignViolation[] = [];
  const allNodes = collectAllNodes(doc.nodes);

  for (const node of allNodes) {
    if (node.type === 'text' && node.width) {
      // Check if any parent frame is narrower
      const ancestors = findAncestorFrames(node.id, doc.nodes);
      for (const ancestor of ancestors) {
        if (ancestor.width && node.width > ancestor.width) {
          violations.push({
            ruleId: 'text-overflow-risk',
            ruleName: 'Text Overflow Risk',
            severity: 'warning',
            nodeId: node.id,
            nodeName: node.name,
            message: `Text "${node.name}" (${node.width}px) is wider than parent "${ancestor.name}" (${ancestor.width}px)`,
            suggestion: 'Reduce text width or increase parent frame width.',
          });
          break;
        }
      }
    }
  }
  return violations;
}

function checkUnnamedNodes(doc: OPDocument, _config: RuleConfig): DesignViolation[] {
  const violations: DesignViolation[] = [];
  const allNodes = collectAllNodes(doc.nodes);
  const defaultPatterns = [/^(frame|rectangle|ellipse|text|group|vector|image)-\d+/i, /^$/];

  for (const node of allNodes) {
    if (defaultPatterns.some(p => p.test(node.name))) {
      violations.push({
        ruleId: 'unnamed-nodes',
        ruleName: 'Unnamed Nodes',
        severity: 'info',
        nodeId: node.id,
        nodeName: node.name,
        message: `Node "${node.name || '(empty)'}" appears to have a default/empty name`,
        suggestion: 'Give this node a meaningful name for better organization.',
      });
    }
  }
  return violations;
}

function checkLayoutModeMissing(doc: OPDocument, _config: RuleConfig): DesignViolation[] {
  const violations: DesignViolation[] = [];
  const allNodes = collectAllNodes(doc.nodes);

  for (const node of allNodes) {
    if (node.type === 'frame' && node.children && node.children.length > 1 && (!node.layoutMode || node.layoutMode === 'none')) {
      violations.push({
        ruleId: 'layout-mode-missing',
        ruleName: 'Layout Mode Missing',
        severity: 'warning',
        nodeId: node.id,
        nodeName: node.name,
        message: `Frame "${node.name}" has ${node.children.length} children but no layoutMode set`,
        suggestion: 'Set layoutMode to "horizontal" or "vertical" for proper auto-layout.',
      });
    }
  }
  return violations;
}

function checkPaddingAsymmetry(doc: OPDocument, _config: RuleConfig): DesignViolation[] {
  const violations: DesignViolation[] = [];
  const allNodes = collectAllNodes(doc.nodes);

  for (const node of allNodes) {
    if (!node.padding) continue;
    const { top, bottom, left, right } = node.padding;
    if (top !== bottom && Math.abs(top - bottom) <= 4) {
      violations.push({
        ruleId: 'padding-asymmetry',
        ruleName: 'Padding Asymmetry',
        severity: 'info',
        nodeId: node.id,
        nodeName: node.name,
        message: `Top padding (${top}px) differs from bottom (${bottom}px) by only ${Math.abs(top - bottom)}px`,
        suggestion: `Consider unifying to ${Math.max(top, bottom)}px for visual consistency.`,
      });
    }
    if (left !== right && Math.abs(left - right) <= 4) {
      violations.push({
        ruleId: 'padding-asymmetry',
        ruleName: 'Padding Asymmetry',
        severity: 'info',
        nodeId: node.id,
        nodeName: node.name,
        message: `Left padding (${left}px) differs from right (${right}px) by only ${Math.abs(left - right)}px`,
        suggestion: `Consider unifying to ${Math.max(left, right)}px for visual consistency.`,
      });
    }
  }
  return violations;
}

function checkTouchTargetSize(doc: OPDocument, config: RuleConfig): DesignViolation[] {
  const violations: DesignViolation[] = [];
  const allNodes = collectAllNodes(doc.nodes);
  const interactivePatterns = /button|btn|link|input|toggle|switch|checkbox|radio|tab|select|slider/i;

  for (const node of allNodes) {
    if (!interactivePatterns.test(node.name)) continue;
    const w = node.width ?? 0;
    const h = node.height ?? 0;
    if (w > 0 && h > 0 && (w < config.minTouchTargetSize || h < config.minTouchTargetSize)) {
      violations.push({
        ruleId: 'touch-target-size',
        ruleName: 'Touch Target Size',
        severity: 'warning',
        nodeId: node.id,
        nodeName: node.name,
        message: `Interactive element "${node.name}" (${w}x${h}px) is below ${config.minTouchTargetSize}x${config.minTouchTargetSize}px minimum`,
        suggestion: `Increase size to at least ${config.minTouchTargetSize}x${config.minTouchTargetSize}px for touch accessibility.`,
      });
    }
  }
  return violations;
}

function checkColorVariableUsage(doc: OPDocument, _config: RuleConfig): DesignViolation[] {
  const violations: DesignViolation[] = [];
  if (!doc.variableCollections || doc.variableCollections.length === 0) return violations;

  const variableColors = new Set<string>();
  for (const coll of doc.variableCollections) {
    for (const v of coll.variables) {
      if (v.type === 'color' && typeof v.value === 'string') {
        variableColors.add(v.value.toUpperCase());
      }
    }
  }

  const allNodes = collectAllNodes(doc.nodes);
  for (const node of allNodes) {
    if (node.fills) {
      for (const fill of node.fills) {
        if (fill.color && !variableColors.has(fill.color.toUpperCase())) {
          violations.push({
            ruleId: 'color-variable-usage',
            ruleName: 'Color Variable Usage',
            severity: 'info',
            nodeId: node.id,
            nodeName: node.name,
            message: `Inline color ${fill.color} on "${node.name}" is not defined as a design variable`,
            suggestion: 'Consider adding this color to a variable collection for consistency.',
          });
        }
      }
    }
  }
  return violations;
}

function checkTypographyVariableUsage(doc: OPDocument, _config: RuleConfig): DesignViolation[] {
  const violations: DesignViolation[] = [];
  if (!doc.variableCollections || doc.variableCollections.length === 0) return violations;

  const variableFonts = new Set<string>();
  for (const coll of doc.variableCollections) {
    for (const v of coll.variables) {
      if (v.type === 'string' && typeof v.value === 'string') {
        variableFonts.add(v.value);
      }
    }
  }

  // Only flag if there are typography variables defined
  if (variableFonts.size === 0) return violations;

  const allNodes = collectAllNodes(doc.nodes);
  for (const node of allNodes) {
    if (node.fontFamily && !variableFonts.has(node.fontFamily)) {
      violations.push({
        ruleId: 'typography-variable-usage',
        ruleName: 'Typography Variable Usage',
        severity: 'info',
        nodeId: node.id,
        nodeName: node.name,
        message: `Font "${node.fontFamily}" on "${node.name}" is not defined as a design variable`,
        suggestion: 'Consider adding this font to a variable collection.',
      });
    }
  }
  return violations;
}

// Helper to find ancestor frames
function findAncestorFrames(nodeId: string, nodes: OPNode[]): OPNode[] {
  const ancestors: OPNode[] = [];

  function search(node: OPNode, path: OPNode[]): boolean {
    if (node.id === nodeId) {
      ancestors.push(...path.filter(n => n.type === 'frame').reverse());
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

// All 15 built-in rules
const BUILT_IN_RULES: DesignRule[] = [
  { id: 'wcag-aa-contrast', name: 'WCAG AA Contrast', category: 'accessibility', severity: 'error', enabled: true, check: checkWCAGContrast },
  { id: 'grid-alignment', name: 'Grid Alignment', category: 'spacing', severity: 'warning', enabled: true, check: checkGridAlignment },
  { id: 'font-count-limit', name: 'Font Count Limit', category: 'typography', severity: 'warning', enabled: true, check: checkFontCountLimit },
  { id: 'color-count-limit', name: 'Color Count Limit', category: 'color', severity: 'warning', enabled: true, check: checkColorCountLimit },
  { id: 'missing-alt-text', name: 'Missing Alt Text', category: 'accessibility', severity: 'warning', enabled: true, check: checkMissingAltText },
  { id: 'consistent-spacing', name: 'Consistent Spacing', category: 'consistency', severity: 'info', enabled: true, check: checkConsistentSpacing },
  { id: 'orphan-nodes', name: 'Orphan Nodes', category: 'layout', severity: 'warning', enabled: true, check: checkOrphanNodes },
  { id: 'empty-frames', name: 'Empty Frames', category: 'layout', severity: 'info', enabled: true, check: checkEmptyFrames },
  { id: 'text-overflow-risk', name: 'Text Overflow Risk', category: 'layout', severity: 'warning', enabled: true, check: checkTextOverflowRisk },
  { id: 'unnamed-nodes', name: 'Unnamed Nodes', category: 'naming', severity: 'info', enabled: true, check: checkUnnamedNodes },
  { id: 'layout-mode-missing', name: 'Layout Mode Missing', category: 'layout', severity: 'warning', enabled: true, check: checkLayoutModeMissing },
  { id: 'padding-asymmetry', name: 'Padding Asymmetry', category: 'consistency', severity: 'info', enabled: true, check: checkPaddingAsymmetry },
  { id: 'touch-target-size', name: 'Touch Target Size', category: 'accessibility', severity: 'warning', enabled: true, check: checkTouchTargetSize },
  { id: 'color-variable-usage', name: 'Color Variable Usage', category: 'consistency', severity: 'info', enabled: true, check: checkColorVariableUsage },
  { id: 'typography-variable-usage', name: 'Typography Variable Usage', category: 'consistency', severity: 'info', enabled: true, check: checkTypographyVariableUsage },
];

function resolveRuleSource(
  overridesOrPath?: Record<string, DesignRuleOverride> | string,
): { ruleOverrides: Record<string, DesignRuleOverride>; config: Partial<RuleConfig> } {
  if (!overridesOrPath) {
    return resolveRuleSource(DEFAULT_RULES_PATH);
  }

  if (typeof overridesOrPath !== 'string') {
    return { ruleOverrides: overridesOrPath, config: {} };
  }

  try {
    const raw = fs.readFileSync(overridesOrPath, 'utf8');
    const parsed = yaml.parse(raw) as DesignRulesFile | null;
    const config = parsed?.config ?? {};
    const { namingPattern, ...restConfig } = config;
    return {
      ruleOverrides: parsed?.rules ?? {},
      config: {
        ...restConfig,
        ...(namingPattern ? { namingPattern: new RegExp(namingPattern) } : {}),
      },
    };
  } catch {
    return { ruleOverrides: {}, config: {} };
  }
}

/**
 * Get all built-in rules, optionally with overrides applied.
 */
export function loadRules(overridesOrPath?: Record<string, DesignRuleOverride> | string): DesignRule[] {
  const { ruleOverrides } = resolveRuleSource(overridesOrPath);
  const rules = BUILT_IN_RULES.map(r => ({ ...r }));
  for (const rule of rules) {
    const override = ruleOverrides[rule.id];
    if (override) {
      if (override.enabled !== undefined) rule.enabled = override.enabled;
      if (override.severity !== undefined) rule.severity = override.severity;
    }
  }
  return rules;
}

export function loadRuleConfig(overridesOrPath?: Record<string, DesignRuleOverride> | string): Partial<RuleConfig> {
  return resolveRuleSource(overridesOrPath).config;
}

/**
 * Evaluate a document against all enabled rules.
 * Returns violations sorted by severity (error > warning > info).
 */
export function evaluateDocument(
  doc: OPDocument,
  rules?: DesignRule[],
  config?: Partial<RuleConfig>,
): DesignViolation[] {
  const sourceConfig = typeof rules === 'undefined' ? loadRuleConfig() : {};
  const activeRules = (rules ?? loadRules()).filter(r => r.enabled);
  const mergedConfig: RuleConfig = { ...DEFAULT_CONFIG, ...sourceConfig, ...config };
  const violations: DesignViolation[] = [];

  for (const rule of activeRules) {
    const ruleViolations = rule.check(doc, mergedConfig).map(violation => ({
      ...violation,
      ruleId: violation.ruleId || rule.id,
      ruleName: violation.ruleName || rule.name,
      severity: rule.severity,
    }));
    violations.push(...ruleViolations);
  }

  const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
  violations.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return violations;
}

/**
 * Format violations into a markdown report.
 */
export function formatViolationReport(violations: DesignViolation[]): string {
  if (violations.length === 0) return 'No design violations found.';

  const errors = violations.filter(v => v.severity === 'error');
  const warnings = violations.filter(v => v.severity === 'warning');
  const infos = violations.filter(v => v.severity === 'info');

  const lines: string[] = [
    `# Design Lint Report`,
    ``,
    `**${errors.length}** errors, **${warnings.length}** warnings, **${infos.length}** info`,
    ``,
  ];

  function formatGroup(title: string, items: DesignViolation[]) {
    if (items.length === 0) return;
    lines.push(`## ${title}`);
    for (const v of items) {
      const nodeRef = v.nodeName ? ` (${v.nodeName})` : '';
      lines.push(`- **${v.ruleName}**${nodeRef}: ${v.message}`);
      if (v.suggestion) lines.push(`  - Fix: ${v.suggestion}`);
    }
    lines.push('');
  }

  formatGroup('Errors', errors);
  formatGroup('Warnings', warnings);
  formatGroup('Info', infos);

  return lines.join('\n');
}

/**
 * Map violations to suggested tool calls that would fix them.
 */
export function autoFixSuggestions(violations: DesignViolation[]): Array<{ violation: DesignViolation; toolCall: string; params: Record<string, unknown> }> {
  const suggestions: Array<{ violation: DesignViolation; toolCall: string; params: Record<string, unknown> }> = [];

  for (const v of violations) {
    if (v.ruleId === 'grid-alignment' && v.nodeId && v.suggestion) {
      const match = v.message.match(/padding\.(\w+):\s*(\d+)px/);
      if (match) {
        const side = match[1];
        const nearestValue = nearestGridValue(parseInt(match[2], 10), 4);
        suggestions.push({
          violation: v,
          toolCall: 'setPadding',
          params: { nodeId: v.nodeId, [side!]: nearestValue },
        });
      }
    }
  }

  return suggestions;
}

export { DEFAULT_CONFIG };
