import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseOP,
  stringifyOP,
  validateOP,
  diffOP,
  createSkeletonOP,
} from '../src/harvested/openpencil/op-codec.js';
import {
  createSimpleOP,
  createMediumOP,
  createBadSpacingOP,
  createBadColorsOP,
  getSimpleOPString,
} from './helpers/mock-op.js';

describe('parseOP', () => {
  it('parses valid JSON into OPDocument', () => {
    const jsonStr = getSimpleOPString();
    const doc = parseOP(jsonStr);
    assert.strictEqual(doc.formatVersion, '1.0.0');
    assert.strictEqual(doc.generator, 'danteforge-test');
    assert.strictEqual(doc.document.name, 'Test Design');
    assert.ok(Array.isArray(doc.nodes));
    assert.ok(Array.isArray(doc.document.pages));
    assert.strictEqual(doc.nodes.length, 1);
    assert.strictEqual(doc.nodes[0].id, 'frame-1');
  });

  it('throws on invalid JSON', () => {
    assert.throws(() => parseOP('{ not valid json }'), {
      name: 'SyntaxError',
    });
    assert.throws(() => parseOP(''), {
      name: 'SyntaxError',
    });
  });

  it('throws on missing document/nodes fields', () => {
    // Has valid JSON but missing required structure
    const noDocument = JSON.stringify({ nodes: [], formatVersion: '1.0.0' });
    assert.throws(() => parseOP(noDocument), {
      message: /missing required "document" and "nodes" fields/,
    });

    const noNodes = JSON.stringify({ document: { name: 'X', pages: [] }, formatVersion: '1.0.0' });
    assert.throws(() => parseOP(noNodes), {
      message: /missing required "document" and "nodes" fields/,
    });

    const neither = JSON.stringify({ formatVersion: '1.0.0', metadata: {} });
    assert.throws(() => parseOP(neither), {
      message: /missing required "document" and "nodes" fields/,
    });
  });

  it('rejects oversized files (>2MB)', () => {
    // Create a string exceeding the 2MB limit
    const oversized = 'x'.repeat(2 * 1024 * 1024 + 1);
    assert.throws(() => parseOP(oversized), {
      message: /exceeds maximum size/,
    });
  });
});

describe('stringifyOP', () => {
  it('produces valid JSON roundtrip', () => {
    const original = createSimpleOP();
    const serialized = stringifyOP(original);
    const reparsed = JSON.parse(serialized);

    // Core fields preserved through roundtrip
    assert.strictEqual(reparsed.formatVersion, original.formatVersion);
    assert.strictEqual(reparsed.generator, original.generator);
    assert.strictEqual(reparsed.document.name, original.document.name);
    assert.strictEqual(reparsed.nodes.length, original.nodes.length);
    assert.strictEqual(reparsed.nodes[0].id, original.nodes[0].id);

    // Verify it sets a modified timestamp
    assert.ok(reparsed.modified);

    // Verify deterministic formatting (indented with 2 spaces)
    assert.ok(serialized.includes('\n'));
    assert.ok(serialized.startsWith('{'));
  });
});

describe('validateOP', () => {
  it('returns valid for well-formed documents', () => {
    const doc = createSimpleOP();
    const result = validateOP(doc);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);
  });

  it('catches missing required fields', () => {
    // Construct a doc missing critical fields
    const broken = {
      formatVersion: '',
      generator: 'test',
      created: '2026-01-01',
      document: null as unknown as { name: string; pages: [] },
      nodes: null as unknown as [],
    };
    const result = validateOP(broken as any);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
    // Should flag missing formatVersion, document, nodes
    const errorText = result.errors.join(' ');
    assert.ok(errorText.includes('Missing'));
  });

  it('warns on bad spacing (not on 4px grid)', () => {
    const doc = createBadSpacingOP();
    const result = validateOP(doc);
    // Bad spacing produces warnings, not errors
    assert.ok(result.warnings.length > 0);
    const warningText = result.warnings.join(' ');
    assert.ok(warningText.includes('4px grid'));
  });

  it('catches invalid hex colors', () => {
    const doc = createBadColorsOP();
    const result = validateOP(doc);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.length > 0);
    const errorText = result.errors.join(' ');
    assert.ok(errorText.includes('invalid fill color'));
  });
});

describe('diffOP', () => {
  it('detects added/removed/modified nodes', () => {
    const docA = createSimpleOP();
    const docB = createSimpleOP();

    // Modify a node name
    docB.nodes[0].name = 'Renamed Frame';

    // Add a new node
    docB.nodes.push({
      id: 'new-node-1',
      type: 'rectangle',
      name: 'New Rectangle',
      width: 100,
      height: 100,
    });

    // Remove original node by changing A to have an extra node not in B
    const docC = createSimpleOP();
    docC.nodes.push({
      id: 'will-be-removed',
      type: 'ellipse',
      name: 'Removed Ellipse',
    });

    // Diff A (has extra node) vs B (does not have it, but has new-node-1)
    const diff = diffOP(docC, docB);

    assert.ok(diff.summary.added > 0, 'Should detect added nodes');
    assert.ok(diff.summary.removed > 0, 'Should detect removed nodes');

    // Also test modification detection
    const diffMod = diffOP(docA, docB);
    assert.ok(diffMod.summary.modified > 0, 'Should detect modified nodes');
    assert.ok(diffMod.summary.added > 0, 'Should detect added nodes');

    // Verify entries array is populated
    assert.ok(diffMod.entries.length > 0);
    const types = diffMod.entries.map(e => e.type);
    assert.ok(types.includes('modified'));
    assert.ok(types.includes('added'));
  });
});

describe('createSkeletonOP', () => {
  it('creates valid document', () => {
    const doc = createSkeletonOP('My Project');
    const result = validateOP(doc);
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.errors.length, 0);

    // Verify project name
    assert.strictEqual(doc.document.name, 'My Project');

    // Verify default page name
    assert.strictEqual(doc.document.pages[0].name, 'Main');
    assert.strictEqual(doc.document.pages[0].type, 'page');

    // Verify root frame
    assert.ok(doc.nodes.length >= 1);
    assert.strictEqual(doc.nodes[0].type, 'frame');
    assert.strictEqual(doc.nodes[0].width, 1440);
    assert.strictEqual(doc.nodes[0].height, 900);

    // Verify custom page name
    const custom = createSkeletonOP('Other', 'Dashboard');
    assert.strictEqual(custom.document.pages[0].name, 'Dashboard');

    // Verify format version is set
    assert.ok(doc.formatVersion);
    assert.ok(doc.created);
  });
});
