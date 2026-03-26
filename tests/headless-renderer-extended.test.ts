// Extended headless-renderer tests — comprehensive coverage for renderToSVG, renderToHTML, renderToASCII
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToSVG, renderToASCII, renderToHTML } from '../src/harvested/openpencil/headless-renderer.js';
import type { OPDocument, OPNode } from '../src/harvested/openpencil/op-codec.js';

// ── Factory helpers ──

function makeDoc(nodes: OPNode[], name = 'Test Doc'): OPDocument {
  return {
    formatVersion: '1.0.0',
    generator: 'test',
    created: '2026-01-01T00:00:00.000Z',
    document: { name, pages: [] },
    nodes,
  };
}

function makeNode(overrides: Partial<OPNode> & { id: string; type: OPNode['type']; name: string }): OPNode {
  return { id: overrides.id, type: overrides.type, name: overrides.name, ...overrides };
}

// ── renderToSVG ──

describe('renderToSVG', () => {
  it('empty document (no nodes) returns SVG with "Empty design" text', () => {
    const doc = makeDoc([]);
    const svg = renderToSVG(doc);
    assert.ok(svg.includes('<svg'), 'Should contain an <svg opening tag');
    assert.ok(svg.includes('Empty design'), 'Should contain "Empty design" text');
    assert.ok(svg.includes('</svg>'), 'Should close the SVG element');
  });

  it('rectangle with cornerRadius produces <rect with rx= attribute', () => {
    const rect = makeNode({
      id: 'r1',
      type: 'rectangle',
      name: 'Rounded Box',
      x: 10,
      y: 20,
      width: 200,
      height: 100,
      cornerRadius: 12,
    });
    const svg = renderToSVG(makeDoc([rect]));
    assert.ok(svg.includes('<rect'), 'Should contain a <rect element');
    assert.ok(svg.includes('rx="12"'), 'Should have rx="12" for the corner radius');
  });

  it('ellipse node produces <ellipse with cx, cy, rx, ry attributes', () => {
    const ellipse = makeNode({
      id: 'e1',
      type: 'ellipse',
      name: 'Circle',
      x: 0,
      y: 0,
      width: 100,
      height: 60,
    });
    const svg = renderToSVG(makeDoc([ellipse]));
    assert.ok(svg.includes('<ellipse'), 'Should contain an <ellipse element');
    // cx = x + width/2 = 0 + 50 = 50, cy = y + height/2 = 0 + 30 = 30
    assert.ok(svg.includes('cx="50"'), 'cx should be 50');
    assert.ok(svg.includes('cy="30"'), 'cy should be 30');
    assert.ok(svg.includes('rx="50"'), 'rx should be 50 (width/2)');
    assert.ok(svg.includes('ry="30"'), 'ry should be 30 (height/2)');
  });

  it('text node with center align produces text-anchor="middle"', () => {
    const text = makeNode({
      id: 't1',
      type: 'text',
      name: 'Heading',
      x: 100,
      y: 50,
      characters: 'Hello World',
      fontSize: 24,
      textAlign: 'center',
    });
    const svg = renderToSVG(makeDoc([text]));
    assert.ok(svg.includes('text-anchor="middle"'), 'Center-aligned text should have text-anchor="middle"');
    assert.ok(svg.includes('Hello World'), 'Should contain the text characters');
    assert.ok(svg.includes('font-size="24"'), 'Should contain the font size');
  });

  it('line node produces <line with x1, y1, x2, y2 attributes', () => {
    const line = makeNode({
      id: 'l1',
      type: 'line',
      name: 'Divider',
      x: 10,
      y: 20,
      width: 200,
      strokes: [{ type: 'solid', color: '#cccccc', weight: 2 }],
    });
    const svg = renderToSVG(makeDoc([line]));
    assert.ok(svg.includes('<line'), 'Should contain a <line element');
    assert.ok(svg.includes('x1="10"'), 'x1 should be 10');
    assert.ok(svg.includes('y1="20"'), 'y1 should be 20');
    assert.ok(svg.includes('x2="210"'), 'x2 should be x + width = 210');
    assert.ok(svg.includes('y2="20"'), 'y2 should equal y1 (horizontal line)');
    assert.ok(svg.includes('stroke="#cccccc"'), 'Should have the stroke color');
    assert.ok(svg.includes('stroke-width="2"'), 'Should have the stroke width');
  });

  it('frame with child produces <g data-name= and nested child element', () => {
    const child = makeNode({
      id: 'child1',
      type: 'rectangle',
      name: 'Inner Rect',
      x: 5,
      y: 5,
      width: 90,
      height: 90,
    });
    const frame = makeNode({
      id: 'f1',
      type: 'frame',
      name: 'Card Frame',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      children: [child],
    });
    const svg = renderToSVG(makeDoc([frame]));
    assert.ok(svg.includes('<g data-name="Card Frame"'), 'Frame should produce a <g> with data-name');
    assert.ok(svg.includes('data-name="Inner Rect"'), 'Child rectangle should appear within the frame');
    // Verify nesting: the child rect should appear between the <g> opening and </g> closing
    const gIndex = svg.indexOf('<g data-name="Card Frame"');
    const childIndex = svg.indexOf('data-name="Inner Rect"');
    const gCloseIndex = svg.lastIndexOf('</g>');
    assert.ok(gIndex < childIndex, 'Child should appear after the <g> open tag');
    assert.ok(childIndex < gCloseIndex, 'Child should appear before the </g> close tag');
  });
});

