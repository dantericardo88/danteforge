import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractTokensFromDocument,
  tokensToCSS,
  tokensToTailwindConfig,
  tokensToStyledTheme,
} from '../src/harvested/openpencil/token-extractor.js';
import {
  createSimpleOP,
  createMediumOP,
} from './helpers/mock-op.js';

describe('extractTokensFromDocument', () => {
  it('returns a DesignTokens structure', () => {
    const doc = createSimpleOP();
    const tokens = extractTokensFromDocument(doc);
    assert.ok(tokens);
    assert.ok(typeof tokens.colors === 'object');
    assert.ok(typeof tokens.typography === 'object');
    assert.ok(typeof tokens.spacing === 'object');
    assert.ok(typeof tokens.radii === 'object');
    assert.ok(typeof tokens.shadows === 'object');
  });

  it('extracts colors from variable collections', () => {
    const doc = createMediumOP();
    const tokens = extractTokensFromDocument(doc);
    // The medium OP has a Colors variable collection with primary, background, text-primary, border
    assert.ok(Object.keys(tokens.colors).length > 0);
    // Check for the explicitly defined color variables
    assert.ok(tokens.colors['primary'] === '#3B82F6' || Object.values(tokens.colors).includes('#3B82F6'));
  });

  it('extracts colors from node fills', () => {
    const doc = createSimpleOP();
    const tokens = extractTokensFromDocument(doc);
    // The simple OP has a root frame with fill #FFFFFF
    assert.ok(Object.values(tokens.colors).includes('#FFFFFF'));
  });

  it('extracts typography from text nodes', () => {
    const doc = createMediumOP();
    const tokens = extractTokensFromDocument(doc);
    // Medium OP has text nodes with fontSize 16, 24, 28
    assert.ok(Object.keys(tokens.typography).length > 0);
    const sizes = Object.values(tokens.typography).map(t => t.size);
    assert.ok(sizes.some(s => s.includes('px')));
  });

  it('extracts spacing from padding values', () => {
    const doc = createMediumOP();
    const tokens = extractTokensFromDocument(doc);
    // Medium OP has various padding values (12, 16, 24, 32, 64)
    assert.ok(Object.keys(tokens.spacing).length > 0);
    const values = Object.values(tokens.spacing);
    assert.ok(values.some(v => v.includes('px')));
  });
});

describe('tokensToCSS', () => {
  it('produces valid CSS custom properties string', () => {
    const doc = createMediumOP();
    const tokens = extractTokensFromDocument(doc);
    const css = tokensToCSS(tokens);
    assert.ok(css.includes(':root {'));
    assert.ok(css.includes('}'));
    assert.ok(css.includes('--color-'));
    assert.ok(css.includes(';'));
  });
});

describe('tokensToTailwindConfig', () => {
  it('produces valid Tailwind config string', () => {
    const doc = createMediumOP();
    const tokens = extractTokensFromDocument(doc);
    const config = tokensToTailwindConfig(tokens);
    assert.ok(config.includes('module.exports'));
    assert.ok(config.includes('theme'));
    assert.ok(config.includes('extend'));
  });
});

describe('tokensToStyledTheme', () => {
  it('produces valid theme export', () => {
    const doc = createMediumOP();
    const tokens = extractTokensFromDocument(doc);
    const theme = tokensToStyledTheme(tokens);
    assert.ok(theme.includes('export const theme'));
    assert.ok(theme.includes('as const'));
    assert.ok(theme.includes('export type Theme'));
  });
});
