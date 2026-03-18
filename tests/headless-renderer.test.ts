import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  renderToSVG,
  renderToASCII,
  renderToHTML,
} from '../src/harvested/openpencil/headless-renderer.js';
import {
  createSimpleOP,
  createMediumOP,
} from './helpers/mock-op.js';

describe('renderToSVG', () => {
  it('returns a string starting with <svg', () => {
    const doc = createSimpleOP();
    const svg = renderToSVG(doc);
    assert.strictEqual(typeof svg, 'string');
    assert.ok(svg.startsWith('<svg'));
  });

  it('includes data-name attributes', () => {
    const doc = createSimpleOP();
    const svg = renderToSVG(doc);
    assert.ok(svg.includes('data-name='));
    assert.ok(svg.includes('Root Frame'));
  });

  it('handles nested children', () => {
    const doc = createMediumOP();
    const svg = renderToSVG(doc);
    // Medium OP has nested children: Header, Login Card, title text, etc.
    assert.ok(svg.includes('Header'));
    assert.ok(svg.includes('Login Card'));
    assert.ok(svg.includes('MyApp'));
  });
});

describe('renderToASCII', () => {
  it('returns a string with frame names', () => {
    const doc = createMediumOP();
    const ascii = renderToASCII(doc);
    assert.strictEqual(typeof ascii, 'string');
    assert.ok(ascii.includes('Login Page'));
  });
});

describe('renderToHTML', () => {
  it('includes DOCTYPE and svg', () => {
    const doc = createSimpleOP();
    const html = renderToHTML(doc);
    assert.ok(html.includes('<!DOCTYPE html>'));
    assert.ok(html.includes('<svg'));
    assert.ok(html.includes('</svg>'));
  });
});

describe('renderToSVG edge cases', () => {
  it('empty document renders without error', () => {
    const emptyDoc = {
      formatVersion: '1.0.0',
      generator: 'test',
      created: '2026-03-12T00:00:00.000Z',
      document: { name: 'Empty', pages: [] },
      nodes: [],
    };
    const svg = renderToSVG(emptyDoc as any);
    assert.strictEqual(typeof svg, 'string');
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('Empty design'));
  });
});