// ── renderToHTML ──

describe('renderToHTML', () => {
  it('wraps SVG in DOCTYPE html with title', () => {
    const doc = makeDoc([], 'My Design');
    const html = renderToHTML(doc);
    assert.ok(html.startsWith('<!DOCTYPE html>'), 'Should start with DOCTYPE');
    assert.ok(html.includes('<html lang="en">'), 'Should include <html> tag');
    assert.ok(html.includes('<title>My Design'), 'Title should contain the document name');
    assert.ok(html.includes('</html>'), 'Should close the <html> tag');
    // The SVG should be embedded inside the HTML
    assert.ok(html.includes('<svg'), 'Should contain embedded SVG');
  });

  it('escapes HTML special chars in title', () => {
    const doc = makeDoc([], '<script>alert("xss")</script>');
    const html = renderToHTML(doc);
    // The title should be escaped — no raw <script> tags
    assert.ok(!html.includes('<script>alert'), 'Raw <script> should not appear in the output');
    assert.ok(html.includes('&lt;script&gt;'), 'Angle brackets should be escaped as &lt; and &gt;');
    assert.ok(html.includes('&quot;'), 'Double quotes should be escaped as &quot;');
  });
});

// ── renderToASCII ──

describe('renderToASCII', () => {
  it('empty document returns bordered "Empty Design" box', () => {
    const doc = makeDoc([]);
    const ascii = renderToASCII(doc);
    assert.ok(ascii.includes('Empty Design'), 'Should contain "Empty Design" text');
    assert.ok(ascii.includes('┌'), 'Should contain top-left corner character');
    assert.ok(ascii.includes('┐'), 'Should contain top-right corner character');
    assert.ok(ascii.includes('└'), 'Should contain bottom-left corner character');
    assert.ok(ascii.includes('┘'), 'Should contain bottom-right corner character');
  });

  it('text node shows TEXT type label and characters', () => {
    const text = makeNode({
      id: 'txt1',
      type: 'text',
      name: 'Label',
      characters: 'Sign In',
      width: 100,
      height: 30,
    });
    const ascii = renderToASCII(makeDoc([text]));
    assert.ok(ascii.includes('TEXT'), 'Should contain the TEXT type label');
    assert.ok(ascii.includes('"Sign In"'), 'Should contain the text characters in quotes');
    assert.ok(ascii.includes('100'), 'Should contain the width dimension');
  });
});

// ── Styling helpers ──

describe('Styling helpers in SVG output', () => {
  it('node with solid fill includes the fill color in SVG', () => {
    const rect = makeNode({
      id: 'filled1',
      type: 'rectangle',
      name: 'Blue Box',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fills: [{ type: 'solid', color: '#3B82F6' }],
    });
    const svg = renderToSVG(makeDoc([rect]));
    assert.ok(svg.includes('#3B82F6'), 'SVG should contain the fill color #3B82F6');
    assert.ok(svg.includes('fill="#3B82F6"'), 'Fill attribute should match the specified color');
  });

  it('node with drop-shadow effect produces <filter and <feDropShadow', () => {
    const frame = makeNode({
      id: 'shadow-frame',
      type: 'frame',
      name: 'Shadow Card',
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      effects: [{
        type: 'drop-shadow',
        color: '#00000040',
        offset: { x: 0, y: 4 },
        radius: 8,
      }],
    });
    const svg = renderToSVG(makeDoc([frame]));
    assert.ok(svg.includes('<filter'), 'Should contain a <filter element in <defs>');
    assert.ok(svg.includes('<feDropShadow'), 'Should contain a <feDropShadow element');
    assert.ok(svg.includes('id="shadow-shadow-frame"'), 'Filter id should reference the node id');
    assert.ok(svg.includes('flood-color="#00000040"'), 'Should contain the shadow color');
    assert.ok(svg.includes('filter="url(#shadow-shadow-frame)"'), 'Node should reference the filter via url()');
  });
});
