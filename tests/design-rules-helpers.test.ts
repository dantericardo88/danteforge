import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  nearestGridValue,
  isGridAligned,
  findParentBackground,
  type RGB,
  type TreeNode,
} from '../src/core/design-rules-helpers.js';

describe('hexToRgb', () => {
  it('parses 6-char hex', () => {
    const rgb = hexToRgb('#ff8800');
    assert.deepEqual(rgb, { r: 255, g: 136, b: 0 });
  });

  it('parses 3-char hex by expanding each digit', () => {
    const rgb = hexToRgb('#f80');
    assert.deepEqual(rgb, { r: 255, g: 136, b: 0 });
  });

  it('parses 8-char hex (ignores alpha)', () => {
    const rgb = hexToRgb('#ff8800ff');
    assert.deepEqual(rgb, { r: 255, g: 136, b: 0 });
  });

  it('works without # prefix', () => {
    const rgb = hexToRgb('ffffff');
    assert.deepEqual(rgb, { r: 255, g: 255, b: 255 });
  });

  it('returns null for invalid length', () => {
    assert.equal(hexToRgb('#ff'), null);
    assert.equal(hexToRgb('#fffff'), null);
  });

  it('parses black correctly', () => {
    assert.deepEqual(hexToRgb('#000000'), { r: 0, g: 0, b: 0 });
  });

  it('parses white correctly', () => {
    assert.deepEqual(hexToRgb('#ffffff'), { r: 255, g: 255, b: 255 });
  });
});

describe('relativeLuminance', () => {
  it('returns 0 for black', () => {
    const lum = relativeLuminance({ r: 0, g: 0, b: 0 });
    assert.ok(Math.abs(lum) < 0.001);
  });

  it('returns ~1 for white', () => {
    const lum = relativeLuminance({ r: 255, g: 255, b: 255 });
    assert.ok(Math.abs(lum - 1) < 0.001);
  });

  it('returns value between 0 and 1', () => {
    const lum = relativeLuminance({ r: 128, g: 64, b: 32 });
    assert.ok(lum >= 0 && lum <= 1);
  });
});

describe('contrastRatio', () => {
  it('white on black has maximum contrast (~21)', () => {
    const white: RGB = { r: 255, g: 255, b: 255 };
    const black: RGB = { r: 0, g: 0, b: 0 };
    const ratio = contrastRatio(white, black);
    assert.ok(ratio > 20 && ratio <= 21);
  });

  it('same color has ratio of 1', () => {
    const gray: RGB = { r: 128, g: 128, b: 128 };
    const ratio = contrastRatio(gray, gray);
    assert.ok(Math.abs(ratio - 1) < 0.001);
  });

  it('contrast is symmetric (fg/bg order does not matter)', () => {
    const a: RGB = { r: 0, g: 0, b: 255 };
    const b: RGB = { r: 255, g: 255, b: 0 };
    assert.ok(Math.abs(contrastRatio(a, b) - contrastRatio(b, a)) < 0.001);
  });

  it('returns a value >= 1', () => {
    const ratio = contrastRatio({ r: 100, g: 100, b: 100 }, { r: 200, g: 200, b: 200 });
    assert.ok(ratio >= 1);
  });
});

describe('nearestGridValue', () => {
  it('returns value unchanged when already on grid', () => {
    assert.equal(nearestGridValue(32, 8), 32);
  });

  it('rounds up when past midpoint', () => {
    assert.equal(nearestGridValue(13, 8), 16);
  });

  it('rounds down when before midpoint', () => {
    assert.equal(nearestGridValue(11, 8), 8);
  });

  it('handles 0 correctly', () => {
    assert.equal(nearestGridValue(0, 4), 0);
  });

  it('works with grid unit 1 (integer rounding)', () => {
    assert.equal(nearestGridValue(3.7, 1), 4);
  });
});

describe('isGridAligned', () => {
  it('returns true when value is multiple of grid unit', () => {
    assert.equal(isGridAligned(16, 8), true);
    assert.equal(isGridAligned(0, 8), true);
  });

  it('returns false when value is not aligned', () => {
    assert.equal(isGridAligned(13, 8), false);
  });
});

describe('findParentBackground', () => {
  it('returns null when no ancestors have fills', () => {
    const nodes: TreeNode[] = [
      {
        id: 'parent',
        children: [{ id: 'child' }],
      },
    ];
    const result = findParentBackground('child', nodes);
    assert.equal(result, null);
  });

  it('returns color from nearest ancestor with solid fill', () => {
    const nodes: TreeNode[] = [
      {
        id: 'root',
        fills: [{ type: 'solid', color: '#ffffff' }],
        children: [{ id: 'target' }],
      },
    ];
    const result = findParentBackground('target', nodes);
    assert.equal(result, '#ffffff');
  });

  it('returns null when node is not found in tree', () => {
    const nodes: TreeNode[] = [{ id: 'other' }];
    const result = findParentBackground('missing', nodes);
    assert.equal(result, null);
  });

  it('skips non-solid fills', () => {
    const nodes: TreeNode[] = [
      {
        id: 'parent',
        fills: [{ type: 'gradient' }],
        children: [{ id: 'child' }],
      },
    ];
    const result = findParentBackground('child', nodes);
    assert.equal(result, null);
  });

  it('walks up nested hierarchy', () => {
    const nodes: TreeNode[] = [
      {
        id: 'grandparent',
        fills: [{ type: 'solid', color: '#aabbcc' }],
        children: [
          {
            id: 'parent',
            children: [{ id: 'child' }],
          },
        ],
      },
    ];
    const result = findParentBackground('child', nodes);
    assert.equal(result, '#aabbcc');
  });
});
