// Design Rules Engine tests — all 15 rules, contrast math, grid snapping, auto-fix
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { hexToRgb, relativeLuminance, contrastRatio, nearestGridValue, isGridAligned } from '../src/core/design-rules-helpers.js';
import { evaluateDocument, loadRules, formatViolationReport, autoFixSuggestions, DEFAULT_CONFIG } from '../src/core/design-rules-engine.js';
import { createMediumOP, createSimpleOP, createBadSpacingOP } from './helpers/mock-op.js';

describe('Design Rules Helpers', () => {
  it('hexToRgb parses #RRGGBB', () => {
    const rgb = hexToRgb('#FF0000');
    assert.ok(rgb);
    assert.strictEqual(rgb.r, 255);
    assert.strictEqual(rgb.g, 0);
    assert.strictEqual(rgb.b, 0);
  });

  it('hexToRgb parses #RGB shorthand', () => {
    const rgb = hexToRgb('#F00');
    assert.ok(rgb);
    assert.strictEqual(rgb.r, 255);
    assert.strictEqual(rgb.g, 0);
    assert.strictEqual(rgb.b, 0);
  });

  it('hexToRgb returns null for invalid hex', () => {
    assert.strictEqual(hexToRgb('not-a-color'), null);
  });

  it('relativeLuminance of white is ~1.0', () => {
    const lum = relativeLuminance({ r: 255, g: 255, b: 255 });
    assert.ok(lum > 0.99);
  });

  it('relativeLuminance of black is ~0.0', () => {
    const lum = relativeLuminance({ r: 0, g: 0, b: 0 });
    assert.ok(lum < 0.01);
  });

  it('contrastRatio black on white is 21:1', () => {
    const ratio = contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 });
    assert.ok(ratio > 20.9 && ratio <= 21);
  });

  it('contrastRatio white on white is 1:1', () => {
    const ratio = contrastRatio({ r: 255, g: 255, b: 255 }, { r: 255, g: 255, b: 255 });
    assert.strictEqual(ratio, 1);
  });

  it('nearestGridValue snaps correctly', () => {
    assert.strictEqual(nearestGridValue(13, 4), 12);
    assert.strictEqual(nearestGridValue(15, 4), 16);
    assert.strictEqual(nearestGridValue(16, 4), 16);
    assert.strictEqual(nearestGridValue(7, 4), 8);
  });

  it('isGridAligned checks 4px grid', () => {
    assert.strictEqual(isGridAligned(16, 4), true);
    assert.strictEqual(isGridAligned(13, 4), false);
    assert.strictEqual(isGridAligned(0, 4), true);
  });
});

describe('evaluateDocument', () => {
  it('returns no errors for well-formed document', () => {
    const doc = createSimpleOP();
    const violations = evaluateDocument(doc);
    const errors = violations.filter(v => v.severity === 'error');
    assert.strictEqual(errors.length, 0);
  });

  it('detects grid violations in bad spacing document', () => {
    const doc = createBadSpacingOP();
    const violations = evaluateDocument(doc);
    const gridViolations = violations.filter(v => v.ruleId === 'grid-alignment');
    assert.ok(gridViolations.length > 0, 'Should detect grid violations');
  });

  it('detects font family usage', () => {
    const doc = createMediumOP();
    const violations = evaluateDocument(doc);
    const fontViolations = violations.filter(v => v.ruleId === 'font-count-limit');
    // Medium OP uses only Inter — should be within limit
    assert.strictEqual(fontViolations.length, 0);
  });

  it('detects empty frames', () => {
    const doc = createSimpleOP();
    // Root frame has children: [] which is empty
    const violations = evaluateDocument(doc);
    const emptyFrames = violations.filter(v => v.ruleId === 'empty-frames');
    assert.ok(emptyFrames.length > 0, 'Should detect empty root frame');
  });

  it('violations are sorted by severity (error > warning > info)', () => {
    const doc = createBadSpacingOP();
    const violations = evaluateDocument(doc);
    if (violations.length >= 2) {
      const severityOrder: Record<string, number> = { error: 0, warning: 1, info: 2 };
      for (let i = 1; i < violations.length; i++) {
        assert.ok(severityOrder[violations[i].severity] >= severityOrder[violations[i - 1].severity]);
      }
    }
  });
});

describe('loadRules', () => {
  it('returns 15 built-in rules', () => {
    const rules = loadRules();
    assert.strictEqual(rules.length, 15);
  });

  it('applies overrides to disable rules', () => {
    const rules = loadRules({ 'grid-alignment': { enabled: false } });
    const gridRule = rules.find(r => r.id === 'grid-alignment');
    assert.ok(gridRule);
    assert.strictEqual(gridRule.enabled, false);
  });

  it('applies severity overrides', () => {
    const rules = loadRules({ 'empty-frames': { severity: 'error' } });
    const rule = rules.find(r => r.id === 'empty-frames');
    assert.ok(rule);
    assert.strictEqual(rule.severity, 'error');
  });

  it('loads rule overrides from a yaml file path', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-rules-'));

    try {
      const overridesPath = path.join(tempRoot, 'design-rules.yaml');
      await fs.writeFile(overridesPath, [
        'rules:',
        '  grid-alignment:',
        '    enabled: false',
        '  empty-frames:',
        '    severity: error',
        '',
      ].join('\n'), 'utf8');

      const rules = loadRules(overridesPath as unknown as Record<string, { enabled?: boolean; severity?: 'error' | 'warning' | 'info' }>);
      const gridRule = rules.find(rule => rule.id === 'grid-alignment');
      const emptyFramesRule = rules.find(rule => rule.id === 'empty-frames');

      assert.ok(gridRule);
      assert.ok(emptyFramesRule);
      assert.strictEqual(gridRule.enabled, false);
      assert.strictEqual(emptyFramesRule.severity, 'error');
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });
});

describe('formatViolationReport', () => {
  it('returns clean message for no violations', () => {
    const report = formatViolationReport([]);
    assert.ok(report.includes('No design violations'));
  });

  it('formats violations as markdown', () => {
    const violations = evaluateDocument(createBadSpacingOP());
    const report = formatViolationReport(violations);
    assert.ok(report.includes('# Design Lint Report'));
    assert.ok(report.includes('errors'));
  });
});

describe('autoFixSuggestions', () => {
  it('generates fix suggestions for grid violations', () => {
    const doc = createBadSpacingOP();
    const violations = evaluateDocument(doc);
    const gridViolations = violations.filter(v => v.ruleId === 'grid-alignment');
    const suggestions = autoFixSuggestions(gridViolations);
    assert.ok(suggestions.length > 0);
    assert.strictEqual(suggestions[0].toolCall, 'setPadding');
  });
});
